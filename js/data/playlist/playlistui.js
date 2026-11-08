/**
 * js/data/playlist/playlistui.js - Playlist detail view, item rendering, and modal collection picker.
 */
(function(window) {
  let currentPlaylistId = null;

  const playlistItemsWrap = document.getElementById('playlistItemsWrap');
  const playlistCreateRow = document.getElementById('playlistCreateRow');
  const playlistDetailToolbar = document.getElementById('playlistDetailToolbar');
  const playlistDetailTitle = document.getElementById('playlistDetailTitle');
  const btnBackPlaylists = document.getElementById('btnBackPlaylists');
  const btnPlayAllPlaylist = document.getElementById('btnPlayAllPlaylist');
  const btnShufflePlaylist = document.getElementById('btnShufflePlaylist');
  const btnAddFromCollection = document.getElementById('btnAddFromCollection');
  const btnExportCurPlaylist = document.getElementById('btnExportCurPlaylist');
  const btnModifyPlaylist = document.getElementById('btnModifyPlaylist');
  const btnDeletePlaylist = document.getElementById('btnDeletePlaylist');
  const inputNewPlaylist = document.getElementById('inputNewPlaylist');
  const btnCreatePlaylist = document.getElementById('btnCreatePlaylist');
  const btnImportPlaylist = document.getElementById('btnImportPlaylist');
  const inputImportPlaylist = document.getElementById('inputImportPlaylist');
  const countBadge = document.getElementById('leftCountBadge');

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
    modalBody.innerHTML = `<input type="text" class="modal-input" id="modalInputBox" value="${defaultVal ? defaultVal : ''}" placeholder="${placeholder ? placeholder : ''}" />`;
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

  function renderPlaylists() {
    playlistCreateRow.classList.remove('hide');
    playlistDetailToolbar.classList.add('hide');
    const playlists = window.XMPlaylist.getPlaylists();
    if (countBadge) countBadge.textContent = `${playlists.length} PLAYLISTS`;
    if (playlists.length === 0) {
      playlistItemsWrap.innerHTML = '<div class="library-empty-msg">No playlists created yet. Enter a name above to create one.</div>';
      return;
    }
    playlistItemsWrap.innerHTML = playlists.map((pl, idx) => `<div class="playlist-card" data-pl-idx="${idx}"><div class="pl-card-info"><span class="pl-card-title">${pl.name}</span><span class="pl-card-meta">${pl.tracks.length} tracks</span></div><div class="pl-card-actions"><button class="km-btn-icon" data-action="export" title="Export (.json)"><svg viewBox="0 0 24 24" class="t-icon-xs"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button><button class="km-btn-icon" data-action="modify" title="Rename"><svg viewBox="0 0 24 24" class="t-icon-xs"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button><button class="km-btn-icon" data-action="delete" title="Delete"><svg viewBox="0 0 24 24" class="t-icon-xs"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></div></div>`).join('');
  }

  function viewPlaylist(plId) {
    currentPlaylistId = plId;
    const pl = window.XMPlaylist.getPlaylists().find(p => p.id === plId);
    if (!pl) return;
    pl.tracks._playlistId = pl.id;
    playlistCreateRow.classList.add('hide');
    playlistDetailToolbar.classList.remove('hide');
    playlistDetailTitle.textContent = pl.name;
    if (pl.tracks.length === 0) {
      playlistItemsWrap.innerHTML = '<div class="library-empty-msg">Playlist is empty. Click "+ Add" above.</div>';
      return;
    }
    const isFavFn = window.XMPlaylist.isFavorited;
    const getBadge = window.XMLibrary.getFormatBadgeClass;
    playlistItemsWrap.innerHTML = pl.tracks.map((track, idx) => `<div class="track-card ${isFavFn(track.id) ? 'is-favorite' : ''}" data-pl-track-idx="${idx}" data-track-id="${track.id}"><span class="track-card-num">${idx + 1}</span><div class="track-card-content"><div class="track-card-row1"><span class="track-card-title">${track.title}</span><span class="fmt-badge ${getBadge(track.ext)}">${track.ext}</span></div><div class="track-card-row2"><span class="track-card-artist">${track.artist}</span><div class="track-card-actions"><button class="km-btn-icon" data-action="remove-added" title="Remove"><svg viewBox="0 0 24 24" class="t-icon-xs"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div></div></div></div>`).join('');
  }

  playlistItemsWrap.addEventListener('click', (e) => {
    const plCard = e.target.closest('.playlist-card');
    if (plCard) {
      const playlists = window.XMPlaylist.getPlaylists();
      const pl = playlists[parseInt(plCard.getAttribute('data-pl-idx'), 10)];
      if (!pl) return;
      const btn = e.target.closest('.km-btn-icon');
      if (btn) {
        e.stopPropagation();
        const act = btn.getAttribute('data-action');
        if (act === 'export') window.XMPlaylist.exportPlaylist(pl.id);
        else if (act === 'modify') showPrompt("RENAME PLAYLIST", pl.name, "New name...", (nn) => { pl.name = nn; window.XMPlaylist.savePlaylists(playlists); renderPlaylists(); });
        else if (act === 'delete') showConfirm("DELETE PLAYLIST", `Delete "${pl.name}"?`, () => { window.XMPlaylist.savePlaylists(playlists.filter(p => p.id !== pl.id)); renderPlaylists(); });
      } else viewPlaylist(pl.id);
      return;
    }

    const trCard = e.target.closest('.track-card');
    if (trCard && currentPlaylistId) {
      const idx = parseInt(trCard.getAttribute('data-pl-track-idx'), 10);
      const pls = window.XMPlaylist.getPlaylists();
      const pl = pls.find(p => p.id === currentPlaylistId);
      if (!pl || !pl.tracks[idx]) return;
      if (e.target.closest('[data-action="remove-added"]')) {
        e.stopPropagation();
        pl.tracks.splice(idx, 1);
        window.XMPlaylist.savePlaylists(pls);
        viewPlaylist(currentPlaylistId);
      } else if (window.XMLibrary && window.XMLibrary.playTrackDirect) {
        pl.tracks._playlistId = pl.id;
        window.XMLibrary.playTrackDirect(pl.tracks[idx], pl.tracks, idx);
      }
    }
  });

  function openAddFromCollectionModal() {
    if (!currentPlaylistId) return;
    const pl = window.XMPlaylist.getPlaylists().find(p => p.id === currentPlaylistId);
    if (!pl) return;
    modalTitle.textContent = `ADD TO ${pl.name.toUpperCase()}`;
    modalBody.innerHTML = `<input type="text" class="modal-input" id="modalColSearch" placeholder="Filter collection..." /><div class="modal-collection-list" id="modalColList"></div>`;
    modalFooter.innerHTML = '<button class="action-btn action-btn-secondary" id="btnModalCloseOnly"><span>Done</span></button>';
    document.getElementById('btnModalCloseOnly').addEventListener('click', closeModal);
    modalBackdrop.classList.remove('hide');

    const colList = document.getElementById('modalColList'), colSearch = document.getElementById('modalColSearch');
    const fullCatalog = window.XMLibrary.getFullCatalog();
    let currentModalItems = [];

    function renderModalItems(items) {
      currentModalItems = items.slice(0, 100);
      colList.innerHTML = currentModalItems.map((t, i) => `<div class="modal-collection-item"><div style="flex:1;min-width:0;"><div style="font-size:0.78rem;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.title}</div><div style="font-size:0.70rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.artist}</div></div><button class="action-btn" data-modal-idx="${i}" style="padding:4px 8px;font-size:0.65rem;flex:none;"><span>+ Add</span></button></div>`).join('');
    }

    colList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-modal-idx]');
      if (!btn) return;
      const t = currentModalItems[parseInt(btn.getAttribute('data-modal-idx'), 10)];
      if (!t) return;
      const allPls = window.XMPlaylist.getPlaylists();
      const target = allPls.find(p => p.id === currentPlaylistId);
      if (target && !target.tracks.some(tr => tr.id === t.id)) {
        target.tracks.push(window.XMPlaylist.sanitizeTrackForStorage(t));
        window.XMPlaylist.savePlaylists(allPls);
        btn.querySelector('span').textContent = 'Added';
        viewPlaylist(currentPlaylistId);
      }
    });

    renderModalItems(fullCatalog);
    colSearch.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      renderModalItems(q ? fullCatalog.filter(t => t._search.includes(q)) : fullCatalog);
    });
  }

  function openPlaylistPicker(track) {
    const pls = window.XMPlaylist.getPlaylists();
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
        target.tracks.push(window.XMPlaylist.sanitizeTrackForStorage(track));
        window.XMPlaylist.savePlaylists(pls);
      }
      modalBody.onclick = null;
      closeModal();
    };
  }

  btnAddFromCollection.addEventListener('click', openAddFromCollectionModal);
  if (btnExportCurPlaylist) btnExportCurPlaylist.addEventListener('click', () => { if (currentPlaylistId) window.XMPlaylist.exportPlaylist(currentPlaylistId); });
  btnCreatePlaylist.addEventListener('click', () => {
    const name = inputNewPlaylist.value.trim();
    if (!name) return;
    const pls = window.XMPlaylist.getPlaylists();
    pls.push({ id: `pl_${Date.now()}`, name, tracks: [] });
    window.XMPlaylist.savePlaylists(pls);
    inputNewPlaylist.value = '';
    renderPlaylists();
  });
  if (btnImportPlaylist && inputImportPlaylist) {
    btnImportPlaylist.addEventListener('click', () => inputImportPlaylist.click());
    inputImportPlaylist.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) { window.XMPlaylist.importPlaylist(e.target.files[0]); inputImportPlaylist.value = ''; }
    });
  }
  btnBackPlaylists.addEventListener('click', renderPlaylists);
  btnPlayAllPlaylist.addEventListener('click', () => {
    if (!currentPlaylistId) return;
    const pl = window.XMPlaylist.getPlaylists().find(p => p.id === currentPlaylistId);
    if (pl && pl.tracks.length > 0 && window.XMLibrary.playTrackDirect) {
      pl.tracks._playlistId = pl.id;
      window.XMLibrary.playTrackDirect(pl.tracks[0], pl.tracks, 0);
    }
  });
  if (btnShufflePlaylist) {
    btnShufflePlaylist.addEventListener('click', () => {
      if (!currentPlaylistId) return;
      const pl = window.XMPlaylist.getPlaylists().find(p => p.id === currentPlaylistId);
      if (!pl || pl.tracks.length === 0 || !window.XMLibrary.playTrackDirect) return;
      pl.tracks._playlistId = pl.id;

      const isPlayable = (t) => window.XMMeta && window.XMMeta.isSupportedFormat ? window.XMMeta.isSupportedFormat(t) : true;
      const playableIndices = [];
      for (let i = 0; i < pl.tracks.length; i++) {
        if (isPlayable(pl.tracks[i])) playableIndices.push(i);
      }
      if (playableIndices.length === 0) {
        alert('Playlist Error: No supported playable tracks in this playlist.');
        return;
      }

      if (window.XMQueue && window.XMQueue.playMode !== 'shuffle') {
        window.XMQueue.setPlayMode('shuffle');
      }
      const s = playableIndices[Math.floor(Math.random() * playableIndices.length)];
      window.XMLibrary.playTrackDirect(pl.tracks[s], pl.tracks, s);
    });
  }
  btnModifyPlaylist.addEventListener('click', () => {
    if (currentPlaylistId) {
      const pls = window.XMPlaylist.getPlaylists();
      const pl = pls.find(p => p.id === currentPlaylistId);
      if (pl) showPrompt("RENAME PLAYLIST", pl.name, "New name...", (nn) => { pl.name = nn; window.XMPlaylist.savePlaylists(pls); viewPlaylist(currentPlaylistId); });
    }
  });
  btnDeletePlaylist.addEventListener('click', () => {
    if (currentPlaylistId) {
      showConfirm("DELETE PLAYLIST", "Delete this playlist?", () => {
        window.XMPlaylist.savePlaylists(window.XMPlaylist.getPlaylists().filter(p => p.id !== currentPlaylistId));
        renderPlaylists();
      });
    }
  });

  window.XMPlaylistUI = {
    renderPlaylists,
    viewPlaylist,
    openPlaylistPicker,
    showPrompt,
    showConfirm,
    closeModal
  };
})(window);