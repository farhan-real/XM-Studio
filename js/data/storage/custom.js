/**
 * js/data/custom.js - Persistent IndexedDB connection & lightweight metadata-only RAM cache.
 */
(function(window) {
  const DB_NAME = 'xm_studio_custom_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'custom_tracks';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
    return dbPromise;
  }

  function stripBlob(record) {
    return {
      id: record.id,
      title: record.title,
      artist: record.artist,
      ext: record.ext,
      folder: record.folder || '',
      folderSourceId: record.folderSourceId || '',
      dateAdded: record.dateAdded,
      isCustom: Boolean(record.isCustom),
      isFolderTrack: Boolean(record.isFolderTrack)
    };
  }

  async function saveTrack(record) {
    return saveTracksBatch([record]);
  }

  async function saveTracksBatch(records) {
    if (!records || records.length === 0) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (let i = 0; i < records.length; i++) {
        store.put(records[i]);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getTracks() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const raw = req.result || [];
        const light = new Array(raw.length);
        for (let i = 0; i < raw.length; i++) light[i] = stripBlob(raw[i]);
        resolve(light);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getTrackBlob(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteTrack(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearTracks() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deleteTracksByFolder(folderId) {
    const db = await openDB();
    const tracks = await getTracks();
    const toDelete = tracks.filter(t => t.folderSourceId === folderId);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (let i = 0; i < toDelete.length; i++) store.delete(toDelete[i].id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearAllFolderTracks() {
    const db = await openDB();
    const tracks = await getTracks();
    const toDelete = tracks.filter(t => t.isFolderTrack);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (let i = 0; i < toDelete.length; i++) store.delete(toDelete[i].id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function parseFilename(filename) {
    let base = filename.replace(/\.[a-z0-9]+$/i, '').trim();
    if (base.includes('_-_')) base = base.replace(/_-_/g, ' - ').replace(/_/g, ' ');
    else if (!base.includes(' ') && base.includes('_')) base = base.replace(/_/g, ' ');

    let artist = "Custom Artist";
    let title = base;
    const match = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (match) {
      artist = match[1].trim();
      title = match[2].trim();
    }
    const extMatch = filename.toLowerCase().match(/\.[a-z0-9]+$/);
    const ext = extMatch ? extMatch[0].replace('.', '').toUpperCase() : 'XM';
    return { artist, title, ext };
  }

  const inputCustomFiles = document.getElementById('inputCustomFiles');
  const btnAddCustomFile = document.getElementById('btnAddCustomFile');
  const btnClearAllCustom = document.getElementById('btnClearAllCustom');
  const customTracksList = document.getElementById('customTracksList');
  const customCountBadge = document.getElementById('customCountBadge');

  async function renderCustomManagerList() {
    if (!customTracksList) return;
    const all = await getTracks();
    const tracks = all.filter(t => !t.isFolderTrack);
    if (customCountBadge) customCountBadge.textContent = `${tracks.length} ADDED`;

    if (tracks.length === 0) {
      customTracksList.innerHTML = '<div class="library-empty-msg" style="padding:14px 8px;">No individual custom tracks uploaded yet. Click "+ Add Tracks" to upload.</div>';
      return;
    }

    customTracksList.innerHTML = tracks.map(track => {
      const fmtClass = track.ext.toLowerCase() === 'flac' ? 'fmt-flac' : 'fmt-xm';
      return `<div class="custom-track-item"><div class="custom-track-meta"><div class="custom-track-title">${track.title}</div><div class="custom-track-artist">${track.artist}</div></div><span class="fmt-badge ${fmtClass}">${track.ext}</span><button class="km-btn-icon btn-danger-text" data-del-id="${track.id}" title="Delete Custom Track"><svg viewBox="0 0 24 24" class="t-icon-xs"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></div>`;
    }).join('');
  }

  if (customTracksList) {
    customTracksList.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-del-id]');
      if (!btn) return;
      e.stopPropagation();
      await deleteTrack(btn.getAttribute('data-del-id'));
      await renderCustomManagerList();
      if (window.XMLibrary) window.XMLibrary.refreshArchive();
    });
  }

  if (btnAddCustomFile && inputCustomFiles) {
    btnAddCustomFile.addEventListener('click', () => inputCustomFiles.click());
    inputCustomFiles.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      const batch = files.map((file, i) => {
        const meta = parseFilename(file.name);
        return {
          id: `custom_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
          title: meta.title,
          artist: meta.artist,
          ext: meta.ext,
          blob: file,
          dateAdded: Date.now(),
          isCustom: true,
          isFolderTrack: false
        };
      });
      await saveTracksBatch(batch);
      inputCustomFiles.value = '';
      await renderCustomManagerList();
      if (window.XMLibrary) window.XMLibrary.refreshArchive();
    });
  }

  if (btnClearAllCustom) {
    btnClearAllCustom.addEventListener('click', () => {
      if (!window.XMPlaylist) return;
      window.XMPlaylist.showConfirm("CLEAR ALL CUSTOM MUSIC", "Remove all your custom added music from the Archive?", async () => {
        const all = await getTracks();
        const db = await openDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          all.forEach(t => { if (!t.isFolderTrack) store.delete(t.id); });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        await renderCustomManagerList();
        if (window.XMLibrary) window.XMLibrary.refreshArchive();
      });
    });
  }

  renderCustomManagerList();

  window.XMCustom = {
    saveTrack,
    saveTracksBatch,
    getTracks,
    getTrackBlob,
    deleteTrack,
    deleteTracksByFolder,
    clearAllFolderTracks,
    clearTracks,
    renderList: renderCustomManagerList
  };
})(window);