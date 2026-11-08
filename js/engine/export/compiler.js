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
        const workerUrl = 'js/engine/workers/worker.js' + (window.USE_CDN ? '?cdn=1' : '');
        this.worker = new Worker(workerUrl);
      } catch (e) {}
    }
  };

  AudioCompiler.prototype.compile = function(buffer, format, onProgress, onComplete, onError) {
    this.cancel();
    const self = this;
    self.isCompiling = true;
    self.isPreload = false;

    try {
      const workerUrl = 'js/engine/workers/worker.js' + (window.USE_CDN ? '?cdn=1' : '');
      const currentWorker = new Worker(workerUrl);
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
          if (onError) onError(new Error(msg.message || 'Compilation failed'));
        }
      };

      currentWorker.onerror = function(err) {
        if (self.worker !== currentWorker || !self.isCompiling || self.isPreload) return;
        self.isCompiling = false;
        self.cleanup();
        if (onError) onError(err);
      };

      let targetSampleRate = 48000;
      if (window.XMAudio?.player?.context) {
        const ctxRate = window.XMAudio.player.context.sampleRate;
        if (ctxRate === 44100 || ctxRate === 48000 || ctxRate === 32000) {
          targetSampleRate = ctxRate;
        }
      }

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
      if (onError) onError(e);
    }
  };

  AudioCompiler.prototype.compilePreload = function(buffer, format, trackId, onComplete, onError) {
    if (this.isCompiling && !this.isPreload) return;
    this.cancel();
    const self = this;
    self.isCompiling = true;
    self.isPreload = true;
    self.activeTrackId = trackId;

    try {
      const workerUrl = 'js/engine/workers/worker.js' + (window.USE_CDN ? '?cdn=1' : '');
      const currentWorker = new Worker(workerUrl);
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
          if (onError) onError(new Error(msg.message || 'Preload failed'));
        }
      };

      currentWorker.onerror = function(err) {
        if (self.worker !== currentWorker || !self.isCompiling || !self.isPreload || self.activeTrackId !== trackId) return;
        self.isCompiling = false;
        self.isPreload = false;
        self.activeTrackId = null;
        self.cleanup();
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