/**
 * js/engine/export/export.js - Audio export coordinator, format routing, and instant cache delivery.
 */
(function(window) {
  const savedFmt = localStorage.getItem('xm_export_format');
  let activeFormat = (savedFmt === 'mp3' || savedFmt === 'wav' || savedFmt === 'raw') ? savedFmt : 'mp3';
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
    const info = window.XMAudio && window.XMAudio.getCurrentInfo ? window.XMAudio.getCurrentInfo() : null;
    if (!info || !info.title || info.title === 'No Module Loaded') {
      qualityBadge.textContent = '--';
      return;
    }
    qualityBadge.textContent = activeFormat === 'wav' ? '16-BIT PCM' : (activeFormat === 'raw' ? 'TRACKER' : '320 KBPS');
  }

  updateFmtButtons(activeFormat === 'wav' ? 'btnFmtWav' : (activeFormat === 'raw' ? 'btnFmtRaw' : 'btnFmtMp3'));

  if (btnFmtMp3) {
    btnFmtMp3.addEventListener('click', () => {
      activeFormat = 'mp3';
      localStorage.setItem('xm_export_format', 'mp3');
      updateFmtButtons('btnFmtMp3');
      updateQualityBadgeDisplay();
      if (window.XMApp && window.XMApp.refreshPlaybackBadge) window.XMApp.refreshPlaybackBadge();
    });
  }
  if (btnFmtWav) {
    btnFmtWav.addEventListener('click', () => {
      activeFormat = 'wav';
      localStorage.setItem('xm_export_format', 'wav');
      updateFmtButtons('btnFmtWav');
      updateQualityBadgeDisplay();
      if (window.XMApp && window.XMApp.refreshPlaybackBadge) window.XMApp.refreshPlaybackBadge();
    });
  }
  if (btnFmtRaw) {
    btnFmtRaw.addEventListener('click', () => {
      activeFormat = 'raw';
      localStorage.setItem('xm_export_format', 'raw');
      updateFmtButtons('btnFmtRaw');
      updateQualityBadgeDisplay();
      if (window.XMApp && window.XMApp.refreshPlaybackBadge) window.XMApp.refreshPlaybackBadge();
    });
  }

  function triggerBlobDownload(blob, filename) {
    if (!blob) throw new Error('Cannot download null or undefined blob.');
    if (!filename) throw new Error('Cannot download file with empty filename.');
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
    if (!raw) throw new Error('Cannot start compilation: Raw buffer is missing.');
    if (!targetTrackId) throw new Error('Cannot start compilation: targetTrackId is missing.');
    if (!window.AudioCompiler) throw new Error('AudioCompiler engine is not available.');

    const format = (activeFormat === 'wav') ? 'wav' : 'mp3';
    const cached = window.XMAudio && window.XMAudio.getCachedCompiled ? window.XMAudio.getCachedCompiled(targetTrackId, format) : null;
    if (cached && cached.blob) {
      if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
      if (cached.visData && window.XMVisualizer && window.XMVisualizer.setVisualizerCache) {
        window.XMVisualizer.setVisualizerCache(cached.visData, cached.visFps);
      }
      if (window.XMAudio && window.XMAudio.handoffToCompiled) {
        window.XMAudio.handoffToCompiled(cached.blob, format, targetTrackId, cached.visData, cached.visFps, cached.duration, cached.engine, cached.channels);
      }
      if (window.XMPrecompiler && window.XMPrecompiler.onTrackLoaded) window.XMPrecompiler.onTrackLoaded();
      return;
    }

    if (window.XMPrecompiler && window.XMPrecompiler.cancel) window.XMPrecompiler.cancel();
    if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('compiling');
    if (readoutProgressTrack) readoutProgressTrack.classList.remove('hide');
    if (readoutProgressBar) readoutProgressBar.style.width = '0%';

    window.AudioCompiler.compile(
      raw,
      format,
      (progress) => {
        if (readoutProgressBar) readoutProgressBar.style.width = `${Math.round(progress * 100)}%`;
        if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('compiling', progress);
      },
      (blob, visData, visFps, duration, engine, channels) => {
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
        if (visData && window.XMVisualizer && window.XMVisualizer.setVisualizerCache) window.XMVisualizer.setVisualizerCache(visData, visFps);

        if (isUserDownloadPending) {
          isUserDownloadPending = false;
          const info = window.XMAudio.getCurrentInfo();
          if (!info || !info.artist || !info.title) throw new Error('Download failed: Incomplete track metadata.');
          triggerBlobDownload(blob, `${info.artist} - ${info.title}.${format}`.replace(/[/\\?%*:|"<>]/g, '_'));
        }
        if (window.XMAudio && window.XMAudio.handoffToCompiled) {
          window.XMAudio.handoffToCompiled(blob, format, targetTrackId, visData, visFps, duration, engine, channels);
        }
        if (window.XMPrecompiler && window.XMPrecompiler.onActiveCompileComplete) window.XMPrecompiler.onActiveCompileComplete();
      },
      (err) => {
        console.error('[XMExport] Compilation error in startInitialCompile:', err);
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('error');
        alert('Compilation Failed: ' + err.message);
      }
    );
  }

  async function handleExportDownload() {
    const info = window.XMAudio ? window.XMAudio.getCurrentInfo() : null;
    if (!info || !info.title || !info.artist || info.title === 'No Module Loaded') {
      alert('Cannot export: No valid track currently loaded with complete title and artist.');
      return;
    }
    const ext = window.XMAudio.getCurrentExtension();
    if (!ext) throw new Error('Export error: Current track extension is missing.');

    const targetTrackItem = window.XMAudio.currentTrackItem;
    const targetTrackId = targetTrackItem ? targetTrackItem.id : window.XMAudio.currentAudioSrc;
    if (!targetTrackId) throw new Error('Export error: Unable to determine track ID.');

    const outExt = (activeFormat === 'raw') ? ext : activeFormat;
    const downloadFilename = `${info.artist} - ${info.title}.${outExt}`.replace(/[/\\?%*:|"<>]/g, '_');

    if (activeFormat === 'raw') {
      let blob = null;
      if (window.XMAudio.currentRawBuffer) {
        blob = new Blob([window.XMAudio.currentRawBuffer], { type: 'application/octet-stream' });
      } else if (window.XMAudio.currentAudioSrc) {
        const res = await fetch(window.XMAudio.currentAudioSrc);
        if (!res.ok) throw new Error(`HTTP ${res.status} retrieving raw track file`);
        blob = await res.blob();
      } else if (window.XMAudio.currentAudioBlob) {
        blob = window.XMAudio.currentAudioBlob;
      }
      if (!blob) throw new Error('Raw module data could not be located for download.');
      triggerBlobDownload(blob, downloadFilename);
      return;
    }

    const cached = window.XMAudio.getCachedCompiled ? window.XMAudio.getCachedCompiled(targetTrackId, activeFormat) : null;
    if (cached && cached.blob) {
      if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
      triggerBlobDownload(cached.blob, downloadFilename);
      return;
    }

    if (window.XMAudio.currentAudioBlob && ext.toLowerCase() === activeFormat.toLowerCase()) {
      if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
      triggerBlobDownload(window.XMAudio.currentAudioBlob, downloadFilename);
      return;
    }

    const isTracker = !new Set(['mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a', 'weba']).has(ext.toLowerCase());
    if (!isTracker && (window.XMAudio.currentAudioBlob || window.XMAudio.currentAudioSrc)) {
      let blob = window.XMAudio.currentAudioBlob;
      if (!blob && window.XMAudio.currentAudioSrc) {
        const res = await fetch(window.XMAudio.currentAudioSrc);
        if (!res.ok) throw new Error(`HTTP ${res.status} retrieving audio file`);
        blob = await res.blob();
      }
      if (!blob) throw new Error('Audio file data could not be retrieved.');
      triggerBlobDownload(blob, `${info.artist} - ${info.title}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_'));
      return;
    }

    if (window.AudioCompiler && window.AudioCompiler.isCompilingActive) {
      isUserDownloadPending = true;
      return;
    }

    let raw = window.XMAudio.currentRawBuffer;
    if (!raw && window.XMAudio.currentAudioSrc) {
      const res = await fetch(window.XMAudio.currentAudioSrc);
      if (!res.ok) throw new Error(`HTTP ${res.status} retrieving source for compilation`);
      raw = await res.arrayBuffer();
    } else if (!raw && window.XMAudio.currentAudioBlob) {
      raw = await window.XMAudio.currentAudioBlob.arrayBuffer();
    }
    if (!raw) throw new Error('Cannot export: Tracker binary buffer is unavailable.');

    isUserDownloadPending = true;
    if (window.XMPrecompiler && window.XMPrecompiler.cancel) window.XMPrecompiler.cancel();
    if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('compiling');
    if (readoutProgressTrack) readoutProgressTrack.classList.remove('hide');
    if (readoutProgressBar) readoutProgressBar.style.width = '0%';

    window.AudioCompiler.compile(
      raw,
      activeFormat,
      (progress) => {
        if (readoutProgressBar) readoutProgressBar.style.width = `${Math.round(progress * 100)}%`;
        if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('compiling', progress);
      },
      (blob, visData, visFps, duration, engine, channels) => {
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
        if (visData && window.XMVisualizer && window.XMVisualizer.setVisualizerCache) window.XMVisualizer.setVisualizerCache(visData, visFps);

        if (isUserDownloadPending) {
          isUserDownloadPending = false;
          triggerBlobDownload(blob, downloadFilename);
        }
        if (window.XMAudio && window.XMAudio.handoffToCompiled) {
          window.XMAudio.handoffToCompiled(blob, activeFormat, targetTrackId, visData, visFps, duration, engine, channels);
        }
        if (window.XMPrecompiler && window.XMPrecompiler.onActiveCompileComplete) window.XMPrecompiler.onActiveCompileComplete();
      },
      (err) => {
        isUserDownloadPending = false;
        console.error('[XMExport] Download compilation failed:', err);
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('error');
        alert('Export Audio Failed: ' + err.message);
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