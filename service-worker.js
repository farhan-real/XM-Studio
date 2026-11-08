// service-worker.js - Resilient offline PWA runtime caching with network-first app shell.
const CACHE_NAME = 'xm-runtime-v57';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    }).then(() => self.clients.claim())
  );
});

function isShellAsset(url) {
  const clean = url.split('#')[0].split('?')[0].toLowerCase();
  return (
    clean.endsWith('.js') ||
    clean.endsWith('.css') ||
    clean.endsWith('.json') ||
    clean.endsWith('.svg') ||
    clean.includes('/js/') ||
    clean.includes('/css/')
  );
}

function isValidResponse(res) {
  if (!res || res.status !== 200) return false;
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) return false;
  return true;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
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
      (async () => {
        if (navigator.onLine) {
          try {
            const netRes = await fetch(req.url, { cache: 'no-cache' });
            if (netRes && netRes.status === 200) {
              const clone = netRes.clone();
              const cache = await caches.open(CACHE_NAME);
              await cache.put(req, clone.clone());
              await cache.put('./', clone.clone());
              await cache.put('index.html', clone);
              return netRes;
            }
          } catch (err) {}
        }

        const cached = (await caches.match(req, { ignoreSearch: true })) ||
                       (await caches.match('./')) ||
                       (await caches.match('index.html')) ||
                       (await caches.match('./index.html'));
        if (cached && cached.status === 200) return cached;

        return new Response('Workstation Offline: App shell is unavailable.', {
          status: 504,
          statusText: 'Gateway Timeout',
          headers: { 'Content-Type': 'text/plain' }
        });
      })()
    );
    return;
  }

  if (isShellAsset(url)) {
    e.respondWith(
      (async () => {
        if (navigator.onLine) {
          try {
            const netRes = await fetch(req.url, { cache: 'no-cache' });
            if (isValidResponse(netRes)) {
              const clone = netRes.clone();
              const cache = await caches.open(CACHE_NAME);
              await cache.put(req, clone);
              return netRes;
            }
          } catch (netErr) {}
        }

        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached && isValidResponse(cached)) {
          return cached;
        }

        if (navigator.onLine) {
          try {
            const reloadRes = await fetch(req.url, { cache: 'reload' });
            if (isValidResponse(reloadRes)) {
              const clone = reloadRes.clone();
              const cache = await caches.open(CACHE_NAME);
              await cache.put(req, clone);
              return reloadRes;
            }
          } catch (reloadErr) {}
        }

        return new Response(`Workstation Asset Unavailable: ${req.url}`, {
          status: 504,
          statusText: 'Gateway Timeout',
          headers: { 'Content-Type': 'text/plain' }
        });
      })()
    );
    return;
  }

  e.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached && (cached.status === 200 || cached.status === 206)) {
        return cached;
      }

      try {
        const netRes = await fetch(req);
        if (
          netRes &&
          netRes.status === 200 &&
          (url.includes('.xm') ||
           url.includes('.mod') ||
           url.includes('.it') ||
           url.includes('.s3m') ||
           url.includes('.flac') ||
           url.includes('.mp3') ||
           url.includes('.wav') ||
           url.includes('libopenmpt.js.mem') ||
           url.endsWith('.wasm'))
        ) {
          const clone = netRes.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return netRes;
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    })()
  );
});