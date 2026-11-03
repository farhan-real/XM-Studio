/**
 * chiptune2.js - Studio Master engine with mobile-optimized real-time preview & hardware handoff
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
    this.isCompiling = false;
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

  // INSTANT REAL-TIME PREVIEW: 8192-sample buffer prevents mobile underruns
  ChiptuneJsPlayer.prototype.play = function(buffer) {
    this.stop();
    this.unlock();

    var sampleRate = 48000;
    var maxFramesPerChunk = 4096;
    // 8192 buffer = 170.6ms of cushion against mobile CPU jitter
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

    // Fast 4-tap sinc interpolation for real-time preview (low CPU), level 5 ramping, 100% stereo
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

  ChiptuneJsPlayer.prototype.pause = function() {
    if (this.currentPlayingNode) this.currentPlayingNode.paused = true;
  };

  ChiptuneJsPlayer.prototype.unpause = function() {
    if (this.currentPlayingNode) this.currentPlayingNode.paused = false;
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

  function createWavBlob(pcmChunks, totalPcmBytes, sampleRate) {
    var buffer = new ArrayBuffer(44);
    var view = new DataView(buffer);
    function writeStr(offset, str) {
      for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + totalPcmBytes, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, totalPcmBytes, true);

    return new Blob([buffer].concat(pcmChunks), { type: 'audio/wav' });
  }

  // MASTER BACKGROUND COMPILER: SINC-8 48kHz, gently throttled to never stall audio
  ChiptuneJsPlayer.prototype.compileAudio = function(buffer, format, onProgress, onComplete, onError) {
    this.cancelCompilation();
    var player = this;
    player.isCompiling = true;

    try {
      var byteArray = new Uint8Array(buffer);
      var ptrToFile = libopenmpt._malloc(byteArray.byteLength);
      libopenmpt.HEAPU8.set(byteArray, ptrToFile);

      var modulePtr = libopenmpt._openmpt_module_create_from_memory(ptrToFile, byteArray.byteLength, 0, 0, 0);
      if (!modulePtr) {
        libopenmpt._free(ptrToFile);
        player.isCompiling = false;
        if (onError) onError(new Error("Unable to parse module."));
        return;
      }

      // 8-Tap Windowed Sinc for master recording
      libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 3, 8]);
      libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 4, 5]);
      libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 2, 100]);

      var duration = libopenmpt._openmpt_module_get_duration_seconds(modulePtr) || 180;
      var sampleRate = 48000;
      var totalFrames = Math.ceil(duration * sampleRate);

      var mp3encoder = (format === 'mp3') ? new lamejs.Mp3Encoder(2, sampleRate, 320) : null;
      var encodedChunks = [];
      var totalPcmBytes = 0;

      var chunkSize = 16384;
      var leftBufferPtr = libopenmpt._malloc(4 * chunkSize);
      var rightBufferPtr = libopenmpt._malloc(4 * chunkSize);

      var leftInt16 = new Int16Array(chunkSize);
      var rightInt16 = new Int16Array(chunkSize);
      var interleavedPcm = (format === 'wav') ? new Int16Array(chunkSize * 2) : null;

      var framesRendered = 0;
      // 1 chunk per tick with 25ms pauses prevents thread starvation on mobile
      var chunksPerTick = 1;

      function cleanup() {
        player.isCompiling = false;
        if (modulePtr) { libopenmpt._openmpt_module_destroy(modulePtr); modulePtr = 0; }
        if (leftBufferPtr) { libopenmpt._free(leftBufferPtr); leftBufferPtr = 0; }
        if (rightBufferPtr) { libopenmpt._free(rightBufferPtr); rightBufferPtr = 0; }
        if (ptrToFile) { libopenmpt._free(ptrToFile); ptrToFile = 0; }
      }

      player.activeCompilerCleanup = cleanup;

      function step() {
        if (!player.isCompiling) {
          cleanup();
          return;
        }
        try {
          for (var c = 0; c < chunksPerTick; c++) {
            var framesToRead = Math.min(chunkSize, totalFrames - framesRendered);
            if (framesToRead <= 0) break;

            var actual = libopenmpt._openmpt_module_read_float_stereo(
              modulePtr,
              sampleRate,
              framesToRead,
              leftBufferPtr,
              rightBufferPtr
            );

            if (actual === 0) {
              framesRendered = totalFrames;
              break;
            }

            var rawL = libopenmpt.HEAPF32.subarray(leftBufferPtr / 4, leftBufferPtr / 4 + actual);
            var rawR = libopenmpt.HEAPF32.subarray(rightBufferPtr / 4, rightBufferPtr / 4 + actual);

            for (var i = 0; i < actual; i++) {
              var sL = rawL[i];
              var sR = rawR[i];
              if (sL > 1.0) sL = 1.0 - Math.exp(-sL);
              else if (sL < -1.0) sL = -1.0 + Math.exp(sL);
              if (sR > 1.0) sR = 1.0 - Math.exp(-sR);
              else if (sR < -1.0) sR = -1.0 + Math.exp(sR);

              var ditherL = ((Math.random() - Math.random()) * 0.5) / 32768.0;
              var ditherR = ((Math.random() - Math.random()) * 0.5) / 32768.0;
              var cL = Math.max(-1.0, Math.min(1.0, sL + ditherL));
              var cR = Math.max(-1.0, Math.min(1.0, sR + ditherR));

              leftInt16[i] = cL < 0 ? Math.round(cL * 32768) : Math.round(cL * 32767);
              rightInt16[i] = cR < 0 ? Math.round(cR * 32768) : Math.round(cR * 32767);

              if (format === 'wav') {
                interleavedPcm[i * 2] = leftInt16[i];
                interleavedPcm[i * 2 + 1] = rightInt16[i];
              }
            }

            if (format === 'mp3') {
              var mp3buf = mp3encoder.encodeBuffer(leftInt16.subarray(0, actual), rightInt16.subarray(0, actual));
              if (mp3buf.length > 0) encodedChunks.push(mp3buf);
            } else {
              var pcmSlice = interleavedPcm.slice(0, actual * 2);
              encodedChunks.push(pcmSlice.buffer);
              totalPcmBytes += pcmSlice.byteLength;
            }

            framesRendered += actual;
            if (actual < framesToRead) {
              framesRendered = totalFrames;
              break;
            }
          }

          var progress = Math.min(1, framesRendered / totalFrames);
          if (onProgress) onProgress(progress);

          if (framesRendered < totalFrames) {
            setTimeout(step, 25);
          } else {
            var finalBlob = null;
            if (format === 'mp3') {
              var endBuf = mp3encoder.flush();
              if (endBuf.length > 0) encodedChunks.push(endBuf);
              finalBlob = new Blob(encodedChunks, { type: 'audio/mp3' });
            } else {
              finalBlob = createWavBlob(encodedChunks, totalPcmBytes, sampleRate);
            }
            cleanup();
            if (onComplete) onComplete(finalBlob);
          }
        } catch (err) {
          cleanup();
          if (onError) onError(err);
        }
      }

      setTimeout(step, 25);
    } catch (e) {
      player.isCompiling = false;
      if (onError) onError(e);
    }
  };

  ChiptuneJsPlayer.prototype.cancelCompilation = function() {
    this.isCompiling = false;
    if (typeof this.activeCompilerCleanup === 'function') {
      this.activeCompilerCleanup();
      this.activeCompilerCleanup = null;
    }
  };

  window.ChiptuneJsPlayer = ChiptuneJsPlayer;
})(window);