/**
 * js/engine/compiler.js - Multithreaded background audio compiler via Web Worker.
 */
(function(window) {
  function AudioCompiler() {
    this.isCompiling = false;
    this.worker = null;
  }

  AudioCompiler.prototype.compile = function(buffer, format, onProgress, onComplete, onError) {
    this.cancel();
    const self = this;
    self.isCompiling = true;

    try {
      // Multithreading: run heavy OpenMPT rendering and LAME encoding in a background Worker
      self.worker = new Worker('js/engine/worker.js');

      self.worker.onmessage = function(e) {
        const msg = e.data;
        if (!self.isCompiling) return;

        if (msg.type === 'progress') {
          if (onProgress) onProgress(msg.progress);
        } else if (msg.type === 'complete') {
          self.isCompiling = false;
          self.cleanup();
          if (onComplete) onComplete(msg.blob);
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

      // Transfer ArrayBuffer ownership to worker (zero-copy memory transfer)
      const copy = buffer.slice(0);
      self.worker.postMessage({
        type: 'compile',
        buffer: copy,
        format: format || 'mp3'
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