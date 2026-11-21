const cachePrefix = 'capycraft-offline-';
const cacheName = `${cachePrefix}__OFFLINE_REVISION__`;
const offlinePage = '/offline.html';
const unavailableStatuses = new Set([502, 503, 504]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.add(new Request(offlinePage, { cache: 'reload' }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(cachePrefix) && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function navigate(request) {
  let response;
  try {
    response = await fetch(request, { cache: 'no-store' });
    if (!unavailableStatuses.has(response.status)) return response;
  } catch {
    // A failed connection can still use the cached offline page.
  }

  const fallback = await caches.match(offlinePage, { cacheName });
  return fallback ?? response ?? Response.error();
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.mode !== 'navigate' || request.destination !== 'document' || request.method !== 'GET') return;

  const { origin, pathname } = new URL(request.url);
  if (origin !== self.location.origin || pathname === '/auth-redirect.html' ||
      pathname.startsWith('/api/') || pathname.startsWith('/item-catalog/')) return;

  event.respondWith(navigate(request));
});
