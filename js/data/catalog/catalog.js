/**
 * js/data/catalog/catalog.js - Catalog indexing, sorting, track number search, and filtering.
 */
(function(window) {
  let fullCatalog = [];
  let displayCatalog = [];
  let remoteCatalog = [];
  let customCatalog = [];

  const FALLBACK_DEMO_TRACKS = [
    { id: 'demo_chipsounds', title: 'Chipsounds', artist: 'Dubmood', ext: 'MOD', path: 'tunes/chipsounds.mod', url: 'https://deskjet.github.io/chiptune2.js/tunes/chipsounds.mod', repoId: 'repo_default', repoName: 'Default Repository', folder: 'Demoscene' },
    { id: 'demo_mysterysterium', title: 'Mysterysterium', artist: 'Maktone', ext: 'MOD', path: 'tunes/mysterysterium.mod', url: 'https://deskjet.github.io/chiptune2.js/tunes/mysterysterium.mod', repoId: 'repo_default', repoName: 'Default Repository', folder: 'Demoscene' },
    { id: 'demo_cydonian_sky', title: 'Cydonian Sky', artist: 'Dubmood', ext: 'MOD', path: 'tunes/cydonian_sky.mod', url: 'https://deskjet.github.io/chiptune2.js/tunes/cydonian_sky.mod', repoId: 'repo_default', repoName: 'Default Repository', folder: 'Demoscene' },
    { id: 'demo_rf_chip', title: 'RF Chip #001', artist: 'Dubmood & Bliss', ext: 'MOD', path: 'tunes/rf_chip_001.mod', url: 'https://deskjet.github.io/chiptune2.js/tunes/rf_chip_001.mod', repoId: 'repo_default', repoName: 'Default Repository', folder: 'Demoscene' }
  ];

  function indexTrack(track, idx) {
    const a = (track.artist || '').toLowerCase();
    const ti = (track.title || '').toLowerCase();
    const f = (track.folder || '').toLowerCase();
    track._sortArtist = a;
    track._sortTitle = ti;
    if (typeof idx === 'number') {
      track.catalogIndex = idx;
      track._trackNum = idx;
    }
    track._search = `${a}\0${ti}\0${f}`;
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
      const allCustom = window.XMCustom ? await window.XMCustom.getTracks() : [];
      const disabledFolders = new Set(
        (window.XMSources && window.XMSources.getFolderSources)
          ? window.XMSources.getFolderSources().filter(f => f.enabled === false).map(f => f.id)
          : []
      );
      customCatalog = disabledFolders.size > 0
        ? allCustom.filter(t => !t.folderSourceId || !disabledFolders.has(t.folderSourceId))
        : allCustom;
    } catch (e) {
      customCatalog = [];
    }
    const combined = [...customCatalog, ...remoteCatalog];
    fullCatalog = sortAlphabetical(combined.length > 0 ? combined : [...FALLBACK_DEMO_TRACKS]);
    for (let i = 0; i < fullCatalog.length; i++) {
      fullCatalog[i].catalogIndex = i + 1;
      fullCatalog[i]._trackNum = i + 1;
    }
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
      return displayCatalog;
    }

    let numTarget = null;
    const numMatch = q.match(/^#?\s*(\d+)$/);
    if (numMatch) {
      numTarget = parseInt(numMatch[1], 10);
    }

    displayCatalog = fullCatalog.filter((t) => {
      if (numTarget !== null && t.catalogIndex === numTarget) return true;
      return t._search.includes(q);
    });

    if (numTarget !== null && displayCatalog.length > 1) {
      displayCatalog.sort((a, b) => {
        if (a.catalogIndex === numTarget) return -1;
        if (b.catalogIndex === numTarget) return 1;
        return 0;
      });
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