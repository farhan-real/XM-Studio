/**
 * js/engine/workers/worker.js - Dedicated Web Worker for OpenMPT rendering and MP3/WAV compilation.
 */
/* global importScripts, libopenmpt, lamejs, computeFftBars, FFT_SIZE, FFT_BARS */
self.libopenmpt = self.libopenmpt || {};
self.libopenmpt.print = function(text) { console.log('[libopenmpt Worker]', text); };
self.libopenmpt.printErr = function(text) { console.error('[libopenmpt Worker Error]', text); };

let isRuntimeReady = false, isRuntimeVerified = false, isRuntimeAborted = false, abortErrorMessage = '';

const prevInit = self.libopenmpt.onRuntimeInitialized;
self.libopenmpt.onRuntimeInitialized = function() {
  isRuntimeReady = true;
  if (typeof prevInit === 'function') prevInit();
};

const prevAbort = self.libopenmpt.onAbort;
self.libopenmpt.onAbort = function(msg) {
  isRuntimeAborted = true;
  abortErrorMessage = String(msg || 'Worker module aborted');
  console.error('[libopenmpt Worker Abort]', abortErrorMessage);
  if (typeof prevAbort === 'function') prevAbort(msg);
};

self.libopenmpt.locateFile = function(f) {
  return '../../' + f;
};

importScripts('fft.js');
importScripts('../../libopenmpt.js');
importScripts('../../lame.min.js');

function isEngineReady() {
  if (isRuntimeAborted) return false;
  if (isRuntimeVerified) return true;
  if (typeof libopenmpt === 'undefined' || !isRuntimeReady) return false;
  try {
    if (!libopenmpt.HEAPU8 || libopenmpt.HEAPU8.length === 0) return false;
    if (typeof libopenmpt._malloc !== 'function' || typeof libopenmpt._free !== 'function') return false;
    if (typeof libopenmpt._openmpt_module_create_from_memory !== 'function') return false;
    const probePtr = libopenmpt._malloc(4);
    if (!probePtr) return false;
    libopenmpt._free(probePtr);
    isRuntimeVerified = true;
    return true;
  } catch (err) {
    return false;
  }
}

function waitForEngine(callback, errback, attempts) {
  const tries = attempts ? attempts : 0;
  if (isRuntimeAborted) {
    if (errback) errback(new Error(abortErrorMessage ? abortErrorMessage : 'libopenmpt memory initialization aborted.'));
    return;
  }
  let ready = false;
  try { ready = isEngineReady(); } catch (e) { ready = false; }
  if (ready) {
    callback();
  } else if (tries < 300) {
    setTimeout(() => waitForEngine(callback, errback, tries + 1), 50);
  } else if (errback) {
    errback(new Error('DSP engine memory initialization timed out in worker.'));
  }
}

function createWavBlob(pcmChunks, totalPcmBytes, sampleRate) {
  const header = new ArrayBuffer(44), view = new DataView(header);
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
  return new Blob([header, ...pcmChunks], { type: 'audio/wav' });
}

function resolveEngineString(tracker, typeLong) {
  const t = tracker ? tracker.trim() : '', tl = typeLong ? typeLong.trim() : '';
  if (t && tl) {
    const tL = t.toLowerCase(), tlL = tl.toLowerCase();
    if (tL.includes('compatible') && !tlL.includes('compatible')) return tl.toUpperCase();
    if (tlL.includes('compatible') && !tL.includes('compatible')) return t.toUpperCase();
    return (t.length >= tl.length ? t : tl).toUpperCase();
  }
  if (tl) return tl.toUpperCase();
  if (t) return t.toUpperCase();
  throw new Error('OpenMPT failed to determine tracker engine metadata (type_long/tracker).');
}

