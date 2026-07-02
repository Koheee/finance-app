/* Cache-first service worker: app shell + pdf.js CDN, so the app opens
 * (and parses statements) even offline after the first visit. */
const CACHE = "stmt-v1";
const SHELL = ["./", "index.html", "app.js", "engine.js", "manifest.json",
  "icon-180.png", "icon-192.png", "icon-512.png",
  "pdf.min.js", "pdf.worker.min.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) =>
      hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }))
  );
});
