/**
 * js/engine/chiptune2.js - Zero-allocation real-time Chiptune2 DSP player engine.
 */
(function(window) {
  var ChiptuneAudioContext = window.AudioContext || window.webkitAudioContext;
  var BUFFER_FRAMES = 16384;

  function ChiptuneJsPlayer() {
    try {
      this.context = new ChiptuneAudioContext({ sampleRate: 48000 });
    } catch (e) {
      this.context = new ChiptuneAudioContext();
    }
    this.sampleRate = this.context.sampleRate || 48000;
    this.gainNode = this.context.createGain();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 64;
    this.analyser.smoothingTimeConstant = 0.82;

    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.context.destination);

    this.currentPlayingNode = null;
    this.currentMetadata = null;
    this.cachedDuration = 0;
    this.repeatCount = -1;
    this.handlers = {};
    this.leftBufferPtr = 0;
    this.rightBufferPtr = 0;
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
    if (this.context && this.context.state === 'suspended') {
      this.context.resume().catch(function() {});
    }
  };

  ChiptuneJsPlayer.prototype.isEngineReady = function() {
    return typeof libopenmpt !== 'undefined' &&
      Boolean(libopenmpt._openmpt_module_create_from_memory) &&
      Boolean(libopenmpt.HEAPU8);
  };

  ChiptuneJsPlayer.prototype.waitForEngine = function(callback, errback, attempts) {
    var player = this;
    var tries = attempts || 0;
    if (player.isEngineReady()) {
      callback();
    } else if (tries < 100) {
      setTimeout(function() {
        player.waitForEngine(callback, errback, tries + 1);
      }, 80);
    } else if (errback) {
      errback(new Error("DSP engine timed out."));
    }
  };

  ChiptuneJsPlayer.prototype.ensureScratchBuffers = function() {
    if (!this.isEngineReady()) return false;
    if (!this.leftBufferPtr) this.leftBufferPtr = libopenmpt._malloc(4 * BUFFER_FRAMES);
    if (!this.rightBufferPtr) this.rightBufferPtr = libopenmpt._malloc(4 * BUFFER_FRAMES);
    return true;
  };

  ChiptuneJsPlayer.prototype.extractModuleMeta = function(mod) {
    var meta = {};
    var keys = ['title', 'artist', 'type_long', 'tracker', 'message'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      meta[k] = libopenmpt.ccall('openmpt_module_get_metadata', 'string', ['number', 'string'], [mod, k]) || '';
    }
    meta.channels = libopenmpt._openmpt_module_get_num_channels
      ? libopenmpt._openmpt_module_get_num_channels(mod)
      : (libopenmpt.ccall('openmpt_module_get_num_channels', 'number', ['number'], [mod]) || 0);
    meta.duration = libopenmpt._openmpt_module_get_duration_seconds(mod) || 180;
    return meta;
  };

  ChiptuneJsPlayer.prototype.load = function(input, callback, errback) {
    var player = this;
    player.unlock();

    function finishLoad(buf) {
      player.waitForEngine(function() {
        callback(buf);
      }, function(err) {
        if (errback) errback(err);
        player.fireEvent('onError', err);
      });
    }

    if (input instanceof File || input instanceof Blob) {
      var reader = new FileReader();
      reader.onload = function() { finishLoad(reader.result); };
      reader.onerror = function(err) {
        if (errback) errback(err);
        player.fireEvent('onError', err);
      };
      reader.readAsArrayBuffer(input);
    } else if (typeof input === 'string') {
      fetch(input)
        .then(function(res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.arrayBuffer();
        })
        .then(finishLoad)
        .catch(function(err) {
          if (errback) errback(err);
          player.fireEvent('onError', err);
        });
    } else if (input instanceof ArrayBuffer) {
      finishLoad(input);
    }
  };

  ChiptuneJsPlayer.prototype.readMetadata = function(buffer) {
    if (this.currentMetadata) return this.currentMetadata;
    if (!this.isEngineReady()) return null;
    var byteArray = new Uint8Array(buffer);
    var ptr = libopenmpt._malloc(byteArray.byteLength);
    libopenmpt.HEAPU8.set(byteArray, ptr);
    var mod = libopenmpt._openmpt_module_create_from_memory(ptr, byteArray.byteLength, 0, 0, 0);
    libopenmpt._free(ptr);
    if (!mod) return null;
    var meta = this.extractModuleMeta(mod);
    libopenmpt._openmpt_module_destroy(mod);
    return meta;
  };

  ChiptuneJsPlayer.prototype.play = function(buffer) {
    this.stop();
    this.unlock();

    if (!this.ensureScratchBuffers()) {
      this.fireEvent('onError', new Error("DSP engine not ready."));
      return null;
    }

    var byteArray = new Uint8Array(buffer);
    var ptrToFile = libopenmpt._malloc(byteArray.byteLength);
    libopenmpt.HEAPU8.set(byteArray, ptrToFile);

    var mod = libopenmpt._openmpt_module_create_from_memory(ptrToFile, byteArray.byteLength, 0, 0, 0);
    if (!mod) {
      libopenmpt._free(ptrToFile);
      this.fireEvent('onError', new Error("Could not parse tracker module."));
      return null;
    }

    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [mod, 3, 4]);
    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [mod, 4, 5]);
    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [mod, 2, 100]);
    libopenmpt.ccall('openmpt_module_set_repeat_count', 'number', ['number', 'number'], [mod, this.repeatCount]);

    this.currentMetadata = this.extractModuleMeta(mod);
    this.cachedDuration = this.currentMetadata.duration;

    var processNode = this.context.createScriptProcessor(BUFFER_FRAMES, 0, 2);
    processNode.player = this;
    processNode.modulePtr = mod;
    processNode.ptrToFile = ptrToFile;
    processNode.paused = false;

    var leftPtr = this.leftBufferPtr;
    var rightPtr = this.rightBufferPtr;
    var rate = this.sampleRate;

    processNode.cleanup = function() {
      if (this.modulePtr) {
        libopenmpt._openmpt_module_destroy(this.modulePtr);
        this.modulePtr = 0;
      }
      if (this.ptrToFile) {
        libopenmpt._free(this.ptrToFile);
        this.ptrToFile = 0;
      }
    };

    processNode.onaudioprocess = function(e) {
      var outL = e.outputBuffer.getChannelData(0);
      var outR = e.outputBuffer.getChannelData(1);
      var framesToRender = outL.length;

      if (this.paused || !this.modulePtr) {
        outL.fill(0);
        outR.fill(0);
        return;
      }

      var actual = libopenmpt._openmpt_module_read_float_stereo(
        this.modulePtr,
        rate,
        framesToRender,
        leftPtr,
        rightPtr
      );

      if (actual === 0) {
        outL.fill(0);
        outR.fill(0);
        this.disconnect();
        this.cleanup();
        this.player.currentPlayingNode = null;
        this.player.fireEvent('onEnded');
        return;
      }

      var heapF32 = libopenmpt.HEAPF32;
      var baseL = leftPtr >> 2;
      var baseR = rightPtr >> 2;

      for (var i = 0; i < actual; i++) {
        var sL = heapF32[baseL + i];
        var sR = heapF32[baseR + i];
        if (sL > 1.0) sL = 1.0 - 0.25 / (sL + 0.5);
        else if (sL < -1.0) sL = -1.0 + 0.25 / (-sL + 0.5);

        if (sR > 1.0) sR = 1.0 - 0.25 / (sR + 0.5);
        else if (sR < -1.0) sR = -1.0 + 0.25 / (-sR + 0.5);

        outL[i] = sL;
        outR[i] = sR;
      }

      if (actual < framesToRender) {
        outL.fill(0, actual);
        outR.fill(0, actual);
        this.disconnect();
        this.cleanup();
        this.player.currentPlayingNode = null;
        this.player.fireEvent('onEnded');
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
      this.currentMetadata = null;
      this.cachedDuration = 0;
      this.fireEvent('onStop');
    }
  };

  ChiptuneJsPlayer.prototype.togglePause = function() {
    if (this.currentPlayingNode) {
      this.unlock();
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
      if (libopenmpt._openmpt_module_get_position_seconds) {
        return libopenmpt._openmpt_module_get_position_seconds(this.currentPlayingNode.modulePtr);
      }
      return libopenmpt.ccall('openmpt_module_get_position_seconds', 'number', ['number'], [this.currentPlayingNode.modulePtr]);
    }
    return 0;
  };

  ChiptuneJsPlayer.prototype.duration = function() {
    return this.cachedDuration || 0;
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