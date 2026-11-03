/**
 * js/data/library.js - Multi-line track list, metadata normalization, and accurate playback.
 */
(function(window) {
  const DEFAULT_REPO_URL = 'https://farhan-real.github.io/XM-Music/';
  let remoteCatalog = [];
  let customCatalog = [];
  let fullCatalog = [];
  let displayCatalog = [];
  let activeTab = 'archive';
  let currentPlaylistId = null;
  let currentlyPlayingId = null;

  function getBaseUrl() {
    const saved = localStorage.getItem('xm_custom_library_url');
    return (saved && saved.trim()) ? saved.trim() : DEFAULT_REPO_URL;
  }

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

  function resolveTrackUrl(item) {
    if (item.url) return item.url;
    if (!item.path) return null;
    if (item.path.startsWith('http://') || item.path.startsWith('https://')) return item.path;
    const cleanBase = getBaseUrl().replace(/\/+$/, '');
    const cleanPath = item.path.replace(/^\/+/, '');
    return `${cleanBase}/${cleanPath}`;
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
  const btnAddFromCollection = document.getElementById('btnAddFromCollection');
  const btnModifyPlaylist = document.getElementById('btnModifyPlaylist');
  const btnDeletePlaylist = document.getElementById('btnDeletePlaylist');
  const inputNewPlaylist = document.getElementById('inputNewPlaylist');
  const btnCreatePlaylist = document.getElementById('btnCreatePlaylist');

  const tabArchive = document.getElementById('tabArchive');
  const tabPlaylists = document.getElementById('tabPlaylists');
  const tabFavs = document.getElementById('tabFavorites');
  const tabSource = document.getElementById('tabSource');
  const paneTable = document.getElementById('paneTable');
  const panePlaylists = document.getElementById('panePlaylists');
  const paneSource = document.getElementById('paneSource');

  function renderTrackList(tracks) {
    tableBody.innerHTML = '';
    countBadge.textContent = `${tracks.length} TRACKS`;

    if (tracks.length === 0) {
      tableBody.innerHTML = '<div class="library-empty-msg">No matching tracks found.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    tracks.forEach((track, idx) => {
      const card = document.createElement('div');
      const isFav = window.XMPlaylist.isFavorited(track.id);
      const isPlaying = currentlyPlayingId === track.id;
      const fmtClass = getFormatBadgeClass(track.ext);

      card.className = `track-card ${isPlaying ? 'active-playing' : ''}`;
      card.setAttribute('data-track-id', track.id);
      card.innerHTML = `
        <div class="track-card-row1">
          <span class="track-card-title">${track.title}</span>
          <span class="fmt-badge ${fmtClass}">${track.ext || 'XM'}</span>
        </div>
        <div class="track-card-row2">
          <span class="track-card-artist">${track.artist}</span>
          <div class="track-card-actions">
            <button class="km-btn-icon ${isFav ? 'active' : ''}" data-action="fav" title="Favorite">
              <svg viewBox="0 0 24 24" class="t-icon-xs" fill="${isFav ? 'var(--col-gold)' : 'none'}" stroke="${isFav ? 'var(--col-gold)' : 'currentColor'}">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
            </button>
            <button class="km-btn-icon" data-action="add-pl" title="Add to playlist">
              <svg viewBox="0 0 24 24" class="t-icon-xs"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.km-btn-icon')) return;
        playTrack(track, tracks, idx);
      });

      card.querySelector('[data-action="fav"]').addEventListener('click', (e) => {
        e.stopPropagation();
        window.XMPlaylist.toggleFavorite(track);
      });

      card.querySelector('[data-action="add-pl"]').addEventListener('click', (e) => {
        e.stopPropagation();
        window.XMPlaylist.openPlaylistPicker(track);
      });

      frag.appendChild(card);
    });

    tableBody.appendChild(frag);
  }

  async function playTrack(track, queue, idx) {
    currentlyPlayingId = track.id;
    updateActiveCards();
    if (track.isCustom) {
      let blob = track.blob;
      if (!blob && window.XMCustom) blob = await window.XMCustom.getTrackBlob(track.id);
      if (blob) {
        window.XMAudio.loadTrack(blob, `${track.artist} - ${track.title}.${(track.ext || 'xm').toLowerCase()}`, track, queue, idx);
        return;
      }
    }
    const fullUrl = resolveTrackUrl(track);
    window.XMAudio.loadTrack(fullUrl, `${track.artist} - ${track.title}.${(track.ext || 'xm').toLowerCase()}`, track, queue, idx);
  }

  function updateActiveCards() {
    document.querySelectorAll('.track-card').forEach(el => {
      if (el.getAttribute('data-track-id') === currentlyPlayingId) {
        el.classList.add('active-playing');
      } else {
        el.classList.remove('active-playing');
      }
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
      card.innerHTML = `
        <div class="pl-card-info">
          <span class="pl-card-title">${pl.name}</span>
          <span class="pl-card-meta">${pl.tracks.length} tracks</span>
        </div>
        <div class="pl-card-actions">
          <button class="km-btn-icon" data-action="modify" title="Rename Playlist">
            <svg viewBox="0 0 24 24" class="t-icon-xs"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </button>
          <button class="km-btn-icon" data-action="delete" title="Delete Playlist">
            <svg viewBox="0 0 24 24" class="t-icon-xs"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      `;

      card.querySelector('.pl-card-info').addEventListener('click', () => viewPlaylist(pl.id));
      card.querySelector('[data-action="modify"]').addEventListener('click', (e) => {
        e.stopPropagation();
        window.XMPlaylist.showPrompt("MODIFY PLAYLIST NAME", pl.name, "Enter new playlist name...", (newName) => {
          pl.name = newName;
          window.XMPlaylist.savePlaylists(playlists);
          renderPlaylists();
        });
      });
      card.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        window.XMPlaylist.showConfirm("DELETE PLAYLIST", `Permanently delete "${pl.name}"?`, () => {
          window.XMPlaylist.savePlaylists(playlists.filter(p => p.id !== pl.id));
          renderPlaylists();
        });
      });

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
      playlistItemsWrap.innerHTML = '<div class="library-empty-msg">Playlist is empty. Click "+ Add From Collection" above.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    pl.tracks.forEach((track, idx) => {
      const card = document.createElement('div');
      const fmtClass = getFormatBadgeClass(track.ext);
      card.className = `track-card ${currentlyPlayingId === track.id ? 'active-playing' : ''}`;
      card.setAttribute('data-track-id', track.id);
      card.innerHTML = `
        <div class="track-card-row1">
          <span class="track-card-title">${track.title}</span>
          <span class="fmt-badge ${fmtClass}">${track.ext || 'XM'}</span>
        </div>
        <div class="track-card-row2">
          <span class="track-card-artist">${track.artist}</span>
          <div class="track-card-actions">
            <button class="km-btn-icon" data-action="remove-added" title="Remove track">
              <svg viewBox="0 0 24 24" class="t-icon-xs"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.km-btn-icon')) return;
        playTrack(track, pl.tracks, idx);
      });

      card.querySelector('[data-action="remove-added"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const pls = window.XMPlaylist.getPlaylists();
        const target = pls.find(p => p.id === plId);
        if (target) {
          target.tracks.splice(idx, 1);
          window.XMPlaylist.savePlaylists(pls);
          viewPlaylist(plId);
        }
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
    const modalTitle = document.getElementById('studioModalTitle');
    const modalBody = document.getElementById('studioModalBody');
    const modalFooter = document.getElementById('studioModalFooter');

    modalTitle.textContent = `ADD TO ${pl.name.toUpperCase()}`;
    modalBody.innerHTML = `
      <input type="text" class="modal-input" id="modalColSearch" placeholder="Filter entire collection by artist or title..." />
      <div class="modal-collection-list" id="modalColList"></div>
    `;
    modalFooter.innerHTML = '<button class="action-btn action-btn-secondary" id="btnModalCloseOnly"><span>Done</span></button>';
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
        item.innerHTML = `
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.78rem;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.title}</div>
            <div style="font-size:0.70rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.artist}</div>
          </div>
          <button class="action-btn" data-add-id="${t.id}" style="padding:4px 8px;font-size:0.65rem;flex:none;"><span>+ Add</span></button>
        `;
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
      const filtered = q
        ? fullCatalog.filter(t => (t.artist && t.artist.toLowerCase().includes(q)) || (t.title && t.title.toLowerCase().includes(q)))
        : fullCatalog;
      renderModalItems(filtered);
    });
  }

  btnAddFromCollection.addEventListener('click', openAddFromCollectionModal);

  btnCreatePlaylist.addEventListener('click', () => {
    const name = inputNewPlaylist.value.trim();
    if (!name) return;
    const pls = window.XMPlaylist.getPlaylists();
    pls.push({ id: `pl_${Date.now()}`, name, tracks: [] });
    window.XMPlaylist.savePlaylists(pls);
    inputNewPlaylist.value = '';
    renderPlaylists();
  });

  btnBackPlaylists.addEventListener('click', renderPlaylists);
  btnPlayAllPlaylist.addEventListener('click', () => {
    if (!currentPlaylistId) return;
    const pl = window.XMPlaylist.getPlaylists().find(p => p.id === currentPlaylistId);
    if (pl && pl.tracks.length > 0) playTrack(pl.tracks[0], pl.tracks, 0);
  });
  btnModifyPlaylist.addEventListener('click', () => {
    if (currentPlaylistId) {
      const pls = window.XMPlaylist.getPlaylists();
      const pl = pls.find(p => p.id === currentPlaylistId);
      if (pl) {
        window.XMPlaylist.showPrompt("RENAME PLAYLIST", pl.name, "New name...", (nn) => {
          pl.name = nn;
          window.XMPlaylist.savePlaylists(pls);
          viewPlaylist(currentPlaylistId);
        });
      }
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
      renderTrackList(displayCatalog);
    } else if (tabId === 'favorites') {
      tabFavs.classList.add('active');
      searchBarWrap.classList.remove('hide');
      paneTable.classList.remove('hide');
      searchInput.placeholder = "Filter favorites...";
      renderTrackList(sortAlphabetical(window.XMPlaylist.getFavorites()));
    } else if (tabId === 'playlists') {
      tabPlaylists.classList.add('active');
      searchBarWrap.classList.add('hide');
      panePlaylists.classList.remove('hide');
      renderPlaylists();
    } else if (tabId === 'source') {
      tabSource.classList.add('active');
      searchBarWrap.classList.add('hide');
      paneSource.classList.remove('hide');
      document.getElementById('inputCustomSource').value = localStorage.getItem('xm_custom_library_url') || '';
      countBadge.textContent = "SOURCE";
    }
  }

  tabArchive.addEventListener('click', () => switchTab('archive'));
  tabFavs.addEventListener('click', () => switchTab('favorites'));
  tabPlaylists.addEventListener('click', () => switchTab('playlists'));
  tabSource.addEventListener('click', () => switchTab('source'));

  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (activeTab === 'archive') {
      displayCatalog = q 
        ? fullCatalog.filter(t => (t.artist && t.artist.toLowerCase().includes(q)) || (t.title && t.title.toLowerCase().includes(q)) || (t.folder && t.folder.toLowerCase().includes(q)))
        : fullCatalog;
      renderTrackList(displayCatalog);
    } else if (activeTab === 'favorites') {
      const favs = window.XMPlaylist.getFavorites();
      const filtered = q
        ? favs.filter(t => (t.artist && t.artist.toLowerCase().includes(q)) || (t.title && t.title.toLowerCase().includes(q)))
        : favs;
      renderTrackList(filtered);
    }
  });

  async function syncFullCatalog() {
    if (window.XMCustom) {
      customCatalog = await window.XMCustom.getTracks();
    } else {
      customCatalog = [];
    }
    fullCatalog = sortAlphabetical([...customCatalog, ...remoteCatalog]);
    displayCatalog = fullCatalog;
    if (activeTab === 'archive') renderTrackList(displayCatalog);
  }

  async function loadCatalog() {
    const baseUrl = getBaseUrl();
    tableBody.innerHTML = `<div class="library-empty-msg">Loading XM-Music repository catalog...</div>`;
    try {
      const res = await fetch(`${baseUrl}tracks.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      data.forEach((t, i) => {
        t.title = (t.title || t.name || t.song || '').trim() || (t.path ? t.path.split('/').pop().replace(/\.[a-z0-9]+$/i, '') : `Track ${i + 1}`);
        t.artist = (t.artist || t.author || '').trim() || 'Unknown Artist';
        if (!t.ext && t.path) {
          const m = t.path.match(/\.([a-z0-9]+)$/i);
          if (m) t.ext = m[1].toUpperCase();
        }
        if (!t.id) t.id = t.path ? `cloud_${t.path}` : `track_${i}`;
      });
      remoteCatalog = data;
    } catch (e) {
      remoteCatalog = [];
    }
    await syncFullCatalog();
    switchTab('archive');
  }

  loadCatalog();

  window.XMLibrary = {
    getBaseUrl: getBaseUrl,
    notifyPlaying: function(trackId) {
      currentlyPlayingId = trackId;
      updateActiveCards();
    },
    renderCurrentTab: function() {
      switchTab(activeTab);
    },
    refreshArchive: async function() {
      await syncFullCatalog();
    }
  };
})(window);