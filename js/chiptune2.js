/**
 * chiptune2.js - Studio Master libopenmpt wrapper with 320kbps MP3 / Lossless WAV generator
 */
(function(window) {
  function ChiptuneJsPlayer() {
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

  // Build Standard RIFF/WAV Container for 16-bit PCM Stereo
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

    var parts = [buffer].concat(pcmChunks);
    return new Blob(parts, { type: 'audio/wav' });
  }

  /**
   * Compiles tracker audio at studio quality:
   * - Native hardware sample rate: 48,000 Hz
   * - Resampler: 8-Tap Windowed SINC
   * - Volume Ramping: Level 5
   * - DSP: Soft-knee limiter + TPDF Dithering
   * - Target: MP3 320 kbps CBR or Lossless 16-bit WAV
   */
  ChiptuneJsPlayer.prototype.compileAudio = function(buffer, format, onProgress, onComplete, onError) {
    try {
      if (typeof libopenmpt === 'undefined' || !libopenmpt._openmpt_module_create_from_memory) {
        throw new Error("libopenmpt engine not ready.");
      }
      if (format === 'mp3' && (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder)) {
        throw new Error("lamejs MP3 encoder library missing.");
      }

      var byteArray = new Uint8Array(buffer);
      var ptrToFile = libopenmpt._malloc(byteArray.byteLength);
      libopenmpt.HEAPU8.set(byteArray, ptrToFile);

      var modulePtr = libopenmpt._openmpt_module_create_from_memory(ptrToFile, byteArray.byteLength, 0, 0, 0);
      if (!modulePtr) {
        libopenmpt._free(ptrToFile);
        if (onError) onError(new Error("Unable to parse module with libopenmpt."));
        return;
      }

      // SINC-8 interpolation resampler
      libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 3, 8]);
      // Volume ramping level 5
      libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 4, 5]);
      // 100% stereo separation
      libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 2, 100]);

      var duration = libopenmpt._openmpt_module_get_duration_seconds(modulePtr);
      if (!duration || duration <= 0 || !isFinite(duration)) {
        duration = 180;
      }

      var metadata = {};
      ['title', 'artist', 'type_long', 'tracker', 'message'].forEach(function(key) {
        metadata[key] = libopenmpt.ccall('openmpt_module_get_metadata', 'string', ['number', 'string'], [modulePtr, key]) || '';
      });
      metadata.channels = libopenmpt.ccall('openmpt_module_get_num_channels', 'number', ['number'], [modulePtr]) || 0;

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
      var chunksPerTick = 4;

      function cleanup() {
        if (modulePtr) { libopenmpt._openmpt_module_destroy(modulePtr); modulePtr = 0; }
        if (leftBufferPtr) { libopenmpt._free(leftBufferPtr); leftBufferPtr = 0; }
        if (rightBufferPtr) { libopenmpt._free(rightBufferPtr); rightBufferPtr = 0; }
        if (ptrToFile) { libopenmpt._free(ptrToFile); ptrToFile = 0; }
      }

      function step() {
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

            // Master DSP: Transparent Soft-Knee Limiter + TPDF Dither
            for (var i = 0; i < actual; i++) {
              var sL = rawL[i];
              var sR = rawR[i];

              // Soft-knee analog curve for signals > 0 dBFS
              if (sL > 1.0) sL = 1.0 - Math.exp(-sL);
              else if (sL < -1.0) sL = -1.0 + Math.exp(sL);
              if (sR > 1.0) sR = 1.0 - Math.exp(-sR);
              else if (sR < -1.0) sR = -1.0 + Math.exp(sR);

              // TPDF Dither (-96 dB transparent floor)
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
              var mp3buf = mp3encoder.encodeBuffer(
                leftInt16.subarray(0, actual),
                rightInt16.subarray(0, actual)
              );
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
            setTimeout(step, 0);
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
            if (onComplete) onComplete(finalBlob, duration, metadata);
          }
        } catch (err) {
          cleanup();
          if (onError) onError(err);
        }
      }

      setTimeout(step, 0);
    } catch (e) {
      if (onError) onError(e);
    }
  };

  window.ChiptuneJsPlayer = ChiptuneJsPlayer;
})(window);