/**
 * js/data/backup.js - Structured ZIP workstation backup and batched restore engine without fallbacks.
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
    if (statusBadge) {
      statusBadge.textContent = badgeText;
      statusBadge.className = 'badge';
      if (isError) statusBadge.classList.add('badge-error');
    }
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
        version: 3,
        exportDate: new Date().toISOString(),
        remoteRepos: window.XMSources ? window.XMSources.getRepos() : [],
        localFolderSources: window.XMSources ? window.XMSources.getFolderSources() : []
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
        const blob = window.XMCustom ? await window.XMCustom.getTrackBlob(t.id) : null;
        if (!blob) throw new Error(`Custom track ${t.id} (${t.title}) audio blob could not be retrieved from IndexedDB.`);
        const ext = (t.ext || 'xm').toLowerCase();
        const safeFileName = `${t.id}.${ext}`;
        const zipPath = `custom_music/${safeFileName}`;
        const ab = await blob.arrayBuffer();
        zip.addFile(zipPath, ab);

        metaList.push({
          id: t.id,
          title: t.title,
          artist: t.artist,
          ext: t.ext,
          folder: t.folder || '',
          folderSourceId: t.folderSourceId || '',
          isFolderTrack: Boolean(t.isFolderTrack),
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
      console.error('[XMBackup] Export failed:', err);
      setStatus(`Export failed: ${err.message}`, 'ERROR', true);
      alert('Backup Export Error: ' + err.message);
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
          if (Array.isArray(conf.remoteRepos) && window.XMSources) window.XMSources.saveRepos(conf.remoteRepos);
          if (Array.isArray(conf.localFolderSources) && window.XMSources) window.XMSources.saveFolderSources(conf.localFolderSources);
        }

        if (zipFiles.has('favorites.json')) {
          const favs = JSON.parse(await zipFiles.get('favorites.json').text());
          if (Array.isArray(favs) && window.XMPlaylist) window.XMPlaylist.saveFavorites(favs);
        }

        const restoredPlaylists = [];
        for (const [path, entry] of zipFiles.entries()) {
          if (path.startsWith('playlists/') && path.endsWith('.json')) {
            const rawText = await entry.text();
            const plData = JSON.parse(rawText);
            if (!plData || !plData.name) throw new Error(`Invalid playlist format in backup: ${path}`);
            restoredPlaylists.push(plData);
          }
        }
        if (restoredPlaylists.length > 0 && window.XMPlaylist) {
          window.XMPlaylist.savePlaylists(restoredPlaylists);
        }

        if (zipFiles.has('custom_music.json')) {
          const customMeta = JSON.parse(await zipFiles.get('custom_music.json').text());
          if (Array.isArray(customMeta) && window.XMCustom) {
            const batch = [];
            for (const cm of customMeta) {
              const fileEntry = zipFiles.get(cm.filename);
              if (!fileEntry) throw new Error(`Referenced audio file missing in ZIP: ${cm.filename}`);
              const trackBlob = await fileEntry.blob();
              batch.push({
                id: cm.id,
                title: cm.title,
                artist: cm.artist,
                ext: cm.ext,
                folder: cm.folder || '',
                folderSourceId: cm.folderSourceId || '',
                isFolderTrack: Boolean(cm.isFolderTrack),
                blob: trackBlob,
                dateAdded: cm.dateAdded || Date.now(),
                isCustom: true
              });
            }
            await window.XMCustom.saveTracksBatch(batch);
            await window.XMCustom.renderList();
          }
        }
      } else {
        const text = await file.text();
        const bundle = JSON.parse(text);
        if (!bundle || (!Array.isArray(bundle.playlists) && !Array.isArray(bundle.favorites))) {
          throw new Error('Invalid JSON backup file: Must contain playlists or favorites array.');
        }
        if (Array.isArray(bundle.playlists)) window.XMPlaylist.savePlaylists(bundle.playlists);
        if (Array.isArray(bundle.favorites)) window.XMPlaylist.saveFavorites(bundle.favorites);
      }

      if (window.XMSources) window.XMSources.renderLists();
      if (window.XMLibrary) await window.XMLibrary.refreshArchive();

      setStatus('Workstation restored successfully!', 'RESTORED');
      setTimeout(() => setStatus('', 'READY'), 4000);
    } catch (err) {
      console.error('[XMBackup] Restore failed:', err);
      setStatus(`Restore failed: ${err.message}`, 'ERROR', true);
      alert('Backup Restore Error: ' + err.message);
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