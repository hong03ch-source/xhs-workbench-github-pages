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
var VERSION = "2026-07-29-3";
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

/*
 * 统一 stale-while-revalidate：有缓存就立刻给缓存（点开即用，不等网络），
 * 同时在后台悄悄拉一份新的存起来。
 *
 * 上一版我为了「让更新能生效」把 HTML/JS/CSS 改成了 network-first，
 * 结果是每次打开都要先等一次网络往返 —— 手机信号差的时候就是白屏干等，
 * 恰恰把「像软件一样秒开」这件事牺牲掉了。
 *
 * 现在两头都要：更新走 Service Worker 自己的版本机制 ——
 * 上面的 VERSION 一变，install 时会重新抓一遍 SHELL 建新缓存，
 * 页面那边收到 updatefound 就弹「有新版本 · 刷新」。
 *
 * 所以：改完代码记得把 VERSION 改掉，否则老设备不会更新。
 * 页面每次启动还会主动调一次 registration.update() 兜底。
 */
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;          // GitHub API / CDN 一律不碰

  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // 离线：有缓存就用缓存，导航请求兜底回首页
        return hit || (req.mode === "navigate" ? caches.match("index.html") : undefined);
      });
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
