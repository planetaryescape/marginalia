/* Only the offline screen is cached. Never persist articles, API responses,
   mutations or Next's versioned app shell in the service worker. */
const CACHE = "marginalia-offline-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.add(new Request(OFFLINE, { cache: "reload" }));
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) => key.startsWith("marginalia-offline-") && key !== CACHE,
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (
    request.method !== "GET" ||
    request.mode !== "navigate" ||
    new URL(request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    fetch(request).catch(async () => {
      const fallback = await caches.match(OFFLINE, { cacheName: CACHE });
      return fallback ?? Response.error();
    }),
  );
});
