/**
 * js/engine/export/compiler.js - Multithreaded background audio and visualizer compiler via Web Worker.
 */
(function(window) {
  function AudioCompiler() {
    this.isCompiling = false;
    this.isPreload = false;
    this.activeTrackId = null;
    this.worker = null;
  }

  AudioCompiler.prototype.init = function() {
    if (!this.worker && !this.isCompiling) {
      try {
        this.worker = new Worker('js/engine/workers/worker.js');
      } catch (err) {
        console.error('[AudioCompiler] Worker instantiation failed:', err);
        throw err;
      }
    }
  };

  AudioCompiler.prototype.compile = function(buffer, format, onProgress, onComplete, onError) {
    if (!buffer || buffer.byteLength === 0) {
      const err = new Error('Cannot compile empty audio buffer.');
      console.error('[AudioCompiler]', err);
      if (onError) onError(err);
      return;
    }
    this.cancel();
    const self = this;
    self.isCompiling = true;
    self.isPreload = false;

    try {
      const currentWorker = new Worker('js/engine/workers/worker.js');
      self.worker = currentWorker;

      currentWorker.onmessage = function(e) {
        if (self.worker !== currentWorker || !self.isCompiling || self.isPreload) return;
        const msg = e.data;
        if (!msg) return;

        if (msg.type === 'progress') {
          if (onProgress) onProgress(msg.progress);
        } else if (msg.type === 'complete') {
          self.isCompiling = false;
          self.cleanup();
          if (onComplete) onComplete(msg.blob, msg.visData, msg.visFps, msg.duration, msg.engine, msg.channels);
        } else if (msg.type === 'error') {
          self.isCompiling = false;
          self.cleanup();
          const err = new Error(msg.message || 'Worker compilation failed');
          console.error('[AudioCompiler]', err);
          if (onError) onError(err);
        }
      };

      currentWorker.onerror = function(err) {
        if (self.worker !== currentWorker || !self.isCompiling || self.isPreload) return;
        self.isCompiling = false;
        self.cleanup();
        console.error('[AudioCompiler] Web Worker error:', err);
        if (onError) onError(err);
      };

      if (!window.XMAudio?.player?.context?.sampleRate) {
        throw new Error('AudioContext is not initialized or missing sampleRate property.');
      }
      const targetSampleRate = window.XMAudio.player.context.sampleRate;

      const copy = buffer.slice(0);
      currentWorker.postMessage({
        type: 'compile',
        buffer: copy,
        format: format || 'mp3',
        sampleRate: targetSampleRate
      }, [copy]);
    } catch (e) {
      self.isCompiling = false;
      self.cleanup();
      console.error('[AudioCompiler] compile execution failed:', e);
      if (onError) onError(e);
    }
  };

  AudioCompiler.prototype.compilePreload = function(buffer, format, trackId, onComplete, onError) {
    if (this.isCompiling && !this.isPreload) return;
    if (!buffer || buffer.byteLength === 0) {
      const err = new Error(`Cannot preload empty buffer for track ${trackId}.`);
      console.error('[AudioCompiler]', err);
      if (onError) onError(err);
      return;
    }
    this.cancel();
    const self = this;
    self.isCompiling = true;
    self.isPreload = true;
    self.activeTrackId = trackId;

    try {
      const currentWorker = new Worker('js/engine/workers/worker.js');
      self.worker = currentWorker;

      currentWorker.onmessage = function(e) {
        if (self.worker !== currentWorker || !self.isCompiling || !self.isPreload || self.activeTrackId !== trackId) return;
        const msg = e.data;
        if (!msg) return;

        if (msg.type === 'complete') {
          self.isCompiling = false;
          self.isPreload = false;
          self.activeTrackId = null;
          self.cleanup();
          if (onComplete) onComplete(msg.blob, msg.visData, msg.visFps, msg.duration, msg.engine, msg.channels);
        } else if (msg.type === 'error') {
          self.isCompiling = false;
          self.isPreload = false;
          self.activeTrackId = null;
          self.cleanup();
          const err = new Error(msg.message || 'Worker preload failed');
          console.error('[AudioCompiler]', err);
          if (onError) onError(err);
        }
      };

      currentWorker.onerror = function(err) {
        if (self.worker !== currentWorker || !self.isCompiling || !self.isPreload || self.activeTrackId !== trackId) return;
        self.isCompiling = false;
        self.isPreload = false;
        self.activeTrackId = null;
        self.cleanup();
        console.error('[AudioCompiler] Web Worker preload error:', err);
        if (onError) onError(err);
      };

      const copy = buffer.slice(0);
      currentWorker.postMessage({
        type: 'compile',
        buffer: copy,
        format: format || 'mp3',
        sampleRate: 48000
      }, [copy]);
    } catch (e) {
      self.isCompiling = false;
      self.isPreload = false;
      self.cleanup();
      console.error('[AudioCompiler] compilePreload execution error:', e);
      if (onError) onError(e);
    }
  };

  AudioCompiler.prototype.cleanup = function() {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  };

  AudioCompiler.prototype.cancel = function() {
    this.isCompiling = false;
    this.isPreload = false;
    this.activeTrackId = null;
    this.cleanup();
  };

  Object.defineProperty(AudioCompiler.prototype, 'isCompilingActive', {
    get: function() { return this.isCompiling && !this.isPreload; }
  });

  window.AudioCompiler = new AudioCompiler();
})(window);