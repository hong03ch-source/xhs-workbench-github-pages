/*
 * sync.js — 同步层（重写版）
 *
 * 修掉的三个会丢数据 / 有风险的问题：
 *
 * 1. 旧版启动时不管云端读没读到，最后都会 Sync.save(state) 推一次。
 *    网络抖一下、令牌过期、GitHub 限流 —— 任意一种情况都会把本地的空数据
 *    推上去，静默覆盖掉云端正确的数据，且不可恢复。
 *    现在：只有确认「本次数据确实来自云端」才允许写云端，否则进入只读模式，
 *    顶部挂提示条，你自己决定是重试还是强制以本机为准。
 *
 * 2. 旧版整体覆盖，state.json 里虽然写了 updated_at 却从来不读。
 *    电脑和手机同时开着，后保存的把前一个全量吃掉。
 *    现在：推送前先比对云端 updated_at，不一致就中止并提示。
 *
 * 3. 令牌永久明文存 localStorage，且没有任何清除入口。
 *    现在：可以选择「只记住本次会话」（存 sessionStorage，关掉浏览器即失效），
 *    并提供一键清除凭证。
 *
 * 凭证只存在你自己的浏览器里，不会发给除 GitHub / Supabase 官方接口以外的任何地方。
 */
window.Sync = (function () {
  var LS_KEY = "xhs_workbench_v4";
  var LS_KEY_LEGACY = "xhs_video_workbench_v3";
  var CFG_KEY = "xhs_sync_cfg";
  var ROW_ID = "macro-xhs-single";
  var GIST_DESC = "xhs-workbench-state (do not delete)";
  var GIST_FILE = "state.json";
  var API = "https://api.github.com";
  var PUSH_DEBOUNCE = 1500;

  var cfg = loadCfg();
  var writeAllowed = false;      // 未确认云端可读之前，一律不许写云端
  var lastSeenRemoteAt = null;   // 最近一次见到的云端 updated_at，用于冲突检测
  var pushTimer = null;
  var pendingState = null;
  var listeners = [];

  /* ---------- 配置读写 ---------- */

  function loadCfg() {
    var raw = null;
    try { raw = sessionStorage.getItem(CFG_KEY) || localStorage.getItem(CFG_KEY); } catch (e) {}
    if (!raw) return { type: "github", remember: true };
    try {
      var c = JSON.parse(raw);
      if (!c.type) c.type = "github";
      if (c.remember === undefined) c.remember = true;
      return c;
    } catch (e) { return { type: "github", remember: true }; }
  }

  function saveCfg(c) {
    cfg = c || { type: "github", remember: true };
    var json = JSON.stringify(cfg);
    try {
      if (cfg.remember) { localStorage.setItem(CFG_KEY, json); sessionStorage.removeItem(CFG_KEY); }
      else { sessionStorage.setItem(CFG_KEY, json); localStorage.removeItem(CFG_KEY); }
    } catch (e) {}
  }

  function getCfg() { return cfg; }

  function clearCreds() {
    try { localStorage.removeItem(CFG_KEY); sessionStorage.removeItem(CFG_KEY); } catch (e) {}
    cfg = { type: "github", remember: true };
    writeAllowed = false;
    lastSeenRemoteAt = null;
    emit({ kind: "creds-cleared" });
  }

  function cloudEnabled() {
    if (!cfg || !cfg.type || cfg.type === "github") return !!(cfg && cfg.token);
    if (cfg.type === "supabase") return !!(cfg.url && cfg.key);
    return !!cfg.url;
  }

  function canWriteCloud() { return cloudEnabled() && writeAllowed; }

  /* ---------- 事件（UI 用来挂只读提示 / 冲突提示） ---------- */

  function on(fn) { listeners.push(fn); }
  function emit(ev) { listeners.forEach(function (f) { try { f(ev); } catch (e) {} }); }

  /* ---------- HTTP ---------- */

  async function api(method, url, body, token) {
    var headers = { "Content-Type": "application/json", "Accept": "application/vnd.github+json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    var res = await fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      var detail = "";
      try { detail = (await res.json()).message || ""; } catch (e) {}
      var err = new Error("HTTP " + res.status + (detail ? " · " + detail : ""));
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return {};
    return res.json();
  }

  async function ensureGist() {
    if (cfg.gistId) return cfg.gistId;
    var list;
    try {
      list = await api("GET", API + "/gists?per_page=100", null, cfg.token);
    } catch (e) {
      // 列举失败时不能贸然创建新 Gist —— 那会产生第二份数据，正是数据分裂的开始
      throw new Error("无法确认云端是否已有数据（" + e.message + "）");
    }
    var found = (list || []).find(function (g) { return g.description === GIST_DESC; });
    if (found) { cfg.gistId = found.id; saveCfg(cfg); return cfg.gistId; }
    var files = {};
    files[GIST_FILE] = { content: JSON.stringify({ data: null, updated_at: new Date().toISOString() }) };
    var created = await api("POST", API + "/gists", { description: GIST_DESC, public: false, files: files }, cfg.token);
    cfg.gistId = created.id; saveCfg(cfg);
    return cfg.gistId;
  }

  async function ensureSupabase() {
    if (window.__sb) return window.__sb;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg.url || "")) throw new Error("Supabase 地址格式不对");
    var m = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    window.__sb = m.createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
    return window.__sb;
  }

  /* ---------- 读取云端 ---------- */

  async function readRemote() {
    if (cfg.type === "supabase") {
      var client = await ensureSupabase();
      var r = await client.from("workbench_state").select("data,updated_at").eq("id", ROW_ID).maybeSingle();
      if (r.error) throw new Error(r.error.message);
      return r.data ? { data: r.data.data, updated_at: r.data.updated_at } : { data: null, updated_at: null };
    }
    if (cfg.type === "github") {
      var id = await ensureGist();
      var g = await api("GET", API + "/gists/" + id, null, cfg.token);
      var f = g.files && g.files[GIST_FILE];
      if (!f) return { data: null, updated_at: null };
      var content = f.content;
      if (f.truncated && f.raw_url) content = await (await fetch(f.raw_url)).text();
      var p = JSON.parse(content || "{}");
      return { data: p.data || null, updated_at: p.updated_at || null };
    }
    var res = await fetch(cfg.url.replace(/\/$/, "") + "/sync?k=" + encodeURIComponent(ROW_ID));
    if (!res.ok) throw new Error("HTTP " + res.status);
    var j = await res.json();
    return { data: j.data || null, updated_at: j.updated_at || null };
  }

  /* ---------- 启动加载 ---------- */

  function readLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
      var legacy = localStorage.getItem(LS_KEY_LEGACY);
      if (legacy) return JSON.parse(legacy);
    } catch (e) {}
    return null;
  }

  async function load() {
    if (cloudEnabled()) {
      try {
        var remote = await readRemote();
        lastSeenRemoteAt = remote.updated_at;
        writeAllowed = true;              // 只有走到这里才解锁云端写入
        if (remote.data) {
          try { localStorage.setItem(LS_KEY, JSON.stringify(remote.data)); } catch (e) {}
          return { state: remote.data, src: "cloud" };
        }
        // 云端可读但还没有数据 —— 允许把本地数据作为首份数据推上去
        return { state: readLocal(), src: "cloud-empty" };
      } catch (e) {
        writeAllowed = false;
        emit({ kind: "readonly", message: e.message });
        return { state: readLocal(), src: "local-readonly", error: e.message };
      }
    }
    return { state: readLocal(), src: "local" };
  }

  /* ---------- 保存 ---------- */

  function save(state) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
    catch (e) { emit({ kind: "local-full", message: "本地存储写入失败，可能空间已满" }); }
    if (!canWriteCloud()) return;
    pendingState = state;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushTimer = null; flush(); }, PUSH_DEBOUNCE);
  }

  async function writeRemote(state, now) {
    if (cfg.type === "supabase") {
      var client = await ensureSupabase();
      var r = await client.from("workbench_state").upsert({ id: ROW_ID, data: state, updated_at: now }, { onConflict: "id" });
      if (r.error) throw new Error(r.error.message);
      return;
    }
    if (cfg.type === "github") {
      var id = await ensureGist();
      var files = {};
      files[GIST_FILE] = { content: JSON.stringify({ data: state, updated_at: now }, null, 2) };
      await api("PATCH", API + "/gists/" + id, { files: files }, cfg.token);
      return;
    }
    var res = await fetch(cfg.url.replace(/\/$/, "") + "/sync?k=" + encodeURIComponent(ROW_ID), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: state, updated_at: now })
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
  }

  async function flush() {
    if (!canWriteCloud() || !pendingState) return;
    var state = pendingState;
    pendingState = null;
    emit({ kind: "pushing" });
    try {
      // 冲突检测：推之前看一眼云端有没有被别的设备改过
      var remote = await readRemote();
      if (lastSeenRemoteAt && remote.updated_at && remote.updated_at !== lastSeenRemoteAt) {
        writeAllowed = false;
        emit({ kind: "conflict", remoteAt: remote.updated_at, localAt: lastSeenRemoteAt });
        return;
      }
      var now = new Date().toISOString();
      await writeRemote(state, now);
      lastSeenRemoteAt = now;
      emit({ kind: "pushed", at: now });
    } catch (e) {
      emit({ kind: "push-failed", message: e.message });
    }
  }

  /* ---------- 手动操作 ---------- */

  async function pull() {
    if (!cloudEnabled()) throw new Error("还没连接云端");
    var remote = await readRemote();
    lastSeenRemoteAt = remote.updated_at;
    writeAllowed = true;
    if (remote.data) { try { localStorage.setItem(LS_KEY, JSON.stringify(remote.data)); } catch (e) {} }
    return remote.data;
  }

  // 冲突或只读之后，用户明确选择「以本设备为准」时才调用
  async function forcePush(state) {
    if (!cloudEnabled()) throw new Error("还没连接云端");
    var now = new Date().toISOString();
    await writeRemote(state, now);
    lastSeenRemoteAt = now;
    writeAllowed = true;
    emit({ kind: "pushed", at: now, forced: true });
  }

  async function connect(newCfg, state) {
    saveCfg(newCfg);
    writeAllowed = false;
    lastSeenRemoteAt = null;
    var remote = await readRemote();       // 失败会抛出，由 UI 显示原因
    lastSeenRemoteAt = remote.updated_at;
    writeAllowed = true;
    if (remote.data) return { mode: "adopted", state: remote.data };
    await forcePush(state);
    return { mode: "seeded", state: state };
  }

  async function getGistId() {
    if (!cloudEnabled() || cfg.type !== "github") return null;
    return ensureGist();
  }

  function status() {
    return {
      enabled: cloudEnabled(),
      writable: canWriteCloud(),
      type: cfg.type,
      remember: !!cfg.remember,
      gistId: cfg.gistId || null,
      lastSeenRemoteAt: lastSeenRemoteAt
    };
  }

  // 关页面 / 切后台前，尽量把没推完的改动推出去
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && pendingState) {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = null;
      flush();
    }
  });

  return {
    LS_KEY: LS_KEY, GIST_DESC: GIST_DESC,
    getCfg: getCfg, saveCfg: saveCfg, clearCreds: clearCreds,
    cloudEnabled: cloudEnabled, canWriteCloud: canWriteCloud,
    load: load, save: save, flush: flush, pull: pull, forcePush: forcePush,
    connect: connect, getGistId: getGistId, status: status, on: on
  };
})();
