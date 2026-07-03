/* Service worker.
 * - Small app files (index/app/engine/manifest): NETWORK-FIRST, so code
 *   updates are picked up automatically on the next launch — no cache bump
 *   needed for routine changes. Falls back to cache offline.
 * - Big stable files (pdf.js, icons): CACHE-FIRST for speed/data savings.
 */
const CACHE = "stmt-v5";
const SHELL = ["./", "index.html", "app.js", "engine.js", "manifest.json",
  "icon-180.png", "icon-192.png", "icon-512.png",
  "pdf.min.js", "pdf.worker.min.js"];
const NETWORK_FIRST = /(\/$|index\.html$|app\.js$|engine\.js$|manifest\.json$)/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = e.request.url.split("?")[0];
  if (NETWORK_FIRST.test(url)) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
  } else {
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true }).then((hit) =>
        hit || fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        }))
    );
  }
});
