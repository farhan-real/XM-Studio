/**
 * js/data/backup.js - Structured ZIP workstation backup and restore engine.
 */
(function(window) {
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

  function sanitize(str) {
    return (str || 'item').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 32);
  }

  async function exportBackupZip() {
    try {
      setStatus('Packaging ZIP archive...', 'PACKING');
      const zip = new window.XMZip.ZipWriter();

      const config = {
        app: 'XM-Studio',
        version: 2,
        exportDate: new Date().toISOString(),
        customRepoUrl: localStorage.getItem('xm_custom_library_url') || ''
      };
      zip.addFile('config.json', JSON.stringify(config, null, 2));

      const favorites = window.XMPlaylist ? window.XMPlaylist.getFavorites() : [];
      zip.addFile('favorites.json', JSON.stringify(favorites, null, 2));

      const playlists = window.XMPlaylist ? window.XMPlaylist.getPlaylists() : [];
      playlists.forEach((pl, i) => {
        const safeName = sanitize(pl.name || `playlist_${i}`);
        zip.addFile(`playlists/${safeName}_${pl.id}.json`, JSON.stringify(pl, null, 2));
      });

      const customTracks = window.XMCustom ? await window.XMCustom.getTracks() : [];
      const metaList = [];

      for (const t of customTracks) {
        let blob = t.blob;
        if (!blob && window.XMCustom) blob = await window.XMCustom.getTrackBlob(t.id);
        const ext = (t.ext || 'xm').toLowerCase();
        const safeFileName = `${t.id}.${ext}`;
        const zipPath = `custom_music/${safeFileName}`;

        if (blob) {
          const ab = await blob.arrayBuffer();
          zip.addFile(zipPath, ab);
        }

        metaList.push({
          id: t.id,
          title: t.title,
          artist: t.artist,
          ext: t.ext,
          dateAdded: t.dateAdded || Date.now(),
          filename: zipPath,
          isCustom: true
        });
      }
      zip.addFile('custom_music.json', JSON.stringify(metaList, null, 2));

      const zipBlob = await zip.generate();
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `xm-studio-backup-${dateStr}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      setStatus(`Exported ZIP with ${customTracks.length} tracks & ${playlists.length} playlists!`, 'SAVED');
      setTimeout(() => setStatus('', 'READY'), 4000);
    } catch (err) {
      setStatus(`Export failed: ${err.message}`, 'ERROR', true);
    }
  }

  async function importBackupFile(file) {
    try {
      setStatus('Unpacking backup...', 'READING');
      const isZip = file.name.toLowerCase().endsWith('.zip');

      if (isZip) {
        const zipFiles = await window.XMZip.ZipReader.read(file);

        if (zipFiles.has('config.json')) {
          const conf = JSON.parse(await zipFiles.get('config.json').text());
          if (conf.customRepoUrl) localStorage.setItem('xm_custom_library_url', conf.customRepoUrl);
          else localStorage.removeItem('xm_custom_library_url');
        }

        if (zipFiles.has('favorites.json')) {
          const favs = JSON.parse(await zipFiles.get('favorites.json').text());
          if (Array.isArray(favs) && window.XMPlaylist) window.XMPlaylist.saveFavorites(favs);
        }

        const restoredPlaylists = [];
        for (const [path, entry] of zipFiles.entries()) {
          if (path.startsWith('playlists/') && path.endsWith('.json')) {
            try {
              const plData = JSON.parse(await entry.text());
              if (plData && plData.name) restoredPlaylists.push(plData);
            } catch (e) {}
          }
        }
        if (restoredPlaylists.length > 0 && window.XMPlaylist) {
          window.XMPlaylist.savePlaylists(restoredPlaylists);
        }

        if (zipFiles.has('custom_music.json')) {
          const customMeta = JSON.parse(await zipFiles.get('custom_music.json').text());
          if (Array.isArray(customMeta) && window.XMCustom) {
            for (const cm of customMeta) {
              const fileEntry = zipFiles.get(cm.filename);
              let trackBlob = null;
              if (fileEntry) trackBlob = await fileEntry.blob();
              await window.XMCustom.saveTrack({
                id: cm.id,
                title: cm.title,
                artist: cm.artist,
                ext: cm.ext,
                blob: trackBlob,
                dateAdded: cm.dateAdded || Date.now(),
                isCustom: true
              });
            }
            await window.XMCustom.renderList();
          }
        }
      } else {
        const text = await file.text();
        const bundle = JSON.parse(text);
        if (Array.isArray(bundle.playlists)) window.XMPlaylist.savePlaylists(bundle.playlists);
        if (Array.isArray(bundle.favorites)) window.XMPlaylist.saveFavorites(bundle.favorites);
      }

      if (window.XMLibrary) {
        await window.XMLibrary.refreshArchive();
        window.XMLibrary.renderCurrentTab();
      }

      setStatus('Workstation restored successfully!', 'RESTORED');
      setTimeout(() => setStatus('', 'READY'), 4000);
    } catch (err) {
      setStatus(`Restore failed: ${err.message}`, 'ERROR', true);
    }
  }

  if (btnExport) btnExport.addEventListener('click', exportBackupZip);
  if (btnImport && inputImport) {
    btnImport.addEventListener('click', () => inputImport.click());
    inputImport.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        importBackupFile(e.target.files[0]);
        inputImport.value = '';
      }
    });
  }

  window.XMBackup = {
    exportBackup: exportBackupZip,
    importBackup: importBackupFile
  };
})(window);