/**
 * js/engine/dsp/chiptune2.js - Multithreaded AudioWorklet + Web Worker DSP chiptune engine.
 */
(function(window) {
  const ChiptuneAudioContext = window.AudioContext || window.webkitAudioContext;
  if (!ChiptuneAudioContext) throw new Error('Fatal: Web Audio API is not supported in this browser.');

  function ChiptuneJsPlayer() {
    this.context = new ChiptuneAudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.sampleRate = this.context.sampleRate;
    this.gainNode = this.context.createGain();
    this.workletGain = this.context.createGain();
    this.workletGain.gain.value = 1.0;
    this.workletGain.connect(this.gainNode);

    this.dcFilter = this.context.createBiquadFilter();
    this.dcFilter.type = 'highpass';
    this.dcFilter.frequency.value = 25;
    this.dcFilter.Q.value = 0.707;

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 64;
    this.analyser.smoothingTimeConstant = 0.82;

    this.gainNode.connect(this.dcFilter);
    this.dcFilter.connect(this.analyser);
    this.analyser.connect(this.context.destination);

    this.workletNode = null;
    this.dspWorker = null;
    this.isPipelineReady = false;
    this.initPromise = null;
    this.currentPlayingNode = null;
    this.currentMetadata = null;
    this.cachedDuration = 0;
    this.currentPosition = 0;
    this.repeatCount = -1;
    this.handlers = {};
    this.pendingLoadCallback = null;
    this.pendingLoadErrback = null;

    this.initPipeline();
  }

  ChiptuneJsPlayer.prototype.initPipeline = function() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise(async (resolve, reject) => {
      try {
        await this.context.audioWorklet.addModule('js/engine/workers/worklet.js');
        this.workletNode = new AudioWorkletNode(this.context, 'xm-audio-worklet', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });
        this.workletNode.paused = true;
        this.workletNode.connect(this.workletGain);

        this.workletNode.port.onmessage = (e) => {
          if (!e.data) return;
          if (e.data.type === 'position') {
            this.currentPosition = e.data.position;
          } else if (e.data.type === 'ended') {
            if (this.currentPlayingNode) {
              this.currentPlayingNode.paused = true;
              this.currentPlayingNode = null;
            }
            this.currentPosition = 0;
            this.fireEvent('onEnded');
          }
        };

        if (this.workletNode.port.start) this.workletNode.port.start();

        this.dspWorker = new Worker('js/engine/workers/dspworker.js');
        this.bindWorkerEvents();

        const channel = new MessageChannel();
        this.workletNode.port.postMessage({ type: 'init-port', port: channel.port1 }, [channel.port1]);
        this.dspWorker.postMessage({ action: 'init-port', port: channel.port2, sampleRate: this.sampleRate }, [channel.port2]);

        this.isPipelineReady = true;
        resolve();
      } catch (err) {
        console.error('[ChiptuneJsPlayer] initPipeline failed:', err);
        reject(err);
      }
    });

    return this.initPromise;
  };

  ChiptuneJsPlayer.prototype.bindWorkerEvents = function() {
    this.dspWorker.onmessage = (e) => {
      const data = e.data;
      if (!data) return;
      if (data.type === 'metadata') {
        this.currentMetadata = data.meta;
        if (!data.meta || typeof data.meta.duration !== 'number' || data.meta.duration <= 0) {
          const err = new Error('Invalid metadata received: missing valid duration.');
          if (typeof this.pendingLoadErrback === 'function') {
            const eb = this.pendingLoadErrback;
            this.pendingLoadCallback = null;
            this.pendingLoadErrback = null;
            eb(err);
          }
          this.fireEvent('onError', err);
          return;
        }
        this.cachedDuration = data.meta.duration;
        if (typeof this.pendingLoadCallback === 'function') {
          const cb = this.pendingLoadCallback;
          this.pendingLoadCallback = null;
          this.pendingLoadErrback = null;
          cb();
        }
      } else if (data.type === 'error') {
        const err = new Error(`DSP Worker Error: ${data.message}`);
        if (typeof this.pendingLoadErrback === 'function') {
          const eb = this.pendingLoadErrback;
          this.pendingLoadCallback = null;
          this.pendingLoadErrback = null;
          eb(err);
        }
        this.fireEvent('onError', err);
      }
    };
  };

  ChiptuneJsPlayer.prototype.on = function(eventName, handler) { this.handlers[eventName] = handler; };
  ChiptuneJsPlayer.prototype.fireEvent = function(eventName, arg) {
    if (typeof this.handlers[eventName] === 'function') this.handlers[eventName](arg);
  };

  ChiptuneJsPlayer.prototype.unlock = function() {
    if (this.context && this.context.state !== 'running') {
      this.context.resume().catch((err) => console.error('[ChiptuneJsPlayer] AudioContext resume failed:', err));
    }
  };

  ChiptuneJsPlayer.prototype.load = function(input, callback, errback) {
    this.unlock();
    this.currentPosition = 0;
    this.cachedDuration = 0;

    const finishLoad = (buf) => {
      this.initPipeline()
        .then(() => {
          this.pendingLoadCallback = () => callback(buf);
          this.pendingLoadErrback = (err) => { if (errback) errback(err); };
          const copy = buf.slice(0);
          this.dspWorker.postMessage({ action: 'load', buffer: copy, repeatCount: this.repeatCount }, [copy]);
        })
        .catch((err) => {
          if (errback) errback(err);
          this.fireEvent('onError', err);
        });
    };

    if (input instanceof File || input instanceof Blob) {
      const reader = new FileReader();
      reader.onload = () => finishLoad(reader.result);
      reader.onerror = () => {
        const err = new Error(`Failed to read file: ${reader.error ? reader.error.message : 'Unknown'}`);
        if (errback) errback(err);
        this.fireEvent('onError', err);
      };
      reader.readAsArrayBuffer(input);
    } else if (typeof input === 'string') {
      fetch(input)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status} fetching module from ${input}`);
          return res.arrayBuffer();
        })
        .then(finishLoad)
        .catch((err) => {
          if (errback) errback(err);
          this.fireEvent('onError', err);
        });
    } else if (input instanceof ArrayBuffer) {
      finishLoad(input);
    } else {
      const err = new Error('Invalid input format provided to load().');
      if (errback) errback(err);
      this.fireEvent('onError', err);
    }
  };

  ChiptuneJsPlayer.prototype.play = function(buffer) {
    this.unlock();
    if (!this.isPipelineReady || !this.dspWorker || !this.workletNode) {
      throw new Error('Cannot play: DSP pipeline is not ready.');
    }

    this.currentPosition = 0;
    this.workletGain.gain.cancelScheduledValues(this.context.currentTime);
    this.workletGain.gain.setValueAtTime(1.0, this.context.currentTime);
    this.workletNode.port.postMessage({ type: 'flush', position: 0 });
    this.dspWorker.postMessage({ action: 'play' });
    this.workletNode.port.postMessage({ type: 'resume' });

    this.currentPlayingNode = this.workletNode;
    this.currentPlayingNode.paused = false;
    this.fireEvent('onPlay');
    return this.workletNode;
  };

  ChiptuneJsPlayer.prototype.stop = function() {
    if (this.dspWorker) this.dspWorker.postMessage({ action: 'stop' });
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'flush', position: 0 });
      this.workletNode.port.postMessage({ type: 'pause' });
    }
    if (this.currentPlayingNode) {
      this.currentPlayingNode.paused = true;
      this.currentPlayingNode = null;
    }
    this.currentMetadata = null;
    this.cachedDuration = 0;
    this.currentPosition = 0;
    this.fireEvent('onStop');
  };

  ChiptuneJsPlayer.prototype.togglePause = function() {
    if (!this.currentPlayingNode) return false;
    this.unlock();
    const willPause = !this.currentPlayingNode.paused;
    this.currentPlayingNode.paused = willPause;

    if (willPause) {
      this.dspWorker.postMessage({ action: 'pause' });
      this.workletNode.port.postMessage({ type: 'pause' });
    } else {
      this.workletNode.port.postMessage({ type: 'resume' });
      this.dspWorker.postMessage({ action: 'play' });
    }
    return willPause;
  };

  ChiptuneJsPlayer.prototype.seek = function(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) throw new Error(`Invalid seek time: ${seconds}`);
    this.currentPosition = seconds;
    if (this.workletNode) this.workletNode.port.postMessage({ type: 'seek', position: seconds });
    if (this.dspWorker && this.currentPlayingNode) this.dspWorker.postMessage({ action: 'seek', seconds });
  };

  ChiptuneJsPlayer.prototype.getPosition = function() {
    return (isFinite(this.currentPosition) && this.currentPosition >= 0) ? this.currentPosition : 0;
  };

  ChiptuneJsPlayer.prototype.duration = function() {
    return (isFinite(this.cachedDuration) && this.cachedDuration > 0) ? this.cachedDuration : 0;
  };

  ChiptuneJsPlayer.prototype.setVolume = function(vol) {
    if (typeof vol !== 'number' || isNaN(vol)) throw new Error(`Invalid volume value: ${vol}`);
    this.gainNode.gain.setValueAtTime(vol, this.context.currentTime);
  };

  ChiptuneJsPlayer.prototype.setRepeat = function(loop) {
    this.repeatCount = loop ? -1 : 0;
    if (this.dspWorker) this.dspWorker.postMessage({ action: 'repeat', repeatCount: this.repeatCount });
  };

  window.ChiptuneJsPlayer = ChiptuneJsPlayer;
})(window);