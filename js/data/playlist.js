/**
 * js/data/playlist.js - In-memory cached Playlist CRUD, O(1) favorites Set, and modal core.
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
          if (p.id === 'pl_default' && p.name === 'Demoscene Favorites') p.name = 'Demoscene Classics';
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
    try { localStorage.setItem('xm_playlists', JSON.stringify(pls)); } catch (e) {}
  }

  function getFavorites() {
    if (cachedFavorites) return cachedFavorites;
    try { cachedFavorites = JSON.parse(localStorage.getItem('xm_favorites')) || []; }
    catch (e) { cachedFavorites = []; }
    cachedFavSet = new Set(cachedFavorites.map(f => f.id));
    return cachedFavorites;
  }

  function saveFavorites(favs) {
    cachedFavorites = favs.map(sanitizeTrackForStorage);
    cachedFavSet = new Set(cachedFavorites.map(f => f.id));
    try { localStorage.setItem('xm_favorites', JSON.stringify(cachedFavorites)); } catch (e) {}
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
    exportPlaylist,
    importPlaylist,
    sanitizeTrackForStorage
  };
})(window);