function runCompilation(data) {
  let modulePtr = 0, ptrToFile = 0, leftBufferPtr = 0, rightBufferPtr = 0;
  try {
    if (!data.sampleRate) throw new Error('Worker compilation error: sampleRate is required.');
    if (!data.format) throw new Error('Worker compilation error: format is required.');
    const sampleRate = data.sampleRate, isMp3 = data.format === 'mp3';
    const byteArray = new Uint8Array(data.buffer);
    if (!byteArray || byteArray.byteLength === 0) throw new Error('Empty module buffer received.');

    ptrToFile = libopenmpt._malloc(byteArray.byteLength);
    if (!ptrToFile) throw new Error('Failed to allocate memory for module.');
    libopenmpt.HEAPU8.set(byteArray, ptrToFile);

    modulePtr = libopenmpt._openmpt_module_create_from_memory(ptrToFile, byteArray.byteLength, 0, 0, 0);
    libopenmpt._free(ptrToFile);
    ptrToFile = 0;
    if (!modulePtr) throw new Error('Unable to parse module (null pointer returned).');

    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 3, 4]);
    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 4, 5]);
    libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 2, 100]);
    libopenmpt.ccall('openmpt_module_set_repeat_count', 'number', ['number', 'number'], [modulePtr, 0]);

    const typeLong = libopenmpt.ccall('openmpt_module_get_metadata', 'string', ['number', 'string'], [modulePtr, 'type_long']);
    const trackerName = libopenmpt.ccall('openmpt_module_get_metadata', 'string', ['number', 'string'], [modulePtr, 'tracker']);
    const engineName = resolveEngineString(trackerName, typeLong);

    const numCh = libopenmpt._openmpt_module_get_num_channels
      ? libopenmpt._openmpt_module_get_num_channels(modulePtr)
      : libopenmpt.ccall('openmpt_module_get_num_channels', 'number', ['number'], [modulePtr]);
    if (typeof numCh !== 'number' || numCh <= 0) throw new Error(`OpenMPT reported invalid channel count: ${numCh}`);
    const channelsStr = `${numCh}CH`;

    const rawDur = libopenmpt._openmpt_module_get_duration_seconds
      ? libopenmpt._openmpt_module_get_duration_seconds(modulePtr)
      : libopenmpt.ccall('openmpt_module_get_duration_seconds', 'number', ['number'], [modulePtr]);
    if (!isFinite(rawDur) || rawDur <= 0) throw new Error(`Invalid duration reported by OpenMPT: ${rawDur}s`);

    const duration = rawDur, totalFrames = Math.ceil(duration * sampleRate);
    let mp3encoder = null;
    if (isMp3) {
      if (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder) throw new Error('LAME MP3 encoder is not available.');
      mp3encoder = new lamejs.Mp3Encoder(2, sampleRate, 320);
    }

    const BLOCK_SIZE = 1152, chunkSize = BLOCK_SIZE * 16;
    leftBufferPtr = libopenmpt._malloc(4 * chunkSize);
    rightBufferPtr = libopenmpt._malloc(4 * chunkSize);
    if (!leftBufferPtr || !rightBufferPtr) throw new Error('Failed to allocate stereo render buffers in Worker.');

    const baseL = leftBufferPtr >> 2, baseR = rightBufferPtr >> 2;
    const leftInt16 = isMp3 ? new Int16Array(chunkSize) : null;
    const rightInt16 = isMp3 ? new Int16Array(chunkSize) : null;
    const interleavedPcm = !isMp3 ? new Int16Array(chunkSize * 2) : null;
    const encodedChunks = [];
    let totalPcmBytes = 0;

    const VIS_FPS = 15, visStep = Math.max(1, Math.round(sampleRate / VIS_FPS));
    const totalVisFrames = Math.ceil(totalFrames / visStep) + 16;
    const visBuffer = new Uint8Array(totalVisFrames * FFT_BARS);
    const fftWindowBuf = new Float32Array(FFT_SIZE), prevTailMono = new Float32Array(FFT_SIZE);
    let hasPrevTail = false, visFrameIndex = 0, nextVisFrameTarget = 0, framesRendered = 0, lastReportedPct = -1;

    try {
      while (framesRendered < totalFrames) {
        const framesToRead = Math.min(chunkSize, totalFrames - framesRendered);
        const actual = libopenmpt._openmpt_module_read_float_stereo(modulePtr, sampleRate, framesToRead, leftBufferPtr, rightBufferPtr);
        if (!actual || actual <= 0) break;
        const heapF32 = libopenmpt.HEAPF32;

        if (isMp3) {
          for (let i = 0; i < actual; i++) {
            let sL = heapF32[baseL + i], sR = heapF32[baseR + i];
            if (sL > 1.0) sL = 1.0; else if (sL < -1.0) sL = -1.0;
            if (sR > 1.0) sR = 1.0; else if (sR < -1.0) sR = -1.0;
            leftInt16[i] = (sL < 0 ? sL * 32768 : sL * 32767) | 0;
            rightInt16[i] = (sR < 0 ? sR * 32768 : sR * 32767) | 0;
          }
          const lBuf = (actual === chunkSize) ? leftInt16 : leftInt16.subarray(0, actual);
          const rBuf = (actual === chunkSize) ? rightInt16 : rightInt16.subarray(0, actual);
          const mp3buf = mp3encoder.encodeBuffer(lBuf, rBuf);
          if (mp3buf && mp3buf.length > 0) encodedChunks.push(new Uint8Array(mp3buf));
        } else {
          for (let i = 0; i < actual; i++) {
            let sL = heapF32[baseL + i], sR = heapF32[baseR + i];
            if (sL > 1.0) sL = 1.0; else if (sL < -1.0) sL = -1.0;
            if (sR > 1.0) sR = 1.0; else if (sR < -1.0) sR = -1.0;
            const idx = i << 1;
            interleavedPcm[idx] = (sL < 0 ? sL * 32768 : sL * 32767) | 0;
            interleavedPcm[idx + 1] = (sR < 0 ? sR * 32768 : sR * 32767) | 0;
          }
          const pcmSlice = interleavedPcm.slice(0, actual * 2);
          encodedChunks.push(pcmSlice.buffer);
          totalPcmBytes += pcmSlice.byteLength;
        }

        const chunkEnd = framesRendered + actual;
        while (nextVisFrameTarget < chunkEnd && visFrameIndex < totalVisFrames) {
          const localIdx = nextVisFrameTarget - framesRendered;
          if (localIdx >= FFT_SIZE - 1) {
            const start = localIdx - (FFT_SIZE - 1);
            for (let k = 0; k < FFT_SIZE; k++) fftWindowBuf[k] = 0.5 * (heapF32[baseL + start + k] + heapF32[baseR + start + k]);
          } else if (hasPrevTail) {
            const fromPrev = (FFT_SIZE - 1) - localIdx;
            for (let k = 0; k < fromPrev; k++) fftWindowBuf[k] = prevTailMono[FFT_SIZE - fromPrev + k];
            for (let k = 0; k <= localIdx; k++) fftWindowBuf[fromPrev + k] = 0.5 * (heapF32[baseL + k] + heapF32[baseR + k]);
          } else {
            for (let k = 0; k < FFT_SIZE; k++) {
              const srcIdx = Math.max(0, localIdx - (FFT_SIZE - 1) + k);
              fftWindowBuf[k] = 0.5 * (heapF32[baseL + srcIdx] + heapF32[baseR + srcIdx]);
            }
          }
          computeFftBars(fftWindowBuf, visBuffer, visFrameIndex * FFT_BARS);
          visFrameIndex++;
          nextVisFrameTarget += visStep;
        }

        const tailCount = Math.min(FFT_SIZE, actual), tailStart = actual - tailCount;
        for (let k = 0; k < tailCount; k++) prevTailMono[k] = 0.5 * (heapF32[baseL + tailStart + k] + heapF32[baseR + tailStart + k]);
        hasPrevTail = true;

        framesRendered += actual;
        const pct = Math.min(100, Math.round((framesRendered / totalFrames) * 100));
        if (pct !== lastReportedPct) {
          lastReportedPct = pct;
          self.postMessage({ type: 'progress', progress: pct / 100 });
        }
      }
    } finally {
      if (modulePtr) { libopenmpt._openmpt_module_destroy(modulePtr); modulePtr = 0; }
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
      visFps: VIS_FPS,
      duration: duration,
      engine: engineName,
      channels: channelsStr
    }, [trimmedVisBuffer.buffer]);
  } catch (err) {
    if (ptrToFile) { libopenmpt._free(ptrToFile); ptrToFile = 0; }
    if (modulePtr) { libopenmpt._openmpt_module_destroy(modulePtr); modulePtr = 0; }
    if (leftBufferPtr) { libopenmpt._free(leftBufferPtr); leftBufferPtr = 0; }
    if (rightBufferPtr) { libopenmpt._free(rightBufferPtr); rightBufferPtr = 0; }
    console.error('[worker] runCompilation exception:', err);
    self.postMessage({ type: 'error', message: err.message });
  }
}

self.onmessage = function(e) {
  const data = e.data;
  if (!data || data.type !== 'compile') return;
  waitForEngine(
    () => runCompilation(data),
    (err) => {
      console.error('[worker] Engine readiness error:', err);
      self.postMessage({ type: 'error', message: err.message });
    }
  );
};