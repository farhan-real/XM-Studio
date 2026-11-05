/**
 * js/engine/export/compiler.js - Multithreaded background audio and visualizer compiler via Web Worker.
 */
(function(window) {
  function AudioCompiler() {
    this.isCompiling = false;
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

    try {
      const workerUrl = 'js/engine/workers/worker.js' + (window.USE_CDN ? '?cdn=1' : '');
      self.worker = new Worker(workerUrl);

      self.worker.onmessage = function(e) {
        const msg = e.data;
        if (!self.isCompiling) return;

        if (msg.type === 'progress') {
          if (onProgress) onProgress(msg.progress);
        } else if (msg.type === 'complete') {
          self.isCompiling = false;
          self.cleanup();
          if (onComplete) onComplete(msg.blob, msg.visData, msg.visFps, msg.duration);
        } else if (msg.type === 'error') {
          self.isCompiling = false;
          self.cleanup();
          if (onError) onError(new Error(msg.message));
        }
      };

      self.worker.onerror = function(err) {
        self.isCompiling = false;
        self.cleanup();
        if (onError) onError(err);
      };

      let targetSampleRate = 48000;
      if (window.XMAudio && window.XMAudio.player && window.XMAudio.player.context) {
        const ctxRate = window.XMAudio.player.context.sampleRate;
        if (ctxRate === 44100 || ctxRate === 48000 || ctxRate === 32000) {
          targetSampleRate = ctxRate;
        }
      }

      const copy = buffer.slice(0);
      self.worker.postMessage({
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

  AudioCompiler.prototype.cleanup = function() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  };

  AudioCompiler.prototype.cancel = function() {
    this.isCompiling = false;
    this.cleanup();
  };

  window.AudioCompiler = new AudioCompiler();
})(window);