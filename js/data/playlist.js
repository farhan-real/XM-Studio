/**
 * js/data/playlist.js - In-memory cached Playlist CRUD, O(1) favorites Set, and modal dialogs.
 */
(function(window) {
  let cachedPlaylists = null;
  let cachedFavorites = null;
  let cachedFavSet = null;

  function sanitizeTrackForStorage(t) {
    if (!t) return t;
    const copy = Object.assign({}, t);
    delete copy.blob;
    return copy;
  }

  function getPlaylists() {
    if (cachedPlaylists) return cachedPlaylists;
    try {
      const pls = JSON.parse(localStorage.getItem('xm_playlists'));
      if (Array.isArray(pls)) {
        pls.forEach(p => {
          if (p.id === 'pl_default' && p.name === 'Demoscene Favorites') {
            p.name = 'Demoscene Classics';
          }
        });
        cachedPlaylists = pls;
        return cachedPlaylists;
      }
    } catch (e) {}
    cachedPlaylists = [{ id: 'pl_default', name: 'Demoscene Classics', tracks: [] }];
    return cachedPlaylists;
  }

  function savePlaylists(pls) {
    cachedPlaylists = pls;
    try {
      localStorage.setItem('xm_playlists', JSON.stringify(pls));
    } catch (e) {}
  }

  function getFavorites() {
    if (cachedFavorites) return cachedFavorites;
    try {
      cachedFavorites = JSON.parse(localStorage.getItem('xm_favorites')) || [];
    } catch (e) {
      cachedFavorites = [];
    }
    cachedFavSet = new Set(cachedFavorites.map(f => f.id));
    return cachedFavorites;
  }

  function saveFavorites(favs) {
    cachedFavorites = favs.map(sanitizeTrackForStorage);
    cachedFavSet = new Set(cachedFavorites.map(f => f.id));
    try {
      localStorage.setItem('xm_favorites', JSON.stringify(cachedFavorites));
    } catch (e) {}
  }

  function isFavorited(id) {
    if (!cachedFavSet) getFavorites();
    return cachedFavSet.has(id);
  }

  function toggleFavorite(track) {
    const favs = getFavorites();
    const idx = favs.findIndex(f => f.id === track.id);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push(sanitizeTrackForStorage(track));
    saveFavorites(favs);
  }

  function exportPlaylist(plId) {
    const pl = getPlaylists().find(p => p.id === plId);
    if (!pl) return;
    const data = {
      app: 'XM-Studio-Playlist',
      version: 1,
      id: pl.id,
      name: pl.name,
      tracks: pl.tracks.map(sanitizeTrackForStorage)
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(pl.name || 'playlist').replace(/[/\\?%*:|"<>]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importPlaylist(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || !data.name || !Array.isArray(data.tracks)) {
        throw new Error("Invalid playlist JSON format");
      }
      const pls = getPlaylists();
      pls.push({
        id: `pl_${Date.now()}`,
        name: data.name,
        tracks: data.tracks.map(sanitizeTrackForStorage)
      });
      savePlaylists(pls);
      if (window.XMLibrary) window.XMLibrary.renderCurrentTab();
    } catch (err) {
      alert(`Playlist import failed: ${err.message}`);
    }
  }

  const modalBackdrop = document.getElementById('studioModalBackdrop');
  const modalTitle = document.getElementById('studioModalTitle');
  const modalBody = document.getElementById('studioModalBody');
  const modalFooter = document.getElementById('studioModalFooter');
  const btnModalClose = document.getElementById('btnStudioModalClose');

  function closeModal() {
    modalBackdrop.classList.add('hide');
    modalBody.innerHTML = '';
    modalFooter.innerHTML = '';
  }
  btnModalClose.addEventListener('click', closeModal);

  function showPrompt(title, defaultVal, placeholder, onConfirm) {
    modalTitle.textContent = title;
    modalBody.innerHTML = `<input type="text" class="modal-input" id="modalInputBox" value="${defaultVal || ''}" placeholder="${placeholder || ''}" />`;
    modalFooter.innerHTML = `<button class="action-btn action-btn-secondary" id="btnModalCancel"><span>Cancel</span></button><button class="action-btn" id="btnModalSubmit"><span>Confirm</span></button>`;
    modalBackdrop.classList.remove('hide');
    const input = document.getElementById('modalInputBox');
    input.focus();
    input.select();

    document.getElementById('btnModalCancel').addEventListener('click', closeModal);
    document.getElementById('btnModalSubmit').addEventListener('click', () => {
      const val = input.value.trim();
      if (val) { closeModal(); onConfirm(val); }
    });
  }

  function showConfirm(title, message, onConfirm) {
    modalTitle.textContent = title;
    modalBody.innerHTML = `<p style="font-size:0.82rem;color:var(--text-secondary);line-height:1.4;">${message}</p>`;
    modalFooter.innerHTML = `<button class="action-btn action-btn-secondary" id="btnModalCancel"><span>Cancel</span></button><button class="action-btn btn-danger-text" id="btnModalSubmit"><span>Delete</span></button>`;
    modalBackdrop.classList.remove('hide');

    document.getElementById('btnModalCancel').addEventListener('click', closeModal);
    document.getElementById('btnModalSubmit').addEventListener('click', () => { closeModal(); onConfirm(); });
  }

  function openPlaylistPicker(track) {
    const pls = getPlaylists();
    modalTitle.textContent = "ADD TO PLAYLIST";
    if (pls.length === 0) {
      modalBody.innerHTML = '<div class="library-empty-msg">No playlists exist yet. Create one in the Playlists tab.</div>';
      modalFooter.innerHTML = '<button class="action-btn" id="btnModalCloseOnly"><span>Close</span></button>';
      document.getElementById('btnModalCloseOnly').addEventListener('click', closeModal);
      modalBackdrop.classList.remove('hide');
      return;
    }
    modalBody.innerHTML = `<div class="modal-collection-list">${pls.map((p, i) => `<button class="action-btn" data-pl-idx="${i}" style="width:100%;justify-content:space-between;padding:8px 12px;margin-bottom:4px;"><span>${p.name}</span><span class="badge" style="color:var(--col-purple);">${p.tracks.length}</span></button>`).join('')}</div>`;
    modalFooter.innerHTML = '<button class="action-btn action-btn-secondary" id="btnModalCloseOnly"><span>Cancel</span></button>';
    document.getElementById('btnModalCloseOnly').addEventListener('click', closeModal);
    modalBackdrop.classList.remove('hide');

    modalBody.onclick = (e) => {
      const btn = e.target.closest('[data-pl-idx]');
      if (!btn) return;
      const idx = parseInt(btn.getAttribute('data-pl-idx'), 10);
      const target = pls[idx];
      if (target && !target.tracks.some(t => t.id === track.id)) {
        target.tracks.push(sanitizeTrackForStorage(track));
        savePlaylists(pls);
      }
      modalBody.onclick = null;
      closeModal();
    };
  }

  window.XMPlaylist = {
    getPlaylists,
    savePlaylists,
    getFavorites,
    saveFavorites,
    isFavorited,
    toggleFavorite,
    exportPlaylist,
    importPlaylist,
    showPrompt,
    showConfirm,
    openPlaylistPicker,
    closeModal
  };
})(window);