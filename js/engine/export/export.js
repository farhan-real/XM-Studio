/**
 * js/engine/export/export.js - Audio export coordinator, format routing, and instant cache delivery.
 */
(function(window) {
  let activeFormat = 'mp3';
  let isUserDownloadPending = false;

  const btnFmtMp3 = document.getElementById('btnFmtMp3');
  const btnFmtWav = document.getElementById('btnFmtWav');
  const btnFmtRaw = document.getElementById('btnFmtRaw');
  const qualityBadge = document.getElementById('qualityBadge');
  const btnDownload = document.getElementById('btnDownload');
  const readoutProgressTrack = document.getElementById('readoutProgressTrack');
  const readoutProgressBar = document.getElementById('readoutProgressBar');
  const btnBrowse = document.getElementById('btnBrowse');
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');

  function updateFmtButtons(activeId) {
    [btnFmtMp3, btnFmtWav, btnFmtRaw].forEach((b) => {
      if (b) b.classList.toggle('active', b.id === activeId);
    });
  }

  function updateQualityBadgeDisplay() {
    if (!qualityBadge) return;
    const info = window.XMAudio?.getCurrentInfo();
    if (!info || !info.title || info.title === 'No Module Loaded') {
      qualityBadge.textContent = '--';
      return;
    }
    qualityBadge.textContent = activeFormat === 'wav' ? '16-BIT PCM' : (activeFormat === 'raw' ? 'TRACKER' : '320 KBPS');
  }

  if (btnFmtMp3) {
    btnFmtMp3.addEventListener('click', () => {
      activeFormat = 'mp3';
      updateFmtButtons('btnFmtMp3');
      updateQualityBadgeDisplay();
    });
  }
  if (btnFmtWav) {
    btnFmtWav.addEventListener('click', () => {
      activeFormat = 'wav';
      updateFmtButtons('btnFmtWav');
      updateQualityBadgeDisplay();
    });
  }
  if (btnFmtRaw) {
    btnFmtRaw.addEventListener('click', () => {
      activeFormat = 'raw';
      updateFmtButtons('btnFmtRaw');
      updateQualityBadgeDisplay();
    });
  }

  function triggerBlobDownload(blob, filename) {
    const a = document.createElement('a');
    const blobUrl = URL.createObjectURL(blob);
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  }

  function cancelExport() {
    isUserDownloadPending = false;
    if (window.AudioCompiler) window.AudioCompiler.cancel();
    if (window.XMPrecompiler) window.XMPrecompiler.cancel();
    if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
    if (readoutProgressBar) readoutProgressBar.style.width = '0%';
  }

  function startInitialCompile(raw, targetTrackId) {
    if (!raw || !window.AudioCompiler) return;
    const format = activeFormat || 'mp3';
    const cached = window.XMAudio?.getCachedCompiled ? window.XMAudio.getCachedCompiled(targetTrackId, format) : null;
    if (cached && cached.blob) {
      if (window.XMApp?.setCompileStatus) window.XMApp.setCompileStatus('ready');
      if (cached.visData && window.XMVisualizer?.setVisualizerCache) {
        window.XMVisualizer.setVisualizerCache(cached.visData, cached.visFps);
      }
      if (window.XMAudio?.handoffToCompiled) {
        window.XMAudio.handoffToCompiled(cached.blob, format, targetTrackId, cached.visData, cached.visFps, cached.duration);
      }
      if (window.XMPrecompiler?.onTrackLoaded) window.XMPrecompiler.onTrackLoaded();
      return;
    }

    if (window.XMPrecompiler?.cancel) window.XMPrecompiler.cancel();
    if (window.XMApp?.setCompileStatus) window.XMApp.setCompileStatus('compiling');
    if (readoutProgressTrack) readoutProgressTrack.classList.remove('hide');
    if (readoutProgressBar) readoutProgressBar.style.width = '0%';

    window.AudioCompiler.compile(
      raw,
      format,
      (progress) => {
        if (readoutProgressBar) readoutProgressBar.style.width = `${Math.round(progress * 100)}%`;
        if (window.XMApp?.setCompileStatus) window.XMApp.setCompileStatus('compiling', progress);
      },
      (blob, visData, visFps, duration) => {
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp?.setCompileStatus) window.XMApp.setCompileStatus('ready');
        if (visData && window.XMVisualizer?.setVisualizerCache) window.XMVisualizer.setVisualizerCache(visData, visFps);

        if (isUserDownloadPending) {
          isUserDownloadPending = false;
          const info = window.XMAudio?.getCurrentInfo();
          triggerBlobDownload(blob, `${info?.artist || 'Artist'} - ${info?.title || 'Track'}.${format}`.replace(/[/\\?%*:|"<>]/g, '_'));
        }
        if (window.XMAudio?.handoffToCompiled) {
          window.XMAudio.handoffToCompiled(blob, format, targetTrackId, visData, visFps, duration);
        }
        if (window.XMPrecompiler?.onActiveCompileComplete) window.XMPrecompiler.onActiveCompileComplete();
      },
      () => {
        if (!window.AudioCompiler?.isCompiling) return;
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp?.setCompileStatus) window.XMApp.setCompileStatus('error');
      }
    );
  }

  async function handleExportDownload() {
    const info = window.XMAudio?.getCurrentInfo() || { title: 'track', artist: 'artist' };
    const ext = window.XMAudio?.getCurrentExtension ? window.XMAudio.getCurrentExtension() : 'xm';
    const targetTrackId = window.XMAudio?.currentTrackItem?.id || window.XMAudio?.currentAudioSrc || info.title;

    if (!info || !info.title || info.title === 'No Module Loaded') return;

    const outExt = (activeFormat === 'raw') ? ext : activeFormat;
    const downloadFilename = `${info.artist} - ${info.title}.${outExt}`.replace(/[/\\?%*:|"<>]/g, '_');

    if (activeFormat === 'raw') {
      let blob = window.XMAudio?.currentAudioBlob;
      if (!blob && window.XMAudio?.currentRawBuffer) {
        blob = new Blob([window.XMAudio.currentRawBuffer], { type: 'application/octet-stream' });
      }
      if (!blob && window.XMAudio?.currentAudioSrc) {
        try { const res = await fetch(window.XMAudio.currentAudioSrc); blob = await res.blob(); } catch (e) {}
      }
      if (blob) triggerBlobDownload(blob, downloadFilename);
      return;
    }

    const cached = window.XMAudio?.getCachedCompiled ? window.XMAudio.getCachedCompiled(targetTrackId, activeFormat) : null;
    if (cached && cached.blob) {
      if (window.XMApp?.setCompileStatus) window.XMApp.setCompileStatus('ready');
      triggerBlobDownload(cached.blob, downloadFilename);
      return;
    }

    if (window.XMAudio?.currentAudioBlob && ext.toLowerCase() === activeFormat.toLowerCase()) {
      if (window.XMApp?.setCompileStatus) window.XMApp.setCompileStatus('ready');
      triggerBlobDownload(window.XMAudio.currentAudioBlob, downloadFilename);
      return;
    }

    const isTracker = new Set(['xm', 'mod', 'it', 's3m', 'mtm', 'mo3', 'med', '669', 'far', 'ptm', 'v2m', 'ahx', 'sid']).has(ext.toLowerCase());
    if (!isTracker && (window.XMAudio?.currentAudioBlob || window.XMAudio?.currentAudioSrc)) {
      let blob = window.XMAudio.currentAudioBlob;
      if (!blob && window.XMAudio.currentAudioSrc) {
        try { const res = await fetch(window.XMAudio.currentAudioSrc); blob = await res.blob(); } catch (e) {}
      }
      if (blob) { triggerBlobDownload(blob, `${info.artist} - ${info.title}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_')); return; }
    }

    if (window.AudioCompiler?.isCompilingActive) {
      isUserDownloadPending = true;
      return;
    }

    let raw = window.XMAudio?.currentRawBuffer;
    if (!raw && window.XMAudio?.currentAudioBlob) {
      try { raw = await window.XMAudio.currentAudioBlob.arrayBuffer(); } catch (e) {}
    } else if (!raw && window.XMAudio?.currentAudioSrc) {
      try { const res = await fetch(window.XMAudio.currentAudioSrc); raw = await res.arrayBuffer(); } catch (e) {}
    }
    if (!raw) return;

    isUserDownloadPending = true;
    if (window.XMPrecompiler?.cancel) window.XMPrecompiler.cancel();
    if (window.XMApp?.setCompileStatus) window.XMApp.setCompileStatus('compiling');
    if (readoutProgressTrack) readoutProgressTrack.classList.remove('hide');
    if (readoutProgressBar) readoutProgressBar.style.width = '0%';

    window.AudioCompiler.compile(
      raw,
      activeFormat,
      (progress) => {
        if (readoutProgressBar) readoutProgressBar.style.width = `${Math.round(progress * 100)}%`;
        if (window.XMApp?.setCompileStatus) window.XMApp.setCompileStatus('compiling', progress);
      },
      (blob, visData, visFps, duration) => {
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp?.setCompileStatus) window.XMApp.setCompileStatus('ready');
        if (visData && window.XMVisualizer?.setVisualizerCache) window.XMVisualizer.setVisualizerCache(visData, visFps);

        if (isUserDownloadPending) {
          isUserDownloadPending = false;
          triggerBlobDownload(blob, downloadFilename);
        }
        if (window.XMAudio?.handoffToCompiled) {
          window.XMAudio.handoffToCompiled(blob, activeFormat, targetTrackId, visData, visFps, duration);
        }
        if (window.XMPrecompiler?.onActiveCompileComplete) window.XMPrecompiler.onActiveCompileComplete();
      },
      () => {
        if (!window.AudioCompiler?.isCompiling) return;
        isUserDownloadPending = false;
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp?.setCompileStatus) window.XMApp.setCompileStatus('error');
      }
    );
  }

  if (btnDownload) btnDownload.addEventListener('click', handleExportDownload);

  if (btnBrowse && fileInput) {
    btnBrowse.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0 && window.XMAudio) {
        window.XMAudio.loadTrack(e.target.files[0], e.target.files[0].name);
      }
    });
  }

  if (dropZone) {
    ['dragenter', 'dragover'].forEach((n) => dropZone.addEventListener(n, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach((n) => dropZone.addEventListener(n, (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); }));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0 && window.XMAudio) {
        window.XMAudio.loadTrack(e.dataTransfer.files[0], e.dataTransfer.files[0].name);
      }
    });
  }

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dropZone) dropZone.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0 && window.XMAudio) {
      window.XMAudio.loadTrack(e.dataTransfer.files[0], e.dataTransfer.files[0].name);
    }
  });

  window.XMExport = {
    getActiveFormat: () => activeFormat,
    startInitialCompile,
    cancelExport
  };
})(window);