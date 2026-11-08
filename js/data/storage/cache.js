/**
 * js/data/storage/cache.js - Persistent IndexedDB LRU cache with multi-tier playlist quotas.
 */
(function(window) {
  const DB_NAME = 'xm_studio_cache_db';
  const DB_VERSION = 6;
  const STORE_NAME = 'compiled_songs';
  const MAX_GLOBAL_ITEMS = 35;
  const MAX_PER_PLAYLIST = 10;
  const MAX_ACTIVE_PLAYLISTS = 3;
  const CURRENT_VIS_FPS = 15;

  const ramCache = new Map();
  let dbPromise = null;

  function getRecentPlaylists() {
    try {
      const list = JSON.parse(localStorage.getItem('xm_recent_playlists'));
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.error('[XMCache] Corrupted recent playlists storage:', err);
      return [];
    }
  }

  function touchRecentPlaylist(playlistId) {
    if (!playlistId || playlistId === 'catalog' || playlistId === 'queue') return;
    let list = getRecentPlaylists().filter((id) => id !== playlistId);
    list.unshift(playlistId);
    if (list.length > MAX_ACTIVE_PLAYLISTS) {
      list = list.slice(0, MAX_ACTIVE_PLAYLISTS);
    }
    localStorage.setItem('xm_recent_playlists', JSON.stringify(list));
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        const err = new Error('IndexedDB is not available in current environment.');
        console.error('[XMCache]', err);
        return reject(err);
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (e.oldVersion < 4 && db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.error('[XMCache] Failed to open IndexedDB:', req.error);
        dbPromise = null;
        reject(req.error);
      };
    });
    return dbPromise;
  }

  async function enforceQuotas(db) {
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const records = req.result || [];
        if (records.length === 0) return;

        const activePlaylists = new Set(getRecentPlaylists());
        const toDelete = new Set();

        if (activePlaylists.size > 0) {
          for (let i = 0; i < records.length; i++) {
            const r = records[i];
            if (r.playlistId && !activePlaylists.has(r.playlistId) && r.playlistId !== 'favorites' && r.playlistId !== 'archive') {
              toDelete.add(r.id);
            }
          }
        }

        const byPlaylist = new Map();
        for (let i = 0; i < records.length; i++) {
          const r = records[i];
          if (toDelete.has(r.id)) continue;
          const pid = r.playlistId || '__general__';
          if (!byPlaylist.has(pid)) byPlaylist.set(pid, []);
          byPlaylist.get(pid).push(r);
        }

        for (const [pid, list] of byPlaylist.entries()) {
          if (pid !== '__general__' && list.length > MAX_PER_PLAYLIST) {
            list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            const excess = list.length - MAX_PER_PLAYLIST;
            for (let j = 0; j < excess; j++) {
              toDelete.add(list[j].id);
            }
          }
        }

        const remaining = records.filter((r) => !toDelete.has(r.id));
        if (remaining.length > MAX_GLOBAL_ITEMS) {
          remaining.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          const excess = remaining.length - MAX_GLOBAL_ITEMS;
          for (let j = 0; j < excess; j++) {
            toDelete.add(remaining[j].id);
          }
        }

        toDelete.forEach((id) => {
          ramCache.delete(id);
          store.delete(id);
        });
      };
      req.onerror = () => console.error('[XMCache] Enforce quotas transaction failed:', req.error);
    } catch (err) {
      console.error('[XMCache] Failed during quota enforcement:', err);
    }
  }

  async function init() {
    try {
      const db = await openDB();
      if (!db) return;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        ramCache.clear();

        const validItems = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.visFps === CURRENT_VIS_FPS && item.visData) {
            validItems.push(item);
          } else {
            store.delete(item.id);
          }
        }

        const keep = validItems.slice(0, MAX_GLOBAL_ITEMS);
        for (let i = 0; i < keep.length; i++) {
          const item = keep[i];
          ramCache.set(item.id, {
            blob: item.blob,
            ext: item.format || 'mp3',
            visData: item.visData,
            visFps: item.visFps || CURRENT_VIS_FPS,
            duration: item.duration || 0,
            playlistId: item.playlistId || null,
            engine: item.engine || '',
            channels: item.channels || ''
          });
        }

        if (validItems.length > MAX_GLOBAL_ITEMS) {
          enforceQuotas(db);
        }
      };
      req.onerror = () => console.error('[XMCache] Error loading cache entries on init:', req.error);
    } catch (err) {
      console.error('[XMCache] Init failed:', err);
    }
  }

  function has(trackId, format) {
    const key = `${trackId}_${(format || 'mp3').toLowerCase()}`;
    return ramCache.has(key);
  }

  function get(trackId, format) {
    const key = `${trackId}_${(format || 'mp3').toLowerCase()}`;
    const item = ramCache.get(key);
    if (item) {
      if (item.visFps !== CURRENT_VIS_FPS) {
        ramCache.delete(key);
        openDB().then((db) => {
          if (!db) return;
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).delete(key);
        }).catch((err) => console.error('[XMCache] Error deleting stale cache entry:', err));
        return null;
      }

      openDB().then((db) => {
        if (!db) return;
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          const record = getReq.result;
          if (record) {
            record.timestamp = Date.now();
            store.put(record);
          }
        };
      }).catch((err) => console.error('[XMCache] Error updating LRU timestamp:', err));
      return item;
    }
    return null;
  }

  async function set(trackId, format, blob, visData, visFps, duration, playlistId, engine, channels) {
    if (!trackId || !blob) {
      throw new Error(`Invalid cache set parameters: trackId="${trackId}", blob=${Boolean(blob)}`);
    }
    const fmt = (format || 'mp3').toLowerCase();
    const key = `${trackId}_${fmt}`;
    if (playlistId) touchRecentPlaylist(playlistId);

    const existing = ramCache.get(key);
    const resolvedEngine = engine || (existing && existing.engine) || '';
    const resolvedChannels = channels || (existing && existing.channels) || '';

    const entry = {
      blob,
      ext: fmt,
      visData: visData ? (visData instanceof Uint8Array ? visData : new Uint8Array(visData)) : null,
      visFps: visFps || CURRENT_VIS_FPS,
      duration: (typeof duration === 'number' && duration > 0) ? duration : 0,
      playlistId: playlistId || null,
      engine: resolvedEngine,
      channels: resolvedChannels
    };

    ramCache.set(key, entry);

    try {
      const db = await openDB();
      if (!db) return;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({
        id: key,
        trackId,
        format: fmt,
        blob,
        visData: entry.visData,
        visFps: entry.visFps,
        duration: entry.duration,
        playlistId: entry.playlistId,
        engine: entry.engine,
        channels: entry.channels,
        timestamp: Date.now()
      });
      tx.oncomplete = () => enforceQuotas(db);
      tx.onerror = () => console.error('[XMCache] Error persisting record to IndexedDB:', tx.error);
    } catch (err) {
      console.error('[XMCache] Set transaction failure:', err);
    }
  }

  function clear() {
    ramCache.clear();
    openDB().then((db) => {
      if (!db) return;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
    }).catch((err) => console.error('[XMCache] Clear cache error:', err));
  }

  window.XMCache = { init, get, has, set, clear, MAX_PER_PLAYLIST, MAX_GLOBAL_ITEMS };
})(window);