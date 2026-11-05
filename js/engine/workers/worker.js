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

let runtimeInitialized = false;
const prevInit = self.libopenmpt.onRuntimeInitialized;
self.libopenmpt.onRuntimeInitialized = function() {
  runtimeInitialized = true;
  if (typeof prevInit === 'function') prevInit();
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

function ensureLame() {
  if (typeof lamejs !== 'undefined' && lamejs.Mp3Encoder) return lamejs;
  if (self.lamejs && self.lamejs.Mp3Encoder) return self.lamejs;
  try {
    importScripts('../../lame.min.js');
  } catch (e) {
    try {
      importScripts('https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js');
    } catch (e2) {}
  }
  return (typeof lamejs !== 'undefined' && lamejs.Mp3Encoder) ? lamejs : (self.lamejs || null);
}

function isEngineReady() {
  const mod = self.libopenmpt || self.Module;
  if (!mod || typeof mod._malloc !== 'function') return false;
  if (runtimeInitialized || mod.calledRun) return true;
  if (mod.asm && (typeof mod.asm.wc === 'function' || Object.keys(mod.asm).length > 5)) {
    return true;
  }
  return false;
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
    const binIdx = Math.min(31, Math.floor(1 + Math.pow(b / (FFT_BARS - 1), 1.25) * 29));
    const mag = Math.sqrt(fftRe[binIdx] * fftRe[binIdx] + fftIm[binIdx] * fftIm[binIdx]) * 8.0;
    outTarget[outOffset + b] = mag > 0 ? Math.min(255, Math.round(Math.log10(1 + mag * 50) * 110)) : 0;
  }
}

function runCompilation(data) {
  let modulePtr = 0;
  let leftBufferPtr = 0;
  let rightBufferPtr = 0;
  const mod = self.libopenmpt || self.Module;

  try {
    const byteArray = new Uint8Array(data.buffer);
    const ptrToFile = mod._malloc(byteArray.byteLength);
    if (!ptrToFile) {
      self.postMessage({ type: 'error', message: 'Failed to allocate memory for module.' });
      return;
    }
    mod.HEAPU8.set(byteArray, ptrToFile);

    modulePtr = mod._openmpt_module_create_from_memory(ptrToFile, byteArray.byteLength, 0, 0, 0);
    mod._free(ptrToFile);
    if (!modulePtr) {
      self.postMessage({ type: 'error', message: 'Unable to parse module.' });
      return;
    }

    if (mod.ccall) {
      mod.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 3, 4]);
      mod.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 4, 5]);
      mod.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 2, 100]);
      mod.ccall('openmpt_module_set_repeat_count', 'number', ['number', 'number'], [modulePtr, 0]);
    }

    const rawDur = mod._openmpt_module_get_duration_seconds
      ? mod._openmpt_module_get_duration_seconds(modulePtr)
      : (mod.ccall ? mod.ccall('openmpt_module_get_duration_seconds', 'number', ['number'], [modulePtr]) : 0);
    const duration = (isFinite(rawDur) && rawDur > 0) ? rawDur : 180;
    const sampleRate = data.sampleRate || 48000;
    const totalFrames = Math.ceil(duration * sampleRate);
    const format = data.format || 'mp3';
    const isMp3 = (format === 'mp3');

    let mp3encoder = null;
    if (isMp3) {
      const Lame = ensureLame();
      if (!Lame || !Lame.Mp3Encoder) {
        self.postMessage({ type: 'error', message: 'LAME MP3 encoder could not be loaded.' });
        if (mod._openmpt_module_destroy) mod._openmpt_module_destroy(modulePtr);
        return;
      }
      mp3encoder = new Lame.Mp3Encoder(2, sampleRate, 320);
    }

    const BLOCK_SIZE = 1152;
    const chunkSize = BLOCK_SIZE * 4;
    leftBufferPtr = mod._malloc(4 * chunkSize);
    rightBufferPtr = mod._malloc(4 * chunkSize);
    const baseL = leftBufferPtr >> 2;
    const baseR = rightBufferPtr >> 2;

    const leftInt16 = isMp3 ? new Int16Array(chunkSize) : null;
    const rightInt16 = isMp3 ? new Int16Array(chunkSize) : null;
    const interleavedPcm = !isMp3 ? new Int16Array(chunkSize * 2) : null;

    const encodedChunks = [];
    let totalPcmBytes = 0;

    const VIS_FPS = 60;
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
        const actual = mod._openmpt_module_read_float_stereo(modulePtr, sampleRate, framesToRead, leftBufferPtr, rightBufferPtr);
        if (!actual || actual <= 0) break;

        const heapF32 = mod.HEAPF32;
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
        if (mod._openmpt_module_destroy) mod._openmpt_module_destroy(modulePtr);
        else if (mod.ccall) mod.ccall('openmpt_module_destroy', null, ['number'], [modulePtr]);
        modulePtr = 0;
      }
      if (leftBufferPtr) { mod._free(leftBufferPtr); leftBufferPtr = 0; }
      if (rightBufferPtr) { mod._free(rightBufferPtr); rightBufferPtr = 0; }
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