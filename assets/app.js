(function () {
  "use strict";
  const KEY = "xhs_video_workbench_v3";
  const S = window.SEED;
  // 每日自动化抓取的 hotspots.js 优先覆盖内置热点
  if (window.HOTSPOT_DATA && window.HOTSPOT_DATA.days && window.HOTSPOT_DATA.days[0] && window.HOTSPOT_DATA.days[0].items) {
    S.hotspots = window.HOTSPOT_DATA.days[0].items;
  }

  // 流水线 6 阶段（视频博主核心工作流）
  const IC = 'viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const STAGES = [
    { key: "pool", name: "灵感池", color: "#A0A0A8", icon: '<svg ' + IC + '><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.6 1 1.2 1 2.5h6c0-1.3.3-1.9 1-2.5A6 6 0 0 0 12 3Z"/></svg>' },
    { key: "script", name: "写脚本", color: "#E8A33D", icon: '<svg ' + IC + '><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' },
    { key: "shoot", name: "拍摄", color: "#3A7AFE", icon: '<svg ' + IC + '><path d="M3 7h3l2-2h4l2 2h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="11.5" cy="13" r="3.2"/></svg>' },
    { key: "edit", name: "剪辑", color: "#8B5CF6", icon: '<svg ' + IC + '><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><path d="M8 7.5 20 18M8 16.5 20 6"/></svg>' },
    { key: "published", name: "已发布", color: "#1FA971", icon: '<svg ' + IC + '><path d="M4.5 16.5c-1.5 1.5-2 4-2 4s2.5-.5 4-2M9 15l8-8 2 2-8 8-3-3Z"/><path d="M14 6l2 2"/></svg>' },
    { key: "review", name: "复盘", color: "#FF2442", icon: '<svg ' + IC + '><path d="M4 20V4M4 20h16M8.5 16v-5M12.5 16V8M16.5 16v-9"/></svg>' }
  ];

  let state = defaultState();
  let liveHotspots = null;   // 云端 Gist 的每日热点；无 token / 离线时为 null，回退本地快照

  function defaultState() {
    return {
      ideas: clone(S.seedIdeas),
      reviews: [],
      deals: [],
      profile: clone(S.profile)
    };
  }
  function save() { Sync.save(state); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // 热点来源：云端优先，无则回退内置/本地快照
  function getHotspots() {
    return (liveHotspots && liveHotspots.length) ? liveHotspots : (S.hotspots || []);
  }
  // 热点来源角标：云端实时 / 本地快照
  function updateHotSrc() {
    const el = $("#hot-src"); if (!el) return;
    if (liveHotspots && liveHotspots.length) {
      el.hidden = false;
      el.textContent = "● 云端实时";
      el.className = "hot-src live";
    } else {
      el.hidden = false;
      el.textContent = "○ 本地快照";
      el.className = "hot-src local";
    }
  }
  function $(s, r) { return (r || document).querySelector(s); }
  function uid() { return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---------- 渲染：顶部数据条 ----------
  function renderStats() {
    const pub = state.ideas.filter(i => i.stage === "published" || i.stage === "review").length;
    const reviewed = state.reviews.length;
    const todo = Math.max(0, pub - reviewed);
    const fansNow = state.profile.startFans;
    const goal = state.profile.goalFans;
    const pct = Math.min(100, Math.round((fansNow / goal) * 100));
    $("#st-fans").innerHTML = '<b class="red">' + fansNow + '</b><span>粉丝 / 目标 ' + goal + '</span>';
    $("#st-week").innerHTML = '<b>' + pub + '</b><span>已发布视频</span>';
    $("#st-review").innerHTML = '<b style="color:' + (todo ? '#FF2442' : '#1FA971') + '">' + todo + '</b><span>待复盘</span>';
    $("#st-pipe").innerHTML = '<b>' + state.ideas.filter(i => ["script","shoot","edit"].includes(i.stage)).length + '</b><span>制作中</span>';
    const pgyOk = fansNow >= 1000;
    $("#st-biz").innerHTML = '<b class="' + (pgyOk ? "green" : "red") + '">' + (pgyOk ? "可接单" : "涨粉中") + '</b><span>蒲公英 ' + (pgyOk ? "已达标" : "差 " + (1000 - fansNow)) + "</span>";
    $("#fans-bar i").style.width = pct + "%";
    $("#kpi-fans").textContent = fansNow;
    $("#kpi-fans-sub").textContent = "已 " + pct + "% · 目标 " + goal + " 粉（开蒲公英接商单）";
  }

  // ---------- 渲染：今日聚焦 ----------
  function renderFocus() {
    const ul = $("#focus-list");
    const tips = [];
    const pool = state.ideas.filter(i => i.stage === "pool");
    const script = state.ideas.filter(i => i.stage === "script");
    const shoot = state.ideas.filter(i => i.stage === "shoot");
    const edit = state.ideas.filter(i => i.stage === "edit");
    const published = state.ideas.filter(i => i.stage === "published");
    const reviewedIds = state.reviews.map(r => r.ideaId);
    const needReview = published.filter(i => !reviewedIds.includes(i.id));

    if (script.length) tips.push("《" + script[0].title + "》脚本进行中，今天把它收尾");
    if (shoot.length) tips.push("《" + shoot[0].title + "》待拍摄，排一下今天机位/场景");
    if (edit.length) tips.push("《" + edit[0].title + "》剪辑中，先剪完前 3 秒钩子");
    if (pool.length) tips.push("灵感池有 " + pool.length + " 个，挑 1 个今天写脚本");
    needReview.forEach(i => tips.push("《" + i.title + "》已发布，记得复盘数据"));
    if (!tips.length) tips.push("流水线空了，去热点雷达捞一条二创选题吧");

    ul.innerHTML = tips.map(t => '<li><span class="ic">→</span><span>' + esc(t) + "</span></li>").join("");
  }

  // ---------- 渲染：看板 ----------
  let dragId = null;
  function renderBoard() {
    const board = $("#board");
    board.innerHTML = "";
    STAGES.forEach(st => {
      const items = state.ideas.filter(i => i.stage === st.key);
      const col = document.createElement("div");
      col.className = "col";
      col.dataset.stage = st.key;
      col.innerHTML =
        '<div class="col-head"><div class="name"><span class="stage-ic" style="color:' + st.color + '">' + st.icon + '</span>' + st.name + '</div><span class="count">' + items.length + "</span></div>";
      items.forEach((it, idx) => { const el = ticket(it); el.style.animationDelay = (idx * 0.045) + "s"; col.appendChild(el); });
      // 空列也能接收拖拽
      col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("drag-over"); });
      col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
      col.addEventListener("drop", e => {
        e.preventDefault(); col.classList.remove("drag-over");
        if (dragId) moveStage(dragId, st.key);
      });
      board.appendChild(col);
    });
  }

  function ticket(it) {
    const el = document.createElement("div");
    el.className = "ticket";
    el.draggable = true;
    el.dataset.id = it.id;
    const pfs = (it.platform || []).map(p =>
      '<span class="pf ' + p + '">' + (p === "xhs" ? "小红书" : "抖音") + "</span>").join("");
    const sc = it.script || {};
    const sblks = [it.hook, sc.pain, sc.steps, sc.end].filter(Boolean);
    const scriptChip = sblks.length === 4 ? '<span class="chip tag">脚本·终稿</span>'
      : sblks.length > 0 ? '<span class="chip">脚本·草稿</span>' : "";
    el.innerHTML =
      '<div class="tt">' + esc(it.title) + "</div>" +
      (it.hook ? '<div class="hook">⏱ ' + esc(it.hook) + "</div>" : "") +
      '<div class="meta"><span class="chip tag">' + esc(it.tag || "AI") + "</span>" + pfs +
      scriptChip + (it.due ? '<span class="due">' + esc(it.due.slice(5)) + "</span>" : "") + "</div>" +
      '<div class="acts"><button data-act="edit">编辑</button><button data-act="del">删除</button></div>';
    el.addEventListener("dragstart", () => { dragId = it.id; el.classList.add("dragging"); });
    el.addEventListener("dragend", () => { dragId = null; el.classList.remove("dragging"); });
    el.querySelector('[data-act="edit"]').onclick = e => { e.stopPropagation(); openModal(it.id); };
    el.querySelector('[data-act="del"]').onclick = e => {
      e.stopPropagation();
      if (confirm("删除《" + it.title + "》？")) { state.ideas = state.ideas.filter(x => x.id !== it.id); save(); refresh(); }
    };
    return el;
  }

  function moveStage(id, stage) {
    const it = state.ideas.find(x => x.id === id);
    if (it && it.stage !== stage) { it.stage = stage; save(); refresh(); }
  }

  // ---------- 热点 ----------
  function renderHotspots() {
    const HS = getHotspots();
    // 每日自动化热点可能无 id，补一个稳定 id
    HS.forEach((h, i) => { if (h.id == null) h.id = "auto" + i; });
    const wrap = $("#hot-grid");
    wrap.innerHTML = HS.map(h => {
      const hid = "hot_" + h.id;
      const added = state.hotAdded && state.hotAdded.includes(hid);
      return '<div class="hot">' +
        '<div class="htop"><span class="ptag">' + esc(h.platform) + '</span><span class="heat ' + h.heat + '">' + h.heat + "热度</span></div>" +
        "<h4>" + esc(h.title) + "</h4>" +
        '<div class="row"><b>为什么火：</b>' + esc(h.why) + "</div>" +
        '<div class="row"><b>你的二创角度：</b>' + esc(h.angle) + "</div>" +
        '<div class="tip">🛡 ' + esc(h.tip) + "</div>" +
        '<button class="btn" data-hot="' + h.id + '" ' + (added ? "disabled style='opacity:.5'" : "") + ">" + (added ? "已加入灵感池" : "+ 加入灵感池") + "</button>" +
        "</div>";
    }).join("");
    wrap.querySelectorAll("[data-hot]").forEach(b => {
      b.onclick = () => {
        const h = HS.find(x => String(x.id) === String(b.dataset.hot));
        if (!h) return;
        state.ideas.unshift({
          id: uid(), title: h.angle.split("》——")[0].replace("《", "") || h.title,
          hook: "", cover: "", platform: ["xhs"], tag: "AI实操", stage: "pool", due: "", note: "来自热点：" + h.title
        });
        state.hotAdded = state.hotAdded || [];
        state.hotAdded.push("hot_" + h.id);
        save(); refresh();
        b.textContent = "已加入灵感池"; b.disabled = true; b.style.opacity = ".5";
      };
    });
  }

  // ---------- 对标博主 ----------
  function renderRivals() {
    const wrap = $("#rival-grid");
    wrap.innerHTML = S.rivals.map(r =>
      '<div class="rival">' +
      '<div class="rname">' + esc(r.name) + ' <span class="rtag">' + esc(r.tag) + "</span></div>" +
      '<div class="rrow"><b>为什么火：</b>' + esc(r.why) + "</div>" +
      '<div class="rrow"><b>钩子：</b>' + esc(r.hook) + "</div>" +
      '<div class="rrow"><b>你该学：</b>' + esc(r.learn) + "</div>" +
      '<div class="links"><a href="' + r.xhs + '" target="_blank" rel="noopener">小红书 ↗</a><a href="' + r.dy + '" target="_blank" rel="noopener">抖音 ↗</a></div>' +
      "</div>"
    ).join("");
  }

  // ---------- 复盘 ----------
  function renderReviewForm() {
    const sel = $("#rv-idea");
    const pub = state.ideas.filter(i => i.stage === "published" || i.stage === "review");
    sel.innerHTML = '<option value="">选择已发布视频…</option>' +
      pub.map(i => '<option value="' + i.id + '">' + esc(i.title) + "</option>").join("");
  }

  function renderReviews() {
    const wrap = $("#review-list");
    if (!state.reviews.length) {
      wrap.innerHTML = '<div class="empty-note">还没有复盘记录。发布视频后，在左侧填入数据自动诊断。</div>';
      return;
    }
    wrap.innerHTML = state.reviews.slice().reverse().map(r => {
      const it = state.ideas.find(i => i.id === r.ideaId);
      const diags = diagnose(r);
      return '<div class="rv">' +
        '<div class="rvtop"><b>' + esc(it ? it.title : r.ideaId) + '</b><span class="dt">' + r.date + "</span></div>" +
        (r.scriptSnap && r.scriptSnap.hook ? '<div class="rv-snap">当时钩子：' + esc(r.scriptSnap.hook) + (r.scriptSnap.cover ? " · 封面：" + esc(r.scriptSnap.cover) : "") + "</div>" : "") +
        '<div class="metrics">' +
        metric("播放", r.play) + metric("2秒留存", r.ret2 + "%") + metric("完播", r.finish + "%") +
        metric("赞", r.like) + metric("藏", r.save) + metric("评", r.comment) + metric("涨粉", "+" + r.follow) +
        "</div>" +
        '<div class="diag">' + diags.map(d => '<div class="d ' + (d.good ? "good" : "warn") + '"><b>' + (d.good ? "✓ " : "⚠ ") + esc(d.t) + "：</b>" + esc(d.a) + "</div>").join("") + "</div>" +
        "</div>";
    }).join("");

    // 留存对比图
    const chart = $("#ret-chart");
    chart.innerHTML = '<div class="section-sub" style="margin:14px 0 4px">各视频留存对比（2秒 / 完播）</div><div class="chart">' +
      state.reviews.map(r => {
        const it = state.ideas.find(i => i.id === r.ideaId);
        const nm = it ? it.title : r.ideaId;
        return '<div class="cr"><span class="cl">' + esc(nm.slice(0, 10)) + '</span>' +
          '<span class="ct"><i style="width:' + r.ret2 + '%"></i></span><span class="cv">' + r.ret2 + "%</span></div>" +
          '<div class="cr"><span class="cl" style="color:var(--ink-3)">└ 完播</span>' +
          '<span class="ct"><i style="width:' + r.finish + '%;background:var(--red)"></i></span><span class="cv">' + r.finish + "%</span></div>";
      }).join("") + "</div>";
  }

  function metric(l, v) { return '<div class="metric"><b>' + (v == null ? "-" : v) + "</b><span>" + l + "</span></div>"; }

  function diagnose(r) {
    const play = Number(r.play) || 1;
    const ret2 = Number(r.ret2) || 0;
    const finish = Number(r.finish) || 0;
    const likeRate = (Number(r.like) + Number(r.save)) / play;
    const followRate = (Number(r.follow) || 0) / play * 100;
    const out = [];
    if (ret2 < 40) out.push({ t: "前3秒钩子弱", a: "2秒留存仅 " + ret2 + "%，开头没留住人。下次把最强反差/结果放第1秒，钩子前置。" });
    else out.push({ t: "钩子合格", a: "2秒留存 " + ret2 + "%，开头稳。", good: true });
    if (finish < 15) out.push({ t: "完播率偏低", a: "完播 " + finish + "%，中段可能拖沓。砍掉铺垫、每15秒给一个信息点。" });
    else out.push({ t: "节奏不错", a: "完播 " + finish + "%，内容密度在线。", good: true });
    if (likeRate < 0.05) out.push({ t: "内容价值感不足", a: "赞藏率仅 " + (likeRate * 100).toFixed(1) + "%。加可收藏的「清单/模板」，提升保存欲。" });
    if (followRate < 0.5) out.push({ t: "关注钩子弱", a: "转粉率 " + followRate.toFixed(2) + "%。结尾加「关注看下期实测」+ 人设锚点。" });
    else out.push({ t: "人设吸粉", a: "转粉率 " + followRate.toFixed(2) + "%，关注欲强。", good: true });
    return out;
  }

  function submitReview(e) {
    e.preventDefault();
    const ideaId = $("#rv-idea").value;
    if (!ideaId) { alert("请选择已发布视频"); return; }
    const r = {
      ideaId, date: new Date().toISOString().slice(0, 10),
      play: $("#rv-play").value, ret2: $("#rv-ret2").value, finish: $("#rv-finish").value,
      like: $("#rv-like").value, save: $("#rv-save").value, comment: $("#rv-comment").value, follow: $("#rv-follow").value
    };
    const it = state.ideas.find(i => i.id === ideaId);
    r.scriptSnap = it ? { hook: it.hook || "", cover: it.cover || "", script: it.script || {} } : null;
    state.reviews.push(r);
    if (it && it.stage !== "review") it.stage = "review";
    save(); renderReviews(); renderStats(); renderFocus(); renderCadence(); renderBiz(); renderReviewForm();
    e.target.reset();
    $("#rv-script").className = "script-recall"; $("#rv-script").innerHTML = "";
  }

  // ---------- 弹窗（新建 / 编辑） ----------
  function openModal(id) {
    const m = $("#modal");
    const isEdit = !!id;
    const it = isEdit ? state.ideas.find(i => i.id === id) : null;
    $("#m-title").value = it ? it.title : "";
    $("#m-hook").value = it ? (it.hook || "") : "";
    const sc = it && it.script ? it.script : {};
    $("#m-pain").value = sc.pain || "";
    $("#m-steps").value = sc.steps || "";
    $("#m-end").value = sc.end || "";
    $("#m-cover").value = it ? (it.cover || "") : "";
    updateCompliance();
    $("#m-tag").value = it ? (it.tag || "AI实操") : "AI实操";
    $("#m-due").value = it ? (it.due || "") : "";
    $("#m-stage").value = it ? it.stage : "pool";
    const pfs = it ? (it.platform || ["xhs"]) : ["xhs"];
    document.querySelectorAll("#m-pf input").forEach(c => { c.checked = pfs.includes(c.value); });
    $("#m-del").style.display = isEdit ? "inline-block" : "none";
    m.dataset.id = id || "";
    m.classList.add("open");
    $("#m-title").focus();
  }
  function closeModal() { $("#modal").classList.remove("open"); }

  function saveModal() {
    const id = $("#modal").dataset.id;
    const pfs = Array.from(document.querySelectorAll("#m-pf input:checked")).map(c => c.value);
    const data = {
      title: $("#m-title").value.trim() || "未命名选题",
      hook: $("#m-hook").value.trim(),
      cover: $("#m-cover").value.trim(),
      tag: $("#m-tag").value.trim() || "AI",
      due: $("#m-due").value,
      stage: $("#m-stage").value,
      platform: pfs.length ? pfs : ["xhs"],
      script: {
        pain: $("#m-pain").value.trim(),
        steps: $("#m-steps").value.trim(),
        end: $("#m-end").value.trim()
      }
    };
    if (id) {
      const it = state.ideas.find(i => i.id === id);
      Object.assign(it, data);
    } else {
      state.ideas.unshift(Object.assign({ id: uid(), note: "" }, data));
    }
    save(); closeModal(); refresh();
  }
  function delModal() {
    const id = $("#modal").dataset.id;
    if (id && confirm("确认删除？")) {
      state.ideas = state.ideas.filter(i => i.id !== id);
      save(); closeModal(); refresh();
    }
  }

  // ---------- 工具 ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // 合规预检：检测海外AI/社交平台敏感词，给替换建议
  const SENS = [
    { w: "GPT", r: "海外某对话AI" }, { w: "ChatGPT", r: "海外某对话AI" },
    { w: "Claude", r: "C记AI / 海外某对话AI" }, { w: "Anthropic", r: "海外某AI公司" },
    { w: "OpenAI", r: "海外某AI公司" }, { w: "Twitter", r: "海外某社交平台" },
    { w: "推特", r: "海外某社交平台" }, { w: "Midjourney", r: "海外某绘图AI" },
    { w: "Perplexity", r: "海外某搜索AI" }, { w: "Grok", r: "海外某AI" },
    { w: "Poe", r: "海外某AI助手" }, { w: "Gemini", r: "海外某AI" }
  ];
  function checkCompliance(t) {
    if (!t || !t.trim()) return [];
    const hit = {};
    SENS.forEach(s => { if (t.indexOf(s.w) >= 0) hit[s.w] = s.r; });
    if (/\bX\b/.test(t)) hit["X"] = "海外某社交平台";
    let res = Object.keys(hit).map(w => ({ w: w, r: hit[w] }));
    res = res.filter(a => !res.some(b => b.w !== a.w && b.w.indexOf(a.w) >= 0));
    return res;
  }
  function updateCompliance() {
    const el = $("#m-comp"); if (!el) return;
    const t = [$("#m-hook").value, $("#m-pain").value, $("#m-steps").value, $("#m-end").value].join("\n");
    if (!t.trim()) { el.className = "compliance"; el.innerHTML = ""; return; }
    const hits = checkCompliance(t);
    if (!hits.length) { el.className = "compliance show ok"; el.innerHTML = "✓ 未检测到敏感海外词，可放心发"; return; }
    const list = hits.map(h => "「" + h.w + "」→ " + h.r).join("；");
    el.className = "compliance show warn";
    el.innerHTML = "⚠ 建议替换：" + list;
  }

  // ---------- 发布节奏（周频次） ----------
  function fmtDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function startOfWeek(d) {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    const day = (x.getDay() + 6) % 7; // 周一=0
    x.setDate(x.getDate() - day);
    return x;
  }
  function renderCadence() {
    const today = new Date();
    const ws = startOfWeek(today);
    const goal = 3;
    const thisWeek = state.reviews.filter(r => { const d = new Date(r.date); return d >= ws; }).length;
    $("#kpi-week").innerHTML = thisWeek + '<span class="sub-num"> / ' + goal + ' 条</span>';
    const days = ["一", "二", "三", "四", "五", "六", "日"];
    const todayStr = fmtDate(today);
    let bars = "";
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws); d.setDate(d.getDate() + i);
      const cnt = state.reviews.filter(r => r.date === fmtDate(d)).length;
      const h = cnt ? Math.min(100, 18 + cnt * 30) : 4;
      const isToday = fmtDate(d) === todayStr;
      bars += '<span class="wb' + (isToday ? " today" : "") + '"><i style="height:' + h + '%"></i><b>' + days[i] + "</b></span>";
    }
    $("#week-bars").innerHTML = bars;
  }

  // ---------- 商单变现 ----------
  function renderBiz() {
    const fans = Number(state.profile.startFans) || 0;
    const goal = state.profile.goalFans;
    const pct = Math.min(100, Math.round(fans / goal * 100));
    $("#biz-fans-now").textContent = fans;
    $("#biz-prog-i").style.width = pct + "%";
    const pgyOk = fans >= 1000;
    $("#biz-pgy").innerHTML = pgyOk
      ? '✓ 已达蒲公英入驻门槛（≥1000），可开始接商单'
      : '距蒲公英入驻还差 <b>' + (1000 - fans) + "</b> 粉（门槛 1000）";

    const pub = state.reviews.length;
    const avgFinish = pub ? state.reviews.reduce((a, r) => a + (Number(r.finish) || 0), 0) / pub : 0;
    const checks = [
      { t: "粉丝 ≥ 1000（蒲公英门槛）", ok: fans >= 1000 },
      { t: "已发布 ≥ 10 篇作品", ok: pub >= 10 },
      { t: "平均完播率 ≥ 15%", ok: avgFinish >= 15 },
      { t: "人设清晰（陪跑 / 信息差）", ok: true },
      { t: "蒲公英已入驻", ok: fans >= 1000 && state.deals.length > 0 }
    ];
    $("#biz-ready").innerHTML = checks.map(c =>
      '<li class="' + (c.ok ? "ok" : "no") + '"><span class="mk">' + (c.ok ? "✓" : "○") + "</span>" + esc(c.t) + "</li>").join("");

    const top = state.reviews.map(r => {
      const it = state.ideas.find(i => i.id === r.ideaId);
      const fr = (Number(r.follow) || 0) / (Number(r.play) || 1) * 100;
      return { title: it ? it.title : r.ideaId, fr: fr, play: Number(r.play) || 0 };
    }).sort((a, b) => b.fr - a.fr).slice(0, 3);
    $("#biz-port").innerHTML = top.length
      ? top.map(p => '<div class="port"><div class="pt"><b>' + esc(p.title) + '</b></div><div class="pv">转粉 ' + p.fr.toFixed(2) + '% · 播放 ' + p.play.toLocaleString() + "</div></div>").join("")
      : '<div class="empty-note">发布并复盘后，自动捞出转粉率最高的作品集</div>';

    $("#biz-rate").innerHTML = '<tr><th>粉丝档</th><th>图文</th><th>视频</th></tr>' +
      S.bizRates.map(r => '<tr><td>' + esc(r.tier) + "</td><td>" + esc(r.post) + "</td><td>" + esc(r.video) + "</td></tr>").join("");

    renderDeals();
  }
  function renderDeals() {
    const wrap = $("#biz-deals");
    if (!state.deals.length) { wrap.innerHTML = '<div class="empty-note">暂无商单。达到门槛后在这里记录合作</div>'; return; }
    wrap.innerHTML = state.deals.map((d, i) =>
      '<div class="deal"><div class="dl"><b>' + esc(d.brand) + '</b><span>' + esc(d.amount) + " · " + esc(d.status) + '</span></div><button data-del-deal="' + i + '" title="删除">×</button></div>').join("");
    wrap.querySelectorAll("[data-del-deal]").forEach(b => {
      b.onclick = () => { state.deals.splice(Number(b.dataset.delDeal), 1); save(); renderBiz(); };
    });
  }

  // ---------- 闭环：复盘回显脚本 ----------
  function renderScriptRecall(id) {
    const el = $("#rv-script"); if (!el) return;
    if (!id) { el.className = "script-recall"; el.innerHTML = ""; return; }
    const it = state.ideas.find(i => i.id === id);
    if (!it) { el.className = "script-recall"; el.innerHTML = ""; return; }
    const sc = it.script || {};
    const rows = [];
    if (it.hook) rows.push(["钩子", it.hook]);
    if (sc.pain) rows.push(["痛点", sc.pain]);
    if (sc.steps) rows.push(["步骤", sc.steps]);
    if (sc.end) rows.push(["收尾", sc.end]);
    if (it.cover) rows.push(["封面", it.cover]);
    el.className = "script-recall show";
    el.innerHTML = '<div class="sr-h">📝 当时脚本回顾（对照数据找优化点）</div>' +
      (rows.length ? rows.map(r => '<div class="sr-row"><b>' + r[0] + "</b><span>" + esc(r[1]) + "</span></div>").join("")
        : '<div class="sr-row empty">该选题还没写脚本，先去补脚本再复盘</div>');
  }

  function refresh() {
    renderStats(); renderFocus(); renderBoard(); renderHotspots(); updateHotSrc(); renderRivals();
    renderReviewForm(); renderReviews(); renderCadence(); renderBiz();
  }

  // ---------- 云端同步 UI ----------
  function updateSyncUI() {
    const b = $("#btn-sync"); if (!b) return;
    const cfg = Sync.getCfg() || {};
    if (Sync.cloudEnabled()) {
      b.textContent = "☁ 已同步";
      b.classList.add("on");
      b.title = "云端同步：" + (cfg.type === "github" ? "GitHub Gist" : cfg.type === "supabase" ? "Supabase" : "自托管");
    } else {
      b.textContent = "☁ 本地";
      b.classList.remove("on");
      b.title = "云端同步设置";
    }
  }
  function updateSyncStatus(msg, ok) {
    const el = $("#sync-status");
    if (!el) return;
    el.textContent = "状态：" + msg;
    el.className = "sync-status " + (ok ? "ok" : "off");
  }
  function openSync() {
    const cfg = Sync.getCfg() || {};
    const isGh = !cfg.type || cfg.type === "github";
    $("#sync-token").value = isGh ? (cfg.token || "") : "";
    $("#sync-gist").value = (isGh && cfg.gistId) ? cfg.gistId : "";
    $("#gist-row").style.display = (isGh && cfg.gistId) ? "block" : "none";
    $("#sync-url").value = cfg.type === "supabase" ? (cfg.url || "") : "";
    $("#sync-key").value = cfg.type === "supabase" ? (cfg.key || "") : "";
    updateSyncStatus(Sync.cloudEnabled() ? "已连接云端" : "未连接（仅本地保存）", Sync.cloudEnabled());
    $("#sync-modal").classList.add("open");
  }
  function closeSync() { $("#sync-modal").classList.remove("open"); }
  function saveSync() {
    const token = $("#sync-token").value.trim();
    const url = $("#sync-url").value.trim();
    const key = $("#sync-key").value.trim();
    if (url && key) {   // 高级：Supabase 模式
      Sync.saveCfg({ type: "supabase", url: url, key: key });
      updateSyncStatus("已连接 Supabase，正在推送当前数据…", true);
      updateSyncUI();
      Sync.save(state);
      setTimeout(closeSync, 700);
      return;
    }
    if (!token) { alert("填一下 GitHub 令牌（或展开「高级」填 Supabase）"); return; }
    Sync.saveCfg({ type: "github", token: token, gistId: $("#sync-gist").value.trim() || undefined });
    updateSyncStatus("已连接，正在创建/查找 Gist 并推送…", true);
    updateSyncUI();
    Sync.save(state);             // 把现有数据推上云端（内部会自动创建/查找 Gist）
    Sync.getGistId().then(id => {
      if (id) { $("#sync-gist").value = id; $("#gist-row").style.display = "block"; }
    }).catch(e => console.warn(e));
    setTimeout(closeSync, 1000);
  }
  function pullCloud() {
    Sync.pull().then(d => {
      if (d) { state = d; updateSyncStatus("已从云端拉取最新数据", true); }
      else updateSyncStatus("拉取失败（检查网络 / 凭证）", false);
      // 顺带刷新云端热点
      Sync.loadHotspots().then(hs => { liveHotspots = hs; save(); refresh(); }).catch(() => { save(); refresh(); });
    });
  }
  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "xhs-workbench-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importJSON(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (d && d.ideas) { state = d; save(); refresh(); updateSyncStatus("已导入备份", true); }
        else alert("文件格式不对");
      } catch (e) { alert("文件解析失败"); }
    };
    r.readAsText(file);
  }

  // ---------- 事件绑定 ----------
  function bind() {
    document.querySelectorAll("nav button").forEach(b => {
      b.onclick = () => {
        document.querySelectorAll("nav button").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
        $("#view-" + b.dataset.view).classList.add("active");
      };
    });
    $("#btn-new").onclick = () => openModal();
    $("#m-save").onclick = saveModal;
    $("#m-cancel").onclick = closeModal;
    $("#m-del").onclick = delModal;
    $("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
    $("#rv-form").addEventListener("submit", submitReview);
    ["m-hook", "m-pain", "m-steps", "m-end"].forEach(id => { const e = $("#" + id); if (e) e.addEventListener("input", updateCompliance); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

    // 复盘：选视频时回显当时脚本（闭环）
    $("#rv-idea").addEventListener("change", e => renderScriptRecall(e.target.value));
    // 商单：更新粉丝数
    $("#biz-fans-save").onclick = () => {
      const v = Number($("#biz-fans-input").value);
      if (!isNaN(v) && v >= 0) { state.profile.startFans = v; save(); renderStats(); renderBiz(); }
    };
    // 商单：添加商单记录
    $("#biz-deal-add").onclick = () => {
      const brand = $("#biz-brand").value.trim();
      const amount = $("#biz-amount").value.trim();
      const status = $("#biz-status").value;
      if (!brand) { alert("填一下品牌名"); return; }
      state.deals.push({ brand, amount: amount || "—", status });
      save(); renderBiz();
      $("#biz-brand").value = ""; $("#biz-amount").value = "";
    };

    // ---------- 云端同步 ----------
    $("#btn-sync").onclick = openSync;
    $("#sync-cancel").onclick = closeSync;
    $("#sync-save").onclick = saveSync;
    $("#sync-pull").onclick = pullCloud;
    $("#sync-export").onclick = exportJSON;
    $("#sync-import-btn").onclick = () => $("#sync-import").click();
    $("#sync-import").onchange = e => { if (e.target.files[0]) importJSON(e.target.files[0]); };
    $("#sync-modal").addEventListener("click", e => { if (e.target.id === "sync-modal") closeSync(); });
  }

  // ---------- 启动（异步：先拉云端，再渲染） ----------
  async function bootstrap() {
    try {
      const res = await Sync.load();
      if (res.state && res.state.ideas) state = res.state;
    } catch (e) { console.warn("[Boot] load failed, use default", e); }
    // 云端热点（每日自动化写入），失败则回退本地快照
    try { liveHotspots = await Sync.loadHotspots(); } catch (e) { console.warn("[Boot] 热点加载失败：", e); }
    bind();
    refresh();
    updateSyncUI();
    try { Sync.save(state); } catch (e) { console.warn("[Boot] 初始推送失败（离线/未配置）：", e.message); }
  }
  bootstrap();
})();
