// service-worker.js - Resilient offline PWA runtime caching with network-first app shell.
const CACHE_NAME = 'xm-runtime-v52';

self.addEventListener('install', () => {
  self.skipWaiting();
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
    console.error('[ServiceWorker] Initial asset fetch returned invalid response:', req.url);
  } catch (err) {
    console.error('[ServiceWorker] Initial asset fetch failed:', req.url, err);
  }

  await new Promise((r) => setTimeout(r, 60));
  const retryRes = await fetch(req, { cache: 'reload' });
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

  const url = req.url;
  const isDocNavigation = (
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    url.endsWith('.html') ||
    url.endsWith('/')
  );

  const isAppShell = (
    isDocNavigation ||
    url.endsWith('.css') ||
    url.endsWith('.js') ||
    url.includes('/js/') ||
    url.endsWith('manifest.json') ||
    url.endsWith('icon.svg')
  );

  if (isAppShell) {
    e.respondWith(
      fetchAssetWithRetry(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        return res;
      }).catch(async (err) => {
        console.error('[ServiceWorker] App shell request failed:', req.url, err);
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached && isValidResponse(req, cached)) return cached;
        if (isDocNavigation) {
          const fallbackDoc = (await caches.match('./')) || (await caches.match('./index.html'));
          if (fallbackDoc) return fallbackDoc;
        }
        return new Response(`Workstation ServiceWorker Offline Error: ${err.message}`, {
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
      });
    })
  );
});