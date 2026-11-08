/**
 * js/data/playlist/playlist.js - In-memory cached Playlist CRUD with automatic metadata synchronization.
 */
(function(window) {
  let cachedPlaylists = null;
  let cachedFavorites = null;
  let cachedFavSet = null;

  function sanitizeTrackForStorage(t) {
    if (!t) throw new Error('sanitizeTrackForStorage: track is required.');
    const copy = Object.assign({}, t);
    delete copy.blob;
    return copy;
  }

  function getPlaylists() {
    if (cachedPlaylists) return cachedPlaylists;
    try {
      const raw = localStorage.getItem('xm_playlists');
      if (raw) {
        const pls = JSON.parse(raw);
        if (Array.isArray(pls)) {
          pls.forEach(p => {
            if (p.id === 'pl_default' && p.name === 'Demoscene Favorites') p.name = 'Demoscene Classics';
          });
          cachedPlaylists = pls;
          return cachedPlaylists;
        }
      }
    } catch (err) {
      console.error('[XMPlaylist] Corrupted playlists in localStorage:', err);
    }
    cachedPlaylists = [{ id: 'pl_default', name: 'Demoscene Classics', tracks: [] }];
    return cachedPlaylists;
  }

  function savePlaylists(pls) {
    cachedPlaylists = pls;
    localStorage.setItem('xm_playlists', JSON.stringify(pls));
  }

  function getFavorites() {
    if (cachedFavorites) return cachedFavorites;
    try {
      const raw = localStorage.getItem('xm_favorites');
      cachedFavorites = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(cachedFavorites)) cachedFavorites = [];
    } catch (err) {
      console.error('[XMPlaylist] Corrupted favorites in localStorage:', err);
      cachedFavorites = [];
    }
    cachedFavSet = new Set(cachedFavorites.map(f => f.id));
    return cachedFavorites;
  }

  function saveFavorites(favs) {
    cachedFavorites = favs.map(sanitizeTrackForStorage);
    cachedFavSet = new Set(cachedFavorites.map(f => f.id));
    localStorage.setItem('xm_favorites', JSON.stringify(cachedFavorites));
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

  function syncSavedTrackMetadata() {
    if (!window.XMCatalog || !window.XMCatalog.getFullCatalog) return;
    const catalog = window.XMCatalog.getFullCatalog();
    if (!catalog || catalog.length === 0) return;

    const catalogMap = new Map();
    for (let i = 0; i < catalog.length; i++) {
      catalogMap.set(catalog[i].id, catalog[i]);
    }

    let favsChanged = false;
    const favs = getFavorites();
    for (let i = 0; i < favs.length; i++) {
      const match = catalogMap.get(favs[i].id);
      if (match && (favs[i].artist !== match.artist || favs[i].title !== match.title)) {
        favs[i].artist = match.artist;
        favs[i].title = match.title;
        favs[i].ext = match.ext;
        favsChanged = true;
      }
    }
    if (favsChanged) saveFavorites(favs);

    let plsChanged = false;
    const pls = getPlaylists();
    for (let p = 0; p < pls.length; p++) {
      const pl = pls[p];
      if (!pl.tracks) continue;
      for (let i = 0; i < pl.tracks.length; i++) {
        const match = catalogMap.get(pl.tracks[i].id);
        if (match && (pl.tracks[i].artist !== match.artist || pl.tracks[i].title !== match.title)) {
          pl.tracks[i].artist = match.artist;
          pl.tracks[i].title = match.title;
          pl.tracks[i].ext = match.ext;
          plsChanged = true;
        }
      }
    }
    if (plsChanged) savePlaylists(pls);
  }

  function exportPlaylist(plId) {
    const pl = getPlaylists().find(p => p.id === plId);
    if (!pl) throw new Error(`Playlist with ID "${plId}" not found for export.`);
    if (!pl.name) throw new Error('Playlist has no name.');
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
    a.download = `${pl.name.replace(/[/\\?%*:|"<>]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importPlaylist(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || !data.name || !Array.isArray(data.tracks)) throw new Error("Invalid playlist JSON format");
      const pls = getPlaylists();
      pls.push({ id: `pl_${Date.now()}`, name: data.name, tracks: data.tracks.map(sanitizeTrackForStorage) });
      savePlaylists(pls);
      if (window.XMLibrary) window.XMLibrary.renderCurrentTab();
    } catch (err) { alert(`Playlist import failed: ${err.message}`); }
  }

  window.XMPlaylist = {
    getPlaylists,
    savePlaylists,
    getFavorites,
    saveFavorites,
    isFavorited,
    toggleFavorite,
    syncSavedTrackMetadata,
    exportPlaylist,
    importPlaylist,
    sanitizeTrackForStorage
  };
})(window);