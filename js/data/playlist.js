/**
 * js/data/playlist.js - Playlist CRUD, modal dialogs, and individual import/export.
 */
(function(window) {
  function getPlaylists() {
    try {
      const pls = JSON.parse(localStorage.getItem('xm_playlists'));
      if (Array.isArray(pls)) {
        pls.forEach(p => {
          if (p.id === 'pl_default' && p.name === 'Demoscene Favorites') {
            p.name = 'Demoscene Classics';
          }
        });
        return pls;
      }
      return [{ id: 'pl_default', name: 'Demoscene Classics', tracks: [] }];
    } catch (e) {
      return [{ id: 'pl_default', name: 'Demoscene Classics', tracks: [] }];
    }
  }

  function savePlaylists(pls) {
    localStorage.setItem('xm_playlists', JSON.stringify(pls));
  }

  function getFavorites() {
    try {
      return JSON.parse(localStorage.getItem('xm_favorites')) || [];
    } catch (e) {
      return [];
    }
  }

  function saveFavorites(favs) {
    localStorage.setItem('xm_favorites', JSON.stringify(favs));
  }

  function isFavorited(id) {
    return getFavorites().some(f => f.id === id);
  }

  function toggleFavorite(track) {
    let favs = getFavorites();
    const idx = favs.findIndex(f => f.id === track.id);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push(track);
    saveFavorites(favs);
    if (window.XMLibrary) window.XMLibrary.renderCurrentTab();
  }

  function exportPlaylist(plId) {
    const pl = getPlaylists().find(p => p.id === plId);
    if (!pl) return;
    const data = {
      app: 'XM-Studio-Playlist',
      version: 1,
      id: pl.id,
      name: pl.name,
      tracks: pl.tracks
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
      const newId = `pl_${Date.now()}`;
      pls.push({
        id: newId,
        name: data.name,
        tracks: data.tracks
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
    input.focus(); input.select();

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
    let listHtml = '<div class="modal-collection-list">';
    pls.forEach((p, i) => {
      listHtml += `<button class="action-btn" data-pl-idx="${i}" style="width:100%;justify-content:space-between;padding:8px 12px;margin-bottom:4px;"><span>${p.name}</span><span class="badge" style="color:var(--col-purple);">${p.tracks.length}</span></button>`;
    });
    listHtml += '</div>';
    modalBody.innerHTML = listHtml;
    modalFooter.innerHTML = '<button class="action-btn action-btn-secondary" id="btnModalCloseOnly"><span>Cancel</span></button>';
    document.getElementById('btnModalCloseOnly').addEventListener('click', closeModal);
    modalBackdrop.classList.remove('hide');

    modalBody.querySelectorAll('[data-pl-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-pl-idx'), 10);
        const target = pls[idx];
        if (target && !target.tracks.some(t => t.id === track.id)) {
          target.tracks.push(track);
          savePlaylists(pls);
        }
        closeModal();
      });
    });
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