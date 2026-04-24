const CACHE_NAME = "cfop-trainer-shell-v2";
const scopeUrl = new URL(self.registration.scope);
const APP_SHELL = [
  scopeUrl.pathname,
  new URL("site.webmanifest", self.registration.scope).pathname,
  new URL("app-icon.svg", self.registration.scope).pathname,
  new URL("app-icon-192.png", self.registration.scope).pathname,
  new URL("app-icon-512.png", self.registration.scope).pathname,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, copy);
        });
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match(scopeUrl.pathname))),
  );
});
