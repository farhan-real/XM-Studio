/**
 * js/engine/export/export.js - Independent background audio export, format routing, and instant cache delivery.
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
  const btnDemo = document.getElementById('btnDemo');
  const dropZone = document.getElementById('dropZone');

  function updateFmtButtons(activeId) {
    const list = [btnFmtMp3, btnFmtWav, btnFmtRaw];
    for (let i = 0; i < list.length; i++) {
      if (list[i]) list[i].classList.toggle('active', list[i].id === activeId);
    }
  }

  function updateQualityBadgeDisplay() {
    if (!qualityBadge) return;
    const info = window.XMAudio ? window.XMAudio.getCurrentInfo() : null;
    const hasTrack = Boolean(info && info.title && info.title !== 'No Module Loaded');
    if (!hasTrack) {
      qualityBadge.textContent = '--';
      return;
    }
    if (activeFormat === 'wav') qualityBadge.textContent = '16-BIT PCM';
    else if (activeFormat === 'raw') qualityBadge.textContent = 'TRACKER';
    else qualityBadge.textContent = '320 KBPS';
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
    if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
    if (readoutProgressBar) readoutProgressBar.style.width = '0%';
  }

  function startInitialCompile(raw, targetTrackId) {
    if (!raw || !window.AudioCompiler) return;
    const format = activeFormat || 'mp3';

    const cached = window.XMAudio.getCachedCompiled ? window.XMAudio.getCachedCompiled(targetTrackId, format) : null;
    if (cached && cached.blob) {
      if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');
      if (cached.visData && window.XMVisualizer) {
        window.XMVisualizer.setVisualizerCache(cached.visData, cached.visFps);
      }
      if (window.XMAudio && window.XMAudio.handoffToCompiled) {
        window.XMAudio.handoffToCompiled(cached.blob, format, targetTrackId, cached.visData, cached.visFps, cached.duration);
      }
      return;
    }

    if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('compiling');
    if (readoutProgressTrack) readoutProgressTrack.classList.remove('hide');
    if (readoutProgressBar) readoutProgressBar.style.width = '0%';

    window.AudioCompiler.compile(
      raw,
      format,
      (progress) => {
        if (readoutProgressBar) readoutProgressBar.style.width = `${Math.round(progress * 100)}%`;
        if (window.XMApp && window.XMApp.setCompileStatus) {
          window.XMApp.setCompileStatus('compiling', progress);
        }
      },
      (blob, visData, visFps, duration) => {
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');

        if (visData && window.XMVisualizer) {
          window.XMVisualizer.setVisualizerCache(visData, visFps);
        }

        if (isUserDownloadPending) {
          isUserDownloadPending = false;
          const info = window.XMAudio.getCurrentInfo();
          triggerBlobDownload(blob, `${info.artist} - ${info.title}.${format}`.replace(/[/\\?%*:|"<>]/g, '_'));
        }

        if (window.XMAudio && window.XMAudio.handoffToCompiled) {
          window.XMAudio.handoffToCompiled(blob, format, targetTrackId, visData, visFps, duration);
        }
      },
      (err) => {
        console.error('Initial audio compilation failed:', err);
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('error');
      }
    );
  }

  async function handleExportDownload() {
    const info = window.XMAudio ? window.XMAudio.getCurrentInfo() : { title: 'track', artist: 'artist' };
    const ext = window.XMAudio && window.XMAudio.getCurrentExtension ? window.XMAudio.getCurrentExtension() : 'xm';
    const targetTrackId = (window.XMAudio.currentTrackItem && window.XMAudio.currentTrackItem.id) ||
      window.XMAudio.currentAudioSrc ||
      info.title;

    if (!info || !info.title || info.title === 'No Module Loaded') return;

    const outExt = (activeFormat === 'raw') ? ext : activeFormat;
    const downloadFilename = `${info.artist} - ${info.title}.${outExt}`.replace(/[/\\?%*:|"<>]/g, '_');

    if (activeFormat === 'raw') {
      let blob = window.XMAudio.currentAudioBlob;
      if (!blob && window.XMAudio.currentRawBuffer) {
        blob = new Blob([window.XMAudio.currentRawBuffer], { type: 'application/octet-stream' });
      }
      if (!blob && window.XMAudio.currentAudioSrc) {
        try {
          const res = await fetch(window.XMAudio.currentAudioSrc);
          blob = await res.blob();
        } catch (e) {}
      }
      if (blob) triggerBlobDownload(blob, downloadFilename);
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

    const TRACKER_EXTS = new Set(['xm', 'mod', 'it', 's3m', 'mtm', 'mo3', 'med', '669', 'far', 'ptm', 'v2m', 'ahx', 'sid']);
    const isTracker = TRACKER_EXTS.has(ext.toLowerCase());
    if (!isTracker && (window.XMAudio.currentAudioBlob || window.XMAudio.currentAudioSrc)) {
      let blob = window.XMAudio.currentAudioBlob;
      if (!blob && window.XMAudio.currentAudioSrc) {
        try {
          const res = await fetch(window.XMAudio.currentAudioSrc);
          blob = await res.blob();
        } catch (e) {}
      }
      if (blob) {
        triggerBlobDownload(blob, `${info.artist} - ${info.title}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_'));
        return;
      }
    }

    if (window.AudioCompiler && window.AudioCompiler.isCompiling) {
      isUserDownloadPending = true;
      return;
    }

    let raw = window.XMAudio ? window.XMAudio.currentRawBuffer : null;
    if (!raw && window.XMAudio.currentAudioBlob) {
      try { raw = await window.XMAudio.currentAudioBlob.arrayBuffer(); } catch (e) {}
    } else if (!raw && window.XMAudio.currentAudioSrc) {
      try {
        const res = await fetch(window.XMAudio.currentAudioSrc);
        raw = await res.arrayBuffer();
      } catch (e) {}
    }
    if (!raw) return;

    isUserDownloadPending = true;
    if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('compiling');
    if (readoutProgressTrack) readoutProgressTrack.classList.remove('hide');
    if (readoutProgressBar) readoutProgressBar.style.width = '0%';

    window.AudioCompiler.compile(
      raw,
      activeFormat,
      (progress) => {
        if (readoutProgressBar) readoutProgressBar.style.width = `${Math.round(progress * 100)}%`;
        if (window.XMApp && window.XMApp.setCompileStatus) {
          window.XMApp.setCompileStatus('compiling', progress);
        }
      },
      (blob, visData, visFps, duration) => {
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('ready');

        if (visData && window.XMVisualizer) {
          window.XMVisualizer.setVisualizerCache(visData, visFps);
        }

        if (isUserDownloadPending) {
          isUserDownloadPending = false;
          triggerBlobDownload(blob, downloadFilename);
        }

        if (window.XMAudio && window.XMAudio.handoffToCompiled) {
          window.XMAudio.handoffToCompiled(blob, activeFormat, targetTrackId, visData, visFps, duration);
        }
      },
      (err) => {
        console.error('Audio compilation failed:', err);
        isUserDownloadPending = false;
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp && window.XMApp.setCompileStatus) window.XMApp.setCompileStatus('error');
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

  if (btnDemo) {
    btnDemo.addEventListener('click', () => {
      if (window.XMAudio) {
        window.XMAudio.loadTrack(
          'https://deskjet.github.io/chiptune2.js/tunes/chipsounds.mod',
          'Dubmood - Chipsounds.mod'
        );
      }
    });
  }

  if (dropZone) {
    ['dragenter', 'dragover'].forEach((n) => {
      dropZone.addEventListener(n, (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach((n) => {
      dropZone.addEventListener(n, (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
      });
    });

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