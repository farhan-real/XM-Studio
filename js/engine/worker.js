/**
 * js/engine/worker.js - Dedicated Web Worker for multithreaded OpenMPT rendering and LAME MP3 compilation.
 */
/* global importScripts, libopenmpt, lamejs */
self.libopenmpt = self.libopenmpt || {};
self.libopenmpt.locateFile = function(f) { return '../' + f; };

try {
  importScripts('../libopenmpt.js');
  importScripts('../lame.min.js');
} catch (e) {
  // Scripts will be loaded on demand or fall back to main thread
}

function createWavBlob(pcmChunks, totalPcmBytes, sampleRate) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
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

  return new Blob([buffer, ...pcmChunks], { type: 'audio/wav' });
}

self.onmessage = function(e) {
  const data = e.data;
  if (!data || data.type !== 'compile') return;

  try {
    const byteArray = new Uint8Array(data.buffer);
    const ptrToFile = libopenmpt._malloc(byteArray.byteLength);
    libopenmpt.HEAPU8.set(byteArray, ptrToFile);

    const modulePtr = libopenmpt._openmpt_module_create_from_memory(ptrToFile, byteArray.byteLength, 0, 0, 0);
    if (!modulePtr) {
      libopenmpt._free(ptrToFile);
      self.postMessage({ type: 'error', message: 'Unable to parse module in worker.' });
      return;
    }

    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 3, 8]);
    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 4, 5]);
    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 2, 100]);

    const duration = libopenmpt._openmpt_module_get_duration_seconds(modulePtr) || 180;
    const sampleRate = 48000;
    const totalFrames = Math.ceil(duration * sampleRate);
    const format = data.format || 'mp3';

    const mp3encoder = (format === 'mp3') ? new lamejs.Mp3Encoder(2, sampleRate, 320) : null;
    const encodedChunks = [];
    let totalPcmBytes = 0;

    const chunkSize = 16384;
    const leftBufferPtr = libopenmpt._malloc(4 * chunkSize);
    const rightBufferPtr = libopenmpt._malloc(4 * chunkSize);

    const leftInt16 = new Int16Array(chunkSize);
    const rightInt16 = new Int16Array(chunkSize);
    const interleavedPcm = (format === 'wav') ? new Int16Array(chunkSize * 2) : null;

    let framesRendered = 0;

    while (framesRendered < totalFrames) {
      const framesToRead = Math.min(chunkSize, totalFrames - framesRendered);
      const actual = libopenmpt._openmpt_module_read_float_stereo(
        modulePtr,
        sampleRate,
        framesToRead,
        leftBufferPtr,
        rightBufferPtr
      );

      if (actual === 0) break;

      const rawL = libopenmpt.HEAPF32.subarray(leftBufferPtr / 4, leftBufferPtr / 4 + actual);
      const rawR = libopenmpt.HEAPF32.subarray(rightBufferPtr / 4, rightBufferPtr / 4 + actual);

      for (let i = 0; i < actual; i++) {
        let sL = rawL[i];
        let sR = rawR[i];
        if (sL > 1.0) sL = 1.0 - 0.25 / (sL + 0.5);
        else if (sL < -1.0) sL = -1.0 + 0.25 / (-sL + 0.5);
        if (sR > 1.0) sR = 1.0 - 0.25 / (sR + 0.5);
        else if (sR < -1.0) sR = -1.0 + 0.25 / (-sR + 0.5);

        leftInt16[i] = sL < 0 ? Math.round(sL * 32768) : Math.round(sL * 32767);
        rightInt16[i] = sR < 0 ? Math.round(sR * 32768) : Math.round(sR * 32767);

        if (format === 'wav') {
          interleavedPcm[i * 2] = leftInt16[i];
          interleavedPcm[i * 2 + 1] = rightInt16[i];
        }
      }

      if (format === 'mp3') {
        const mp3buf = mp3encoder.encodeBuffer(leftInt16.subarray(0, actual), rightInt16.subarray(0, actual));
        if (mp3buf.length > 0) encodedChunks.push(mp3buf);
      } else {
        const pcmSlice = interleavedPcm.slice(0, actual * 2);
        encodedChunks.push(pcmSlice.buffer);
        totalPcmBytes += pcmSlice.byteLength;
      }

      framesRendered += actual;
      self.postMessage({ type: 'progress', progress: Math.min(1, framesRendered / totalFrames) });
    }

    let finalBlob = null;
    if (format === 'mp3') {
      const endBuf = mp3encoder.flush();
      if (endBuf.length > 0) encodedChunks.push(endBuf);
      finalBlob = new Blob(encodedChunks, { type: 'audio/mp3' });
    } else {
      finalBlob = createWavBlob(encodedChunks, totalPcmBytes, sampleRate);
    }

    libopenmpt._openmpt_module_destroy(modulePtr);
    libopenmpt._free(leftBufferPtr);
    libopenmpt._free(rightBufferPtr);
    libopenmpt._free(ptrToFile);

    self.postMessage({ type: 'complete', blob: finalBlob });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};