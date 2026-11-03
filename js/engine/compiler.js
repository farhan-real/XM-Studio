/**
 * js/engine/compiler.js - On-demand background audio compiler for WAV/MP3 exports.
 */
(function(window) {
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

  function AudioCompiler() {
    this.isCompiling = false;
    this.cleanupFn = null;
  }

  AudioCompiler.prototype.compile = function(buffer, format, onProgress, onComplete, onError) {
    this.cancel();
    var self = this;
    self.isCompiling = true;

    try {
      var byteArray = new Uint8Array(buffer);
      var ptrToFile = libopenmpt._malloc(byteArray.byteLength);
      libopenmpt.HEAPU8.set(byteArray, ptrToFile);

      var modulePtr = libopenmpt._openmpt_module_create_from_memory(ptrToFile, byteArray.byteLength, 0, 0, 0);
      if (!modulePtr) {
        libopenmpt._free(ptrToFile);
        self.isCompiling = false;
        if (onError) onError(new Error("Unable to parse module."));
        return;
      }

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

      function cleanup() {
        self.isCompiling = false;
        if (modulePtr) { libopenmpt._openmpt_module_destroy(modulePtr); modulePtr = 0; }
        if (leftBufferPtr) { libopenmpt._free(leftBufferPtr); leftBufferPtr = 0; }
        if (rightBufferPtr) { libopenmpt._free(rightBufferPtr); rightBufferPtr = 0; }
        if (ptrToFile) { libopenmpt._free(ptrToFile); ptrToFile = 0; }
      }

      self.cleanupFn = cleanup;

      function step() {
        if (!self.isCompiling) {
          cleanup();
          return;
        }
        try {
          var framesToRead = Math.min(chunkSize, totalFrames - framesRendered);
          if (framesToRead > 0) {
            var actual = libopenmpt._openmpt_module_read_float_stereo(
              modulePtr,
              sampleRate,
              framesToRead,
              leftBufferPtr,
              rightBufferPtr
            );

            if (actual === 0) {
              framesRendered = totalFrames;
            } else {
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
              if (actual < framesToRead) framesRendered = totalFrames;
            }
          }

          var progress = Math.min(1, framesRendered / totalFrames);
          if (onProgress) onProgress(progress);

          if (framesRendered < totalFrames) {
            setTimeout(step, 12);
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

      setTimeout(step, 12);
    } catch (e) {
      self.isCompiling = false;
      if (onError) onError(e);
    }
  };

  AudioCompiler.prototype.cancel = function() {
    this.isCompiling = false;
    if (typeof this.cleanupFn === 'function') {
      this.cleanupFn();
      this.cleanupFn = null;
    }
  };

  window.AudioCompiler = new AudioCompiler();
})(window);