/**
 * js/data/library.js - Pooled DOM virtual list, search index, and archive coordinator.
 */
(function(window) {
  const POOL_SIZE = 32;
  let remoteCatalog = [];
  let customCatalog = [];
  let fullCatalog = [];
  let displayCatalog = [];
  let activeTab = 'archive';
  let renderedTab = null;
  let currentlyPlayingId = null;

  let activeRenderQueue = [];
  let searchDebounceTimer = null;
  let scroller = null;
  let cardPool = [];
  let emptyMsgEl = null;

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
  const tabArchive = document.getElementById('tabArchive');
  const tabPlaylists = document.getElementById('tabPlaylists');
  const tabFavs = document.getElementById('tabFavorites');
  const tabSource = document.getElementById('tabSource');
  const paneTable = document.getElementById('paneTable');
  const panePlaylists = document.getElementById('panePlaylists');
  const paneSource = document.getElementById('paneSource');

  function ensureDomPool() {
    if (cardPool.length > 0) return;
    tableBody.innerHTML = '';
    emptyMsgEl = document.createElement('div');
    emptyMsgEl.className = 'library-empty-msg';
    emptyMsgEl.style.display = 'none';
    tableBody.appendChild(emptyMsgEl);

    const frag = document.createDocumentFragment();
    for (let i = 0; i < POOL_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'track-card';
      el.style.display = 'none';
      el.innerHTML = `<span class="track-card-num"></span><div class="track-card-content"><div class="track-card-row1"><span class="track-card-title"></span><span class="fmt-badge"></span></div><div class="track-card-row2"><span class="track-card-artist"></span><div class="track-card-actions"><button class="km-btn-icon" data-action="fav" title="Favorite"><svg viewBox="0 0 24 24" class="t-icon-xs" fill="none" stroke="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></button><button class="km-btn-icon" data-action="add-pl" title="Add to playlist"><svg viewBox="0 0 24 24" class="t-icon-xs"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button></div></div></div>`;
      el._num = el.querySelector('.track-card-num');
      el._title = el.querySelector('.track-card-title');
      el._fmt = el.querySelector('.fmt-badge');
      el._artist = el.querySelector('.track-card-artist');
      el._favBtn = el.querySelector('[data-action="fav"]');
      el._renderedIdx = -1;
      el._trackId = '';
      cardPool.push(el);
      frag.appendChild(el);
    }
    tableBody.appendChild(frag);
  }

  function updatePoolSlot(el, track, idx, isPlaying, isFav) {
    el._renderedIdx = idx;
    el._trackId = track.id;
    el.dataset.idx = idx;
    el.dataset.trackId = track.id;
    el.style.display = 'flex';
    el.style.transform = `translate3d(0,${idx * 54}px,0)`;

    const targetClass = `track-card ${(idx & 1) ? 'track-even' : ''} ${isPlaying ? 'active-playing' : ''} ${isFav ? 'is-favorite' : ''}`;
    if (el.className !== targetClass) el.className = targetClass;

    const numStr = String(idx + 1);
    if (el._num.textContent !== numStr) el._num.textContent = numStr;
    if (el._title.textContent !== track.title) el._title.textContent = track.title;

    const fmt = track.ext || 'XM';
    if (el._fmt.textContent !== fmt) {
      el._fmt.className = `fmt-badge ${getFormatBadgeClass(fmt)}`;
      el._fmt.textContent = fmt;
    }
    if (el._artist.textContent !== track.artist) el._artist.textContent = track.artist;
    el._favBtn.classList.toggle('active', isFav);
  }

  function initScroller() {
    ensureDomPool();
    scroller = window.XMScroller.create({
      viewport: document.getElementById('trackViewport'),
      track: document.getElementById('customScrollbarTrack'),
      thumb: document.getElementById('customScrollbarThumb'),
      itemHeight: 54,
      buffer: 6,
      onRender: (start, end, st, forceRebuild) => {
        ensureDomPool();
        if (!activeRenderQueue || activeRenderQueue.length === 0) {
          tableBody.style.transform = 'translate3d(0,0,0)';
          for (let i = 0; i < POOL_SIZE; i++) { cardPool[i].style.display = 'none'; cardPool[i]._renderedIdx = -1; }
          emptyMsgEl.textContent = 'No matching tracks found.';
          emptyMsgEl.style.display = 'block';
          return;
        }
        emptyMsgEl.style.display = 'none';
        tableBody.style.transform = `translate3d(0,${-st}px,0)`;

        const isFavFn = window.XMPlaylist ? window.XMPlaylist.isFavorited : () => false;
        for (let idx = start; idx < end; idx++) {
          const slot = cardPool[idx % POOL_SIZE];
          const track = activeRenderQueue[idx];
          if (forceRebuild || slot._renderedIdx !== idx || slot._trackId !== track.id) {
            updatePoolSlot(slot, track, idx, currentlyPlayingId === track.id, isFavFn(track.id));
          }
        }
        for (let i = 0; i < POOL_SIZE; i++) {
          const slot = cardPool[i];
          if (slot._renderedIdx !== -1 && (slot._renderedIdx < start || slot._renderedIdx >= end)) {
            slot.style.display = 'none';
            slot._renderedIdx = -1;
          }
        }
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
    const idx = parseInt(card.dataset.idx, 10);
    const track = activeRenderQueue[idx];
    if (!track) return;
    const actionBtn = e.target.closest('.km-btn-icon');
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.getAttribute('data-action');
      if (action === 'fav') {
        window.XMPlaylist.toggleFavorite(track);
        if (window.XMApp && window.XMApp.updateDeckFav) window.XMApp.updateDeckFav();
        if (activeTab === 'favorites') {
          renderTrackList(sortAlphabetical([...window.XMPlaylist.getFavorites()]), false);
        } else {
          updatePoolSlot(card, track, idx, currentlyPlayingId === track.id, window.XMPlaylist.isFavorited(track.id));
        }
      } else if (action === 'add-pl') {
        window.XMPlaylistUI.openPlaylistPicker(track);
      }
    } else {
      playTrack(track, activeRenderQueue, idx);
    }
  });

  async function playTrack(track, queue, idx) {
    if (window.XMAudio && window.XMAudio.player) window.XMAudio.player.unlock();
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
    for (let i = 0; i < cardPool.length; i++) {
      const slot = cardPool[i];
      if (slot._renderedIdx !== -1) {
        slot.classList.toggle('active-playing', slot._trackId === currentlyPlayingId);
      }
    }
  }

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
      if (window.XMPlaylistUI) window.XMPlaylistUI.renderPlaylists();
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
    try { customCatalog = window.XMCustom ? await window.XMCustom.getTracks() : []; } catch (e) { customCatalog = []; }
    fullCatalog = sortAlphabetical([...customCatalog, ...remoteCatalog]);
    displayCatalog = fullCatalog;
    renderedTab = 'archive';
    if (activeTab === 'archive') renderTrackList(displayCatalog, true);
  }

  async function loadAllCatalogs() {
    ensureDomPool();
    emptyMsgEl.textContent = 'Syncing active repository catalogs...';
    emptyMsgEl.style.display = 'block';
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
    getFullCatalog: () => fullCatalog,
    playTrackDirect: playTrack,
    getFormatBadgeClass
  };
})(window);