/**
 * js/engine/workers/worklet.js - High-performance jitter-buffered AudioWorkletProcessor.
 * Runs directly on the browser's native audio rendering thread.
 */
class XMAudioWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.leftQueue = [];
    this.rightQueue = [];
    this.readOffset = 0;
    this.isPaused = false;
    this.directPort = null;

    this.port.onmessage = (e) => {
      const data = e.data;
      if (!data) {
        return;
      }

      if (data.type === 'init-port') {
        this.initDirectPort(data.port);
      } else if (data.type === 'pause') {
        this.isPaused = true;
      } else if (data.type === 'resume') {
        this.isPaused = false;
      } else if (data.type === 'flush') {
        this.flush();
      }
    };
  }

  initDirectPort(port) {
    this.directPort = port;
    this.directPort.onmessage = (e) => {
      const data = e.data;
      if (!data) {
        return;
      }

      if (data.type === 'chunk') {
        this.leftQueue.push(new Float32Array(data.left));
        this.rightQueue.push(new Float32Array(data.right));
      } else if (data.type === 'flush') {
        this.flush();
      }
    };
  }

  flush() {
    this.leftQueue.length = 0;
    this.rightQueue.length = 0;
    this.readOffset = 0;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) {
      return true;
    }

    const outL = output[0];
    const outR = output[1];
    const framesNeeded = outL.length;

    if (this.isPaused || this.leftQueue.length === 0) {
      outL.fill(0);
      outR.fill(0);

      // If playing but starved, proactively signal emergency refill
      if (!this.isPaused && this.directPort) {
        this.directPort.postMessage({ type: 'pull', count: 8 });
      }
      return true;
    }

    let framesWritten = 0;
    while (framesWritten < framesNeeded && this.leftQueue.length > 0) {
      const curL = this.leftQueue[0];
      const curR = this.rightQueue[0];
      const available = curL.length - this.readOffset;
      const toCopy = Math.min(available, framesNeeded - framesWritten);

      // Direct loop copy avoids GC allocation in the real-time audio thread
      for (let i = 0; i < toCopy; i++) {
        outL[framesWritten + i] = curL[this.readOffset + i];
        outR[framesWritten + i] = curR[this.readOffset + i];
      }

      this.readOffset += toCopy;
      framesWritten += toCopy;

      if (this.readOffset >= curL.length) {
        this.leftQueue.shift();
        this.rightQueue.shift();
        this.readOffset = 0;

        // Keep buffer topped up as chunks are consumed
        if (this.directPort) {
          const needed = this.leftQueue.length < 8 ? 4 : 1;
          this.directPort.postMessage({ type: 'pull', count: needed });
        }
      }
    }

    // Proactive low-watermark refill request before queue drops to zero
    if (this.leftQueue.length < 6 && this.directPort && !this.isPaused) {
      this.directPort.postMessage({ type: 'pull', count: 4 });
    }

    if (framesWritten < framesNeeded) {
      outL.subarray(framesWritten).fill(0);
      outR.subarray(framesWritten).fill(0);
    }

    return true;
  }
}

registerProcessor('xm-audio-worklet', XMAudioWorkletProcessor);