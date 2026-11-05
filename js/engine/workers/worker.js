/**
 * js/engine/workers/worker.js - Dedicated Web Worker for OpenMPT rendering and MP3/WAV compilation.
 */
/* global importScripts, libopenmpt, lamejs */
self.libopenmpt = self.libopenmpt || {};

if (self.location.search && self.location.search.includes('cdn=1')) {
  self.USE_CDN = true;
}

self.libopenmpt.locateFile = function(f) {
  return self.USE_CDN
    ? 'https://cdn.jsdelivr.net/gh/deskjet/chiptune2.js@master/' + f
    : '../../' + f;
};

try {
  if (self.USE_CDN) {
    importScripts('https://cdn.jsdelivr.net/gh/deskjet/chiptune2.js@master/libopenmpt.js');
  } else {
    importScripts('../../libopenmpt.js');
  }
} catch (e) {
  self.USE_CDN = true;
  try {
    importScripts('https://cdn.jsdelivr.net/gh/deskjet/chiptune2.js@master/libopenmpt.js');
  } catch (err2) {}
}

function getLame() {
  if (typeof lamejs !== 'undefined' && lamejs.Mp3Encoder) return lamejs;
  if (self.lamejs && self.lamejs.Mp3Encoder) return self.lamejs;
  try {
    const url = self.USE_CDN
      ? 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js'
      : '../../lame.min.js';
    importScripts(url);
  } catch (e) {
    try {
      importScripts('https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js');
    } catch (err2) {}
  }
  return (typeof lamejs !== 'undefined' && lamejs.Mp3Encoder) ? lamejs : (self.lamejs || null);
}

function isEngineReady() {
  try {
    if (typeof libopenmpt === 'undefined' || typeof libopenmpt._malloc !== 'function') return false;
    if (!libopenmpt.HEAPU8 || libopenmpt.HEAPU8.length === 0) return false;
    const ptr = libopenmpt._malloc(4);
    if (!ptr) return false;
    libopenmpt._free(ptr);
    return true;
  } catch (e) {
    return false;
  }
}

