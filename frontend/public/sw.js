const CACHE_NAME = 'bodagoera-app-v3';
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

// ---- Push alerts (ICANera relay) --------------------------------------------
// The relay sends { title, body, tag, url, urgent, data }: ride requests, ride
// updates, chat messages and INCOMING CALLS. Like a chat app, a system banner
// only shows when the person is NOT looking at the app - when it is in front
// the app's own live screens (ride list, call overlay) already react, and get a
// message here. (iPhone requires every push to show a notification, so it does.)
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data ? event.data.text() : '' }; }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windows.forEach((client) => client.postMessage({ type: 'PUSH_RECEIVED', ...payload }));

    const inFront = windows.some((client) => client.visibilityState === 'visible' && client.focused);
    const isIos = /iPhone|iPad|iPod/i.test(self.navigator.userAgent || '');
    if (inFront && !isIos) return;

    const isCall = payload.data && payload.data.source === 'bodagoera_call';
    await self.registration.showNotification(payload.title || 'BodaGoEra', {
      body: payload.body || 'You have a new notification.',
      icon: '/icons/bodagoera-192.png',
      badge: '/icons/bodagoera-192.png',
      tag: payload.tag || 'bodagoera-notification',
      renotify: true,
      // A ringing call stays on screen until it is answered or dismissed
      requireInteraction: Boolean(payload.urgent),
      vibrate: isCall ? [400, 200, 400, 200, 400, 200, 400] : payload.urgent ? [300, 150, 300] : [200, 100, 200],
      data: { url: payload.url || '/', ...(payload.data || {}) }
    });
  })());
});

// Tapping a notification brings the app forward (or opens it) and tells it what
// was tapped, so a ride request / call can be opened straight away.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.url || '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (!open) return self.clients.openWindow(target);
    open.postMessage({ type: 'NOTIFICATION_CLICK', ...data, url: target });
    return open.focus();
  })());
});
