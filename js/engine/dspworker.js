/**
 * js/engine/dspworker.js - Dedicated Web Worker hosting libopenmpt for off-main-thread DSP.
 */
/* global importScripts, libopenmpt */
self.libopenmpt = self.libopenmpt || {};
self.libopenmpt.locateFile = function(f) {
  return self.USE_CDN
    ? 'https://cdn.jsdelivr.net/gh/deskjet/chiptune2.js@master/' + f
    : '../' + f;
};

try {
  importScripts('../libopenmpt.js');
} catch (e) {
  self.USE_CDN = true;
  importScripts('https://cdn.jsdelivr.net/gh/deskjet/chiptune2.js@master/libopenmpt.js');
}

let directPort = null;
let sampleRate = 48000;
let modulePtr = 0;
let ptrToFile = 0;
let isPlaying = false;
let repeatCount = -1;
let leftBufferPtr = 0;
let rightBufferPtr = 0;

const CHUNK_FRAMES = 2048;

function ensureScratchBuffers() {
  if (!leftBufferPtr) {
    leftBufferPtr = libopenmpt._malloc(4 * CHUNK_FRAMES);
  }
  if (!rightBufferPtr) {
    rightBufferPtr = libopenmpt._malloc(4 * CHUNK_FRAMES);
  }
}

function freeModule() {
  isPlaying = false;
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
    meta[k] = libopenmpt.ccall('openmpt_module_get_metadata', 'string', ['number', 'string'], [mod, k]) || '';
  }
  meta.channels = libopenmpt._openmpt_module_get_num_channels
    ? libopenmpt._openmpt_module_get_num_channels(mod)
    : (libopenmpt.ccall('openmpt_module_get_num_channels', 'number', ['number'], [mod]) || 0);
  meta.duration = libopenmpt._openmpt_module_get_duration_seconds(mod) || 180;
  return meta;
}

function renderAndSendChunk() {
  if (!isPlaying || !modulePtr || !directPort) {
    return;
  }

  ensureScratchBuffers();

  const actual = libopenmpt._openmpt_module_read_float_stereo(
    modulePtr,
    sampleRate,
    CHUNK_FRAMES,
    leftBufferPtr,
    rightBufferPtr
  );

  if (actual === 0) {
    isPlaying = false;
    self.postMessage({ type: 'ended' });
    return;
  }

  const heapF32 = libopenmpt.HEAPF32;
  const baseL = leftBufferPtr >> 2;
  const baseR = rightBufferPtr >> 2;

  const leftArray = new Float32Array(actual);
  const rightArray = new Float32Array(actual);

  leftArray.set(heapF32.subarray(baseL, baseL + actual));
  rightArray.set(heapF32.subarray(baseR, baseR + actual));

  directPort.postMessage(
    {
      type: 'chunk',
      left: leftArray.buffer,
      right: rightArray.buffer
    },
    [leftArray.buffer, rightArray.buffer]
  );
}

function postPosition() {
  if (!isPlaying || !modulePtr) {
    return;
  }
  const pos = libopenmpt._openmpt_module_get_position_seconds
    ? libopenmpt._openmpt_module_get_position_seconds(modulePtr)
    : libopenmpt.ccall('openmpt_module_get_position_seconds', 'number', ['number'], [modulePtr]);

  self.postMessage({ type: 'position', position: pos || 0 });
}

setInterval(postPosition, 200);

self.onmessage = function(e) {
  const data = e.data;
  if (!data) {
    return;
  }

  if (data.action === 'init-port') {
    directPort = data.port;
    sampleRate = data.sampleRate || 48000;
    directPort.onmessage = (msgEvent) => {
      if (msgEvent.data && msgEvent.data.type === 'pull') {
        renderAndSendChunk();
      }
    };
  } else if (data.action === 'load') {
    freeModule();

    try {
      const byteArray = new Uint8Array(data.buffer);
      ptrToFile = libopenmpt._malloc(byteArray.byteLength);
      libopenmpt.HEAPU8.set(byteArray, ptrToFile);

      modulePtr = libopenmpt._openmpt_module_create_from_memory(ptrToFile, byteArray.byteLength, 0, 0, 0);
      if (!modulePtr) {
        self.postMessage({ type: 'error', message: 'Could not parse module.' });
        return;
      }

      repeatCount = (data.repeatCount !== undefined) ? data.repeatCount : -1;
      libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 3, 4]);
      libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 4, 5]);
      libopenmpt.ccall('openmpt_module_set_render_param', 'number', ['number', 'number', 'number'], [modulePtr, 2, 100]);
      libopenmpt.ccall('openmpt_module_set_repeat_count', 'number', ['number', 'number'], [modulePtr, repeatCount]);

      const meta = extractMetadata(modulePtr);
      self.postMessage({ type: 'metadata', meta: meta });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  } else if (data.action === 'play') {
    if (!modulePtr) {
      return;
    }
    isPlaying = true;
    for (let i = 0; i < 4; i++) {
      renderAndSendChunk();
    }
  } else if (data.action === 'pause') {
    isPlaying = false;
  } else if (data.action === 'seek') {
    if (modulePtr && typeof data.seconds === 'number') {
      libopenmpt.ccall('openmpt_module_set_position_seconds', 'number', ['number', 'number'], [modulePtr, data.seconds]);
      if (directPort) {
        directPort.postMessage({ type: 'flush' });
      }
      if (isPlaying) {
        for (let i = 0; i < 4; i++) {
          renderAndSendChunk();
        }
      }
    }
  } else if (data.action === 'repeat') {
    repeatCount = data.repeatCount;
    if (modulePtr) {
      libopenmpt.ccall('openmpt_module_set_repeat_count', 'number', ['number', 'number'], [modulePtr, repeatCount]);
    }
  } else if (data.action === 'stop') {
    freeModule();
    if (directPort) {
      directPort.postMessage({ type: 'flush' });
    }
  }
};