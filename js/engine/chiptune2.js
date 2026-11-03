/**
 * js/engine/chiptune2.js - Real-time Chiptune2 DSP player engine.
 */
(function(window) {
  var ChiptuneAudioContext = window.AudioContext || window.webkitAudioContext;

  function ChiptuneJsPlayer() {
    this.context = new ChiptuneAudioContext({ sampleRate: 48000 });
    this.gainNode = this.context.createGain();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 64;
    this.analyser.smoothingTimeConstant = 0.82;

    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.context.destination);

    this.currentPlayingNode = null;
    this.repeatCount = -1;
    this.handlers = {};
  }

  ChiptuneJsPlayer.prototype.on = function(eventName, handler) {
    this.handlers[eventName] = handler;
  };

  ChiptuneJsPlayer.prototype.fireEvent = function(eventName, arg) {
    if (typeof this.handlers[eventName] === 'function') {
      this.handlers[eventName](arg);
    }
  };

  ChiptuneJsPlayer.prototype.unlock = function() {
    if (this.context.state === 'suspended') {
      this.context.resume();
    }
  };

  ChiptuneJsPlayer.prototype.load = function(input, callback) {
    var player = this;
    if (input instanceof File || input instanceof Blob) {
      var reader = new FileReader();
      reader.onload = function() { callback(reader.result); };
      reader.readAsArrayBuffer(input);
    } else if (typeof input === 'string') {
      fetch(input)
        .then(function(res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.arrayBuffer();
        })
        .then(function(buf) { callback(buf); })
        .catch(function(err) { player.fireEvent('onError', err); });
    } else if (input instanceof ArrayBuffer) {
      callback(input);
    }
  };

  ChiptuneJsPlayer.prototype.readMetadata = function(buffer) {
    if (typeof libopenmpt === 'undefined' || !libopenmpt._openmpt_module_create_from_memory) return null;
    var byteArray = new Uint8Array(buffer);
    var ptr = libopenmpt._malloc(byteArray.byteLength);
    libopenmpt.HEAPU8.set(byteArray, ptr);
    var mod = libopenmpt._openmpt_module_create_from_memory(ptr, byteArray.byteLength, 0, 0, 0);
    if (!mod) {
      libopenmpt._free(ptr);
      return null;
    }
    var meta = {};
    ['title', 'artist', 'type_long', 'tracker', 'message'].forEach(function(k) {
      meta[k] = libopenmpt.ccall('openmpt_module_get_metadata', 'string', ['number', 'string'], [mod, k]) || '';
    });
    meta.channels = libopenmpt.ccall('openmpt_module_get_num_channels', 'number', ['number'], [mod]) || 0;
    meta.duration = libopenmpt._openmpt_module_get_duration_seconds(mod) || 180;
    libopenmpt._openmpt_module_destroy(mod);
    libopenmpt._free(ptr);
    return meta;
  };

  ChiptuneJsPlayer.prototype.play = function(buffer) {
    this.stop();
    this.unlock();

    var sampleRate = 48000;
    var maxFramesPerChunk = 4096;
    var processNode = this.context.createScriptProcessor(8192, 0, 2);
    processNode.player = this;

    var byteArray = new Uint8Array(buffer);
    var ptrToFile = libopenmpt._malloc(byteArray.byteLength);
    libopenmpt.HEAPU8.set(byteArray, ptrToFile);
    processNode.ptrToFile = ptrToFile;

    var mod = libopenmpt._openmpt_module_create_from_memory(ptrToFile, byteArray.byteLength, 0, 0, 0);
    if (!mod) {
      libopenmpt._free(ptrToFile);
      this.fireEvent('onError', new Error("Could not parse tracker module."));
      return null;
    }
    processNode.modulePtr = mod;

    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [mod, 3, 4]);
    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [mod, 4, 5]);
    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [mod, 2, 100]);
    libopenmpt.ccall('openmpt_module_set_repeat_count', 'number', ['number', 'number'], [mod, this.repeatCount]);

    processNode.paused = false;
    processNode.leftBufferPtr = libopenmpt._malloc(4 * maxFramesPerChunk);
    processNode.rightBufferPtr = libopenmpt._malloc(4 * maxFramesPerChunk);

    processNode.cleanup = function() {
      if (this.modulePtr) { libopenmpt._openmpt_module_destroy(this.modulePtr); this.modulePtr = 0; }
      if (this.leftBufferPtr) { libopenmpt._free(this.leftBufferPtr); this.leftBufferPtr = 0; }
      if (this.rightBufferPtr) { libopenmpt._free(this.rightBufferPtr); this.rightBufferPtr = 0; }
      if (this.ptrToFile) { libopenmpt._free(this.ptrToFile); this.ptrToFile = 0; }
    };

    processNode.onaudioprocess = function(e) {
      var outL = e.outputBuffer.getChannelData(0);
      var outR = e.outputBuffer.getChannelData(1);
      var framesToRender = outL.length;

      if (this.paused) {
        outL.fill(0);
        outR.fill(0);
        return;
      }

      var framesRendered = 0;
      var ended = false;

      while (framesToRender > 0) {
        var framesPerChunk = Math.min(framesToRender, maxFramesPerChunk);
        var actual = libopenmpt._openmpt_module_read_float_stereo(
          this.modulePtr,
          sampleRate,
          framesPerChunk,
          this.leftBufferPtr,
          this.rightBufferPtr
        );

        if (actual === 0) ended = true;

        var rawL = libopenmpt.HEAPF32.subarray(this.leftBufferPtr / 4, this.leftBufferPtr / 4 + actual);
        var rawR = libopenmpt.HEAPF32.subarray(this.rightBufferPtr / 4, this.rightBufferPtr / 4 + actual);

        for (var i = 0; i < actual; i++) {
          var sL = rawL[i];
          var sR = rawR[i];
          if (sL > 1.0) sL = 1.0 - Math.exp(-sL);
          else if (sL < -1.0) sL = -1.0 + Math.exp(sL);
          if (sR > 1.0) sR = 1.0 - Math.exp(-sR);
          else if (sR < -1.0) sR = -1.0 + Math.exp(sR);

          outL[framesRendered + i] = sL;
          outR[framesRendered + i] = sR;
        }

        for (var j = actual; j < framesPerChunk; j++) {
          outL[framesRendered + j] = 0;
          outR[framesRendered + j] = 0;
        }

        framesToRender -= framesPerChunk;
        framesRendered += framesPerChunk;

        if (ended) {
          this.disconnect();
          this.cleanup();
          this.player.currentPlayingNode = null;
          this.player.fireEvent('onEnded');
          return;
        }
      }
    };

    this.currentPlayingNode = processNode;
    processNode.connect(this.gainNode);
    this.fireEvent('onPlay');
    return processNode;
  };

  ChiptuneJsPlayer.prototype.stop = function() {
    if (this.currentPlayingNode) {
      this.currentPlayingNode.disconnect();
      this.currentPlayingNode.cleanup();
      this.currentPlayingNode = null;
      this.fireEvent('onStop');
    }
  };

  ChiptuneJsPlayer.prototype.togglePause = function() {
    if (this.currentPlayingNode) {
      this.currentPlayingNode.paused = !this.currentPlayingNode.paused;
      return this.currentPlayingNode.paused;
    }
    return false;
  };

  ChiptuneJsPlayer.prototype.seek = function(seconds) {
    if (this.currentPlayingNode && this.currentPlayingNode.modulePtr) {
      libopenmpt.ccall('openmpt_module_set_position_seconds', 'number', ['number', 'number'], [this.currentPlayingNode.modulePtr, seconds]);
    }
  };

  ChiptuneJsPlayer.prototype.getPosition = function() {
    if (this.currentPlayingNode && this.currentPlayingNode.modulePtr) {
      return libopenmpt.ccall('openmpt_module_get_position_seconds', 'number', ['number'], [this.currentPlayingNode.modulePtr]);
    }
    return 0;
  };

  ChiptuneJsPlayer.prototype.duration = function() {
    if (this.currentPlayingNode && this.currentPlayingNode.modulePtr) {
      return libopenmpt.ccall('openmpt_module_get_duration_seconds', 'number', ['number'], [this.currentPlayingNode.modulePtr]);
    }
    return 0;
  };

  ChiptuneJsPlayer.prototype.setVolume = function(vol) {
    this.gainNode.gain.setValueAtTime(vol, this.context.currentTime);
  };

  ChiptuneJsPlayer.prototype.setRepeat = function(loop) {
    this.repeatCount = loop ? -1 : 0;
    if (this.currentPlayingNode && this.currentPlayingNode.modulePtr) {
      libopenmpt.ccall('openmpt_module_set_repeat_count', 'number', ['number', 'number'], [this.currentPlayingNode.modulePtr, this.repeatCount]);
    }
  };

  window.ChiptuneJsPlayer = ChiptuneJsPlayer;
})(window);