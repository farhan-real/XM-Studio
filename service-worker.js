// service-worker.js - Resilient offline PWA runtime caching with network-first app shell.
const CACHE_NAME = 'xm-runtime-v47';

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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = req.url;
  const isAppShell = (
    url.endsWith('.html') ||
    url.endsWith('.css') ||
    url.endsWith('.js') ||
    url.includes('/js/') ||
    url.endsWith('/') ||
    url.endsWith('manifest.json') ||
    url.endsWith('icon.svg')
  );

  if (isAppShell) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => {
        return caches.match(req).then((cached) => cached || caches.match('./') || caches.match('./index.html'));
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (
          res && res.status === 200 && (
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