/**
 * js/engine/export/export.js - Export target formats, audio compilation, and ingestion deck coordinator.
 */
(function(window) {
  let activeFormat = 'mp3';

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

  if (btnFmtMp3) {
    btnFmtMp3.addEventListener('click', () => {
      activeFormat = 'mp3';
      updateFmtButtons('btnFmtMp3');
      if (qualityBadge) qualityBadge.textContent = '320 KBPS';
    });
  }

  if (btnFmtWav) {
    btnFmtWav.addEventListener('click', () => {
      activeFormat = 'wav';
      updateFmtButtons('btnFmtWav');
      if (qualityBadge) qualityBadge.textContent = '16-BIT PCM';
    });
  }

  if (btnFmtRaw) {
    btnFmtRaw.addEventListener('click', () => {
      activeFormat = 'raw';
      updateFmtButtons('btnFmtRaw');
      if (qualityBadge) qualityBadge.textContent = 'TRACKER';
    });
  }

  async function handleExportDownload() {
    const info = window.XMAudio ? window.XMAudio.getCurrentInfo() : { title: 'track', artist: 'artist' };
    const ext = window.XMAudio && window.XMAudio.getCurrentExtension ? window.XMAudio.getCurrentExtension() : 'xm';
    const safeName = `${info.artist} - ${info.title}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_');
    const targetTrackId = (window.XMAudio.currentTrackItem && window.XMAudio.currentTrackItem.id) ||
      window.XMAudio.currentAudioSrc ||
      info.title;

    if (!info || !info.title || info.title === 'No Module Loaded') return;

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
      if (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = safeName;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      return;
    }

    if (window.XMAudio.currentAudioBlob && ext.toLowerCase() === activeFormat.toLowerCase()) {
      const a = document.createElement('a');
      const blobUrl = URL.createObjectURL(window.XMAudio.currentAudioBlob);
      a.href = blobUrl;
      a.download = `${info.artist} - ${info.title}.${activeFormat}`.replace(/[/\\?%*:|"<>]/g, '_');
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
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
        const a = document.createElement('a');
        const blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        a.download = `${info.artist} - ${info.title}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_');
        a.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        return;
      }
    }

    let raw = window.XMAudio ? window.XMAudio.currentRawBuffer : null;
    if (!raw && window.XMAudio.currentAudioBlob) {
      try {
        raw = await window.XMAudio.currentAudioBlob.arrayBuffer();
      } catch (e) {}
    } else if (!raw && window.XMAudio.currentAudioSrc) {
      try {
        const res = await fetch(window.XMAudio.currentAudioSrc);
        raw = await res.arrayBuffer();
      } catch (e) {}
    }
    if (!raw) return;

    if (window.XMApp && window.XMApp.setStatus) window.XMApp.setStatus('compiling');
    if (readoutProgressTrack) readoutProgressTrack.classList.remove('hide');
    if (readoutProgressBar) readoutProgressBar.style.width = '0%';

    window.AudioCompiler.compile(
      raw,
      activeFormat,
      (progress) => {
        if (readoutProgressBar) {
          readoutProgressBar.style.width = `${Math.round(progress * 100)}%`;
        }
      },
      (blob, visData, visFps) => {
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp && window.XMApp.setStatus) window.XMApp.setStatus('ready');

        const a = document.createElement('a');
        const blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        a.download = `${info.artist} - ${info.title}.${activeFormat}`.replace(/[/\\?%*:|"<>]/g, '_');
        a.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

        if (window.XMAudio && window.XMAudio.handoffToCompiled) {
          window.XMAudio.handoffToCompiled(blob, activeFormat, targetTrackId, visData, visFps);
        }
      },
      (err) => {
        console.error('Audio compilation failed:', err);
        if (readoutProgressTrack) readoutProgressTrack.classList.add('hide');
        if (window.XMApp && window.XMApp.setStatus) window.XMApp.setStatus('error');
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
    getActiveFormat: () => activeFormat
  };
})(window);