function waitForEngine(callback, errback, attempts) {
  const tries = attempts || 0;
  if (isEngineReady()) {
    callback();
  } else if (tries < 200) {
    setTimeout(() => waitForEngine(callback, errback, tries + 1), 50);
  } else if (errback) {
    errback(new Error('DSP engine memory initialization timed out in worker.'));
  }
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

const FFT_SIZE = 64;
const FFT_BARS = 28;
const fftRe = new Float32Array(FFT_SIZE);
const fftIm = new Float32Array(FFT_SIZE);
const hannWindow = new Float32Array(FFT_SIZE);
const cosTable = new Float32Array(FFT_SIZE / 2);
const sinTable = new Float32Array(FFT_SIZE / 2);
const bitRev = new Uint8Array(FFT_SIZE);
const linFftBuf = new Float32Array(FFT_SIZE);

for (let i = 0; i < FFT_SIZE; i++) {
  hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  let rev = 0;
  for (let j = 0; j < 6; j++) rev = (rev << 1) | ((i >> j) & 1);
  bitRev[i] = rev;
}
for (let i = 0; i < FFT_SIZE / 2; i++) {
  cosTable[i] = Math.cos((-2 * Math.PI * i) / FFT_SIZE);
  sinTable[i] = Math.sin((-2 * Math.PI * i) / FFT_SIZE);
}

function computeFftBars(inputSamples, outTarget, outOffset) {
  for (let i = 0; i < FFT_SIZE; i++) {
    const rev = bitRev[i];
    fftRe[rev] = inputSamples[i] * hannWindow[i];
    fftIm[rev] = 0;
  }
  for (let len = 2; len <= FFT_SIZE; len <<= 1) {
    const halfLen = len >> 1;
    const step = FFT_SIZE / len;
    for (let i = 0; i < FFT_SIZE; i += len) {
      for (let j = 0; j < halfLen; j++) {
        const tIdx = j * step;
        const c = cosTable[tIdx];
        const s = sinTable[tIdx];
        const tr = c * fftRe[i + j + halfLen] - s * fftIm[i + j + halfLen];
        const ti = s * fftRe[i + j + halfLen] + c * fftIm[i + j + halfLen];
        fftRe[i + j + halfLen] = fftRe[i + j] - tr;
        fftIm[i + j + halfLen] = fftIm[i + j] - ti;
        fftRe[i + j] += tr;
        fftIm[i + j] += ti;
      }
    }
  }
  for (let b = 0; b < FFT_BARS; b++) {
    const binIdx = Math.min(30, Math.floor(1 + Math.pow(b / (FFT_BARS - 1), 1.35) * 28));
    const re = fftRe[binIdx];
    const im = fftIm[binIdx];
    const mag = Math.sqrt(re * re + im * im) / 32.0;

    let val = 0;
    if (mag > 0.00001) {
      const db = 20 * Math.log10(mag);
      val = Math.round(255 * (db + 100) / 70);
      if (val < 10) val = 0;
      else if (val > 255) val = 255;
    }
    outTarget[outOffset + b] = val;
  }
}

function runCompilation(data) {
  let modulePtr = 0;
  let leftBufferPtr = 0;
  let rightBufferPtr = 0;

  try {
    const byteArray = new Uint8Array(data.buffer);
    const ptrToFile = libopenmpt._malloc(byteArray.byteLength);
    if (!ptrToFile) {
      self.postMessage({ type: 'error', message: 'Failed to allocate memory for module.' });
      return;
    }
    libopenmpt.HEAPU8.set(byteArray, ptrToFile);

    modulePtr = libopenmpt._openmpt_module_create_from_memory(ptrToFile, byteArray.byteLength, 0, 0, 0);
    libopenmpt._free(ptrToFile);
    if (!modulePtr) {
      self.postMessage({ type: 'error', message: 'Unable to parse module.' });
      return;
    }

    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 3, 4]);
    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 4, 5]);
    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 2, 100]);
    libopenmpt.ccall('openmpt_module_set_repeat_count', 'number', ['number', 'number'], [modulePtr, 0]);

    const rawDur = libopenmpt._openmpt_module_get_duration_seconds
      ? libopenmpt._openmpt_module_get_duration_seconds(modulePtr)
      : (libopenmpt.ccall ? libopenmpt.ccall('openmpt_module_get_duration_seconds', 'number', ['number'], [modulePtr]) : 0);
    const duration = (isFinite(rawDur) && rawDur > 0) ? rawDur : 180;
    const sampleRate = data.sampleRate || 48000;
    const totalFrames = Math.ceil(duration * sampleRate);
    const format = data.format || 'mp3';
    const isMp3 = (format === 'mp3');

    let mp3encoder = null;
    if (isMp3) {
      const Lame = getLame();
      if (!Lame || !Lame.Mp3Encoder) {
        self.postMessage({ type: 'error', message: 'LAME MP3 encoder could not be loaded.' });
        if (libopenmpt._openmpt_module_destroy) libopenmpt._openmpt_module_destroy(modulePtr);
        return;
      }
      mp3encoder = new Lame.Mp3Encoder(2, sampleRate, 320);
    }

    const BLOCK_SIZE = 1152;
    const chunkSize = BLOCK_SIZE * 4;
    leftBufferPtr = libopenmpt._malloc(4 * chunkSize);
    rightBufferPtr = libopenmpt._malloc(4 * chunkSize);
    const baseL = leftBufferPtr >> 2;
    const baseR = rightBufferPtr >> 2;

    const leftInt16 = isMp3 ? new Int16Array(chunkSize) : null;
    const rightInt16 = isMp3 ? new Int16Array(chunkSize) : null;
    const interleavedPcm = !isMp3 ? new Int16Array(chunkSize * 2) : null;

    const encodedChunks = [];
    let totalPcmBytes = 0;

    const VIS_FPS = 15;
    const visStep = Math.max(1, Math.round(sampleRate / VIS_FPS));
    const totalVisFrames = Math.ceil(totalFrames / visStep) + 16;
    const visBuffer = new Uint8Array(totalVisFrames * FFT_BARS);
    let visFrameIndex = 0;
    let samplesSinceLastVis = 0;
    const fftWindowBuf = new Float32Array(FFT_SIZE);
    let fftWindowPtr = 0;

    let framesRendered = 0;
    let lastReportedPct = -1;

    try {
      while (framesRendered < totalFrames) {
        const framesToRead = Math.min(chunkSize, totalFrames - framesRendered);
        const actual = libopenmpt._openmpt_module_read_float_stereo(modulePtr, sampleRate, framesToRead, leftBufferPtr, rightBufferPtr);
        if (!actual || actual <= 0) break;

        const heapF32 = libopenmpt.HEAPF32;
        for (let i = 0; i < actual; i++) {
          let sL = heapF32[baseL + i];
          let sR = heapF32[baseR + i];
          if (sL > 1.0) sL = 1.0; else if (sL < -1.0) sL = -1.0;
          if (sR > 1.0) sR = 1.0; else if (sR < -1.0) sR = -1.0;

          fftWindowBuf[fftWindowPtr] = 0.5 * (sL + sR);
          fftWindowPtr = (fftWindowPtr + 1) % FFT_SIZE;
          samplesSinceLastVis++;

          if (samplesSinceLastVis >= visStep) {
            samplesSinceLastVis = 0;
            if (visFrameIndex < totalVisFrames) {
              for (let k = 0; k < FFT_SIZE; k++) linFftBuf[k] = fftWindowBuf[(fftWindowPtr + k) % FFT_SIZE];
              computeFftBars(linFftBuf, visBuffer, visFrameIndex * FFT_BARS);
              visFrameIndex++;
            }
          }

          if (isMp3) {
            leftInt16[i] = (sL < 0 ? sL * 32768 : sL * 32767) | 0;
            rightInt16[i] = (sR < 0 ? sR * 32768 : sR * 32767) | 0;
          } else {
            const idx = i << 1;
            interleavedPcm[idx] = (sL < 0 ? sL * 32768 : sL * 32767) | 0;
            interleavedPcm[idx + 1] = (sR < 0 ? sR * 32768 : sR * 32767) | 0;
          }
        }

        if (isMp3) {
          for (let i = 0; i < actual; i += BLOCK_SIZE) {
            const end = Math.min(i + BLOCK_SIZE, actual);
            const leftChunk = (i === 0 && end === chunkSize) ? leftInt16 : leftInt16.subarray(i, end);
            const rightChunk = (i === 0 && end === chunkSize) ? rightInt16 : rightInt16.subarray(i, end);
            const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
            if (mp3buf && mp3buf.length > 0) encodedChunks.push(new Uint8Array(mp3buf));
          }
        } else {
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
    } finally {
      if (modulePtr) {
        libopenmpt._openmpt_module_destroy(modulePtr);
        modulePtr = 0;
      }
      if (leftBufferPtr) { libopenmpt._free(leftBufferPtr); leftBufferPtr = 0; }
      if (rightBufferPtr) { libopenmpt._free(rightBufferPtr); rightBufferPtr = 0; }
    }

    let finalBlob = null;
    if (isMp3) {
      const endBuf = mp3encoder.flush();
      if (endBuf && endBuf.length > 0) encodedChunks.push(new Uint8Array(endBuf));
      finalBlob = new Blob(encodedChunks, { type: 'audio/mpeg' });
    } else {
      finalBlob = createWavBlob(encodedChunks, totalPcmBytes, sampleRate);
    }

    const trimmedVisBuffer = visBuffer.slice(0, visFrameIndex * FFT_BARS);
    self.postMessage({
      type: 'complete',
      blob: finalBlob,
      visData: trimmedVisBuffer.buffer,
      visFps: VIS_FPS
    }, [trimmedVisBuffer.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
}

self.onmessage = function(e) {
  const data = e.data;
  if (!data || data.type !== 'compile') return;

  waitForEngine(() => {
    runCompilation(data);
  }, (err) => {
    self.postMessage({ type: 'error', message: err.message });
  });
};