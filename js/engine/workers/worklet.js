/**
 * js/engine/workers/worklet.js - High-performance jitter-buffered AudioWorkletProcessor.
 * Runs directly on the browser's native audio rendering thread.
 */
class XMAudioWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.leftQueue = [];
    this.rightQueue = [];
    this.posQueue = [];
    this.readOffset = 0;
    this.isPaused = false;
    this.isEos = false;
    this.directPort = null;
    this.currentPosition = 0;
    this.processTick = 0;

    this.port.onmessage = (e) => {
      const data = e.data;
      if (!data) return;
      if (data.type === 'init-port') {
        this.initDirectPort(data.port);
      } else if (data.type === 'pause') {
        this.isPaused = true;
      } else if (data.type === 'resume') {
        this.isPaused = false;
      } else if (data.type === 'seek') {
        this.currentPosition = typeof data.position === 'number' ? data.position : 0;
      } else if (data.type === 'flush') {
        this.flush();
        if (typeof data.position === 'number') {
          this.currentPosition = data.position;
        }
      }
    };
  }

  initDirectPort(port) {
    this.directPort = port;
    this.directPort.onmessage = (e) => {
      const data = e.data;
      if (!data) return;
      if (data.type === 'chunk') {
        this.leftQueue.push(new Float32Array(data.left));
        this.rightQueue.push(new Float32Array(data.right));
        this.posQueue.push(typeof data.pos === 'number' ? data.pos : 0);
      } else if (data.type === 'eos') {
        this.isEos = true;
      } else if (data.type === 'flush') {
        this.flush();
        if (typeof data.position === 'number') {
          this.currentPosition = data.position;
        }
      }
    };
  }

  flush() {
    this.leftQueue.length = 0;
    this.rightQueue.length = 0;
    this.posQueue.length = 0;
    this.readOffset = 0;
    this.isEos = false;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output[1] || null;
    const isMono = !outR;
    const framesNeeded = outL.length;

    if (this.isPaused || this.leftQueue.length === 0) {
      outL.fill(0);
      if (outR) outR.fill(0);
      if (this.isEos && this.leftQueue.length === 0 && !this.isPaused) {
        this.isEos = false;
        this.port.postMessage({ type: 'ended' });
      } else if (!this.isPaused && this.directPort) {
        this.directPort.postMessage({ type: 'pull', count: 8 });
      }
      return true;
    }

    const chunkPos = this.posQueue[0] || 0;
    this.currentPosition = chunkPos + (this.readOffset / sampleRate);

    let framesWritten = 0;
    while (framesWritten < framesNeeded && this.leftQueue.length > 0) {
      const curL = this.leftQueue[0];
      const curR = this.rightQueue[0];
      const available = curL.length - this.readOffset;
      const toCopy = Math.min(available, framesNeeded - framesWritten);

      if (isMono) {
        for (let i = 0; i < toCopy; i++) {
          outL[framesWritten + i] = 0.5 * (curL[this.readOffset + i] + curR[this.readOffset + i]);
        }
      } else {
        for (let i = 0; i < toCopy; i++) {
          outL[framesWritten + i] = curL[this.readOffset + i];
          outR[framesWritten + i] = curR[this.readOffset + i];
        }
      }

      this.readOffset += toCopy;
      framesWritten += toCopy;

      if (this.readOffset >= curL.length) {
        this.leftQueue.shift();
        this.rightQueue.shift();
        this.posQueue.shift();
        this.readOffset = 0;

        if (this.directPort) {
          const needed = this.leftQueue.length < 8 ? 4 : 1;
          this.directPort.postMessage({ type: 'pull', count: needed });
        }
      }
    }

    if (this.leftQueue.length < 6 && this.directPort && !this.isPaused && !this.isEos) {
      this.directPort.postMessage({ type: 'pull', count: 4 });
    }

    if (framesWritten < framesNeeded) {
      outL.subarray(framesWritten).fill(0);
      if (outR) outR.subarray(framesWritten).fill(0);
    }

    this.processTick = (this.processTick + 1) || 1;
    if (this.processTick % 16 === 0) {
      this.port.postMessage({ type: 'position', position: this.currentPosition });
    }

    return true;
  }
}

registerProcessor('xm-audio-worklet', XMAudioWorkletProcessor);