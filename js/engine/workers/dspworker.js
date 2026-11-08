/**
 * js/engine/workers/dspworker.js - Dedicated Web Worker hosting libopenmpt for off-main-thread DSP without fallbacks.
 */
/* global importScripts, libopenmpt */
self.libopenmpt = self.libopenmpt || {};
self.libopenmpt.print = function(text) { console.log('[libopenmpt DSP]', text); };
self.libopenmpt.printErr = function(text) { console.error('[libopenmpt DSP Error]', text); };

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
  abortErrorMessage = String(msg || 'Module aborted');
  console.error('[libopenmpt DSP Abort]', abortErrorMessage);
  if (typeof prevAbort === 'function') prevAbort(msg);
};

self.libopenmpt.locateFile = function(f) {
  return '../../' + f;
};

importScripts('../../libopenmpt.js');

let directPort = null;
let sampleRate = 0;
let modulePtr = 0;
let ptrToFile = 0;
let isPlaying = false;
let repeatCount = -1;
let leftBufferPtr = 0;
let rightBufferPtr = 0;
let renderedFrames = 0;

const CHUNK_FRAMES = 4096;

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

function ensureScratchBuffers() {
  if (!leftBufferPtr && isEngineReady()) {
    leftBufferPtr = libopenmpt._malloc(4 * CHUNK_FRAMES);
    if (!leftBufferPtr) throw new Error('Failed to allocate scratch buffer for left channel.');
  }
  if (!rightBufferPtr && isEngineReady()) {
    rightBufferPtr = libopenmpt._malloc(4 * CHUNK_FRAMES);
    if (!rightBufferPtr) throw new Error('Failed to allocate scratch buffer for right channel.');
  }
}

function freeModule() {
  isPlaying = false;
  renderedFrames = 0;
  if (modulePtr) {
    libopenmpt._openmpt_module_destroy(modulePtr);
    modulePtr = 0;
  }
  if (ptrToFile) {
    libopenmpt._free(ptrToFile);
    ptrToFile = 0;
  }
}

function extractMetadata(mod) {
  const meta = {};
  const keys = ['title', 'artist', 'type_long', 'tracker', 'message'];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    meta[k] = libopenmpt.ccall('openmpt_module_get_metadata', 'string', ['number', 'string'], [mod, k]);
  }
  if (!meta.type_long && !meta.tracker) throw new Error('OpenMPT failed to detect tracker format (type_long/tracker).');

  const ch = libopenmpt._openmpt_module_get_num_channels
    ? libopenmpt._openmpt_module_get_num_channels(mod)
    : libopenmpt.ccall('openmpt_module_get_num_channels', 'number', ['number'], [mod]);
  if (typeof ch !== 'number' || ch <= 0) {
    throw new Error(`OpenMPT reported invalid channel count: ${ch}`);
  }
  meta.channels = ch;

  libopenmpt.ccall('openmpt_module_set_repeat_count', 'number', ['number', 'number'], [mod, 0]);
  const rawDur = libopenmpt._openmpt_module_get_duration_seconds
    ? libopenmpt._openmpt_module_get_duration_seconds(mod)
    : libopenmpt.ccall('openmpt_module_get_duration_seconds', 'number', ['number'], [mod]);

  if (!isFinite(rawDur) || rawDur <= 0) {
    throw new Error(`Invalid duration reported by libopenmpt for module: ${rawDur}s`);
  }
  meta.duration = rawDur;
  return meta;
}

function renderAndSendChunk() {
  if (!isPlaying || !modulePtr || !directPort || !isEngineReady()) {
    return;
  }

  ensureScratchBuffers();

  let chunkPos = renderedFrames / sampleRate;
  let rawPos = null;
  if (typeof libopenmpt._openmpt_module_get_position_seconds === 'function') {
    rawPos = libopenmpt._openmpt_module_get_position_seconds(modulePtr);
  } else if (typeof libopenmpt.ccall === 'function') {
    rawPos = libopenmpt.ccall('openmpt_module_get_position_seconds', 'number', ['number'], [modulePtr]);
  }
  if (typeof rawPos === 'number' && isFinite(rawPos) && rawPos > 0) {
    chunkPos = rawPos;
    renderedFrames = Math.round(rawPos * sampleRate);
  }

  const actual = libopenmpt._openmpt_module_read_float_stereo(
    modulePtr,
    sampleRate,
    CHUNK_FRAMES,
    leftBufferPtr,
    rightBufferPtr
  );

  if (actual === 0) {
    isPlaying = false;
    directPort.postMessage({ type: 'eos' });
    return;
  }

  renderedFrames += actual;

  const heapF32 = libopenmpt.HEAPF32;
  const baseL = leftBufferPtr >> 2;
  const baseR = rightBufferPtr >> 2;

  const leftArray = new Float32Array(actual);
  const rightArray = new Float32Array(actual);

  for (let i = 0; i < actual; i++) {
    let sL = heapF32[baseL + i], sR = heapF32[baseR + i];
    if (sL > 1.0) sL = 1.0; else if (sL < -1.0) sL = -1.0;
    if (sR > 1.0) sR = 1.0; else if (sR < -1.0) sR = -1.0;
    leftArray[i] = sL;
    rightArray[i] = sR;
  }

  directPort.postMessage(
    {
      type: 'chunk',
      left: leftArray.buffer,
      right: rightArray.buffer,
      pos: chunkPos
    },
    [leftArray.buffer, rightArray.buffer]
  );
}

