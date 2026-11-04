/**
 * js/data/catalog.js - Catalog indexing, sorting, remote repository fetching, and search index.
 */
(function(window) {
  let fullCatalog = [];
  let displayCatalog = [];
  let remoteCatalog = [];
  let customCatalog = [];

  function indexTrack(track) {
    if (!track._search) {
      const a = (track.artist || '').toLowerCase();
      const ti = (track.title || '').toLowerCase();
      const f = (track.folder || '').toLowerCase();
      track._sortArtist = a;
      track._sortTitle = ti;
      track._search = `${a}\0${ti}\0${f}`;
    }
    return track;
  }

  function sortAlphabetical(tracks) {
    for (let i = 0; i < tracks.length; i++) {
      indexTrack(tracks[i]);
    }
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

  async function syncFullCatalog() {
    try {
      customCatalog = window.XMCustom ? await window.XMCustom.getTracks() : [];
    } catch (e) {
      customCatalog = [];
    }
    fullCatalog = sortAlphabetical([...customCatalog, ...remoteCatalog]);
    displayCatalog = fullCatalog;
    return displayCatalog;
  }

  async function fetchRemoteCatalogs() {
    if (window.XMSources && window.XMSources.fetchRemoteCatalogs) {
      remoteCatalog = await window.XMSources.fetchRemoteCatalogs();
    } else {
      remoteCatalog = [];
    }
    return remoteCatalog;
  }

  function filter(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
      displayCatalog = fullCatalog;
    } else {
      displayCatalog = fullCatalog.filter((t) => t._search.includes(q));
    }
    return displayCatalog;
  }

  window.XMCatalog = {
    getFullCatalog: () => fullCatalog,
    getDisplayCatalog: () => displayCatalog,
    setDisplayCatalog: (arr) => { displayCatalog = arr; },
    syncFullCatalog,
    fetchRemoteCatalogs,
    filter,
    sortAlphabetical,
    getFormatBadgeClass
  };
})(window);