/**
 * js/custom.js - IndexedDB storage & UI manager for user-added custom music.
 */
(function(window) {
  const DB_NAME = 'xm_studio_custom_db';
  const DB_VERSION = 1;
  const STORE_NAME = 'custom_tracks';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveTrack(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getTracks() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
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

  // DOM Elements
  const inputCustomFiles = document.getElementById('inputCustomFiles');
  const btnAddCustomFile = document.getElementById('btnAddCustomFile');
  const btnClearAllCustom = document.getElementById('btnClearAllCustom');
  const customTracksList = document.getElementById('customTracksList');
  const customCountBadge = document.getElementById('customCountBadge');

  async function renderCustomManagerList() {
    if (!customTracksList) return;
    const tracks = await getTracks();
    if (customCountBadge) customCountBadge.textContent = `${tracks.length} ADDED`;
    customTracksList.innerHTML = '';

    if (tracks.length === 0) {
      customTracksList.innerHTML = '<div class="library-empty-msg" style="padding:14px 8px;">No custom tracks uploaded yet. Click "+ Add Tracks" to upload.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    tracks.forEach(track => {
      const row = document.createElement('div');
      row.className = 'custom-track-item';
      row.innerHTML = `
        <div class="custom-track-meta">
          <div class="custom-track-title">${track.title}</div>
          <div class="custom-track-artist">${track.artist}</div>
        </div>
        <span class="fmt-badge fmt-xm">${track.ext}</span>
        <button class="km-btn-icon btn-danger-text" data-del-id="${track.id}" title="Delete Custom Track">
          <svg viewBox="0 0 24 24" class="t-icon-xs">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      `;

      row.querySelector('[data-del-id]').addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteTrack(track.id);
        await renderCustomManagerList();
        if (window.XMLibrary) window.XMLibrary.refreshArchive();
      });

      frag.appendChild(row);
    });

    customTracksList.appendChild(frag);
  }

  if (btnAddCustomFile && inputCustomFiles) {
    btnAddCustomFile.addEventListener('click', () => inputCustomFiles.click());
    inputCustomFiles.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        const meta = parseFilename(file.name);
        const record = {
          id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          title: meta.title,
          artist: meta.artist,
          ext: meta.ext,
          blob: file,
          dateAdded: Date.now(),
          isCustom: true
        };
        await saveTrack(record);
      }
      inputCustomFiles.value = '';
      await renderCustomManagerList();
      if (window.XMLibrary) window.XMLibrary.refreshArchive();
    });
  }

  if (btnClearAllCustom) {
    btnClearAllCustom.addEventListener('click', () => {
      if (!window.XMPlaylist) return;
      window.XMPlaylist.showConfirm("CLEAR ALL CUSTOM MUSIC", "Remove all your custom added music from the Archive?", async () => {
        await clearTracks();
        await renderCustomManagerList();
        if (window.XMLibrary) window.XMLibrary.refreshArchive();
      });
    });
  }

  renderCustomManagerList();

  window.XMCustom = {
    getTracks: getTracks,
    getTrackBlob: getTrackBlob,
    deleteTrack: deleteTrack,
    renderList: renderCustomManagerList
  };
})(window);