/**
 * js/data/catalog/sources.js - Multi-repository aggregator and toggleable local folder directory manager.
 */
(function(window) {
  const DEFAULT_REPO = { id: 'repo_default', name: 'Default Repository', url: 'https://farhan-real.github.io/XM-Music/', enabled: true, isDefault: true, trackCount: 0 };
  const BACKUP_REPO = { id: 'repo_backup', name: 'Backup Repository', url: 'https://xm-archive.pages.dev/', enabled: false, isBackup: true, trackCount: 0 };
  const SUPPORTED_EXTS = ['.xm', '.mod', '.it', '.s3m', '.mtm', '.flac', '.mp3', '.ogg', '.wav', '.v2m', '.mid', '.ahx', '.sid'];

  function getRepos() {
    try {
      const saved = JSON.parse(localStorage.getItem('xm_remote_repos'));
      if (Array.isArray(saved) && saved.length > 0) {
        let changed = false;
        if (!saved.some(r => r.id === 'repo_backup' || r.url.includes('xm-archive.pages.dev'))) {
          saved.push(BACKUP_REPO);
          changed = true;
        }
        if (changed) saveRepos(saved);
        return saved;
      }
    } catch (e) {}
    const legacy = localStorage.getItem('xm_custom_library_url');
    if (legacy && legacy.trim() && legacy.trim() !== DEFAULT_REPO.url) {
      return [DEFAULT_REPO, BACKUP_REPO, { id: `repo_${Date.now()}`, name: 'Custom Repository', url: legacy.trim(), enabled: true, isDefault: false, trackCount: 0 }];
    }
    return [DEFAULT_REPO, BACKUP_REPO];
  }

  function saveRepos(repos) { localStorage.setItem('xm_remote_repos', JSON.stringify(repos)); }

  function getFolderSources() {
    try {
      const saved = JSON.parse(localStorage.getItem('xm_local_folder_sources'));
      return Array.isArray(saved) ? saved.map(f => ({ ...f, enabled: f.enabled !== false })) : [];
    } catch (e) {
      return [];
    }
  }

  function saveFolderSources(sources) { localStorage.setItem('xm_local_folder_sources', JSON.stringify(sources)); }

  function normalizeUrl(url) {
    let clean = (url || '').trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) clean = 'https://' + clean;
    if (!clean.endsWith('/')) clean += '/';
    return clean;
  }

  const inputNewRepoUrl = document.getElementById('inputNewRepoUrl');
  const btnAddRepo = document.getElementById('btnAddRepo');
  const btnSyncAllRepos = document.getElementById('btnSyncAllRepos');
  const btnResetRepos = document.getElementById('btnResetRepos');
  const remoteReposList = document.getElementById('remoteReposList');
  const reposCountBadge = document.getElementById('reposCountBadge');
  const repoStatusMsg = document.getElementById('repoStatusMsg');

  const inputLocalFolder = document.getElementById('inputLocalFolder');
  const btnAddFolderSource = document.getElementById('btnAddFolderSource');
  const btnClearFolders = document.getElementById('btnClearFolders');
  const folderSourcesList = document.getElementById('folderSourcesList');
  const folderCountBadge = document.getElementById('folderCountBadge');
  const folderStatusMsg = document.getElementById('folderStatusMsg');

  function renderRemoteReposList() {
    if (!remoteReposList) return;
    const repos = getRepos();
    const activeCount = repos.filter(r => r.enabled).length;
    if (reposCountBadge) reposCountBadge.textContent = `${activeCount} ACTIVE`;
    remoteReposList.innerHTML = repos.map(repo => {
      const tag = repo.isDefault ? '<span class="badge" style="font-size:0.55rem;padding:1px 4px;">DEFAULT</span>' : (repo.isBackup ? '<span class="badge" style="font-size:0.55rem;padding:1px 4px;">BACKUP</span>' : '');
      const canDelete = !repo.isDefault && !repo.isBackup;
      return `<div class="source-item-row"><label class="source-item-info" style="cursor:pointer;"><div class="source-item-title">${repo.name} ${tag}</div><div class="source-item-sub">${repo.url}</div></label><div class="source-item-actions"><input type="checkbox" class="source-toggle" data-toggle-repo="${repo.id}" ${repo.enabled ? 'checked' : ''} title="Toggle active status" />${canDelete ? `<button class="km-btn-icon btn-danger-text" data-del-repo="${repo.id}" title="Remove repository"><svg viewBox="0 0 24 24" class="t-icon-xs"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>` : ''}</div></div>`;
    }).join('');
  }

  if (remoteReposList) {
    remoteReposList.addEventListener('change', (e) => {
      const toggle = e.target.closest('[data-toggle-repo]');
      if (!toggle) return;
      const repos = getRepos();
      const target = repos.find(r => r.id === toggle.getAttribute('data-toggle-repo'));
      if (target) {
        target.enabled = toggle.checked;
        saveRepos(repos);
        renderRemoteReposList();
        if (window.XMLibrary) window.XMLibrary.refreshArchive();
      }
    });

    remoteReposList.addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-del-repo]');
      if (!delBtn) return;
      e.stopPropagation();
      const id = delBtn.getAttribute('data-del-repo');
      saveRepos(getRepos().filter(r => r.id !== id));
      renderRemoteReposList();
      if (window.XMLibrary) window.XMLibrary.refreshArchive();
    });
  }

  function renderFolderSourcesList() {
    if (!folderSourcesList) return;
    const folders = getFolderSources();
    const activeFolders = folders.filter(f => f.enabled !== false).length;
    if (folderCountBadge) folderCountBadge.textContent = `${activeFolders} ACTIVE`;
    if (folders.length === 0) {
      folderSourcesList.innerHTML = '<div class="library-empty-msg" style="padding:14px 8px;">No local folders mounted. Click "+ Add Local Folder" to select a folder.</div>';
      return;
    }
    folderSourcesList.innerHTML = folders.map(folder => {
      const isEnabled = folder.enabled !== false;
      return `<div class="source-item-row"><label class="source-item-info" style="cursor:pointer;"><div class="source-item-title">${folder.name}</div><div class="source-item-sub">${folder.trackCount} tracks &bull; ${new Date(folder.dateAdded).toLocaleDateString()}</div></label><div class="source-item-actions"><input type="checkbox" class="source-toggle" data-toggle-folder="${folder.id}" ${isEnabled ? 'checked' : ''} title="Toggle folder active status" /><button class="km-btn-icon btn-danger-text" data-del-folder="${folder.id}" title="Unmount local folder"><svg viewBox="0 0 24 24" class="t-icon-xs"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></div></div>`;
    }).join('');
  }

  if (folderSourcesList) {
    folderSourcesList.addEventListener('change', (e) => {
      const toggle = e.target.closest('[data-toggle-folder]');
      if (!toggle) return;
      const folders = getFolderSources();
      const target = folders.find(f => f.id === toggle.getAttribute('data-toggle-folder'));
      if (target) {
        target.enabled = toggle.checked;
        saveFolderSources(folders);
        renderFolderSourcesList();
        if (window.XMLibrary) window.XMLibrary.refreshArchive();
      }
    });

    folderSourcesList.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-del-folder]');
      if (!btn) return;
      e.stopPropagation();
      const folderId = btn.getAttribute('data-del-folder');
      if (window.XMCustom && window.XMCustom.deleteTracksByFolder) {
        await window.XMCustom.deleteTracksByFolder(folderId);
      }
      saveFolderSources(getFolderSources().filter(f => f.id !== folderId));
      renderFolderSourcesList();
      if (window.XMLibrary) window.XMLibrary.refreshArchive();
    });
  }

  async function fetchRemoteCatalogs() {
    const repos = getRepos().filter(r => r.enabled);
    const allTracks = [];
    let successCount = 0;

    await Promise.all(repos.map(async (repo) => {
      try {
        const url = `${repo.url.replace(/\/+$/, '')}/tracks.json`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          const cleanBase = repo.url.replace(/\/+$/, '') + '/';
          for (let i = 0; i < data.length; i++) {
            const t = data[i];
            const cleanPath = (t.path || '').replace(/^\/+/, '');
            const extMatch = cleanPath.match(/\.([a-z0-9]+)$/i);
            const ext = t.ext || (extMatch ? extMatch[1].toUpperCase() : 'XM');
            allTracks.push({
              id: `${repo.id}_${cleanPath || i}`,
              title: (t.title || t.name || cleanPath.split('/').pop().replace(/\.[^.]+$/, '') || `Track ${i + 1}`).trim(),
              artist: (t.artist || t.author || repo.name).trim(),
              ext: ext,
              path: cleanPath,
              url: cleanPath.startsWith('http://') || cleanPath.startsWith('https://') ? cleanPath : cleanBase + encodeURI(cleanPath),
              repoId: repo.id,
              repoName: repo.name,
              folder: t.folder || cleanPath.split('/')[0] || repo.name
            });
          }
          repo.trackCount = data.length;
          successCount++;
        }
      } catch (err) {
        repo.trackCount = 0;
      }
    }));

    if (repoStatusMsg) {
      repoStatusMsg.textContent = `Synced ${successCount}/${repos.length} active repos (${allTracks.length} tracks).`;
      setTimeout(() => { if (repoStatusMsg) repoStatusMsg.textContent = ''; }, 4000);
    }
    return allTracks;
  }

  function parseFilename(filename) {
    let base = filename.replace(/\.[a-z0-9]+$/i, '').trim();
    if (base.includes('_-_')) base = base.replace(/_-_/g, ' - ').replace(/_/g, ' ');
    else if (!base.includes(' ') && base.includes('_')) base = base.replace(/_/g, ' ');
    let artist = "Local Artist", title = base;
    const match = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (match) { artist = match[1].trim(); title = match[2].trim(); }
    const extMatch = filename.toLowerCase().match(/\.[a-z0-9]+$/);
    const ext = extMatch ? extMatch[0].replace('.', '').toUpperCase() : 'XM';
    return { artist, title, ext };
  }

  async function handleFolderSelection(fileList) {
    const files = Array.from(fileList || []);
    const valid = files.filter(f => SUPPORTED_EXTS.some(ext => f.name.toLowerCase().endsWith(ext)));
    if (valid.length === 0) {
      if (folderStatusMsg) folderStatusMsg.textContent = 'No supported tracker or audio files found in directory.';
      return;
    }

    let rootName = 'Local Directory';
    if (valid[0].webkitRelativePath) rootName = valid[0].webkitRelativePath.split('/')[0] || rootName;
    const folderId = `fld_${Date.now()}`;
    if (folderStatusMsg) folderStatusMsg.textContent = `Importing ${valid.length} tracks from ${rootName}...`;

    const now = Date.now();
    const batch = valid.map((file, i) => {
      const meta = parseFilename(file.name);
      let subfolder = rootName;
      if (file.webkitRelativePath) {
        const parts = file.webkitRelativePath.split('/');
        if (parts.length > 2) subfolder = parts.slice(0, -1).join('/');
      }
      return { id: `fld_${folderId}_${i}`, title: meta.title, artist: meta.artist, ext: meta.ext, blob: file, folder: subfolder, folderSourceId: folderId, dateAdded: now, isCustom: true, isFolderTrack: true };
    });

    await window.XMCustom.saveTracksBatch(batch);
    const currentFolders = getFolderSources();
    currentFolders.push({ id: folderId, name: rootName, trackCount: valid.length, dateAdded: now, enabled: true });
    saveFolderSources(currentFolders);
    renderFolderSourcesList();

    if (folderStatusMsg) {
      folderStatusMsg.textContent = `Mounted ${valid.length} tracks from "${rootName}"!`;
      setTimeout(() => { if (folderStatusMsg) folderStatusMsg.textContent = ''; }, 4000);
    }
    if (window.XMLibrary) window.XMLibrary.refreshArchive();
  }

  if (btnAddRepo && inputNewRepoUrl) {
    btnAddRepo.addEventListener('click', () => {
      const url = normalizeUrl(inputNewRepoUrl.value);
      if (!url.startsWith('http://') && !url.startsWith('https://')) return;
      const repos = getRepos();
      let repoName = 'Remote Repository';
      try { repoName = new URL(url).hostname; } catch (e) {}
      repos.push({ id: `repo_${Date.now()}`, name: repoName, url, enabled: true, isDefault: false, trackCount: 0 });
      saveRepos(repos);
      inputNewRepoUrl.value = '';
      renderRemoteReposList();
      if (window.XMLibrary) window.XMLibrary.refreshArchive();
    });
  }

  if (btnSyncAllRepos) btnSyncAllRepos.addEventListener('click', () => { if (window.XMLibrary) window.XMLibrary.refreshArchive(); });
  if (btnResetRepos) {
    btnResetRepos.addEventListener('click', () => {
      saveRepos([DEFAULT_REPO, BACKUP_REPO]);
      localStorage.removeItem('xm_custom_library_url');
      renderRemoteReposList();
      if (window.XMLibrary) window.XMLibrary.refreshArchive();
    });
  }

  if (btnAddFolderSource && inputLocalFolder) {
    btnAddFolderSource.addEventListener('click', () => inputLocalFolder.click());
    inputLocalFolder.addEventListener('change', async (e) => {
      await handleFolderSelection(e.target.files);
      inputLocalFolder.value = '';
    });
  }

  if (btnClearFolders) {
    btnClearFolders.addEventListener('click', () => {
      if (!window.XMPlaylist) return;
      window.XMPlaylist.showConfirm("CLEAR ALL FOLDERS", "Unmount and remove all local directory tracks from the Archive?", async () => {
        if (window.XMCustom && window.XMCustom.clearAllFolderTracks) {
          await window.XMCustom.clearAllFolderTracks();
        }
        saveFolderSources([]);
        renderFolderSourcesList();
        if (window.XMLibrary) window.XMLibrary.refreshArchive();
      });
    });
  }

  renderRemoteReposList();
  renderFolderSourcesList();

  window.XMSources = {
    getRepos,
    saveRepos,
    getFolderSources,
    saveFolderSources,
    fetchRemoteCatalogs,
    renderLists: function() { renderRemoteReposList(); renderFolderSourcesList(); }
  };
})(window);