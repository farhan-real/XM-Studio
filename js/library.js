/**
 * js/library.js - Left Panel: Keygenmusic Table & Complete Playlist CRUD (No Emojis)
 */
(function(window) {
  const DEFAULT_REPO_URL = 'https://farhan-real.github.io/XM-Music/';

  function getBaseUrl() {
    const saved = localStorage.getItem('xm_custom_library_url');
    return (saved && saved.trim()) ? saved.trim() : DEFAULT_REPO_URL;
  }

  // State
  let fullCatalog = [];
  let displayCatalog = [];
  let isCatalogLoaded = false;
  let activeTab = 'archive';
  let currentPlaylistId = null;
  let currentlyPlayingId = null;

  // Sorting: Keygenmusic style (Alphabetical by Artist, then Title)
  function sortKeygenmusicStyle(tracks) {
    return tracks.sort((a, b) => {
      const artA = (a.artist || 'Unknown').toLowerCase();
      const artB = (b.artist || 'Unknown').toLowerCase();
      if (artA !== artB) return artA.localeCompare(artB);
      return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase());
    });
  }

  // Favorites (localStorage)
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
    if (idx >= 0) {
      favs.splice(idx, 1);
    } else {
      favs.push(track);
    }
    saveFavorites(favs);
    renderCurrentTab();
  }

  // Playlists (localStorage)
  function getPlaylists() {
    try {
      return JSON.parse(localStorage.getItem('xm_playlists')) || [
        { id: 'pl_default', name: 'Demoscene Favorites', tracks: [] }
      ];
    } catch (e) {
      return [];
    }
  }

  function savePlaylists(pls) {
    localStorage.setItem('xm_playlists', JSON.stringify(pls));
  }

  // DOM Elements
  const searchInput = document.getElementById('leftSearchInput');
  const countBadge = document.getElementById('leftCountBadge');
  const searchBarWrap = document.getElementById('searchBarWrap');

  // Navigation Tabs in Left Panel
  const tabArchive = document.getElementById('tabArchive');
  const tabPlaylists = document.getElementById('tabPlaylists');
  const tabFavs = document.getElementById('tabFavorites');
  const tabSource = document.getElementById('tabSource');

  // Panes
  const paneTable = document.getElementById('paneTable');
  const panePlaylists = document.getElementById('panePlaylists');
  const paneSource = document.getElementById('paneSource');

  const tableBody = document.getElementById('kmTableBody');
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

  const inputCustomUrl = document.getElementById('inputCustomSource');
  const btnSaveSource = document.getElementById('btnSaveSource');
  const btnResetSource = document.getElementById('btnResetSource');
  const sourceStatus = document.getElementById('sourceStatusMsg');

  // In-App Studio Modal System
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

  function showStudioPrompt(title, defaultVal, placeholder, onConfirm) {
    modalTitle.textContent = title;
    modalBody.innerHTML = `<input type="text" class="modal-input" id="modalInputBox" value="${defaultVal || ''}" placeholder="${placeholder || ''}" />`;
    modalFooter.innerHTML = `
      <button class="action-btn action-btn-secondary" id="btnModalCancel"><span>Cancel</span></button>
      <button class="action-btn" id="btnModalSubmit"><span>Confirm</span></button>
    `;
    modalBackdrop.classList.remove('hide');
    const input = document.getElementById('modalInputBox');
    input.focus();
    input.select();

    document.getElementById('btnModalCancel').addEventListener('click', closeModal);
    document.getElementById('btnModalSubmit').addEventListener('click', () => {
      const val = input.value.trim();
      if (val) {
        closeModal();
        onConfirm(val);
      }
    });
  }

  function showStudioConfirm(title, message, onConfirm) {
    modalTitle.textContent = title;
    modalBody.innerHTML = `<p class="modal-msg">${message}</p>`;
    modalFooter.innerHTML = `
      <button class="action-btn action-btn-secondary" id="btnModalCancel"><span>Cancel</span></button>
      <button class="action-btn btn-danger-text" id="btnModalSubmit"><span>Delete</span></button>
    `;
    modalBackdrop.classList.remove('hide');

    document.getElementById('btnModalCancel').addEventListener('click', closeModal);
    document.getElementById('btnModalSubmit').addEventListener('click', () => {
      closeModal();
      onConfirm();
    });
  }

  // Fetch Catalog
  async function loadCatalog() {
    const baseUrl = getBaseUrl();
    tableBody.innerHTML = `<div class="library-empty-msg">Connecting to default XM-Music repository...<br><span style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.7rem;">${baseUrl}</span></div>`;
    
    try {
      const res = await fetch(`${baseUrl}tracks.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      data.forEach(t => {
        if (!t.id) t.id = `cloud_${t.path}`;
      });

      fullCatalog = sortKeygenmusicStyle(data);
      displayCatalog = fullCatalog;
      isCatalogLoaded = true;
      countBadge.textContent = `${fullCatalog.length} TRACKS`;
      renderCurrentTab();
    } catch (e) {
      tableBody.innerHTML = `
        <div class="library-empty-msg">
          Could not load catalog from:<br><span style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.7rem;">${baseUrl}</span><br><br>
          Deploy XM-Music to GitHub Pages or configure in <strong>Source</strong>.
        </div>
      `;
    }
  }

  function getFormatBadgeClass(ext) {
    const e = (ext || 'xm').toLowerCase();
    if (e === 'xm') return 'fmt-xm';
    if (e === 'mod') return 'fmt-mod';
    if (e === 'it') return 'fmt-it';
    if (e === 's3m') return 'fmt-s3m';
    return 'fmt-default';
  }

  // Keygenmusic Table Renderer
  function renderKeygenmusicTable(tracks) {
    tableBody.innerHTML = '';
    countBadge.textContent = `${tracks.length} TRACKS`;

    if (tracks.length === 0) {
      tableBody.innerHTML = '<div class="library-empty-msg">No matching tracks found.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    tracks.forEach((track, idx) => {
      const row = document.createElement('div');
      const isFav = isFavorited(track.id);
      const isPlaying = currentlyPlayingId === track.id;
      const fmtClass = getFormatBadgeClass(track.ext);

      row.className = `km-row ${isPlaying ? 'active-playing' : ''}`;
      row.innerHTML = `
        <div class="km-col-play">
          <svg viewBox="0 0 24 24" class="t-icon-xs" fill="currentColor">
            <polygon points="6 4 20 12 6 20 6 4"></polygon>
          </svg>
        </div>
        <div class="km-col-artist" title="${track.artist}">${track.artist}</div>
        <div class="km-col-title" title="${track.title}">${track.title}</div>
        <div class="km-col-fmt">
          <span class="fmt-badge ${fmtClass}">${track.ext || 'XM'}</span>
        </div>
        <div class="km-col-actions">
          <button class="km-btn-icon ${isFav ? 'active' : ''}" data-action="fav" title="Favorite">
            <svg viewBox="0 0 24 24" class="t-icon-xs" fill="${isFav ? 'var(--col-gold)' : 'none'}" stroke="${isFav ? 'var(--col-gold)' : 'currentColor'}">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </button>
          <button class="km-btn-icon" data-action="add-pl" title="Add to Playlist">
            <svg viewBox="0 0 24 24" class="t-icon-xs">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.closest('.km-btn-icon')) return;
        playTrack(track, tracks, idx);
      });

      row.querySelector('[data-action="fav"]').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(track);
      });

      row.querySelector('[data-action="add-pl"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openPlaylistPicker(track);
      });

      frag.appendChild(row);
    });

    tableBody.appendChild(frag);
  }

  function playTrack(track, queue, idx) {
    currentlyPlayingId = track.id;
    renderCurrentTab();

    const fullUrl = track.path ? `${getBaseUrl()}${track.path}` : (track.url || null);
    if (window.XMStudio && typeof window.XMStudio.loadTrackItem === 'function') {
      window.XMStudio.loadTrackItem(track, fullUrl, queue, idx);
    }
  }

  // Playlists View (CRUD)
  function renderPlaylists() {
    playlistCreateRow.classList.remove('hide');
    playlistDetailToolbar.classList.add('hide');
    playlistItemsWrap.innerHTML = '';
    const playlists = getPlaylists();
    countBadge.textContent = `${playlists.length} PLAYLISTS`;

    if (playlists.length === 0) {
      playlistItemsWrap.innerHTML = '<div class="library-empty-msg">No playlists created. Enter a name above to create one.</div>';
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
          <button class="km-btn-icon" data-action="play" title="Play Playlist">
            <svg viewBox="0 0 24 24" class="t-icon-xs" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4"></polygon>
            </svg>
          </button>
          <button class="km-btn-icon" data-action="modify" title="Rename Playlist">
            <svg viewBox="0 0 24 24" class="t-icon-xs">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
          <button class="km-btn-icon" data-action="delete" title="Delete Playlist">
            <svg viewBox="0 0 24 24" class="t-icon-xs">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;

      card.querySelector('.pl-card-info').addEventListener('click', () => viewPlaylist(pl.id));
      card.querySelector('[data-action="play"]').addEventListener('click', (e) => {
        e.stopPropagation();
        if (pl.tracks.length > 0) playTrack(pl.tracks[0], pl.tracks, 0);
      });
      card.querySelector('[data-action="modify"]').addEventListener('click', (e) => {
        e.stopPropagation();
        modifyPlaylistName(pl.id);
      });
      card.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        deletePlaylist(pl.id);
      });

      playlistItemsWrap.appendChild(card);
    });
  }

  // Playlist Detail View
  function viewPlaylist(plId) {
    currentPlaylistId = plId;
    const pl = getPlaylists().find(p => p.id === plId);
    if (!pl) return;

    playlistCreateRow.classList.add('hide');
    playlistDetailToolbar.classList.remove('hide');
    playlistDetailTitle.textContent = pl.name;
    playlistItemsWrap.innerHTML = '';

    if (pl.tracks.length === 0) {
      playlistItemsWrap.innerHTML = '<div class="library-empty-msg">Playlist is empty. Click "+ Add From Collection" above to add tracks.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    pl.tracks.forEach((track, idx) => {
      const row = document.createElement('div');
      const fmtClass = getFormatBadgeClass(track.ext);

      row.className = 'km-row';
      row.innerHTML = `
        <div class="km-col-play">
          <svg viewBox="0 0 24 24" class="t-icon-xs" fill="currentColor">
            <polygon points="6 4 20 12 6 20 6 4"></polygon>
          </svg>
        </div>
        <div class="km-col-artist" title="${track.artist}">${track.artist}</div>
        <div class="km-col-title" title="${track.title}">${track.title}</div>
        <div class="km-col-fmt"><span class="fmt-badge ${fmtClass}">${track.ext || 'XM'}</span></div>
        <div class="km-col-actions">
          <button class="km-btn-icon" data-action="remove-added" title="Delete added track">
            <svg viewBox="0 0 24 24" class="t-icon-xs">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.closest('.km-btn-icon')) return;
        playTrack(track, pl.tracks, idx);
      });

      row.querySelector('[data-action="remove-added"]').addEventListener('click', (e) => {
        e.stopPropagation();
        removeTrackFromPlaylist(plId, idx);
      });

      frag.appendChild(row);
    });

    playlistItemsWrap.appendChild(frag);
  }

  // "Add from collection" Picker Modal
  function openAddFromCollectionModal() {
    if (!currentPlaylistId) return;
    const pl = getPlaylists().find(p => p.id === currentPlaylistId);
    if (!pl) return;

    modalTitle.textContent = `ADD TO ${pl.name.toUpperCase()}`;
    modalBody.innerHTML = `
      <input type="text" class="modal-input" id="modalColSearch" placeholder="Filter collection by artist or title..." />
      <div class="modal-collection-list" id="modalColList"></div>
    `;
    modalFooter.innerHTML = '<button class="action-btn action-btn-secondary" id="btnModalCloseOnly"><span>Done</span></button>';
    document.getElementById('btnModalCloseOnly').addEventListener('click', closeModal);
    modalBackdrop.classList.remove('hide');

    const colList = document.getElementById('modalColList');
    const colSearch = document.getElementById('modalColSearch');

    function renderModalCollection(items) {
      colList.innerHTML = '';
      const slice = items.slice(0, 80);
      slice.forEach(t => {
        const item = document.createElement('div');
        item.className = 'modal-collection-item';
        item.innerHTML = `
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.78rem;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.artist}</div>
            <div style="font-size:0.70rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.title}</div>
          </div>
          <button class="action-btn" data-add-id="${t.id}" style="padding:4px 8px;font-size:0.65rem;"><span>+ Add</span></button>
        `;
        item.querySelector('[data-add-id]').addEventListener('click', () => {
          const allPls = getPlaylists();
          const target = allPls.find(p => p.id === currentPlaylistId);
          if (target && !target.tracks.some(tr => tr.id === t.id)) {
            target.tracks.push(t);
            savePlaylists(allPls);
            item.querySelector('span').textContent = 'Added';
            viewPlaylist(currentPlaylistId);
          }
        });
        colList.appendChild(item);
      });
    }

    renderModalCollection(fullCatalog);

    colSearch.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = q
        ? fullCatalog.filter(t => (t.artist && t.artist.toLowerCase().includes(q)) || (t.title && t.title.toLowerCase().includes(q)))
        : fullCatalog;
      renderModalCollection(filtered);
    });
  }

  btnAddFromCollection.addEventListener('click', openAddFromCollectionModal);

  // Playlist Actions: Create, Modify, Delete, Remove Added
  btnCreatePlaylist.addEventListener('click', () => {
    const name = inputNewPlaylist.value.trim();
    if (!name) return;
    const pls = getPlaylists();
    pls.push({ id: `pl_${Date.now()}`, name, tracks: [] });
    savePlaylists(pls);
    inputNewPlaylist.value = '';
    renderPlaylists();
  });

  function modifyPlaylistName(plId) {
    const pls = getPlaylists();
    const pl = pls.find(p => p.id === plId);
    if (!pl) return;

    showStudioPrompt("MODIFY PLAYLIST NAME", pl.name, "Enter new playlist name...", (newName) => {
      pl.name = newName;
      savePlaylists(pls);
      renderPlaylists();
    });
  }

  function deletePlaylist(plId) {
    const pls = getPlaylists();
    const pl = pls.find(p => p.id === plId);
    if (!pl) return;

    showStudioConfirm("DELETE PLAYLIST", `Are you sure you want to permanently delete "${pl.name}"?`, () => {
      savePlaylists(pls.filter(p => p.id !== plId));
      renderPlaylists();
    });
  }

  function removeTrackFromPlaylist(plId, idx) {
    const pls = getPlaylists();
    const pl = pls.find(p => p.id === plId);
    if (pl) {
      pl.tracks.splice(idx, 1);
      savePlaylists(pls);
      viewPlaylist(plId);
    }
  }

  btnBackPlaylists.addEventListener('click', renderPlaylists);
  btnPlayAllPlaylist.addEventListener('click', () => {
    if (!currentPlaylistId) return;
    const pl = getPlaylists().find(p => p.id === currentPlaylistId);
    if (pl && pl.tracks.length > 0) playTrack(pl.tracks[0], pl.tracks, 0);
  });
  btnModifyPlaylist.addEventListener('click', () => {
    if (currentPlaylistId) modifyPlaylistName(currentPlaylistId);
  });
  btnDeletePlaylist.addEventListener('click', () => {
    if (currentPlaylistId) deletePlaylist(currentPlaylistId);
  });

  // Add to Playlist Picker
  function openPlaylistPicker(track) {
    const pls = getPlaylists();
    modalTitle.textContent = "ADD TO PLAYLIST";

    if (pls.length === 0) {
      modalBody.innerHTML = '<div class="library-empty-msg">No custom playlists created yet. Create one in the Playlists tab.</div>';
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

  // Tab Switcher
  function switchTab(tabId) {
    activeTab = tabId;
    [tabArchive, tabPlaylists, tabFavs, tabSource].forEach(t => t.classList.remove('active'));
    [paneTable, panePlaylists, paneSource].forEach(p => p.classList.add('hide'));

    if (tabId === 'archive') {
      tabArchive.classList.add('active');
      searchBarWrap.classList.remove('hide');
      paneTable.classList.remove('hide');
      searchInput.placeholder = "Filter artist (A-Z), title, or folder...";
      renderKeygenmusicTable(displayCatalog);
    } else if (tabId === 'favorites') {
      tabFavs.classList.add('active');
      searchBarWrap.classList.remove('hide');
      paneTable.classList.remove('hide');
      searchInput.placeholder = "Filter favorites...";
      const favs = sortKeygenmusicStyle(getFavorites());
      renderKeygenmusicTable(favs);
    } else if (tabId === 'playlists') {
      tabPlaylists.classList.add('active');
      searchBarWrap.classList.add('hide');
      panePlaylists.classList.remove('hide');
      renderPlaylists();
    } else if (tabId === 'source') {
      tabSource.classList.add('active');
      searchBarWrap.classList.add('hide');
      paneSource.classList.remove('hide');
      inputCustomUrl.value = localStorage.getItem('xm_custom_library_url') || '';
      countBadge.textContent = "SETTINGS";
    }
  }

  function renderCurrentTab() {
    switchTab(activeTab);
  }

  tabArchive.addEventListener('click', () => switchTab('archive'));
  tabFavs.addEventListener('click', () => switchTab('favorites'));
  tabPlaylists.addEventListener('click', () => switchTab('playlists'));
  tabSource.addEventListener('click', () => switchTab('source'));

  // Live Search
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (activeTab === 'archive') {
      displayCatalog = q 
        ? fullCatalog.filter(t => (t.artist && t.artist.toLowerCase().includes(q)) || (t.title && t.title.toLowerCase().includes(q)) || (t.folder && t.folder.toLowerCase().includes(q)))
        : fullCatalog;
      renderKeygenmusicTable(displayCatalog);
    } else if (activeTab === 'favorites') {
      const favs = getFavorites();
      const filtered = q
        ? favs.filter(t => (t.artist && t.artist.toLowerCase().includes(q)) || (t.title && t.title.toLowerCase().includes(q)))
        : favs;
      renderKeygenmusicTable(filtered);
    }
  });

  // Source Configuration
  btnSaveSource.addEventListener('click', () => {
    let url = inputCustomUrl.value.trim();
    if (url) {
      if (!url.endsWith('/')) url += '/';
      localStorage.setItem('xm_custom_library_url', url);
    } else {
      localStorage.removeItem('xm_custom_library_url');
    }
    isCatalogLoaded = false;
    sourceStatus.textContent = 'Saved! Reloading catalog...';
    setTimeout(() => {
      sourceStatus.textContent = '';
      switchTab('archive');
      loadCatalog();
    }, 600);
  });

  btnResetSource.addEventListener('click', () => {
    localStorage.removeItem('xm_custom_library_url');
    inputCustomUrl.value = '';
    isCatalogLoaded = false;
    sourceStatus.textContent = 'Reset to default XM-Music.';
    setTimeout(() => {
      sourceStatus.textContent = '';
      switchTab('archive');
      loadCatalog();
    }, 600);
  });

  loadCatalog();

  window.XMLibrary = {
    notifyPlaying: (trackId) => {
      currentlyPlayingId = trackId;
      if (activeTab === 'archive' || activeTab === 'favorites') renderCurrentTab();
    }
  };
})(window);