/**
 * js/engine/worker.js - Dedicated Web Worker for OpenMPT rendering and LAME MP3 compilation.
 */
/* global importScripts, libopenmpt, lamejs */
self.libopenmpt = self.libopenmpt || {};
self.libopenmpt.locateFile = function(f) {
  return self.USE_CDN ? 'https://cdn.jsdelivr.net/gh/deskjet/chiptune2.js@master/' + f : '../' + f;
};

try {
  importScripts('../libopenmpt.js');
} catch (e) {
  self.USE_CDN = true;
  importScripts('https://cdn.jsdelivr.net/gh/deskjet/chiptune2.js@master/libopenmpt.js');
}

try {
  importScripts('../lame.min.js');
} catch (e) {
  importScripts('https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js');
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
    libopenmpt._free(ptrToFile);

    if (!modulePtr) {
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
    const isMp3 = (format === 'mp3');

    const mp3encoder = isMp3 ? new lamejs.Mp3Encoder(2, sampleRate, 320) : null;
    const encodedChunks = [];
    let totalPcmBytes = 0;

    const chunkSize = 16384;
    const leftBufferPtr = libopenmpt._malloc(4 * chunkSize);
    const rightBufferPtr = libopenmpt._malloc(4 * chunkSize);
    const baseL = leftBufferPtr >> 2;
    const baseR = rightBufferPtr >> 2;

    const leftInt16 = isMp3 ? new Int16Array(chunkSize) : null;
    const rightInt16 = isMp3 ? new Int16Array(chunkSize) : null;
    const interleavedPcm = !isMp3 ? new Int16Array(chunkSize * 2) : null;

    let framesRendered = 0;
    let lastReportedPct = -1;

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

      const heapF32 = libopenmpt.HEAPF32;

      if (isMp3) {
        for (let i = 0; i < actual; i++) {
          let sL = heapF32[baseL + i];
          let sR = heapF32[baseR + i];
          if (sL > 1.0) sL = 1.0 - 0.25 / (sL + 0.5);
          else if (sL < -1.0) sL = -1.0 + 0.25 / (-sL + 0.5);
          if (sR > 1.0) sR = 1.0 - 0.25 / (sR + 0.5);
          else if (sR < -1.0) sR = -1.0 + 0.25 / (-sR + 0.5);

          leftInt16[i] = (sL < 0 ? sL * 32768 : sL * 32767) | 0;
          rightInt16[i] = (sR < 0 ? sR * 32768 : sR * 32767) | 0;
        }
        const mp3buf = mp3encoder.encodeBuffer(
          actual === chunkSize ? leftInt16 : leftInt16.subarray(0, actual),
          actual === chunkSize ? rightInt16 : rightInt16.subarray(0, actual)
        );
        if (mp3buf.length > 0) encodedChunks.push(new Int8Array(mp3buf));
      } else {
        for (let i = 0; i < actual; i++) {
          let sL = heapF32[baseL + i];
          let sR = heapF32[baseR + i];
          if (sL > 1.0) sL = 1.0 - 0.25 / (sL + 0.5);
          else if (sL < -1.0) sL = -1.0 + 0.25 / (-sL + 0.5);
          if (sR > 1.0) sR = 1.0 - 0.25 / (sR + 0.5);
          else if (sR < -1.0) sR = -1.0 + 0.25 / (-sR + 0.5);

          const idx = i << 1;
          interleavedPcm[idx] = (sL < 0 ? sL * 32768 : sL * 32767) | 0;
          interleavedPcm[idx + 1] = (sR < 0 ? sR * 32768 : sR * 32767) | 0;
        }
        const pcmSlice = interleavedPcm.slice(0, actual * 2);
        encodedChunks.push(pcmSlice.buffer);
        totalPcmBytes += pcmSlice.byteLength;
      }

      framesRendered += actual;
      const pct = Math.min(100, Math.round((framesRendered / totalFrames) * 100));
      if (pct !== lastReportedPct) {
        lastReportedPct = pct;
        self.postMessage({ type: 'progress', progress: pct / 100 });
      }
    }

    libopenmpt._openmpt_module_destroy(modulePtr);
    libopenmpt._free(leftBufferPtr);
    libopenmpt._free(rightBufferPtr);

    let finalBlob = null;
    if (isMp3) {
      const endBuf = mp3encoder.flush();
      if (endBuf.length > 0) encodedChunks.push(new Int8Array(endBuf));
      finalBlob = new Blob(encodedChunks, { type: 'audio/mp3' });
    } else {
      finalBlob = createWavBlob(encodedChunks, totalPcmBytes, sampleRate);
    }

    self.postMessage({ type: 'complete', blob: finalBlob });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};