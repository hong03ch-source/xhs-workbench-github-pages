/* Service Worker — 缓存 app shell，离线也能打开工作台（数据走云端/本地） */
const CACHE = "xhs-wb-v1";
const ASSETS = [
  "./", "index.html", "manifest.webmanifest",
  "assets/styles.css", "assets/app.js", "assets/data.js", "assets/sync.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;            // 跨域（如 Supabase CDN）不缓存
  if (url.pathname.endsWith("hotspots.js")) return fetch(e.request); // 热点每日更新，总拉最新
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(r =>
      r || fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match("index.html"))
    )
  );
});
