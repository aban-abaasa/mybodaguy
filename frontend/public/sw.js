const CACHE_NAME = 'bodagoera-app-v2';
const APP_SHELL = [
  '/',
  '/bodagoera/',
  '/supermarketera/',
  '/images/bodagoera-apk.jpg',
  '/images/supermarketera-apk.jpg',
  '/icons/supermarketera-192.png',
  '/icons/supermarketera-512.png',
  '/manifest-bodagoera.webmanifest',
  '/manifest-supermarketera.webmanifest',
  '/icons/bodagoera-icon.svg',
  '/icons/supermarketera-icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))
  );
});
