/* Mehrin service worker — offline app shell.
 * API and SSE traffic always go to the network (never cached). */

// Build-time values keep the HTML, client, styles, and offline shell together.
const CACHE = 'mehrin-__RELEASE__';
const SHELL = [
  '/',
  '/index.html',
  '__STYLES_URL__',
  '__CLIENT_URL__',
  '/manifest.webmanifest',
  '/fonts/manrope-variable.ttf',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mehrin-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache the API or the live price stream.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network-first, fall back to cached app shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-cache' }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Old pages may still ask for unversioned files. Always revalidate these
  // instead of serving a cached bundle that lacks newly added button handlers.
  if (['/main.js', '/styles.css', '/sw.js'].includes(url.pathname)) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' }).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: cache-first, then network (and refresh the cache).
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
