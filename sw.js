/*
 * Service Worker — 重写版
 *
 * 旧版的问题：对所有同源请求一律 cache-first，且缓存名写死 xhs-wb-v1。
 * 结果是你 push 了新代码，老设备永远加载旧版本 —— 除非你记得每次改代码时
 * 顺手把缓存名也改掉。这是个静默失败，最难查。
 *
 * 现在：
 *   HTML / JS / CSS  → network-first，拿不到网络才回退缓存（离线依然能开）
 *   图标 / manifest  → stale-while-revalidate，先给缓存再后台更新
 * 并且发现新版本时通知页面，由页面弹一个「有新版本，点击刷新」。
 */
var VERSION = "2026-07-29-1";
var CACHE = "xhs-wb-" + VERSION;
var SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "assets/styles.css", "assets/config.js", "assets/data.js",
  "assets/sync.js", "assets/app.js", "assets/icon.svg"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .catch(function () { /* 某个文件 404 不该阻塞整个安装 */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function isFresh(pathname) {
  return /\.(html|js|css)$/.test(pathname) || pathname === "/" || pathname.endsWith("/");
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;          // GitHub API / CDN 一律不碰

  if (isFresh(url.pathname)) {
    // network-first：永远优先拿最新代码，离线才用缓存
    e.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match("index.html");
          });
        })
    );
    return;
  }

  // 其它静态资源：先给缓存，后台悄悄更新
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});

self.addEventListener("message", function (e) {
  if (e.data === "skip-waiting") self.skipWaiting();
  if (e.data === "version") {
    e.source && e.source.postMessage({ type: "sw-version", version: VERSION });
  }
});
