// service-worker.js - Resilient offline PWA runtime caching with network-first app shell.
const CACHE_NAME = 'xm-runtime-v53';

const PRECACHE_ASSETS = [
  './',
  'index.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.error('[ServiceWorker] Precache failed during install:', err);
        self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    }).then(() => self.clients.claim())
  );
});

function isAssetRequest(url) {
  return (
    url.endsWith('.js') ||
    url.includes('.js?') ||
    url.endsWith('.css') ||
    url.includes('.css?') ||
    url.endsWith('.json') ||
    url.endsWith('.wasm') ||
    url.endsWith('.mem') ||
    url.endsWith('.svg')
  );
}

function isValidResponse(req, res) {
  if (!res || res.status !== 200) return false;
  if (isAssetRequest(req.url)) {
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) return false;
  }
  return true;
}

async function fetchAssetWithRetry(req) {
  try {
    const res = await fetch(req);
    if (isValidResponse(req, res)) return res;
  } catch (err) {
    // Retry once using direct URL string to bypass aborted or conflicting RequestInit state
  }

  await new Promise((r) => setTimeout(r, 60));
  const retryRes = await fetch(req.url, { cache: 'reload' });
  if (!isValidResponse(req, retryRes)) {
    const err = new Error(`Asset fetch failed permanently for: ${req.url}`);
    console.error('[ServiceWorker]', err);
    throw err;
  }
  return retryRes;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Prevent browser-level TypeError when DevTools or offline check requests only-if-cached
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;

  const url = req.url;
  const isDocNavigation = (
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    url.endsWith('.html') ||
    url.endsWith('/')
  );

  if (isDocNavigation) {
    e.respondWith(
      fetch(req).then((res) => {
        if (isValidResponse(req, res)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => {
            c.put(req, clone.clone());
            c.put('./', clone);
          });
          return res;
        }
        throw new Error(`Invalid navigation response status: ${res ? res.status : 'null'}`);
      }).catch(async (err) => {
        const cached = (await caches.match(req, { ignoreSearch: true })) ||
                       (await caches.match('./')) ||
                       (await caches.match('./index.html'));
        if (cached && isValidResponse(req, cached)) return cached;
        console.error('[ServiceWorker] Navigation request failed and no offline cache available:', req.url, err);
        return new Response(`Workstation Offline Error: ${err.message}`, {
          status: 504,
          statusText: 'Gateway Timeout',
          headers: { 'Content-Type': 'text/plain' }
        });
      })
    );
    return;
  }

  const isAppShellAsset = (
    url.endsWith('.css') ||
    url.includes('.css?') ||
    url.endsWith('.js') ||
    url.includes('.js?') ||
    url.includes('/js/') ||
    url.endsWith('manifest.json') ||
    url.endsWith('icon.svg')
  );

  if (isAppShellAsset) {
    e.respondWith(
      fetchAssetWithRetry(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        return res;
      }).catch(async (err) => {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached && isValidResponse(req, cached)) return cached;
        console.error('[ServiceWorker] Asset fetch failed and not cached:', req.url, err);
        return new Response(`Workstation Asset Error: ${err.message}`, {
          status: 504,
          statusText: 'Gateway Timeout',
          headers: { 'Content-Type': 'text/plain' }
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached && isValidResponse(req, cached)) return cached;
      return fetch(req).then((res) => {
        if (
          isValidResponse(req, res) && (
            url.includes('.xm') ||
            url.includes('.mod') ||
            url.includes('.flac') ||
            url.includes('libopenmpt.js.mem') ||
            url.endsWith('.wasm')
          )
        ) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      }).catch((err) => {
        console.error('[ServiceWorker] Media fetch failed:', req.url, err);
        throw err;
      });
    })
  );
});