function renderBatch(count) {
  const num = Math.min(16, Math.max(1, count));
  for (let i = 0; i < num; i++) {
    if (!isPlaying || !modulePtr) break;
    renderAndSendChunk();
  }
}

function waitForEngine(callback, errback, attempts) {
  const tries = attempts ? attempts : 0;
  if (isRuntimeAborted) {
    if (errback) errback(new Error(abortErrorMessage ? abortErrorMessage : 'DSP engine aborted.'));
    return;
  }
  if (isEngineReady()) {
    callback();
  } else if (tries < 300) {
    setTimeout(() => waitForEngine(callback, errback, tries + 1), 50);
  } else if (errback) {
    errback(new Error('DSP engine timed out in worker.'));
  }
}

self.onmessage = function(e) {
  const data = e.data;
  if (!data) return;

  if (data.action === 'init-port') {
    if (!data.sampleRate) throw new Error('dspworker init-port error: sampleRate is required');
    if (!data.port) throw new Error('dspworker init-port error: port is required');
    directPort = data.port;
    sampleRate = data.sampleRate;
    directPort.onmessage = (msgEvent) => {
      if (!msgEvent.data) return;
      if (msgEvent.data.type === 'pull') renderBatch(msgEvent.data.count ? msgEvent.data.count : 1);
    };
  } else if (data.action === 'load') {
    freeModule();

    waitForEngine(() => {
      try {
        const byteArray = new Uint8Array(data.buffer);
        if (!byteArray || byteArray.byteLength === 0) {
          self.postMessage({ type: 'error', message: 'Empty module buffer received.' });
          return;
        }
        ptrToFile = libopenmpt._malloc(byteArray.byteLength);
        if (!ptrToFile) {
          self.postMessage({ type: 'error', message: 'Failed to allocate memory for module buffer.' });
          return;
        }
        libopenmpt.HEAPU8.set(byteArray, ptrToFile);

        modulePtr = libopenmpt._openmpt_module_create_from_memory(ptrToFile, byteArray.byteLength, 0, 0, 0);
        if (!modulePtr) {
          freeModule();
          self.postMessage({ type: 'error', message: 'Could not parse tracker module (libopenmpt returned null pointer).' });
          return;
        }

        libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 3, 4]);
        libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 4, 5]);
        libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 2, 100]);

        const meta = extractMetadata(modulePtr);
        repeatCount = (typeof data.repeatCount === 'number') ? data.repeatCount : -1;
        libopenmpt.ccall('openmpt_module_set_repeat_count', 'number', ['number', 'number'], [modulePtr, repeatCount]);

        renderedFrames = 0;
        self.postMessage({ type: 'metadata', meta: meta });
      } catch (err) {
        console.error('[dspworker] Exception during module load:', err);
        self.postMessage({ type: 'error', message: err.message });
      }
    }, (err) => {
      console.error('[dspworker] Engine readiness error:', err);
      self.postMessage({ type: 'error', message: err.message });
    });
  } else if (data.action === 'play') {
    if (!modulePtr) {
      self.postMessage({ type: 'error', message: 'Cannot play: No tracker module is loaded.' });
      return;
    }
    isPlaying = true;
    renderBatch(14);
  } else if (data.action === 'pause') {
    isPlaying = false;
  } else if (data.action === 'seek') {
    if (modulePtr && typeof data.seconds === 'number') {
      const targetSec = Math.max(0, data.seconds);
      libopenmpt.ccall('openmpt_module_set_position_seconds', 'number', ['number', 'number'], [modulePtr, targetSec]);
      renderedFrames = Math.round(targetSec * sampleRate);
      if (directPort) directPort.postMessage({ type: 'flush', position: targetSec });
      if (isPlaying) renderBatch(14);
    }
  } else if (data.action === 'repeat') {
    repeatCount = data.repeatCount;
    if (modulePtr) libopenmpt.ccall('openmpt_module_set_repeat_count', 'number', ['number', 'number'], [modulePtr, repeatCount]);
  } else if (data.action === 'stop') {
    freeModule();
    if (directPort) directPort.postMessage({ type: 'flush', position: 0 });
  }
};