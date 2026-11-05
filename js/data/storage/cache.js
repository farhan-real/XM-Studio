/**
 * js/data/storage/cache.js - Persistent IndexedDB LRU cache for compiled songs & 15 FPS visualizer frames.
 */
(function(window) {
  const DB_NAME = 'xm_studio_cache_db';
  const DB_VERSION = 4;
  const STORE_NAME = 'compiled_songs';
  const MAX_ITEMS = 10;
  const CURRENT_VIS_FPS = 15;

  const ramCache = new Map();
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
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
        dbPromise = null;
        resolve(null);
      };
    });
    return dbPromise;
  }

  async function pruneOldEntries(db) {
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const countReq = store.count();

      countReq.onsuccess = () => {
        const count = countReq.result;
        if (count > MAX_ITEMS) {
          const excess = count - MAX_ITEMS;
          let deleted = 0;
          const cursorReq = index.openCursor();
          cursorReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor && deleted < excess) {
              ramCache.delete(cursor.primaryKey);
              cursor.delete();
              deleted++;
              cursor.continue();
            }
          };
        }
      };
    } catch (e) {}
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

        const keep = validItems.slice(0, MAX_ITEMS);
        for (let i = 0; i < keep.length; i++) {
          const item = keep[i];
          ramCache.set(item.id, {
            blob: item.blob,
            ext: item.format || 'mp3',
            visData: item.visData,
            visFps: item.visFps || CURRENT_VIS_FPS,
            duration: item.duration || 0
          });
        }

        if (validItems.length > MAX_ITEMS) {
          pruneOldEntries(db);
        }
      };
    } catch (e) {}
  }

  function get(trackId, format) {
    const key = `${trackId}_${(format || 'mp3').toLowerCase()}`;
    const item = ramCache.get(key);
    if (item) {
      if (item.visFps !== CURRENT_VIS_FPS) {
        ramCache.delete(key);
        openDB().then((db) => {
          if (!db) return;
          try {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(key);
          } catch (e) {}
        });
        return null;
      }

      openDB().then((db) => {
        if (!db) return;
        try {
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
        } catch (err) {}
      });
      return item;
    }
    return null;
  }

  async function set(trackId, format, blob, visData, visFps, duration) {
    if (!trackId || !blob) return;
    const fmt = (format || 'mp3').toLowerCase();
    const key = `${trackId}_${fmt}`;

    const entry = {
      blob,
      ext: fmt,
      visData: visData ? (visData instanceof Uint8Array ? visData : new Uint8Array(visData)) : null,
      visFps: visFps || CURRENT_VIS_FPS,
      duration: (typeof duration === 'number' && duration > 0) ? duration : 0
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
        timestamp: Date.now()
      });
      tx.oncomplete = () => {
        pruneOldEntries(db);
      };
    } catch (err) {}
  }

  function clear() {
    ramCache.clear();
    openDB().then((db) => {
      if (!db) return;
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
      } catch (e) {}
    });
  }

  window.XMCache = { init, get, set, clear };
})(window);