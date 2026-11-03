/**
 * js/data/library.js - High-performance chunked rendering, debounced search, and multi-source archive coordinator.
 */
(function(window) {
  let remoteCatalog = [];
  let customCatalog = [];
  let fullCatalog = [];
  let displayCatalog = [];
  let activeTab = 'archive';
  let renderedTab = null;
  let currentPlaylistId = null;
  let currentlyPlayingId = null;

  const CHUNK_SIZE = 60;
  let activeRenderQueue = [];
  let currentRenderedIndex = 0;
  let searchDebounceTimer = null;

  function sortAlphabetical(tracks) {
    return tracks.sort((a, b) => {
      const artA = (a.artist || 'Unknown').toLowerCase();
      const artB = (b.artist || 'Unknown').toLowerCase();
      if (artA !== artB) return artA.localeCompare(artB);
      return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase());
    });
  }

  function getFormatBadgeClass(ext) {
    const e = (ext || 'xm').toLowerCase();
    if (e === 'xm') return 'fmt-xm';
    if (e === 'mod') return 'fmt-mod';
    if (e === 'it') return 'fmt-it';
    if (e === 's3m') return 'fmt-s3m';
    if (e === 'flac') return 'fmt-flac';
    return 'fmt-default';
  }

  const tableBody = document.getElementById('kmTableBody');
  const countBadge = document.getElementById('leftCountBadge');
  const searchInput = document.getElementById('leftSearchInput');
  const searchBarWrap = document.getElementById('searchBarWrap');
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

  const tabArchive = document.getElementById('tabArchive');
  const tabPlaylists = document.getElementById('tabPlaylists');
  const tabFavs = document.getElementById('tabFavorites');
  const tabSource = document.getElementById('tabSource');
  const paneTable = document.getElementById('paneTable');
  const panePlaylists = document.getElementById('panePlaylists');
  const paneSource = document.getElementById('paneSource');

  function appendTrackChunk() {
    if (currentRenderedIndex >= activeRenderQueue.length) return;
    const end = Math.min(currentRenderedIndex + CHUNK_SIZE, activeRenderQueue.length);
    const frag = document.createDocumentFragment();

    for (let idx = currentRenderedIndex; idx < end; idx++) {
      const track = activeRenderQueue[idx];
      const card = document.createElement('div');
      const isFav = window.XMPlaylist.isFavorited(track.id);
      const isPlaying = currentlyPlayingId === track.id;
      const fmtClass = getFormatBadgeClass(track.ext);

      card.className = `track-card ${isPlaying ? 'active-playing' : ''} ${isFav ? 'is-favorite' : ''}`;
      card.setAttribute('data-track-id', track.id);
      card.innerHTML = `
        <span class="track-card-num">${idx + 1}</span>
        <div class="track-card-content">
          <div class="track-card-row1"><span class="track-card-title">${track.title}</span><span class="fmt-badge ${fmtClass}">${track.ext || 'XM'}</span></div>
          <div class="track-card-row2"><span class="track-card-artist">${track.artist}</span><div class="track-card-actions">
            <button class="km-btn-icon ${isFav ? 'active' : ''}" data-action="fav" title="Favorite"><svg viewBox="0 0 24 24" class="t-icon-xs" fill="${isFav ? 'var(--col-gold)' : 'none'}" stroke="${isFav ? 'var(--col-gold)' : 'currentColor'}"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></button>
            <button class="km-btn-icon" data-action="add-pl" title="Add to playlist"><svg viewBox="0 0 24 24" class="t-icon-xs"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
          </div></div>
        </div>`;
      frag.appendChild(card);
    }
    tableBody.appendChild(frag);
    currentRenderedIndex = end;
  }

  tableBody.addEventListener('click', (e) => {
    const card = e.target.closest('.track-card');
    if (!card) return;
    const trackId = card.getAttribute('data-track-id');
    const track = activeRenderQueue.find(t => t.id === trackId);
    if (!track) return;
    const actionBtn = e.target.closest('.km-btn-icon');
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.getAttribute('data-action');
      if (action === 'fav') window.XMPlaylist.toggleFavorite(track);
      else if (action === 'add-pl') window.XMPlaylist.openPlaylistPicker(track);
    } else {
      playTrack(track, activeRenderQueue, activeRenderQueue.indexOf(track));
    }
  });

  function renderTrackList(tracks, forceReset = false) {
    if (!forceReset && activeRenderQueue === tracks && tableBody.children.length > 0) {
      updateActiveCards();
      return;
    }
    tableBody.innerHTML = '';
    activeRenderQueue = tracks;
    currentRenderedIndex = 0;
    countBadge.textContent = `${tracks.length} TRACKS`;
    if (tracks.length === 0) {
      tableBody.innerHTML = '<div class="library-empty-msg">No matching tracks found.</div>';
      return;
    }
    appendTrackChunk();
  }

  paneTable.addEventListener('scroll', () => {
    if (paneTable.scrollTop + paneTable.clientHeight >= paneTable.scrollHeight - 350) appendTrackChunk();
  }, { passive: true });

  async function playTrack(track, queue, idx) {
    currentlyPlayingId = track.id;
    updateActiveCards();
    if (track.isCustom || track.isFolderTrack) {
      let blob = track.blob;
      if (!blob && window.XMCustom) blob = await window.XMCustom.getTrackBlob(track.id);
      if (blob) {
        window.XMAudio.loadTrack(blob, `${track.artist} - ${track.title}.${(track.ext || 'xm').toLowerCase()}`, track, queue, idx);
        return;
      }
    }
    window.XMAudio.loadTrack(track.url, `${track.artist} - ${track.title}.${(track.ext || 'xm').toLowerCase()}`, track, queue, idx);
  }

  function updateActiveCards() {
    document.querySelectorAll('.track-card').forEach(el => {
      el.classList.toggle('active-playing', el.getAttribute('data-track-id') === currentlyPlayingId);
    });
  }

  function renderPlaylists() {
    playlistCreateRow.classList.remove('hide');
    playlistDetailToolbar.classList.add('hide');
    playlistItemsWrap.innerHTML = '';
    const playlists = window.XMPlaylist.getPlaylists();
    countBadge.textContent = `${playlists.length} PLAYLISTS`;
    if (playlists.length === 0) {
      playlistItemsWrap.innerHTML = '<div class="library-empty-msg">No playlists created yet. Enter a name above to create one.</div>';
      return;
    }
    playlists.forEach(pl => {
      const card = document.createElement('div');
      card.className = 'playlist-card';
      card.innerHTML = `<div class="pl-card-info"><span class="pl-card-title">${pl.name}</span><span class="pl-card-meta">${pl.tracks.length} tracks</span></div><div class="pl-card-actions"><button class="km-btn-icon" data-action="export" title="Export (.json)"><svg viewBox="0 0 24 24" class="t-icon-xs"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button><button class="km-btn-icon" data-action="modify" title="Rename"><svg viewBox="0 0 24 24" class="t-icon-xs"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button><button class="km-btn-icon" data-action="delete" title="Delete"><svg viewBox="0 0 24 24" class="t-icon-xs"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></div>`;
      card.querySelector('.pl-card-info').addEventListener('click', () => viewPlaylist(pl.id));
      card.querySelector('[data-action="export"]').addEventListener('click', (e) => { e.stopPropagation(); window.XMPlaylist.exportPlaylist(pl.id); });
      card.querySelector('[data-action="modify"]').addEventListener('click', (e) => { e.stopPropagation(); window.XMPlaylist.showPrompt("RENAME PLAYLIST", pl.name, "New name...", (nn) => { pl.name = nn; window.XMPlaylist.savePlaylists(playlists); renderPlaylists(); }); });
      card.querySelector('[data-action="delete"]').addEventListener('click', (e) => { e.stopPropagation(); window.XMPlaylist.showConfirm("DELETE PLAYLIST", `Delete "${pl.name}"?`, () => { window.XMPlaylist.savePlaylists(playlists.filter(p => p.id !== pl.id)); renderPlaylists(); }); });
      playlistItemsWrap.appendChild(card);
    });
  }

  function viewPlaylist(plId) {
    currentPlaylistId = plId;
    const pl = window.XMPlaylist.getPlaylists().find(p => p.id === plId);
    if (!pl) return;
    playlistCreateRow.classList.add('hide');
    playlistDetailToolbar.classList.remove('hide');
    playlistDetailTitle.textContent = pl.name;
    playlistItemsWrap.innerHTML = '';
    if (pl.tracks.length === 0) {
      playlistItemsWrap.innerHTML = '<div class="library-empty-msg">Playlist is empty. Click "+ Add" above.</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    pl.tracks.forEach((track, idx) => {
      const card = document.createElement('div');
      const isFav = window.XMPlaylist.isFavorited(track.id);
      card.className = `track-card ${currentlyPlayingId === track.id ? 'active-playing' : ''} ${isFav ? 'is-favorite' : ''}`;
      card.setAttribute('data-track-id', track.id);
      card.innerHTML = `<span class="track-card-num">${idx + 1}</span><div class="track-card-content"><div class="track-card-row1"><span class="track-card-title">${track.title}</span><span class="fmt-badge ${getFormatBadgeClass(track.ext)}">${track.ext || 'XM'}</span></div><div class="track-card-row2"><span class="track-card-artist">${track.artist}</span><div class="track-card-actions"><button class="km-btn-icon" data-action="remove-added" title="Remove"><svg viewBox="0 0 24 24" class="t-icon-xs"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div></div></div>`;
      card.addEventListener('click', (e) => { if (!e.target.closest('.km-btn-icon')) playTrack(track, pl.tracks, idx); });
      card.querySelector('[data-action="remove-added"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const pls = window.XMPlaylist.getPlaylists();
        const target = pls.find(p => p.id === plId);
        if (target) { target.tracks.splice(idx, 1); window.XMPlaylist.savePlaylists(pls); viewPlaylist(plId); }
      });
      frag.appendChild(card);
    });
    playlistItemsWrap.appendChild(frag);
  }

  function openAddFromCollectionModal() {
    if (!currentPlaylistId) return;
    const pl = window.XMPlaylist.getPlaylists().find(p => p.id === currentPlaylistId);
    if (!pl) return;
    const modalBackdrop = document.getElementById('studioModalBackdrop');
    document.getElementById('studioModalTitle').textContent = `ADD TO ${pl.name.toUpperCase()}`;
    document.getElementById('studioModalBody').innerHTML = `<input type="text" class="modal-input" id="modalColSearch" placeholder="Filter collection..." /><div class="modal-collection-list" id="modalColList"></div>`;
    document.getElementById('studioModalFooter').innerHTML = '<button class="action-btn action-btn-secondary" id="btnModalCloseOnly"><span>Done</span></button>';
    document.getElementById('btnModalCloseOnly').addEventListener('click', window.XMPlaylist.closeModal);
    modalBackdrop.classList.remove('hide');

    const colList = document.getElementById('modalColList');
    const colSearch = document.getElementById('modalColSearch');
    function renderModalItems(items) {
      colList.innerHTML = '';
      const frag = document.createDocumentFragment();
      items.forEach(t => {
        const item = document.createElement('div');
        item.className = 'modal-collection-item';
        item.innerHTML = `<div style="flex:1;min-width:0;"><div style="font-size:0.78rem;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.title}</div><div style="font-size:0.70rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.artist}</div></div><button class="action-btn" data-add-id="${t.id}" style="padding:4px 8px;font-size:0.65rem;flex:none;"><span>+ Add</span></button>`;
        item.querySelector('[data-add-id]').addEventListener('click', () => {
          const allPls = window.XMPlaylist.getPlaylists();
          const target = allPls.find(p => p.id === currentPlaylistId);
          if (target && !target.tracks.some(tr => tr.id === t.id)) {
            target.tracks.push(t);
            window.XMPlaylist.savePlaylists(allPls);
            item.querySelector('span').textContent = 'Added';
            viewPlaylist(currentPlaylistId);
          }
        });
        frag.appendChild(item);
      });
      colList.appendChild(frag);
    }
    renderModalItems(fullCatalog);
    colSearch.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      renderModalItems(q ? fullCatalog.filter(t => (t.artist && t.artist.toLowerCase().includes(q)) || (t.title && t.title.toLowerCase().includes(q))) : fullCatalog);
    });
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
    if (pl && pl.tracks.length > 0) playTrack(pl.tracks[0], pl.tracks, 0);
  });
  if (btnShufflePlaylist) {
    btnShufflePlaylist.addEventListener('click', () => {
      if (!currentPlaylistId) return;
      const pl = window.XMPlaylist.getPlaylists().find(p => p.id === currentPlaylistId);
      if (pl && pl.tracks.length > 0) {
        if (window.XMAudio && !window.XMAudio.isShuffle) { window.XMAudio.toggleShuffle(); const b = document.getElementById('btnShuffle'); if (b) b.classList.add('active'); }
        const s = Math.floor(Math.random() * pl.tracks.length);
        playTrack(pl.tracks[s], pl.tracks, s);
      }
    });
  }
  btnModifyPlaylist.addEventListener('click', () => {
    if (currentPlaylistId) {
      const pls = window.XMPlaylist.getPlaylists();
      const pl = pls.find(p => p.id === currentPlaylistId);
      if (pl) window.XMPlaylist.showPrompt("RENAME PLAYLIST", pl.name, "New name...", (nn) => { pl.name = nn; window.XMPlaylist.savePlaylists(pls); viewPlaylist(currentPlaylistId); });
    }
  });
  btnDeletePlaylist.addEventListener('click', () => {
    if (currentPlaylistId) {
      window.XMPlaylist.showConfirm("DELETE PLAYLIST", "Delete this playlist?", () => {
        window.XMPlaylist.savePlaylists(window.XMPlaylist.getPlaylists().filter(p => p.id !== currentPlaylistId));
        renderPlaylists();
      });
    }
  });

  function switchTab(tabId) {
    activeTab = tabId;
    [tabArchive, tabPlaylists, tabFavs, tabSource].forEach(t => t.classList.remove('active'));
    [paneTable, panePlaylists, paneSource].forEach(p => p.classList.add('hide'));

    if (tabId === 'archive') {
      tabArchive.classList.add('active');
      searchBarWrap.classList.remove('hide');
      paneTable.classList.remove('hide');
      searchInput.placeholder = "Filter artist (A-Z), title, or folder...";
      if (renderedTab !== 'archive') { renderTrackList(displayCatalog, true); renderedTab = 'archive'; }
      else { countBadge.textContent = `${displayCatalog.length} TRACKS`; updateActiveCards(); }
    } else if (tabId === 'favorites') {
      tabFavs.classList.add('active');
      searchBarWrap.classList.remove('hide');
      paneTable.classList.remove('hide');
      searchInput.placeholder = "Filter favorites...";
      renderTrackList(sortAlphabetical(window.XMPlaylist.getFavorites()), true);
      renderedTab = 'favorites';
    } else if (tabId === 'playlists') {
      tabPlaylists.classList.add('active');
      searchBarWrap.classList.add('hide');
      panePlaylists.classList.remove('hide');
      renderPlaylists();
      renderedTab = 'playlists';
    } else if (tabId === 'source') {
      tabSource.classList.add('active');
      searchBarWrap.classList.add('hide');
      paneSource.classList.remove('hide');
      countBadge.textContent = "SOURCES";
      renderedTab = 'source';
      if (window.XMSources) window.XMSources.renderLists();
    }
  }

  tabArchive.addEventListener('click', () => switchTab('archive'));
  tabFavs.addEventListener('click', () => switchTab('favorites'));
  tabPlaylists.addEventListener('click', () => switchTab('playlists'));
  tabSource.addEventListener('click', () => switchTab('source'));

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const q = e.target.value.toLowerCase().trim();
      if (activeTab === 'archive') {
        displayCatalog = q ? fullCatalog.filter(t => (t.artist && t.artist.toLowerCase().includes(q)) || (t.title && t.title.toLowerCase().includes(q)) || (t.folder && t.folder.toLowerCase().includes(q))) : fullCatalog;
        renderTrackList(displayCatalog, true);
      } else if (activeTab === 'favorites') {
        const favs = window.XMPlaylist.getFavorites();
        renderTrackList(q ? favs.filter(t => (t.artist && t.artist.toLowerCase().includes(q)) || (t.title && t.title.toLowerCase().includes(q))) : favs, true);
      }
    }, 80);
  });

  async function syncFullCatalog() {
    customCatalog = window.XMCustom ? await window.XMCustom.getTracks() : [];
    fullCatalog = sortAlphabetical([...customCatalog, ...remoteCatalog]);
    displayCatalog = fullCatalog;
    if (activeTab === 'archive') renderTrackList(displayCatalog, true);
  }

  async function loadAllCatalogs() {
    tableBody.innerHTML = `<div class="library-empty-msg">Syncing active repository catalogs...</div>`;
    remoteCatalog = window.XMSources ? await window.XMSources.fetchRemoteCatalogs() : [];
    await syncFullCatalog();
    switchTab('archive');
  }

  loadAllCatalogs();

  window.XMLibrary = {
    notifyPlaying: (trackId) => { currentlyPlayingId = trackId; updateActiveCards(); },
    renderCurrentTab: () => switchTab(activeTab),
    refreshArchive: async () => {
      remoteCatalog = window.XMSources ? await window.XMSources.fetchRemoteCatalogs() : [];
      await syncFullCatalog();
    },
    getDisplayCatalog: () => (activeRenderQueue && activeRenderQueue.length > 0) ? activeRenderQueue : displayCatalog,
    playTrackDirect: playTrack
  };
})(window);