// Pass-through service worker (disables caching). Unregisters on install.
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(self.registration.unregister().then(() => self.clients.matchAll()).then((clients) => {
    clients.forEach((c) => c.navigate(c.url));
  }));
});
self.addEventListener('fetch', (e) => {
  // pass through to network
});