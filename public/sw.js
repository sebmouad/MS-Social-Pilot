/*
 * MS Social Pilot service worker.
 *
 * Deliberately small: it makes the app installable and shows a friendly page
 * when the phone is offline. It never caches screens or API answers — they are
 * a person's private data and go stale in minutes — only the offline page and
 * the icons it needs.
 */
const CACHE = 'msp-shell-v1';
const SHELL = ['/offline.html', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
});
