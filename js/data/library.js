/**
 * js/data/library.js - GPU-translated virtual list, pre-indexed search, and archive coordinator.
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

  let activeRenderQueue = [];
  let searchDebounceTimer = null;
  let scroller = null;
  let lastRenderStart = -1;
  let lastRenderEnd = -1;

  function indexTrack(t) {
    if (!t._search) {
      const a = (t.artist || '').toLowerCase();
      const ti = (t.title || '').toLowerCase();
      const f = (t.folder || '').toLowerCase();
      t._sortArtist = a;
      t._sortTitle = ti;
      t._search = `${a}\0${ti}\0${f}`;
    }
    return t;
  }

  function sortAlphabetical(tracks) {
    for (let i = 0; i < tracks.length; i++) indexTrack(tracks[i]);
    return tracks.sort((a, b) => {
      if (a._sortArtist < b._sortArtist) return -1;
      if (a._sortArtist > b._sortArtist) return 1;
      if (a._sortTitle < b._sortTitle) return -1;
      if (a._sortTitle > b._sortTitle) return 1;
      return 0;
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

  function buildCardHtml(track, idx, relTop, isPlaying, isFav) {
    const fmtClass = getFormatBadgeClass(track.ext);
    const isEven = (idx & 1) === 1;
    const favFill = isFav ? 'var(--col-gold)' : 'none';
    const favStroke = isFav ? 'var(--col-gold)' : 'currentColor';
    return `<div class="track-card ${isEven ? 'track-even' : ''} ${isPlaying ? 'active-playing' : ''} ${isFav ? 'is-favorite' : ''}" style="top:${relTop}px" data-track-id="${track.id}" data-idx="${idx}"><span class="track-card-num">${idx + 1}</span><div class="track-card-content"><div class="track-card-row1"><span class="track-card-title">${track.title}</span><span class="fmt-badge ${fmtClass}">${track.ext || 'XM'}</span></div><div class="track-card-row2"><span class="track-card-artist">${track.artist}</span><div class="track-card-actions"><button class="km-btn-icon ${isFav ? 'active' : ''}" data-action="fav" title="Favorite"><svg viewBox="0 0 24 24" class="t-icon-xs" fill="${favFill}" stroke="${favStroke}"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></button><button class="km-btn-icon" data-action="add-pl" title="Add to playlist"><svg viewBox="0 0 24 24" class="t-icon-xs"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button></div></div></div></div>`;
  }

  function initScroller() {
    scroller = window.XMScroller.create({
      viewport: document.getElementById('trackViewport'),
      track: document.getElementById('customScrollbarTrack'),
      thumb: document.getElementById('customScrollbarThumb'),
      itemHeight: 54,
      buffer: 6,
      onRender: (start, end, st, forceRebuild) => {
        if (!activeRenderQueue || activeRenderQueue.length === 0) {
          lastRenderStart = -1;
          lastRenderEnd = -1;
          tableBody.style.transform = 'translate3d(0,0,0)';
          tableBody.innerHTML = '<div class="library-empty-msg">No matching tracks found.</div>';
          return;
        }
        tableBody.style.transform = `translate3d(0,${start * 54 - st}px,0)`;
        if (!forceRebuild && start === lastRenderStart && end === lastRenderEnd) return;
        lastRenderStart = start;
        lastRenderEnd = end;

        const isFavFn = window.XMPlaylist ? window.XMPlaylist.isFavorited : () => false;
        const count = end - start;
        const htmlParts = new Array(count);
        for (let i = 0; i < count; i++) {
          const idx = start + i;
          const track = activeRenderQueue[idx];
          htmlParts[i] = buildCardHtml(track, idx, i * 54, currentlyPlayingId === track.id, isFavFn(track.id));
        }
        tableBody.innerHTML = htmlParts.join('');
      }
    });
  }

  function renderTrackList(tracks, forceReset = false) {
    activeRenderQueue = tracks;
    countBadge.textContent = `${tracks.length} TRACKS`;
    if (!scroller) initScroller();
    scroller.setTotal(tracks.length, forceReset);
  }

  tableBody.addEventListener('click', (e) => {
    const card = e.target.closest('.track-card');
    if (!card) return;
    const idx = parseInt(card.getAttribute('data-idx'), 10);
    const track = activeRenderQueue[idx];
    if (!track) return;
    const actionBtn = e.target.closest('.km-btn-icon');
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.getAttribute('data-action');
      if (action === 'fav') {
        window.XMPlaylist.toggleFavorite(track);
        if (activeTab === 'favorites') {
          renderTrackList(sortAlphabetical([...window.XMPlaylist.getFavorites()]), false);
        } else {
          const isFav = window.XMPlaylist.isFavorited(track.id);
          card.classList.toggle('is-favorite', isFav);
          actionBtn.classList.toggle('active', isFav);
          const svg = actionBtn.querySelector('svg');
          if (svg) {
            svg.setAttribute('fill', isFav ? 'var(--col-gold)' : 'none');
            svg.setAttribute('stroke', isFav ? 'var(--col-gold)' : 'currentColor');
          }
        }
      } else if (action === 'add-pl') {
        window.XMPlaylist.openPlaylistPicker(track);
      }
    } else {
      playTrack(track, activeRenderQueue, idx);
    }
  });

  async function playTrack(track, queue, idx) {
    if (window.XMAudio && window.XMAudio.player) {
      window.XMAudio.player.unlock();
    }
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
    const children = tableBody.children;
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      const id = el.getAttribute('data-track-id');
      if (id) el.classList.toggle('active-playing', id === currentlyPlayingId);
    }
  }

  function renderPlaylists() {
    playlistCreateRow.classList.remove('hide');
    playlistDetailToolbar.classList.add('hide');
    const playlists = window.XMPlaylist.getPlaylists();
    countBadge.textContent = `${playlists.length} PLAYLISTS`;
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
    playlistCreateRow.classList.add('hide');
    playlistDetailToolbar.classList.remove('hide');
    playlistDetailTitle.textContent = pl.name;
    if (pl.tracks.length === 0) {
      playlistItemsWrap.innerHTML = '<div class="library-empty-msg">Playlist is empty. Click "+ Add" above.</div>';
      return;
    }
    const isFavFn = window.XMPlaylist.isFavorited;
    playlistItemsWrap.innerHTML = pl.tracks.map((track, idx) => `<div class="track-card ${currentlyPlayingId === track.id ? 'active-playing' : ''} ${isFavFn(track.id) ? 'is-favorite' : ''}" data-pl-track-idx="${idx}" data-track-id="${track.id}"><span class="track-card-num">${idx + 1}</span><div class="track-card-content"><div class="track-card-row1"><span class="track-card-title">${track.title}</span><span class="fmt-badge ${getFormatBadgeClass(track.ext)}">${track.ext || 'XM'}</span></div><div class="track-card-row2"><span class="track-card-artist">${track.artist}</span><div class="track-card-actions"><button class="km-btn-icon" data-action="remove-added" title="Remove"><svg viewBox="0 0 24 24" class="t-icon-xs"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div></div></div></div>`).join('');
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
        else if (act === 'modify') window.XMPlaylist.showPrompt("RENAME PLAYLIST", pl.name, "New name...", (nn) => { pl.name = nn; window.XMPlaylist.savePlaylists(playlists); renderPlaylists(); });
        else if (act === 'delete') window.XMPlaylist.showConfirm("DELETE PLAYLIST", `Delete "${pl.name}"?`, () => { window.XMPlaylist.savePlaylists(playlists.filter(p => p.id !== pl.id)); renderPlaylists(); });
      } else {
        viewPlaylist(pl.id);
      }
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
      } else {
        playTrack(pl.tracks[idx], pl.tracks, idx);
      }
    }
  });

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
    let currentModalItems = [];

    function renderModalItems(items) {
      currentModalItems = items.slice(0, 120);
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
        target.tracks.push(t);
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
      else { countBadge.textContent = `${displayCatalog.length} TRACKS`; updateActiveCards(); if (scroller) scroller.refresh(); }
    } else if (tabId === 'favorites') {
      tabFavs.classList.add('active');
      searchBarWrap.classList.remove('hide');
      paneTable.classList.remove('hide');
      searchInput.placeholder = "Filter favorites...";
      renderTrackList(sortAlphabetical([...window.XMPlaylist.getFavorites()]), true);
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
        displayCatalog = q ? fullCatalog.filter(t => t._search.includes(q)) : fullCatalog;
        renderTrackList(displayCatalog, true);
      } else if (activeTab === 'favorites') {
        const favs = sortAlphabetical([...window.XMPlaylist.getFavorites()]);
        renderTrackList(q ? favs.filter(t => t._search.includes(q)) : favs, true);
      }
    }, 60);
  });

  async function syncFullCatalog() {
    try {
      customCatalog = window.XMCustom ? await window.XMCustom.getTracks() : [];
    } catch (e) {
      customCatalog = [];
    }
    fullCatalog = sortAlphabetical([...customCatalog, ...remoteCatalog]);
    displayCatalog = fullCatalog;
    renderedTab = 'archive';
    if (activeTab === 'archive') renderTrackList(displayCatalog, true);
  }

  async function loadAllCatalogs() {
    tableBody.innerHTML = `<div class="library-empty-msg">Syncing active repository catalogs...</div>`;
    remoteCatalog = window.XMSources ? await window.XMSources.fetchRemoteCatalogs() : [];
    await syncFullCatalog();
  }

  loadAllCatalogs();

  window.XMLibrary = {
    notifyPlaying: (trackId) => { currentlyPlayingId = trackId; updateActiveCards(); },
    renderCurrentTab: () => switchTab(activeTab),
    refreshScroller: () => { if (scroller) scroller.refresh(); },
    refreshArchive: async () => {
      remoteCatalog = window.XMSources ? await window.XMSources.fetchRemoteCatalogs() : [];
      await syncFullCatalog();
    },
    getDisplayCatalog: () => (activeRenderQueue && activeRenderQueue.length > 0) ? activeRenderQueue : displayCatalog,
    playTrackDirect: playTrack,
    scrollToPlaying: () => {
      if (!currentlyPlayingId || !scroller) return;
      const idx = activeRenderQueue.findIndex(t => t.id === currentlyPlayingId);
      if (idx >= 0) scroller.scrollToIndex(idx);
    }
  };
})(window);