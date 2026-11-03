// service-worker.js - Zero UI caching. Always network-first for immediate updates.
const CACHE_NAME = 'xm-runtime-v35';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map(k => caches.delete(k)));
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  // Always fetch application UI, scripts, and stylesheets directly from network
  if (url.endsWith('.html') || url.endsWith('.css') || url.endsWith('.js') || url.includes('/js/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Audio files and openmpt binaries can be cached for performance
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (url.includes('.xm') || url.includes('.mod') || url.includes('libopenmpt.js.mem')) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});