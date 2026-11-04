/**
 * js/engine/export/compiler.js - Multithreaded background audio and visualizer compiler via Web Worker.
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
      self.worker = new Worker('js/engine/workers/worker.js');

      self.worker.onmessage = function(e) {
        const msg = e.data;
        if (!self.isCompiling) return;

        if (msg.type === 'progress') {
          if (onProgress) onProgress(msg.progress);
        } else if (msg.type === 'complete') {
          self.isCompiling = false;
          self.cleanup();
          if (onComplete) onComplete(msg.blob, msg.visData, msg.visFps);
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

      const targetSampleRate = (window.XMAudio && window.XMAudio.player && window.XMAudio.player.context)
        ? window.XMAudio.player.context.sampleRate
        : 48000;

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