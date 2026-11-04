/**
 * js/engine/worklet.js - High-performance FIFO ring-buffer AudioWorkletProcessor.
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
      return true;
    }

    let framesWritten = 0;
    while (framesWritten < framesNeeded && this.leftQueue.length > 0) {
      const curL = this.leftQueue[0];
      const curR = this.rightQueue[0];
      const available = curL.length - this.readOffset;
      const toCopy = Math.min(available, framesNeeded - framesWritten);

      outL.set(curL.subarray(this.readOffset, this.readOffset + toCopy), framesWritten);
      outR.set(curR.subarray(this.readOffset, this.readOffset + toCopy), framesWritten);

      this.readOffset += toCopy;
      framesWritten += toCopy;

      if (this.readOffset >= curL.length) {
        this.leftQueue.shift();
        this.rightQueue.shift();
        this.readOffset = 0;

        if (this.directPort) {
          this.directPort.postMessage({ type: 'pull' });
        }
      }
    }

    if (framesWritten < framesNeeded) {
      outL.subarray(framesWritten).fill(0);
      outR.subarray(framesWritten).fill(0);
    }

    return true;
  }
}

registerProcessor('xm-audio-worklet', XMAudioWorkletProcessor);