/*
 * sync.js — 同步层（真·永久方案）
 * 三种后端，按 cfg.type 切换：
 *  - github  (默认): GitHub Gist。永久免费、不依赖本机开机，电脑/iPhone/iPad 三端同步。只需一个带 gist 权限的 PAT。
 *  - supabase: 可选，适合不想用 GitHub 的用户。
 *  - self    : 自托管后端（WorkBuddy 隧道），兼容旧配置。
 * 单用户工作台：固定 ROW_ID。读取云端优先，失败/未配置回退 localStorage。
 * 凭证（PAT / Supabase key）只存本机浏览器，不发给任何第三方。
 */
window.Sync = (function () {
  const LS_KEY = "xhs_video_workbench_v3";
  const CFG_KEY = "xhs_sync_cfg";
  const ROW_ID = "macro-xhs-single";
  const GIST_DESC = "xhs-workbench-state (do not delete)";
  const GIST_FILE = "state.json";
  const HOT_FILE = "hotspots.json";   // 每日热点单独存一个文件，避免覆盖用户数据
  const API = "https://api.github.com";

  function loadCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY) || "null"); } catch (e) { return null; } }
  function saveCfg(c) { cfg = c || {}; try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} }
  function getCfg() { return cfg; }
  function cloudEnabled() {
    if (!cfg || !cfg.type || cfg.type === "github") return !!(cfg && cfg.token);
    return !!(cfg.url);
  }

  let cfg = loadCfg() || { type: "github" };

  async function api(method, url, body, token) {
    const headers = { "Content-Type": "application/json", "Accept": "application/vnd.github+json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).message || ""; } catch (e) {}
      throw new Error("HTTP " + res.status + (detail ? " " + detail : ""));
    }
    if (res.status === 204) return {};
    return res.json();
  }

  // 找到（或创建）工作台专属 Gist，返回其 id
  async function ensureGist() {
    if (cfg.gistId) return cfg.gistId;
    // 已存在则按描述自动查找，其它设备无需手动抄 ID
    try {
      const list = await api("GET", API + "/gists?per_page=100", null, cfg.token);
      const found = (list || []).find(g => g.description === GIST_DESC);
      if (found) { cfg.gistId = found.id; saveCfg(cfg); return cfg.gistId; }
    } catch (e) { /* 忽略，走下面的创建 */ }
    const created = await api("POST", API + "/gists",
      { description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: JSON.stringify({ data: null, updated_at: new Date().toISOString() }) } } },
      cfg.token);
    cfg.gistId = created.id; saveCfg(cfg);
    return cfg.gistId;
  }

  async function load() {
    if (cloudEnabled()) {
      try {
        if (cfg.type === "supabase") {
          if (!/supabase\.co$/i.test(cfg.url)) throw new Error("非 supabase 地址");
          const client = await ensureSupabase();
          if (client) {
            const { data, error } = await client.from("workbench_state").select("data").eq("id", ROW_ID).maybeSingle();
            if (!error && data && data.data) return { state: data.data, src: "cloud" };
          }
        } else if (cfg.type === "github") {
          const id = await ensureGist();
          const g = await api("GET", API + "/gists/" + id, null, cfg.token);
          const c = g.files && g.files[GIST_FILE] && g.files[GIST_FILE].content;
          if (c) { const p = JSON.parse(c); if (p.data) return { state: p.data, src: "cloud" }; }
        } else if (cfg.url) {
          const r = await fetch(cfg.url.replace(/\/$/, "") + "/sync?k=" + encodeURIComponent(ROW_ID));
          if (r.ok) { const j = await r.json(); if (j.data) return { state: j.data, src: "cloud" }; }
        }
      } catch (e) { console.warn("[Sync] 云端读取失败，回退本地：", e.message); }
    }
    let st = null;
    try { st = localStorage.getItem(LS_KEY) ? JSON.parse(localStorage.getItem(LS_KEY)) : null; } catch (e) {}
    return { state: st, src: "local" };
  }

  function save(state) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
    if (!cloudEnabled()) return;
    if (cfg.type === "supabase") {
      ensureSupabase().then(client => {
        if (!client) return;
        client.from("workbench_state").upsert({ id: ROW_ID, data: state, updated_at: new Date().toISOString() }, { onConflict: "id" })
          .then(({ error }) => { if (error) console.warn("[Sync] 云端推送失败：", error.message); });
      }).catch(e => console.warn("[Sync] 推送异常：", e));
    } else if (cfg.type === "github") {
      ensureGist().then(id => api("PATCH", API + "/gists/" + id,
        { files: { [GIST_FILE]: { content: JSON.stringify({ data: state, updated_at: new Date().toISOString() }) } } }, cfg.token))
        .catch(e => console.warn("[Sync] Gist 推送失败：", e.message));
    } else if (cfg.url) {
      fetch(cfg.url.replace(/\/$/, "") + "/sync?k=" + encodeURIComponent(ROW_ID),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) })
        .catch(e => console.warn("[Sync] 推送失败：", e));
    }
  }

  async function pull() {
    if (!cloudEnabled()) return null;
    try {
      if (cfg.type === "supabase") {
        const client = await ensureSupabase();
        if (client) {
          const { data, error } = await client.from("workbench_state").select("data").eq("id", ROW_ID).maybeSingle();
          if (!error && data && data.data) { try { localStorage.setItem(LS_KEY, JSON.stringify(data.data)); } catch (e) {} return data.data; }
        }
      } else if (cfg.type === "github") {
        const id = await ensureGist();
        const g = await api("GET", API + "/gists/" + id, null, cfg.token);
        const c = g.files && g.files[GIST_FILE] && g.files[GIST_FILE].content;
        if (c) { const p = JSON.parse(c); if (p.data) { try { localStorage.setItem(LS_KEY, JSON.stringify(p.data)); } catch (e) {} return p.data; } }
      } else if (cfg.url) {
        const r = await fetch(cfg.url.replace(/\/$/, "") + "/sync?k=" + encodeURIComponent(ROW_ID));
        if (r.ok) { const j = await r.json(); if (j.data) { try { localStorage.setItem(LS_KEY, JSON.stringify(j.data)); } catch (e) {} return j.data; } }
      }
    } catch (e) { console.warn("[Sync] 拉取失败：", e.message); }
    return null;
  }

  let sb = null;
  async function ensureSupabase() {
    if (sb) return sb;
    try {
      if (!window.supabase || !window.supabase.createClient) {
        const m = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
        window.supabase = { createClient: m.createClient };
      }
      sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
      return sb;
    } catch (e) { console.warn("[Sync] supabase 加载失败：", e); return null; }
  }

  // 给 UI 用：返回当前已确保的 Gist id（其它设备可据此确认同一份数据）
  async function getGistId() {
    if (!cloudEnabled() || cfg.type !== "github") return null;
    return ensureGist();
  }

  // 读取每日热点（独立文件，不干扰用户数据）。无 token / 离线时返回 null，由调用方回退本地快照。
  async function loadHotspots() {
    if (!cloudEnabled() || cfg.type !== "github" || !cfg.token) return null;
    try {
      const id = await ensureGist();
      const g = await api("GET", API + "/gists/" + id, null, cfg.token);
      const c = g.files && g.files[HOT_FILE] && g.files[HOT_FILE].content;
      if (c) { const arr = JSON.parse(c); if (Array.isArray(arr)) return arr; }
    } catch (e) { console.warn("[Sync] 热点读取失败，回退本地：", e.message); }
    return null;
  }

  // 写入每日热点（只更新 hotspots.json 一个文件，不动 state.json）
  async function saveHotspots(arr) {
    if (!cloudEnabled() || cfg.type !== "github" || !cfg.token) return false;
    try {
      const id = await ensureGist();
      await api("PATCH", API + "/gists/" + id,
        { files: { [HOT_FILE]: { content: JSON.stringify(arr, null, 2) } } }, cfg.token);
      return true;
    } catch (e) { console.warn("[Sync] 热点写入失败：", e.message); return false; }
  }

  return { getCfg, saveCfg, cloudEnabled, load, save, pull, getGistId, loadHotspots, saveHotspots, GIST_DESC };
})();
