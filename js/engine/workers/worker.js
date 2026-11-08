/**
 * js/engine/workers/worker.js - Dedicated Web Worker for OpenMPT rendering and MP3/WAV compilation without silent fallbacks.
 */
/* global importScripts, libopenmpt, lamejs, computeFftBars, FFT_SIZE, FFT_BARS */
self.libopenmpt = self.libopenmpt || {};
self.libopenmpt.print = function(text) { console.log('[libopenmpt Worker]', text); };
self.libopenmpt.printErr = function(text) { console.error('[libopenmpt Worker Error]', text); };

let isRuntimeReady = false;
let isRuntimeVerified = false;
let isRuntimeAborted = false;
let abortErrorMessage = '';

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
  if (typeof libopenmpt === 'undefined') return false;
  if (!libopenmpt.HEAPU8 || libopenmpt.HEAPU8.length === 0) return false;
  if (typeof libopenmpt._malloc !== 'function' || typeof libopenmpt._free !== 'function') return false;
  if (typeof libopenmpt._openmpt_module_create_from_memory !== 'function') return false;
  if (!isRuntimeReady && !libopenmpt.calledRun && !libopenmpt.asm) return false;

  const probePtr = libopenmpt._malloc(4);
  if (!probePtr) return false;
  libopenmpt._free(probePtr);
  isRuntimeVerified = true;
  return true;
}

function waitForEngine(callback, errback, attempts) {
  const tries = attempts ? attempts : 0;
  if (isRuntimeAborted) {
    if (errback) errback(new Error(abortErrorMessage ? abortErrorMessage : 'libopenmpt memory initialization aborted.'));
    return;
  }
  if (isEngineReady()) {
    callback();
  } else if (tries < 300) {
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

function resolveEngineString(tracker, typeLong) {
  const t = tracker ? tracker.trim() : '';
  const tl = typeLong ? typeLong.trim() : '';
  if (t && tl) {
    const tLower = t.toLowerCase();
    const tlLower = tl.toLowerCase();
    if (tLower.includes('compatible') && !tlLower.includes('compatible')) return tl.toUpperCase();
    if (tlLower.includes('compatible') && !tLower.includes('compatible')) return t.toUpperCase();
    return (t.length >= tl.length ? t : tl).toUpperCase();
  }
  if (tl) return tl.toUpperCase();
  if (t) return t.toUpperCase();
  throw new Error('OpenMPT failed to determine tracker engine metadata (type_long/tracker).');
}

function runCompilation(data) {
  let modulePtr = 0, ptrToFile = 0, leftBufferPtr = 0, rightBufferPtr = 0;

  try {
    if (!data.sampleRate) {
      self.postMessage({ type: 'error', message: 'Worker compilation error: sampleRate is required.' });
      return;
    }
    if (!data.format) {
      self.postMessage({ type: 'error', message: 'Worker compilation error: format is required.' });
      return;
    }
    const sampleRate = data.sampleRate;
    const isMp3 = data.format === 'mp3';

    const byteArray = new Uint8Array(data.buffer);
    if (!byteArray || byteArray.byteLength === 0) {
      self.postMessage({ type: 'error', message: 'Empty module buffer received.' });
      return;
    }
    ptrToFile = libopenmpt._malloc(byteArray.byteLength);
    if (!ptrToFile) {
      self.postMessage({ type: 'error', message: 'Failed to allocate memory for module.' });
      return;
    }
    libopenmpt.HEAPU8.set(byteArray, ptrToFile);

    modulePtr = libopenmpt._openmpt_module_create_from_memory(ptrToFile, byteArray.byteLength, 0, 0, 0);
    libopenmpt._free(ptrToFile);
    ptrToFile = 0;
    if (!modulePtr) {
      self.postMessage({ type: 'error', message: 'Unable to parse module.' });
      return;
    }

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
    if (typeof numCh !== 'number' || numCh <= 0) {
      throw new Error(`OpenMPT reported invalid channel count: ${numCh}`);
    }
    const channelsStr = `${numCh}CH`;

    const rawDur = libopenmpt._openmpt_module_get_duration_seconds
      ? libopenmpt._openmpt_module_get_duration_seconds(modulePtr)
      : libopenmpt.ccall('openmpt_module_get_duration_seconds', 'number', ['number'], [modulePtr]);
    if (!isFinite(rawDur) || rawDur <= 0) {
      throw new Error(`Invalid duration reported by OpenMPT during compilation: ${rawDur}s`);
    }
    const duration = rawDur;
    const totalFrames = Math.ceil(duration * sampleRate);

    let mp3encoder = null;
    if (isMp3) {
      if (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder) {
        throw new Error('LAME MP3 encoder is not available in Web Worker.');
      }
      mp3encoder = new lamejs.Mp3Encoder(2, sampleRate, 320);
    }

    const BLOCK_SIZE = 1152, chunkSize = BLOCK_SIZE * 4;
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
    const fftWindowBuf = new Float32Array(FFT_SIZE);
    const linFftBuf = new Float32Array(FFT_SIZE);
    let visFrameIndex = 0, samplesSinceLastVis = 0, fftWindowPtr = 0, framesRendered = 0, lastReportedPct = -1;

    try {
      while (framesRendered < totalFrames) {
        const framesToRead = Math.min(chunkSize, totalFrames - framesRendered);
        const actual = libopenmpt._openmpt_module_read_float_stereo(modulePtr, sampleRate, framesToRead, leftBufferPtr, rightBufferPtr);
        if (!actual || actual <= 0) break;

        const heapF32 = libopenmpt.HEAPF32;
        for (let i = 0; i < actual; i++) {
          let sL = heapF32[baseL + i], sR = heapF32[baseR + i];
          if (sL > 1.0) sL = 1.0; else if (sL < -1.0) sL = -1.0;
          if (sR > 1.0) sR = 1.0; else if (sR < -1.0) sR = -1.0;

          fftWindowBuf[fftWindowPtr] = 0.5 * (sL + sR);
          fftWindowPtr = (fftWindowPtr + 1) % FFT_SIZE;
          if (++samplesSinceLastVis >= visStep) {
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
            const mp3buf = mp3encoder.encodeBuffer(
              (i === 0 && end === chunkSize) ? leftInt16 : leftInt16.subarray(i, end),
              (i === 0 && end === chunkSize) ? rightInt16 : rightInt16.subarray(i, end)
            );
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