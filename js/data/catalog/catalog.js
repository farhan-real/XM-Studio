/**
 * js/data/catalog/catalog.js - Catalog indexing, sorting, track number search, and filtering without silent fallbacks.
 */
(function(window) {
  let fullCatalog = [];
  let displayCatalog = [];
  let remoteCatalog = [];
  let customCatalog = [];

  function indexTrack(track, idx) {
    if (!track.title) throw new Error(`Track index ${idx} is missing title.`);
    if (!track.artist) throw new Error(`Track "${track.title}" is missing artist.`);
    const a = track.artist.toLowerCase();
    const ti = track.title.toLowerCase();
    const f = track.folder ? track.folder.toLowerCase() : '';
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
      indexTrack(tracks[i], i + 1);
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
    if (!ext) throw new Error('getFormatBadgeClass: Extension is required.');
    const e = ext.toLowerCase();
    if (e === 'xm') return 'fmt-xm';
    if (e === 'mod') return 'fmt-mod';
    if (e === 'it') return 'fmt-it';
    if (e === 's3m') return 'fmt-s3m';
    if (e === 'flac') return 'fmt-flac';
    return 'fmt-default';
  }

  async function syncFullCatalog() {
    if (!window.XMCustom || !window.XMCustom.getTracks) {
      throw new Error('XMCustom storage module is not available.');
    }
    const allCustom = await window.XMCustom.getTracks();
    const disabledFolders = new Set(
      window.XMSources && window.XMSources.getFolderSources
        ? window.XMSources.getFolderSources().filter(f => f.enabled === false).map(f => f.id)
        : []
    );
    customCatalog = disabledFolders.size > 0
      ? allCustom.filter(t => !t.folderSourceId || !disabledFolders.has(t.folderSourceId))
      : allCustom;

    const combined = [...customCatalog, ...remoteCatalog];
    fullCatalog = sortAlphabetical(combined);
    for (let i = 0; i < fullCatalog.length; i++) {
      fullCatalog[i].catalogIndex = i + 1;
      fullCatalog[i]._trackNum = i + 1;
    }
    displayCatalog = fullCatalog;
    return displayCatalog;
  }

  async function fetchRemoteCatalogs() {
    if (!window.XMSources || !window.XMSources.fetchRemoteCatalogs) {
      throw new Error('XMSources module is not loaded or missing fetchRemoteCatalogs function.');
    }
    remoteCatalog = await window.XMSources.fetchRemoteCatalogs();
    return remoteCatalog;
  }

  function filter(query) {
    const q = query ? query.toLowerCase().trim() : '';
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