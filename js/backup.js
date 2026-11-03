/**
 * js/backup.js - Complete workstation backup & restore (IndexedDB custom music, playlists, favorites).
 */
(function(window) {
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(dataUrl) {
    return fetch(dataUrl).then(r => r.blob());
  }

  const btnExport = document.getElementById('btnExportData');
  const btnImport = document.getElementById('btnImportData');
  const inputImport = document.getElementById('inputImportBackup');
  const statusMsg = document.getElementById('backupStatusMsg');
  const statusBadge = document.getElementById('backupStatusBadge');

  function setStatus(text, badgeText = 'READY', isError = false) {
    if (statusMsg) {
      statusMsg.textContent = text;
      statusMsg.style.color = isError ? 'var(--col-red)' : 'var(--col-gold)';
    }
    if (statusBadge) statusBadge.textContent = badgeText;
  }

  async function exportBackup() {
    try {
      setStatus('Exporting workstation data...', 'EXPORTING');
      const playlists = window.XMPlaylist ? window.XMPlaylist.getPlaylists() : [];
      const favorites = window.XMPlaylist ? window.XMPlaylist.getFavorites() : [];
      const customRepo = localStorage.getItem('xm_custom_library_url') || '';
      const customTracks = window.XMCustom ? await window.XMCustom.getTracks() : [];

      const exportedTracks = [];
      for (let i = 0; i < customTracks.length; i++) {
        const t = customTracks[i];
        let blob = t.blob;
        if (!blob && window.XMCustom) blob = await window.XMCustom.getTrackBlob(t.id);
        let base64 = null;
        if (blob) base64 = await blobToBase64(blob);

        exportedTracks.push({
          id: t.id,
          title: t.title,
          artist: t.artist,
          ext: t.ext,
          dateAdded: t.dateAdded || Date.now(),
          isCustom: true,
          data: base64
        });
      }

      const bundle = {
        app: 'XM-Studio',
        version: 1,
        exportDate: new Date().toISOString(),
        customRepoUrl: customRepo,
        playlists: playlists,
        favorites: favorites,
        customTracks: exportedTracks
      };

      const jsonStr = JSON.stringify(bundle);
      const exportBlob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(exportBlob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `xm-studio-backup-${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setStatus(`Exported ${exportedTracks.length} tracks & ${playlists.length} playlists!`, 'SAVED');
      setTimeout(() => setStatus('', 'READY'), 4000);
    } catch (err) {
      setStatus(`Export failed: ${err.message}`, 'ERROR', true);
    }
  }

  async function importBackup(file) {
    try {
      setStatus('Reading backup file...', 'IMPORTING');
      const text = await file.text();
      const bundle = JSON.parse(text);

      if (!bundle || bundle.app !== 'XM-Studio') {
        throw new Error('Invalid or unrecognized backup format.');
      }

      if (Array.isArray(bundle.playlists) && window.XMPlaylist) {
        window.XMPlaylist.savePlaylists(bundle.playlists);
      }

      if (Array.isArray(bundle.favorites) && window.XMPlaylist) {
        window.XMPlaylist.saveFavorites(bundle.favorites);
      }

      if (typeof bundle.customRepoUrl === 'string') {
        if (bundle.customRepoUrl) {
          localStorage.setItem('xm_custom_library_url', bundle.customRepoUrl);
        } else {
          localStorage.removeItem('xm_custom_library_url');
        }
      }

      if (Array.isArray(bundle.customTracks) && window.XMCustom) {
        for (let i = 0; i < bundle.customTracks.length; i++) {
          const ct = bundle.customTracks[i];
          let blob = null;
          if (ct.data) blob = await base64ToBlob(ct.data);

          const record = {
            id: ct.id || `custom_${Date.now()}_${i}`,
            title: ct.title || 'Untitled Track',
            artist: ct.artist || 'Custom Artist',
            ext: (ct.ext || 'XM').toUpperCase(),
            blob: blob,
            dateAdded: ct.dateAdded || Date.now(),
            isCustom: true
          };
          await window.XMCustom.saveTrack(record);
        }
        await window.XMCustom.renderList();
      }

      if (window.XMLibrary) {
        await window.XMLibrary.refreshArchive();
        window.XMLibrary.renderCurrentTab();
      }

      setStatus('Backup successfully restored!', 'RESTORED');
      setTimeout(() => setStatus('', 'READY'), 4000);
    } catch (err) {
      setStatus(`Import failed: ${err.message}`, 'ERROR', true);
    }
  }

  if (btnExport) btnExport.addEventListener('click', exportBackup);
  if (btnImport && inputImport) {
    btnImport.addEventListener('click', () => inputImport.click());
    inputImport.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        importBackup(e.target.files[0]);
        inputImport.value = '';
      }
    });
  }

  window.XMBackup = {
    exportBackup: exportBackup,
    importBackup: importBackup
  };
})(window);