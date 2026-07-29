/*
 * app.js — 视频工作台主逻辑（重写版）
 *
 * 相比旧版的主要变化，都写在对应函数上方的注释里。概括：
 *   · 4 阶段看板，手机端改成单列 + 按钮推进（拖拽在移动端 Safari 不触发）
 *   · 一条视频可以多次采集数据，看得出首日冲还是慢热
 *   · 诊断攒够 5 条后跟你自己的中位数比，而不是跟通用阈值比
 *   · 粉丝数存历史，能算涨粉速度和到门槛的天数
 *   · 热点库 / 拆解库可自己增删改
 *   · 删除都可撤销，不再用 alert / confirm
 *   · 所有用户内容走 DOM API 生成，不做字符串拼接
 */
(function () {
  "use strict";

  var C = window.CONFIG;
  var SEED = window.SEED;

  /* =====================================================================
     基础工具
     ===================================================================== */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /*
   * 元素构造器。旧版全站用字符串拼 innerHTML，esc() 又漏掉了单引号，
   * 导入一个构造过的备份 JSON 就可能注入。这里所有用户内容都走 textContent，
   * 从根上不存在这个问题。
   */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "dataset") Object.keys(v).forEach(function (d) { n.dataset[d] = v[d]; });
        else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? "" : String(v));
      });
    }
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return n;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function uid() { return "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* ---- 日期 ---- */
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmtDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return fmtDate(new Date()); }
  function parseDate(s) {
    if (!s) return null;
    var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  // 周一为一周开始
  function startOfWeek(d) {
    var x = new Date(d); x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
  function hourOf(iso) {
    if (!iso) return null;
    var m = String(iso).match(/T(\d{2}):/);
    return m ? Number(m[1]) : null;
  }
  function bucketOfHour(h) {
    if (h == null) return null;
    for (var i = 0; i < C.hourBuckets.length; i++) {
      var b = C.hourBuckets[i];
      if (b.from < b.to) { if (h >= b.from && h < b.to) return b.key; }
      else if (h >= b.from || h < b.to) return b.key;   // 跨零点
    }
    return null;
  }

  /* ---- 数学 ---- */
  function median(arr) {
    var a = arr.filter(function (x) { return isFinite(x); }).slice().sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function mean(arr) {
    var a = arr.filter(function (x) { return isFinite(x); });
    return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null;
  }
  function round(n, p) { var f = Math.pow(10, p || 0); return Math.round(n * f) / f; }

  /* =====================================================================
     Toast —— 替掉 alert / confirm，删除一律可撤销
     ===================================================================== */

  function toast(msg, opts) {
    opts = opts || {};
    var box = $("#toasts");
    var node = el("div", { class: "toast" + (opts.tone === "bad" ? " bad" : "") }, [
      el("span", { class: "msg", text: msg })
    ]);
    var timer;
    function kill() { clearTimeout(timer); if (node.parentNode) node.parentNode.removeChild(node); }
    if (opts.action) {
      node.appendChild(el("button", {
        type: "button", text: opts.action,
        onclick: function () { kill(); opts.onAction && opts.onAction(); }
      }));
    }
    node.appendChild(el("button", { type: "button", text: "✕", "aria-label": "关闭", onclick: kill }));
    box.appendChild(node);
    timer = setTimeout(kill, opts.timeout || (opts.action ? 7000 : 3200));
    return kill;
  }

  /* =====================================================================
     弹窗管理：焦点陷阱 + Esc 关闭最上层 + 关闭后焦点归位
     旧版 Esc 只关得掉选题弹窗，同步弹窗关不掉，也没有焦点管理
     ===================================================================== */

  var modalStack = [];
  function openModal(id, onClose) {
    var m = document.getElementById(id);
    if (!m) return;
    modalStack.push({ el: m, prev: document.activeElement, onClose: onClose });
    m.classList.add("open");
    var first = m.querySelector("input:not([type=hidden]),select,textarea,button");
    if (first) setTimeout(function () { first.focus(); }, 30);
  }
  function closeModal(m) {
    var top = modalStack[modalStack.length - 1];
    if (!top) return;
    if (m && top.el !== m) {
      var idx = modalStack.findIndex(function (x) { return x.el === m; });
      if (idx < 0) return;
      top = modalStack.splice(idx, 1)[0];
    } else {
      modalStack.pop();
    }
    top.el.classList.remove("open");
    top.onClose && top.onClose();
    if (top.prev && top.prev.focus) top.prev.focus();
  }
  function closeTop() { if (modalStack.length) closeModal(); }

  document.addEventListener("keydown", function (e) {
    if (!modalStack.length) return;
    if (e.key === "Escape") { e.preventDefault(); closeTop(); return; }
    if (e.key !== "Tab") return;
    var m = modalStack[modalStack.length - 1].el;
    var f = $$("a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])", m)
      .filter(function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.matches && t.matches("[data-close]")) { closeModal(t.closest(".modal-bg")); return; }
    if (t.classList && t.classList.contains("modal-bg")) closeModal(t);
  });

  /*
   * iOS 的软键盘不会改变 vh，所以弹窗里靠下的输入框会被键盘直接盖住，
   * 你打字时看不见自己在打什么 —— iPad 横屏（高度只有 744–1024）最明显。
   * 聚焦时把它滚到可视区中间；延迟一点是等键盘弹出动画结束，否则位置算错。
   */
  document.addEventListener("focusin", function (e) {
    if (!modalStack.length) return;
    var t = e.target;
    if (!t.closest || !t.closest(".modal-body")) return;
    setTimeout(function () {
      try { t.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (err) {}
    }, 250);
  });

  /* =====================================================================
     状态
     ===================================================================== */

  var state = blankState();
  var readonlyCloud = false;
  var dirty = false;          // 本次会话里你有没有改过东西，云端对账时用来判断能不能直接覆盖

  function blankState() {
    return {
      v: C.version,
      profile: { name: "宏的AI陪跑", platform: "小红书视频号", fansNow: 0 },
      fansHistory: [],
      ideas: [],
      reviews: [],
      deals: [],
      hotspots: [],
      rivals: [],
      ready: { pgyJoined: false, personaClear: false },
      ui: {},
      meta: { initialized: false, createdAt: new Date().toISOString() }
    };
  }

  /*
   * 归一化 / 迁移。
   * 虽然这次是从空白开始，但你手机、iPad 的浏览器里可能还留着旧版 localStorage，
   * 少了这一层就会在别的设备上白屏。旧的 6 阶段映射到新的 4 阶段。
   */
  function normalize(raw) {
    var s = Object.assign(blankState(), raw || {});
    s.v = C.version;
    s.profile = Object.assign({ name: "宏的AI陪跑", platform: "小红书视频号", fansNow: 0 }, raw && raw.profile);
    if (raw && raw.profile && raw.profile.startFans != null && s.profile.fansNow === 0) {
      s.profile.fansNow = num(raw.profile.startFans);   // 旧字段名语义是「当前粉丝」，改名后迁过来
    }
    ["fansHistory", "ideas", "reviews", "deals", "hotspots", "rivals"].forEach(function (k) {
      if (!Array.isArray(s[k])) s[k] = [];
    });
    s.ready = Object.assign({ pgyJoined: false, personaClear: false }, raw && raw.ready);
    s.ui = Object.assign({}, raw && raw.ui);
    s.meta = Object.assign({ initialized: false, createdAt: new Date().toISOString() }, raw && raw.meta);
    s.deals = s.deals.map(function (d) {
      return { id: d.id || uid(), brand: String(d.brand || ""), amount: String(d.amount || ""), status: d.status || C.dealStatus[0], at: d.at || today() };
    });

    var stageMap = { pool: "pool", script: "script", shoot: "making", edit: "making", published: "published", review: "published", making: "making" };
    s.ideas = s.ideas.map(function (it) {
      var o = Object.assign({}, it);
      o.id = o.id || uid();
      o.title = String(o.title || "未命名选题");
      o.hook = String(o.hook || "");
      o.hookType = o.hookType || "other";
      o.cover = String(o.cover || "");
      o.note = String(o.note || "");
      o.stage = stageMap[o.stage] || "pool";
      if (o.stage === "making" && !o.subStage) o.subStage = (it.stage === "edit") ? "edit" : "shoot";
      o.platform = Array.isArray(o.platform) && o.platform.length ? o.platform : ["xhs"];
      if (!Array.isArray(o.tags)) o.tags = o.tag ? [String(o.tag)] : [];
      delete o.tag;
      o.script = Object.assign({ pain: "", steps: "", end: "" }, o.script);
      o.links = Object.assign({ material: "", post: "" }, o.links);
      o.due = o.due || "";
      o.publishedAt = o.publishedAt || "";
      o.createdAt = o.createdAt || new Date().toISOString();
      return o;
    });

    s.reviews = s.reviews.map(function (r) {
      var o = Object.assign({}, r);
      o.id = o.id || uid();
      o.at = o.at || o.date || today();     // 旧版只有 date（其实是复盘那天）
      delete o.date;
      ["play", "ret2", "finish", "like", "save", "comment", "follow"].forEach(function (k) { o[k] = num(o[k]); });
      o.snap = o.snap || o.scriptSnap || null;
      delete o.scriptSnap;
      return o;
    }).filter(function (r) { return !!r.ideaId; });

    s.hotspots = s.hotspots.map(function (h) {
      var o = Object.assign({}, h);
      o.id = o.id || uid();
      o.addedAt = o.addedAt || today();
      o.used = !!o.used;
      o.suggestedTitle = o.suggestedTitle || o.title || "";
      return o;
    });
    s.rivals = s.rivals.map(function (r) {
      var o = Object.assign({}, r);
      o.id = o.id || uid();
      o.recordedAt = o.recordedAt || today().slice(0, 7);
      return o;
    });
    s.fansHistory = s.fansHistory
      .filter(function (p) { return p && p.date; })
      .map(function (p) { return { date: p.date, count: num(p.count) }; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    // 没有历史但有当前值时，补一个起点，否则速度算不出来
    if (!s.fansHistory.length && s.profile.fansNow > 0) {
      s.fansHistory.push({ date: today(), count: s.profile.fansNow });
    }
    return s;
  }

  function persist() {
    dirty = true;
    state.meta.updatedAt = new Date().toISOString();
    Sync.save(state);
  }

  /* =====================================================================
     派生数据
     ===================================================================== */

  function ideaById(id) { return state.ideas.find(function (i) { return i.id === id; }); }
  function reviewsOf(id) {
    return state.reviews.filter(function (r) { return r.ideaId === id; })
      .sort(function (a, b) { return a.at < b.at ? -1 : 1; });
  }
  function latestReviewOf(id) { var a = reviewsOf(id); return a.length ? a[a.length - 1] : null; }
  function publishedIdeas() { return state.ideas.filter(function (i) { return i.stage === "published"; }); }
  function needReview() { return publishedIdeas().filter(function (i) { return !latestReviewOf(i.id); }); }

  function publishedThisWeek() {
    var ws = startOfWeek(new Date());
    return state.ideas.filter(function (i) {
      if (!i.publishedAt) return false;
      var d = parseDate(i.publishedAt);
      return d && d >= ws;
    }).length;
  }

  // 每条视频取最近一次采集，用于横向比较
  function latestPerIdea() {
    return state.ideas.map(function (i) {
      var r = latestReviewOf(i.id);
      return r ? { idea: i, r: r } : null;
    }).filter(Boolean);
  }

  function followRate(r) { return num(r.play) ? num(r.follow) / num(r.play) * 100 : 0; }
  function engageRate(r) { return num(r.play) ? (num(r.like) + num(r.save)) / num(r.play) * 100 : 0; }

  function fansSpeed() {
    var h = state.fansHistory;
    if (h.length < 2) return null;
    var last = h[h.length - 1];
    // 取 14 天内最早的一个点作为基准，数据太稀时退回第一个点
    var cutoff = fmtDate(addDays(new Date(), -14));
    var base = h.filter(function (p) { return p.date >= cutoff; })[0] || h[0];
    if (base === last) return null;
    var days = daysBetween(parseDate(base.date), parseDate(last.date));
    if (days <= 0) return null;
    var perDay = (last.count - base.count) / days;
    return { perDay: perDay, days: days, from: base, to: last };
  }

  /* =====================================================================
     诊断
     旧版四个阈值写死（40 / 15 / 5 / 0.5），对谁都一样。
     现在：不足 5 条复盘时用绝对阈值冷启动，攒够之后自动改成跟你自己
     近 10 条的中位数比 —— 「低于你平时」比「低于行业」有用得多。
     ===================================================================== */

  function baseline(excludeReviewId) {
    var rows = latestPerIdea()
      .filter(function (x) { return x.r.id !== excludeReviewId; })
      .sort(function (a, b) { return a.r.at < b.r.at ? 1 : -1; })
      .slice(0, C.diagnose.baselineWindow);
    if (rows.length < C.diagnose.baselineMinSamples) return null;
    return {
      n: rows.length,
      ret2: median(rows.map(function (x) { return num(x.r.ret2); })),
      finish: median(rows.map(function (x) { return num(x.r.finish); })),
      engage: median(rows.map(engageRateOf)),
      follow: median(rows.map(followRateOf))
    };
    function engageRateOf(x) { return engageRate(x.r); }
    function followRateOf(x) { return followRate(x.r); }
  }

  function diagnose(r) {
    var out = [];
    var base = baseline(r.id);
    var ret2 = num(r.ret2), finish = num(r.finish);
    var eng = engageRate(r), fol = followRate(r);

    function judge(label, val, ref, unit, betterAdvice, goodWord) {
      if (ref == null) return;
      var diff = val - ref;
      var pct = ref ? Math.abs(diff / ref * 100) : 0;
      if (diff < 0 && pct >= 12) {
        out.push({ tone: "warn", t: label + "低于你平时", a: round(val, 1) + unit + "，你近 " + base.n + " 条的中位数是 " + round(ref, 1) + unit + "。" + betterAdvice });
      } else if (diff > 0 && pct >= 12) {
        out.push({ tone: "good", t: label + goodWord, a: round(val, 1) + unit + "，比你平时的 " + round(ref, 1) + unit + " 高。这条的做法值得复制。" });
      } else {
        out.push({ tone: "info", t: label + "和平时持平", a: round(val, 1) + unit + "（平时 " + round(ref, 1) + unit + "）" });
      }
    }

    if (base) {
      judge("2 秒留存", ret2, base.ret2, "%", "开头再狠一点：把最强的反差或结果挪到第一句。", "是你的高分段");
      judge("完播率", finish, base.finish, "%", "中段可能拖了：砍铺垫，每 15 秒给一个新信息点。", "节奏比平时好");
      judge("赞藏率", eng, base.engage, "%", "加一份能截图收藏的清单或模板。", "价值感比平时强");
      judge("转粉率", fol, base.follow, "%", "结尾把人设说清楚：关注我能持续得到什么。", "吸粉比平时强");

      var best = latestPerIdea().filter(function (x) { return x.r.id !== r.id; })
        .sort(function (a, b) { return num(b.r.finish) - num(a.r.finish); }).slice(0, 3);
      if (best.length === 3 && finish < base.finish) {
        out.push({
          tone: "info", t: "参考你自己完播最高的三条",
          a: best.map(function (x) { return "《" + x.idea.title.slice(0, 12) + "》" + round(num(x.r.finish), 1) + "%"; }).join("、") + "。翻回去看看它们的共同点。"
        });
      }
    } else {
      var cold = C.diagnose.cold;
      var left = C.diagnose.baselineMinSamples - latestPerIdea().length;
      out.push({ tone: "info", t: "还在冷启动", a: "再复盘 " + Math.max(1, left) + " 条，诊断就会改成跟你自己的历史比，而不是跟通用阈值比。" });
      out.push(ret2 >= cold.ret2
        ? { tone: "good", t: "钩子合格", a: "2 秒留存 " + round(ret2, 1) + "%，开头稳。" }
        : { tone: "warn", t: "前 3 秒钩子偏弱", a: "2 秒留存 " + round(ret2, 1) + "%，参考线 " + cold.ret2 + "%。把最强的反差或结果放第一句。" });
      out.push(finish >= cold.finish
        ? { tone: "good", t: "节奏不错", a: "完播 " + round(finish, 1) + "%，内容密度在线。" }
        : { tone: "warn", t: "完播率偏低", a: "完播 " + round(finish, 1) + "%，参考线 " + cold.finish + "%。砍掉铺垫，每 15 秒一个信息点。" });
      out.push(eng >= cold.engage
        ? { tone: "good", t: "价值感在线", a: "赞藏率 " + round(eng, 2) + "%。" }
        : { tone: "warn", t: "价值感不足", a: "赞藏率 " + round(eng, 2) + "%，参考线 " + cold.engage + "%。加可收藏的清单或模板。" });
      out.push(fol >= cold.follow
        ? { tone: "good", t: "人设吸粉", a: "转粉率 " + round(fol, 2) + "%。" }
        : { tone: "warn", t: "关注钩子弱", a: "转粉率 " + round(fol, 2) + "%，参考线 " + cold.follow + "%。结尾加人设锚点。" });
    }
    return out;
  }

  /* =====================================================================
     合规预检
     旧版只查 12 个海外品牌名。实际上更常见的限流原因是绝对化用语和诱导互动，
     所以扩成三类，并支持一键替换（旧版只提示不动手）。
     ===================================================================== */

  var COMP_GROUPS = [
    { key: "absolute", label: "绝对化用语", note: "《广告法》高风险，小红书限流最常见的原因", list: C.compliance.absolute },
    { key: "induce", label: "诱导互动", note: "平台明确打击", list: C.compliance.induce },
    { key: "brand", label: "海外品牌名", note: "站内提及可能降流", list: C.compliance.brand }
  ];

  function scanCompliance(text) {
    if (!text || !text.trim()) return [];
    var hits = [];
    COMP_GROUPS.forEach(function (g) {
      g.list.forEach(function (pair) {
        if (text.indexOf(pair[0]) >= 0) hits.push({ group: g, word: pair[0], repl: pair[1] });
      });
    });
    // 「ChatGPT」已经覆盖了「GPT」，别重复提示
    return hits.filter(function (a) {
      return !hits.some(function (b) { return b.word !== a.word && b.word.indexOf(a.word) >= 0; });
    });
  }

  var SCRIPT_FIELDS = ["#m-hook", "#m-pain", "#m-steps", "#m-end", "#m-title"];

  function scriptText() {
    return SCRIPT_FIELDS.map(function (s) { return $(s).value; }).join("\n");
  }

  function updateCompliance() {
    var box = $("#m-comp");
    var hits = scanCompliance(scriptText());
    clear(box);
    if (!scriptText().trim()) { box.hidden = true; return; }
    box.hidden = false;
    if (!hits.length) {
      box.className = "compliance ok";
      box.textContent = "没查到风险词，可以放心发";
      return;
    }
    box.className = "compliance warn";
    box.appendChild(el("span", { text: "建议替换 " + hits.length + " 处：" }));
    hits.forEach(function (h, i) {
      box.appendChild(el("span", { text: (i ? "、" : "") + "「" + h.word + "」→ " + h.repl }));
    });
    box.appendChild(el("button", {
      type: "button", class: "fix", text: "全部替换",
      onclick: function () {
        SCRIPT_FIELDS.forEach(function (s) {
          var f = $(s);
          hits.forEach(function (h) { f.value = f.value.split(h.word).join(h.repl); });
        });
        updateCompliance();
        toast("替换了 " + hits.length + " 处，记得读一遍通不通顺");
      }
    }));
  }

  /* =====================================================================
     状态条
     ===================================================================== */

  function focusSentence() {
    var nr = needReview();
    if (nr.length) return ["《" + nr[0].title + "》发了还没记数据", "去复盘", function () { go("review"); }];
    var script = state.ideas.filter(function (i) { return i.stage === "script"; });
    if (script.length) return ["今天把《" + script[0].title + "》的脚本收尾", "打开", function () { openIdea(script[0].id); }];
    var making = state.ideas.filter(function (i) { return i.stage === "making"; });
    if (making.length) {
      var sub = making[0].subStage === "edit" ? "剪辑" : "拍摄";
      return ["《" + making[0].title + "》在" + sub + "，先把前 3 秒做出来", "打开", function () { openIdea(making[0].id); }];
    }
    var pool = state.ideas.filter(function (i) { return i.stage === "pool"; });
    if (pool.length) return ["灵感池有 " + pool.length + " 个，挑一个今天写脚本", "打开", function () { openIdea(pool[0].id); }];
    return ["流水线空了，去热点库捞一条选题", "去热点库", function () { go("hot"); }];
  }

  function renderStatusbar() {
    var f = focusSentence();
    var box = $("#sb-focus");
    clear(box);
    box.appendChild(el("span", { class: "dot", "aria-hidden": "true" }));
    box.appendChild(el("span", { text: f[0] }));
    box.appendChild(el("button", { class: "btn btn-sm", type: "button", text: f[1], onclick: f[2] }));

    var m = $("#sb-metrics");
    clear(m);
    var fans = num(state.profile.fansNow);
    var gap = Math.max(0, C.goals.pgyThreshold - fans);
    var pct = Math.min(100, Math.round(fans / C.goals.pgyThreshold * 100));

    var mFans = el("div", { class: "sb-m" });
    if (gap > 0) {
      mFans.appendChild(el("span", { text: "距蒲公英" }));
      mFans.appendChild(el("b", { text: String(gap) }));
      mFans.appendChild(el("span", { text: "粉" }));
      mFans.appendChild(el("span", { class: "prog" }, [el("i", { style: "width:" + pct + "%" })]));
    } else {
      mFans.appendChild(el("span", { text: "蒲公英" }));
      mFans.appendChild(el("b", { class: "up", text: "已达标" }));
    }
    m.appendChild(mFans);

    var wk = publishedThisWeek();
    m.appendChild(el("div", { class: "sb-m" }, [
      el("span", { text: "本周发布" }),
      el("b", { class: wk >= C.goals.weeklyPosts ? "up" : "", text: wk + " / " + C.goals.weeklyPosts })
    ]));

    var nr = needReview().length;
    if (nr) m.appendChild(el("div", { class: "sb-m" }, [el("span", { text: "待复盘" }), el("b", { text: String(nr) })]));

    var sp = fansSpeed();
    if (sp && sp.perDay > 0) {
      m.appendChild(el("div", { class: "sb-m" }, [
        el("span", { text: "日均" }), el("b", { class: "up", text: "+" + round(sp.perDay, 1) })
      ]));
    }
  }

  /* =====================================================================
     看板
     ===================================================================== */

  var filterText = "";
  var filterTags = [];
  var activeStage = "pool";
  var dragId = null;

  function visibleIdeas() {
    var q = filterText.trim().toLowerCase();
    return state.ideas.filter(function (i) {
      if (filterTags.length && !filterTags.some(function (t) { return (i.tags || []).indexOf(t) >= 0; })) return false;
      if (!q) return true;
      return (i.title + " " + i.hook + " " + (i.tags || []).join(" ") + " " + i.note).toLowerCase().indexOf(q) >= 0;
    });
  }

  function allTags() {
    var set = {};
    state.ideas.forEach(function (i) { (i.tags || []).forEach(function (t) { if (t) set[t] = (set[t] || 0) + 1; }); });
    return Object.keys(set).sort(function (a, b) { return set[b] - set[a]; });
  }

  function renderTagFilters() {
    var box = $("#tag-filters");
    clear(box);
    allTags().slice(0, 8).forEach(function (t) {
      box.appendChild(el("button", {
        class: "fchip", type: "button", text: t,
        "aria-pressed": filterTags.indexOf(t) >= 0 ? "true" : "false",
        onclick: function () {
          var i = filterTags.indexOf(t);
          if (i >= 0) filterTags.splice(i, 1); else filterTags.push(t);
          renderTagFilters(); renderBoard();
        }
      }));
    });
  }

  function ticket(it) {
    var stageIdx = C.stages.findIndex(function (s) { return s.key === it.stage; });
    var node = el("div", {
      class: "ticket", draggable: "true", tabindex: "0", "data-id": it.id,
      role: "button", "aria-label": it.title + " · " + C.stages[stageIdx].name,
      onclick: function (e) { if (!e.target.closest(".tk-acts,.tk-move")) openIdea(it.id); },
      onkeydown: function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openIdea(it.id); }
        if (e.key === "ArrowRight" && stageIdx < C.stages.length - 1) { e.preventDefault(); moveStage(it.id, C.stages[stageIdx + 1].key); }
        if (e.key === "ArrowLeft" && stageIdx > 0) { e.preventDefault(); moveStage(it.id, C.stages[stageIdx - 1].key); }
      },
      ondragstart: function () { dragId = it.id; node.classList.add("dragging"); },
      ondragend: function () { dragId = null; node.classList.remove("dragging"); }
    });

    node.appendChild(el("div", { class: "tk-title", text: it.title }));
    if (it.hook) node.appendChild(el("div", { class: "tk-hook", text: it.hook }));

    var meta = el("div", { class: "tk-meta" });
    (it.tags || []).slice(0, 2).forEach(function (t) { meta.appendChild(el("span", { class: "chip", text: t })); });
    if ((it.platform || []).indexOf("dy") >= 0) meta.appendChild(el("span", { class: "chip blue", text: "抖音" }));
    if (it.stage === "making" && it.subStage) {
      meta.appendChild(el("span", { class: "chip amber", text: it.subStage === "edit" ? "剪辑" : "拍摄" }));
    }
    var filled = [it.hook, it.script.pain, it.script.steps, it.script.end].filter(Boolean).length;
    if (it.stage === "script" && filled) meta.appendChild(el("span", { class: "chip", text: "脚本 " + filled + "/4" }));
    if (it.stage === "published") {
      var rs = reviewsOf(it.id);
      meta.appendChild(rs.length
        ? el("span", { class: "chip green", text: "已复盘 ×" + rs.length })
        : el("span", { class: "chip red", text: "待复盘" }));
    }
    if (it.due && it.stage !== "published") {
      var late = it.due < today();
      meta.appendChild(el("span", { class: "chip" + (late ? " due-late" : ""), text: (late ? "已过期 " : "") + it.due.slice(5) }));
    }
    if (meta.childNodes.length) node.appendChild(meta);

    node.appendChild(el("div", { class: "tk-acts" }, [
      el("button", { type: "button", title: "复制一条", "aria-label": "复制", text: "⧉", onclick: function (e) { e.stopPropagation(); cloneIdea(it.id); } }),
      el("button", { type: "button", class: "del", title: "删除", "aria-label": "删除", text: "✕", onclick: function (e) { e.stopPropagation(); removeIdea(it.id); } })
    ]));

    // 手机端：拖拽在移动 Safari 不触发，用按钮推进
    node.appendChild(el("div", { class: "tk-move" }, [
      el("button", {
        type: "button", text: "← " + (stageIdx > 0 ? C.stages[stageIdx - 1].name : ""), disabled: stageIdx === 0,
        onclick: function (e) { e.stopPropagation(); moveStage(it.id, C.stages[stageIdx - 1].key); }
      }),
      el("button", {
        type: "button", text: (stageIdx < C.stages.length - 1 ? C.stages[stageIdx + 1].name : "") + " →",
        disabled: stageIdx === C.stages.length - 1,
        onclick: function (e) { e.stopPropagation(); moveStage(it.id, C.stages[stageIdx + 1].key); }
      })
    ]));

    return node;
  }

  // 只重建受影响的列，不再整块 innerHTML 重刷（旧版拖一次卡片全看板重放动画）
  function renderBoard(onlyStages) {
    var board = $("#board");
    var items = visibleIdeas();
    if (!board.childNodes.length) onlyStages = null;

    C.stages.forEach(function (st) {
      if (onlyStages && onlyStages.indexOf(st.key) < 0) return;
      var list = items.filter(function (i) { return i.stage === st.key; });
      var old = board.querySelector('.col[data-stage="' + st.key + '"]');
      var col = el("div", {
        class: "col" + (st.key === activeStage ? " active" : ""), "data-stage": st.key,
        ondragover: function (e) { e.preventDefault(); col.classList.add("over"); },
        ondragleave: function () { col.classList.remove("over"); },
        ondrop: function (e) { e.preventDefault(); col.classList.remove("over"); if (dragId) moveStage(dragId, st.key); }
      });
      col.appendChild(el("div", { class: "col-head" }, [
        el("span", { class: "col-name", text: st.name }),
        el("span", { class: "col-hint", text: st.hint }),
        el("span", { class: "col-count", text: String(list.length) })
      ]));
      if (!list.length) {
        col.appendChild(el("div", { class: "empty", style: "padding:18px 8px", text: "空" }));
      } else {
        list.forEach(function (i) { col.appendChild(ticket(i)); });
      }
      if (old) board.replaceChild(col, old); else board.appendChild(col);
    });

    renderStageTabs();
  }

  function renderStageTabs() {
    var box = $("#stage-tabs");
    clear(box);
    var items = visibleIdeas();
    C.stages.forEach(function (st) {
      var n = items.filter(function (i) { return i.stage === st.key; }).length;
      box.appendChild(el("button", {
        class: "stage-tab", role: "tab", type: "button",
        "aria-selected": st.key === activeStage ? "true" : "false",
        onclick: function () {
          activeStage = st.key;
          $$(".col", $("#board")).forEach(function (c) { c.classList.toggle("active", c.dataset.stage === activeStage); });
          renderStageTabs();
        }
      }, [document.createTextNode(st.name), el("span", { class: "n", text: String(n) })]));
    });
  }

  function moveStage(id, stage) {
    var it = ideaById(id);
    if (!it || it.stage === stage) return;
    var from = it.stage;
    it.stage = stage;
    if (stage === "making" && !it.subStage) it.subStage = "shoot";
    // 进「已发布」自动打时间戳 —— 旧版没有这个字段，导致「本周节奏」统计的
    // 其实是「本周复盘了几条」
    if (stage === "published" && !it.publishedAt) {
      var n = new Date();
      it.publishedAt = fmtDate(n) + "T" + pad(n.getHours()) + ":" + pad(n.getMinutes());
    }
    persist();
    renderBoard([from, stage]);
    renderStatusbar();
    renderReviewForm();
    toast("《" + it.title.slice(0, 14) + "》移到「" + C.stages.find(function (s) { return s.key === stage; }).name + "」", {
      action: "撤销",
      onAction: function () { it.stage = from; persist(); renderBoard([from, stage]); renderStatusbar(); renderReviewForm(); }
    });
  }

  function removeIdea(id) {
    var idx = state.ideas.findIndex(function (i) { return i.id === id; });
    if (idx < 0) return;
    var backup = state.ideas[idx];
    var backupReviews = state.reviews.filter(function (r) { return r.ideaId === id; });
    state.ideas.splice(idx, 1);
    state.reviews = state.reviews.filter(function (r) { return r.ideaId !== id; });
    persist(); refresh();
    toast("已删除《" + backup.title.slice(0, 14) + "》", {
      action: "撤销",
      onAction: function () {
        state.ideas.splice(idx, 0, backup);
        state.reviews = state.reviews.concat(backupReviews);
        persist(); refresh();
      }
    });
  }

  // 数据好的选题应该能换个角度再做一条 —— 旧版爆款之后没有任何出口
  function cloneIdea(id) {
    var src = ideaById(id);
    if (!src) return;
    var copy = clone(src);
    copy.id = uid();
    copy.title = src.title + "（重做）";
    copy.stage = "pool";
    copy.subStage = "";
    copy.due = "";
    copy.publishedAt = "";
    copy.links = { material: "", post: "" };
    copy.createdAt = new Date().toISOString();
    state.ideas.unshift(copy);
    persist(); refresh();
    toast("复制了一条，放在灵感池", { action: "打开", onAction: function () { openIdea(copy.id); } });
  }

  /* =====================================================================
     日历
     ===================================================================== */

  var calCursor = new Date();

  function renderCalendar() {
    var y = calCursor.getFullYear(), mo = calCursor.getMonth();
    $("#cal-month").textContent = y + " 年 " + (mo + 1) + " 月";
    var grid = $("#cal-grid");
    clear(grid);
    var first = new Date(y, mo, 1);
    var start = startOfWeek(first);
    var todayS = today();

    for (var k = 0; k < 42; k++) {
      var d = addDays(start, k);
      var ds = fmtDate(d);
      var cell = el("div", {
        class: "cal-day" + (d.getMonth() !== mo ? " other" : "") + (ds === todayS ? " today" : "")
      }, [el("div", { class: "cal-date", text: String(d.getDate()) })]);

      state.ideas.forEach(function (i) {
        if (i.publishedAt && i.publishedAt.slice(0, 10) === ds) {
          cell.appendChild(el("div", { class: "cal-item pub", title: i.title, text: i.title, onclick: function () { openIdea(i.id); } }));
        } else if (i.due === ds && i.stage !== "published") {
          cell.appendChild(el("div", { class: "cal-item due", title: i.title, text: i.title, onclick: function () { openIdea(i.id); } }));
        }
      });
      grid.appendChild(cell);
      if (k >= 34 && d.getMonth() !== mo) break;
    }
  }

  /* =====================================================================
     热点库
     ===================================================================== */

  /*
   * 每周搜索聚合的结果。由 GitHub Actions 跑 scripts/fetch-hotspots.mjs 生成，
   * 用的是 Claude API 的 web_search 工具检索公开网络索引 —— 不碰平台接口。
   *
   * 这些条目不直接进你的库：先当「建议」展示，点「采用」才写入 state.hotspots。
   * 这样你的库里始终只有你亲自认可过的东西。
   */
  var suggested = { items: [], generatedAt: null, note: "" };

  function loadSuggested() {
    return fetch("data/hotspots.json", { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && Array.isArray(d.items)) suggested = d;
        renderSuggested();
      })
      .catch(function () { /* 离线或还没跑过，静默跳过 */ });
  }

  function renderSuggested() {
    var wrap = $("#hot-suggested-wrap");
    var box = $("#hot-suggested");
    if (!wrap || !box) return;
    clear(box);

    // 已经采用过的就不再出现在建议区
    var adopted = state.hotspots.map(function (h) { return h.title; });
    var items = (suggested.items || []).filter(function (s) { return adopted.indexOf(s.title) < 0; });

    if (!items.length) {
      wrap.hidden = !suggested.generatedAt;
      if (suggested.generatedAt) {
        box.appendChild(el("div", { class: "empty", text: "本周这批都采用过了。下周一会自动更新。" }));
      }
      updateSuggestedMeta();
      return;
    }
    wrap.hidden = false;
    updateSuggestedMeta();

    items.forEach(function (s) {
      var card = el("div", { class: "item suggested" });
      card.appendChild(el("div", { class: "row" }, [
        el("span", { class: "chip", text: s.platform || "小红书" }),
        document.createTextNode(" "),
        el("span", { class: "chip " + (s.heat === "高" ? "red" : s.heat === "中高" ? "amber" : ""), text: (s.heat || "中") + "热度" }),
        document.createTextNode(" "),
        el("span", { class: "chip blue", text: "搜索聚合" })
      ]));
      card.appendChild(el("h4", { text: s.title }));
      if (s.why) card.appendChild(el("div", { class: "row" }, [el("b", { text: "为什么火：" }), document.createTextNode(s.why)]));
      if (s.angle) card.appendChild(el("div", { class: "row" }, [el("b", { text: "你可以：" }), document.createTextNode(s.angle)]));
      if (s.tip) card.appendChild(el("div", { class: "tip", text: s.tip }));

      // 来源必须可点开验证 —— 搜来的东西看起来和真榜单一样，你得能自己判断
      if (Array.isArray(s.sources) && s.sources.length) {
        var src = el("div", { class: "sources" });
        s.sources.forEach(function (u) {
          if (!u || !/^https?:\/\//.test(String(u.url))) return;
          src.appendChild(el("a", { href: u.url, target: "_blank", rel: "noopener noreferrer", title: u.url, text: u.title || u.url }));
        });
        if (src.childNodes.length) {
          card.appendChild(el("div", { class: "row muted", style: "font-size:var(--fs-xs)", text: "来源（点开自己验一眼）" }));
          card.appendChild(src);
        }
      }

      card.appendChild(el("div", { class: "item-foot" }, [
        el("button", { class: "btn btn-sm btn-primary", type: "button", text: "采用", onclick: function () { adoptSuggested(s); } }),
        el("button", { class: "btn btn-sm", type: "button", text: "不感兴趣", onclick: function () { dismissSuggested(s); } })
      ]));
      box.appendChild(card);
    });
  }

  function updateSuggestedMeta() {
    var at = $("#hot-gen-at");
    if (at) {
      at.textContent = suggested.generatedAt
        ? "更新于 " + String(suggested.generatedAt).slice(0, 10) + (suggested.searches ? " · 搜索 " + suggested.searches + " 次" : "")
        : "还没跑过（需要在仓库 Secrets 里加 ANTHROPIC_API_KEY）";
    }
    var note = $("#hot-note");
    if (note) {
      note.hidden = !suggested.note;
      note.textContent = suggested.note || "";
    }
  }

  function adoptSuggested(s) {
    state.hotspots.unshift({
      id: uid(), addedAt: today(), used: false,
      title: s.title, platform: s.platform || "小红书", heat: s.heat || "中",
      why: s.why || "", angle: s.angle || "", tip: s.tip || "",
      suggestedTitle: s.suggestedTitle || s.title,
      sources: Array.isArray(s.sources) ? s.sources : []
    });
    persist(); renderHot(); renderSuggested();
    toast("已收进你的库");
  }

  function dismissSuggested(s) {
    suggested.items = suggested.items.filter(function (x) { return x !== s; });
    renderSuggested();
    toast("这条本周不再出现", { action: "撤回", onAction: function () { loadSuggested(); } });
  }

  function renderHot() {
    var box = $("#hot-grid");
    clear(box);
    renderSuggested();
    if (!state.hotspots.length) {
      box.appendChild(el("div", { class: "empty", text: "还没有记录。刷到好选题就点上面的按钮记一条，或者从「本周建议」里采用。" }));
      return;
    }
    state.hotspots.forEach(function (h) {
      var card = el("div", { class: "item" });
      card.appendChild(el("div", { class: "row" }, [
        el("span", { class: "chip", text: h.platform || "未标平台" }),
        document.createTextNode(" "),
        el("span", { class: "chip " + (h.heat === "高" ? "red" : h.heat === "中高" ? "amber" : ""), text: (h.heat || "中") + "热度" })
      ]));
      card.appendChild(el("h4", { text: h.title }));
      if (h.why) card.appendChild(el("div", { class: "row" }, [el("b", { text: "为什么火：" }), document.createTextNode(h.why)]));
      if (h.angle) card.appendChild(el("div", { class: "row" }, [el("b", { text: "我的角度：" }), document.createTextNode(h.angle)]));
      if (h.tip) card.appendChild(el("div", { class: "tip", text: h.tip }));

      // 从建议区采用过来的会带着来源，留着方便以后回头核对
      if (Array.isArray(h.sources) && h.sources.length) {
        var hs = el("div", { class: "sources" });
        h.sources.forEach(function (u) {
          if (!u || !/^https?:\/\//.test(String(u.url))) return;
          hs.appendChild(el("a", { href: u.url, target: "_blank", rel: "noopener noreferrer", title: u.url, text: u.title || u.url }));
        });
        if (hs.childNodes.length) card.appendChild(hs);
      }

      card.appendChild(el("div", { class: "item-acts" }, [
        el("button", { type: "button", title: "编辑", "aria-label": "编辑", text: "✎", onclick: function () { editHotspot(h.id); } }),
        el("button", { type: "button", title: "删除", "aria-label": "删除", text: "✕", onclick: function () { removeFrom("hotspots", h.id, h.title); } })
      ]));

      card.appendChild(el("div", { class: "item-foot" }, [
        el("button", {
          class: "btn btn-sm" + (h.used ? "" : " btn-primary"), type: "button",
          text: h.used ? "已加入过" : "变成选题",
          onclick: function () { hotToIdea(h); }
        }),
        el("span", { class: "stamp", text: "记于 " + h.addedAt })
      ]));
      box.appendChild(card);
    });
  }

  /*
   * 旧版是 h.angle.split("》——")[0].replace("《","")，完全依赖种子文案的格式，
   * 换一条数据标题就会变成一整段。现在用独立的 suggestedTitle 字段。
   */
  function hotToIdea(h) {
    var idea = normalize({ ideas: [{
      id: uid(),
      title: h.suggestedTitle || h.title,
      hook: "",
      tags: ["AI实操"],
      stage: "pool",
      note: "来自热点库：" + h.title + (h.tip ? "\n注意：" + h.tip : "")
    }] }).ideas[0];
    state.ideas.unshift(idea);
    h.used = true;
    persist(); refresh();
    toast("已放进灵感池", { action: "去写脚本", onAction: function () { go("board"); openIdea(idea.id); } });
  }

  /* =====================================================================
     拆解库
     ===================================================================== */

  function renderRivals() {
    var box = $("#rival-grid");
    clear(box);
    if (!state.rivals.length) {
      box.appendChild(el("div", { class: "empty", text: "还没有记录。看到打法好的视频就拆一条，攒够之后能看出哪类钩子对你的赛道最有效。" }));
      return;
    }
    state.rivals.forEach(function (r) {
      var card = el("div", { class: "item" });
      card.appendChild(el("h4", {}, []));
      card.lastChild.appendChild(document.createTextNode(r.name));
      if (r.tag) { card.lastChild.appendChild(document.createTextNode(" ")); card.lastChild.appendChild(el("span", { class: "chip", text: r.tag })); }
      if (r.why) card.appendChild(el("div", { class: "row" }, [el("b", { text: "为什么火：" }), document.createTextNode(r.why)]));
      if (r.hook) {
        var ht = (C.hookTypes.find(function (t) { return t.key === r.hookType; }) || {}).name;
        card.appendChild(el("div", { class: "row" }, [
          el("b", { text: "钩子：" }), document.createTextNode(r.hook),
          ht ? el("span", { class: "chip", text: ht }) : null
        ].filter(Boolean)));
      }
      if (r.learn) card.appendChild(el("div", { class: "tip", text: "你该学：" + r.learn }));

      var links = el("div", { class: "links" });
      if (r.xhs) links.appendChild(el("a", { href: r.xhs, target: "_blank", rel: "noopener noreferrer", text: "小红书 ↗" }));
      if (r.dy) links.appendChild(el("a", { href: r.dy, target: "_blank", rel: "noopener noreferrer", text: "抖音 ↗" }));
      if (links.childNodes.length) card.appendChild(links);

      card.appendChild(el("div", { class: "item-acts" }, [
        el("button", { type: "button", title: "编辑", "aria-label": "编辑", text: "✎", onclick: function () { editRival(r.id); } }),
        el("button", { type: "button", title: "删除", "aria-label": "删除", text: "✕", onclick: function () { removeFrom("rivals", r.id, r.name); } })
      ]));
      card.appendChild(el("div", { class: "item-foot" }, [el("span", { class: "stamp", text: "记于 " + r.recordedAt })]));
      box.appendChild(card);
    });
  }

  function removeFrom(key, id, label) {
    var idx = state[key].findIndex(function (x) { return x.id === id; });
    if (idx < 0) return;
    var backup = state[key][idx];
    state[key].splice(idx, 1);
    persist(); refresh();
    toast("已删除「" + String(label).slice(0, 14) + "」", {
      action: "撤销",
      onAction: function () { state[key].splice(idx, 0, backup); persist(); refresh(); }
    });
  }

  /* =====================================================================
     通用编辑弹窗（热点 / 拆解）
     ===================================================================== */

  function genericForm(title, fields, values, onSave, onDelete) {
    $("#gen-title").textContent = title;
    var body = $("#gen-body");
    clear(body);
    var inputs = {};
    fields.forEach(function (f) {
      var wrap = el("div", { class: "fld" });
      wrap.appendChild(el("label", { for: "gen-" + f.key, text: f.label }));
      var node;
      if (f.type === "textarea") node = el("textarea", { id: "gen-" + f.key, placeholder: f.ph || "" });
      else if (f.type === "select") {
        node = el("select", { class: "inp", id: "gen-" + f.key });
        (f.options || []).forEach(function (o) { node.appendChild(el("option", { value: o.value, text: o.label })); });
      } else node = el("input", { class: "inp", id: "gen-" + f.key, type: f.type || "text", placeholder: f.ph || "" });
      node.value = values[f.key] == null ? "" : values[f.key];
      inputs[f.key] = node;
      wrap.appendChild(node);
      body.appendChild(wrap);
    });
    var del = $("#gen-del");
    del.hidden = !onDelete;
    del.onclick = function () { closeModal($("#modal-generic")); onDelete && onDelete(); };
    $("#gen-save").onclick = function () {
      var out = {};
      Object.keys(inputs).forEach(function (k) { out[k] = inputs[k].value.trim(); });
      if (onSave(out) !== false) closeModal($("#modal-generic"));
    };
    openModal("modal-generic");
  }

  var HOT_FIELDS = [
    { key: "title", label: "热点是什么", ph: "如：AI 做 PPT 保姆级教程持续爆" },
    { key: "platform", label: "平台", type: "select", options: [{ value: "小红书", label: "小红书" }, { value: "抖音", label: "抖音" }, { value: "其它", label: "其它" }] },
    { key: "heat", label: "热度", type: "select", options: [{ value: "高", label: "高" }, { value: "中高", label: "中高" }, { value: "中", label: "中" }] },
    { key: "why", label: "为什么火", type: "textarea" },
    { key: "angle", label: "我能怎么做（角度）", type: "textarea" },
    { key: "suggestedTitle", label: "建议标题", ph: "变成选题时直接用这个" },
    { key: "tip", label: "注意事项", ph: "如：工具名模糊化" }
  ];

  function editHotspot(id) {
    var h = id ? state.hotspots.find(function (x) { return x.id === id; }) : null;
    genericForm(h ? "编辑热点" : "记一条热点", HOT_FIELDS, h || { platform: "小红书", heat: "中" }, function (v) {
      if (!v.title) { toast("至少写个标题", { tone: "bad" }); return false; }
      if (h) Object.assign(h, v);
      else state.hotspots.unshift(Object.assign({ id: uid(), addedAt: today(), used: false }, v));
      persist(); renderHot();
    }, h ? function () { removeFrom("hotspots", h.id, h.title); } : null);
  }

  var RIVAL_FIELDS = [
    { key: "name", label: "博主 / 作品", ph: "谁的哪条" },
    { key: "tag", label: "打法标签", ph: "如：保姆级拆解、栏目化" },
    { key: "why", label: "为什么火", type: "textarea" },
    { key: "hook", label: "他的钩子原话", type: "textarea" },
    { key: "hookType", label: "钩子类型", type: "select", options: [] },
    { key: "learn", label: "你该学什么", type: "textarea" },
    { key: "xhs", label: "小红书链接", ph: "主页链接优先，比搜索页好用" },
    { key: "dy", label: "抖音链接" }
  ];

  function editRival(id) {
    RIVAL_FIELDS.find(function (f) { return f.key === "hookType"; }).options =
      C.hookTypes.map(function (t) { return { value: t.key, label: t.name }; });
    var r = id ? state.rivals.find(function (x) { return x.id === id; }) : null;
    genericForm(r ? "编辑拆解" : "记一条拆解", RIVAL_FIELDS, r || { hookType: "other" }, function (v) {
      if (!v.name) { toast("至少写个名字", { tone: "bad" }); return false; }
      if (r) Object.assign(r, v);
      else state.rivals.unshift(Object.assign({ id: uid(), recordedAt: today().slice(0, 7) }, v));
      persist(); renderRivals();
    }, r ? function () { removeFrom("rivals", r.id, r.name); } : null);
  }

  /* =====================================================================
     选题弹窗
     ===================================================================== */

  function fillSelect(sel, list, valueKey, labelKey) {
    clear(sel);
    list.forEach(function (o) { sel.appendChild(el("option", { value: o[valueKey], text: o[labelKey] })); });
  }

  function initIdeaModal() {
    fillSelect($("#m-stage"), C.stages, "key", "name");
    fillSelect($("#m-substage"), C.subStages, "key", "name");
    fillSelect($("#m-hooktype"), C.hookTypes, "key", "name");
    var pf = $("#m-platform");
    clear(pf);
    C.platforms.forEach(function (p) {
      pf.appendChild(el("label", {}, [el("input", { type: "checkbox", value: p.key }), document.createTextNode(p.name)]));
    });
    $("#m-stage").addEventListener("change", syncStageFields);
    SCRIPT_FIELDS.forEach(function (s) { $(s).addEventListener("input", updateCompliance); });
  }

  function syncStageFields() {
    var v = $("#m-stage").value;
    $("#wrap-substage").hidden = v !== "making";
    $("#wrap-published").hidden = v !== "published";
  }

  var editingId = null;

  function openIdea(id) {
    editingId = id || null;
    var it = id ? ideaById(id) : null;
    $("#idea-title").textContent = it ? "编辑选题" : "新建选题";
    $("#m-title").value = it ? it.title : "";
    $("#m-hook").value = it ? it.hook : "";
    $("#m-hooktype").value = it ? (it.hookType || "other") : "other";
    $("#m-pain").value = it ? it.script.pain : "";
    $("#m-steps").value = it ? it.script.steps : "";
    $("#m-end").value = it ? it.script.end : "";
    $("#m-cover").value = it ? it.cover : "";
    $("#m-tags").value = it ? (it.tags || []).join(", ") : "";
    $("#m-due").value = it ? it.due : "";
    $("#m-stage").value = it ? it.stage : activeStage;
    $("#m-substage").value = it ? (it.subStage || "shoot") : "shoot";
    $("#m-pubat").value = it ? it.publishedAt : "";
    $("#m-link-material").value = it ? it.links.material : "";
    $("#m-link-post").value = it ? it.links.post : "";
    $("#m-note").value = it ? it.note : "";
    var pfs = it ? it.platform : ["xhs"];
    $$("#m-platform input").forEach(function (c) { c.checked = pfs.indexOf(c.value) >= 0; });
    $("#m-del").hidden = !it;
    $("#m-clone").hidden = !it;
    syncStageFields();
    updateCompliance();
    openModal("modal-idea");
  }

  function saveIdea() {
    var pfs = $$("#m-platform input:checked").map(function (c) { return c.value; });
    var data = {
      title: $("#m-title").value.trim() || "未命名选题",
      hook: $("#m-hook").value.trim(),
      hookType: $("#m-hooktype").value,
      cover: $("#m-cover").value.trim(),
      tags: $("#m-tags").value.split(/[,，、]/).map(function (t) { return t.trim(); }).filter(Boolean),
      due: $("#m-due").value,
      stage: $("#m-stage").value,
      subStage: $("#m-substage").value,
      publishedAt: $("#m-pubat").value,
      platform: pfs.length ? pfs : ["xhs"],
      note: $("#m-note").value.trim(),
      links: { material: $("#m-link-material").value.trim(), post: $("#m-link-post").value.trim() },
      script: { pain: $("#m-pain").value.trim(), steps: $("#m-steps").value.trim(), end: $("#m-end").value.trim() }
    };
    if (data.stage === "published" && !data.publishedAt) {
      var n = new Date();
      data.publishedAt = fmtDate(n) + "T" + pad(n.getHours()) + ":" + pad(n.getMinutes());
    }
    if (editingId) Object.assign(ideaById(editingId), data);
    else state.ideas.unshift(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, data));
    persist();
    closeModal($("#modal-idea"));
    refresh();
  }

  /* =====================================================================
     复盘
     ===================================================================== */

  function renderReviewForm() {
    var sel = $("#rv-idea");
    var cur = sel.value;
    clear(sel);
    sel.appendChild(el("option", { value: "", text: "选择已发布视频…" }));
    publishedIdeas().forEach(function (i) {
      var n = reviewsOf(i.id).length;
      sel.appendChild(el("option", { value: i.id, text: i.title + (n ? "（已记 " + n + " 次）" : "") }));
    });
    if (cur) sel.value = cur;
    if (!$("#rv-at").value) $("#rv-at").value = today();
  }

  function renderRecall(id) {
    var box = $("#rv-recall");
    clear(box);
    if (!id) return;
    var it = ideaById(id);
    if (!it) return;
    var rows = [];
    if (it.hook) rows.push(["钩子", it.hook]);
    if (it.script.pain) rows.push(["痛点", it.script.pain]);
    if (it.script.steps) rows.push(["步骤", it.script.steps]);
    if (it.script.end) rows.push(["收尾", it.script.end]);
    if (it.cover) rows.push(["封面", it.cover]);
    var wrap = el("div", { class: "recall" }, [el("h5", { text: "当时的脚本（对照数据找问题）" })]);
    if (!rows.length) wrap.appendChild(el("div", { class: "r muted", text: "这条没写脚本，只能看数据了" }));
    rows.forEach(function (r) {
      wrap.appendChild(el("div", { class: "r" }, [el("b", { text: r[0] }), el("span", { text: r[1] })]));
    });
    if (it.links.post) wrap.appendChild(el("div", { class: "r" }, [el("b", { text: "成片" }), el("a", { href: it.links.post, target: "_blank", rel: "noopener noreferrer", text: "打开 ↗" })]));
    box.appendChild(wrap);
  }

  function submitReview(e) {
    e.preventDefault();
    var id = $("#rv-idea").value;
    if (!id) { toast("先选一条已发布的视频", { tone: "bad" }); return; }
    var it = ideaById(id);
    var r = {
      id: uid(), ideaId: id, at: $("#rv-at").value || today(),
      play: num($("#rv-play").value), ret2: num($("#rv-ret2").value), finish: num($("#rv-finish").value),
      like: num($("#rv-like").value), save: num($("#rv-save").value),
      comment: num($("#rv-comment").value), follow: num($("#rv-follow").value),
      snap: it ? { hook: it.hook, hookType: it.hookType, cover: it.cover, script: clone(it.script) } : null
    };
    state.reviews.push(r);
    persist();
    e.target.reset();
    $("#rv-at").value = today();
    clear($("#rv-recall"));
    refresh();
    toast("记下了，往右边看诊断");
  }

  function removeReview(rid) {
    var idx = state.reviews.findIndex(function (r) { return r.id === rid; });
    if (idx < 0) return;
    var backup = state.reviews[idx];
    state.reviews.splice(idx, 1);
    persist(); refresh();
    toast("删了这次记录", { action: "撤销", onAction: function () { state.reviews.splice(idx, 0, backup); persist(); refresh(); } });
  }

  function metric(label, value) {
    return el("div", { class: "metric" }, [el("b", { text: String(value) }), el("span", { text: label })]);
    }

  function renderReviews() {
    var box = $("#review-list");
    clear(box);
    var withData = state.ideas.filter(function (i) { return reviewsOf(i.id).length; });
    if (!withData.length) {
      box.appendChild(el("div", { class: "empty", text: "还没有复盘记录。视频发出去 24 小时后填第一次，过一周再填一次，就能看出是首日冲还是慢热。" }));
      return;
    }
    withData.sort(function (a, b) {
      var ra = latestReviewOf(a.id), rb = latestReviewOf(b.id);
      return ra.at < rb.at ? 1 : -1;
    });

    withData.forEach(function (it) {
      var rs = reviewsOf(it.id);
      var last = rs[rs.length - 1];
      var card = el("div", { class: "rv-card" });
      card.appendChild(el("div", { class: "rv-head" }, [
        el("b", { text: it.title }),
        el("span", { class: "stamp", text: rs.length > 1 ? "共 " + rs.length + " 次采集 · 最近 " + last.at : last.at })
      ]));

      var m = el("div", { class: "metrics" }, [
        metric("播放", num(last.play).toLocaleString()),
        metric("2秒留存", round(num(last.ret2), 1) + "%"),
        metric("完播", round(num(last.finish), 1) + "%"),
        metric("赞", last.like), metric("藏", last.save), metric("评", last.comment),
        metric("涨粉", "+" + last.follow),
        metric("转粉率", round(followRate(last), 2) + "%")
      ]);
      card.appendChild(m);

      // 多次采集：能看出首日冲还是慢热，这是旧版单次复盘完全丢掉的信息
      if (rs.length > 1) {
        var snaps = el("div", { class: "snaps" });
        rs.forEach(function (r, i) {
          var prev = i ? rs[i - 1] : null;
          var delta = prev ? num(r.play) - num(prev.play) : 0;
          snaps.appendChild(el("div", { class: "snap" }, [
            el("span", { class: "t", text: r.at }),
            el("span", { class: "v", text: "播放 " + num(r.play).toLocaleString() + (prev ? "（" + (delta >= 0 ? "+" : "") + delta.toLocaleString() + "）" : "") + " · 涨粉 +" + r.follow }),
            el("button", { type: "button", title: "删除这次记录", "aria-label": "删除这次记录", text: "✕", onclick: function () { removeReview(r.id); } })
          ]));
        });
        card.appendChild(snaps);
        var first = rs[0], span = daysBetween(parseDate(first.at), parseDate(last.at));
        if (span >= 2 && num(first.play) > 0) {
          var growth = (num(last.play) - num(first.play)) / num(first.play) * 100;
          card.appendChild(el("div", { class: "diag" }, [
            el("div", {
              class: "d " + (growth >= 50 ? "good" : "info"),
              text: growth >= 50
                ? "慢热型：" + span + " 天里播放又涨了 " + round(growth, 0) + "%。这类内容值得再做一条同款。"
                : "首日型：" + span + " 天里只多了 " + round(growth, 0) + "%，流量集中在发布当天。"
            })
          ]));
        }
      } else {
        card.appendChild(el("div", { class: "snaps" }, [
          el("div", { class: "snap" }, [
            el("span", { class: "t", text: last.at }),
            el("span", { class: "v muted", text: "只记了一次。过几天再记一次就能看出是首日冲还是慢热。" }),
            el("button", { type: "button", title: "删除这次记录", "aria-label": "删除这次记录", text: "✕", onclick: function () { removeReview(last.id); } })
          ])
        ]));
      }

      var diag = el("div", { class: "diag" });
      diagnose(last).forEach(function (d) {
        diag.appendChild(el("div", { class: "d " + d.tone }, [el("b", { text: d.t + "：" }), document.createTextNode(d.a)]));
      });
      card.appendChild(diag);
      box.appendChild(card);
    });
  }

  /*
   * 横向洞察 —— 旧版所有结论都停在单条视频，这里回答的是「哪类做法对我最有效」。
   * 样本不够时明说还差几条，而不是给一个假装可信的结论。
   */
  function renderInsights() {
    var box = $("#insights");
    clear(box);
    var rows = latestPerIdea();
    if (rows.length < 3) {
      box.appendChild(el("div", { class: "empty", style: "margin-bottom:14px", text: "再复盘 " + (3 - rows.length) + " 条，这里会开始给你横向结论（哪类钩子、哪个标签、什么时段最有效）。" }));
      return;
    }

    function groupBy(keyFn, metricFn, minPerGroup) {
      var g = {};
      rows.forEach(function (x) {
        var keys = keyFn(x);
        (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
          if (!k) return;
          (g[k] = g[k] || []).push(metricFn(x));
        });
      });
      return Object.keys(g)
        .filter(function (k) { return g[k].length >= (minPerGroup || 2); })
        .map(function (k) { return { key: k, n: g[k].length, v: mean(g[k]) }; })
        .sort(function (a, b) { return b.v - a.v; });
    }

    function panel(title, list, unit, hint) {
      if (list.length < 2) return null;
      var p = el("div", { class: "insight", style: "margin-bottom:14px" }, [el("h4", { text: title })]);
      p.appendChild(el("div", { class: "lead" }, [
        document.createTextNode("最好的是 "),
        el("b", { text: list[0].key }),
        document.createTextNode("，平均 " + round(list[0].v, 1) + unit + "；最差的 " + list[list.length - 1].key + " 只有 " + round(list[list.length - 1].v, 1) + unit + "。")
      ]));
      var bars = el("div", { class: "bars" });
      var max = list[0].v || 1;
      list.forEach(function (r, i) {
        bars.appendChild(el("div", { class: "bar-row" }, [
          el("span", { class: "l", text: r.key + "（" + r.n + " 条）" }),
          el("span", { class: "t" }, [el("i", { class: i === 0 ? "hi" : "", style: "width:" + Math.max(2, r.v / max * 100) + "%" })]),
          el("span", { class: "v", text: round(r.v, 1) + unit })
        ]));
      });
      p.appendChild(bars);
      if (hint) p.appendChild(el("div", { class: "sub muted", style: "margin-top:10px;font-size:var(--fs-xs)", text: hint }));
      return p;
    }

    var byHook = groupBy(
      function (x) { var t = C.hookTypes.find(function (h) { return h.key === (x.idea.hookType || "other"); }); return t ? t.name : null; },
      function (x) { return num(x.r.ret2); }
    );
    var byTag = groupBy(function (x) { return x.idea.tags || []; }, function (x) { return followRate(x.r); });
    var byHour = groupBy(
      function (x) { var b = bucketOfHour(hourOf(x.idea.publishedAt)); var f = C.hourBuckets.find(function (h) { return h.key === b; }); return f ? f.name : null; },
      function (x) { return num(x.r.finish); }
    );

    var panels = [
      panel("哪类钩子留得住人（2 秒留存）", byHook, "%", "钩子类型在选题弹窗里选。样本还少时结论仅供参考。"),
      panel("哪类内容更能转粉（转粉率）", byTag, "%", "按标签聚合。想让这里更准，标签就别起太随意。"),
      panel("什么时段发完播更好", byHour, "%", "需要在选题里填「实际发布时间」（带小时）。")
    ].filter(Boolean);

    if (!panels.length) {
      box.appendChild(el("div", { class: "empty", style: "margin-bottom:14px", text: "数据还太散：给选题填上钩子类型、标签和实际发布时间，这里就能给出横向结论。" }));
      return;
    }
    panels.forEach(function (p) { box.appendChild(p); });
  }

  /* =====================================================================
     商单
     ===================================================================== */

  function renderBiz() {
    var fans = num(state.profile.fansNow);
    var th = C.goals.pgyThreshold;
    $("#fans-now").textContent = fans.toLocaleString();
    $("#fans-prog").style.width = Math.min(100, fans / th * 100) + "%";

    var note = $("#fans-note");
    clear(note);
    if (fans >= th) note.appendChild(el("span", { text: "已达蒲公英入驻门槛，可以开始接商单。" + C.goals.thresholdNote }));
    else {
      note.appendChild(el("span", { text: "距蒲公英门槛（" + th + "）还差 " }));
      note.appendChild(el("b", { text: String(th - fans) }));
      note.appendChild(el("span", { text: " 粉。" + C.goals.thresholdNote }));
    }

    var sp = fansSpeed();
    var speedEl = $("#fans-speed");
    clear(speedEl);
    if (!sp) speedEl.textContent = state.fansHistory.length ? "再记一次就能算出速度" : "记录粉丝数即可开始算速度";
    else if (sp.perDay <= 0) speedEl.textContent = "近 " + sp.days + " 天没有净增长";
    else {
      var eta = fans >= th ? null : Math.ceil((th - fans) / sp.perDay);
      speedEl.textContent = "日均 +" + round(sp.perDay, 1) + " 粉" + (eta ? " · 按这个速度约 " + eta + " 天到门槛" : "");
    }

    // 粉丝历史 —— 旧版只存一个当前值，每次更新直接覆盖，看不到斜率
    var hist = $("#fans-history");
    clear(hist);
    var pts = state.fansHistory.slice(-8);
    if (pts.length >= 2) {
      var max = Math.max.apply(null, pts.map(function (p) { return p.count; })) || 1;
      pts.forEach(function (p, i) {
        var prev = i ? pts[i - 1] : null;
        hist.appendChild(el("div", { class: "bar-row" }, [
          el("span", { class: "l", text: p.date }),
          el("span", { class: "t" }, [el("i", { style: "width:" + Math.max(2, p.count / max * 100) + "%" })]),
          el("span", { class: "v", text: (prev && p.count > prev.count ? "+" + (p.count - prev.count) : String(p.count)) })
        ]));
      });
    }

    // 「蒲公英已入驻」旧版是靠 fans>=1000 && deals.length>0 反推的，逻辑不成立，改成手动勾
    var pub = latestPerIdea();
    var avgFinish = mean(pub.map(function (x) { return num(x.r.finish); })) || 0;
    var checks = [
      { t: "粉丝 ≥ " + th + "（蒲公英门槛）", ok: fans >= th, auto: true },
      { t: "已发布 ≥ 10 条作品", ok: publishedIdeas().length >= 10, auto: true },
      { t: "平均完播率 ≥ 15%", ok: avgFinish >= 15, auto: true },
      { t: "人设清晰（一句话说得出你是谁）", ok: !!state.ready.personaClear, key: "personaClear" },
      { t: "蒲公英已入驻", ok: !!state.ready.pgyJoined, key: "pgyJoined" }
    ];
    var ul = $("#ready-list");
    clear(ul);
    checks.forEach(function (c) {
      var mark = c.key
        ? el("button", { class: "mk", type: "button", text: c.ok ? "✓" : "○", "aria-pressed": c.ok ? "true" : "false", "aria-label": c.t,
            onclick: function () { state.ready[c.key] = !state.ready[c.key]; persist(); renderBiz(); } })
        : el("span", { class: "mk", text: c.ok ? "✓" : "○", "aria-hidden": "true" });
      ul.appendChild(el("li", { class: c.ok ? "ok" : "" }, [mark, document.createTextNode(c.t + (c.key ? "（点左边勾）" : ""))]));
    });

    var port = $("#portfolio");
    clear(port);
    var top = pub.map(function (x) { return { title: x.idea.title, fr: followRate(x.r), play: num(x.r.play), id: x.idea.id }; })
      .sort(function (a, b) { return b.fr - a.fr; }).slice(0, 3);
    if (!top.length) port.appendChild(el("div", { class: "empty", text: "复盘之后自动捞出转粉率最高的作品" }));
    top.forEach(function (p) {
      port.appendChild(el("div", { class: "deal" }, [
        el("div", { class: "dl" }, [
          el("b", { text: p.title }),
          el("span", { text: "转粉 " + round(p.fr, 2) + "% · 播放 " + p.play.toLocaleString() })
        ])
      ]));
    });

    var tb = $("#rate-table");
    clear(tb);
    tb.appendChild(el("tr", {}, [el("th", { text: "粉丝档" }), el("th", { text: "图文" }), el("th", { text: "视频" })]));
    C.bizRates.rows.forEach(function (r) {
      tb.appendChild(el("tr", {}, [el("td", { text: r.tier }), el("td", { text: r.post }), el("td", { text: r.video })]));
    });
    $("#rate-note").textContent = C.bizRates.note + "（记录于 " + C.bizRates.recordedAt + "）";

    var dl = $("#deal-list");
    clear(dl);
    if (!state.deals.length) dl.appendChild(el("div", { class: "empty", text: "还没有商单记录" }));
    state.deals.forEach(function (d) {
      dl.appendChild(el("div", { class: "deal" }, [
        el("div", { class: "dl" }, [el("b", { text: d.brand }), el("span", { text: (d.amount || "—") + " · " + d.status })]),
        el("button", { type: "button", "aria-label": "删除", text: "✕", onclick: function () { removeFrom("deals", d.id, d.brand); } })
      ]));
    });
  }

  /* =====================================================================
     路由
     旧版切视图只改 class，刷新回到工作台、后退直接退出 PWA、也没法收藏某一页
     ===================================================================== */

  var VIEWS = ["board", "hot", "review", "biz", "rivals"];
  var currentView = "board";
  var calMode = false;
  var suggestedLoaded = false;

  /*
   * 只渲染当前看得见的那个视图。
   *
   * 旧版每次 refresh() 都把 8 个模块全渲一遍（含日历的 42 个格子），
   * 其中 7 个是 hidden 的 —— 纯粹白烧主线程。改完之后每次操作的
   * 渲染量大概只有原来的六分之一。
   */
  function renderActiveView() {
    if (currentView === "board") {
      if (calMode) renderCalendar();
      else { renderTagFilters(); renderBoard(); }
    } else if (currentView === "hot") {
      if (!suggestedLoaded) { suggestedLoaded = true; whenIdle(loadSuggested); }
      renderHot();
    } else if (currentView === "review") {
      renderReviewForm(); renderInsights(); renderReviews();
    } else if (currentView === "biz") {
      renderBiz();
    } else if (currentView === "rivals") {
      renderRivals();
    }
  }

  function go(view, silent) {
    if (VIEWS.indexOf(view) < 0) view = "board";
    currentView = view;
    VIEWS.forEach(function (v) { document.getElementById("view-" + v).hidden = v !== view; });
    $$(".tab").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.view === view ? "true" : "false"); });
    if (!silent && location.hash.slice(1).split("?")[0] !== view) location.hash = view;
    renderActiveView();
  }

  function readHash() {
    var raw = location.hash.slice(1);
    var view = raw.split("?")[0] || "board";
    go(view, true);
    if (/[?&]new=1/.test(raw)) { openIdea(null); location.hash = view; }
  }

  /* =====================================================================
     同步 UI
     ===================================================================== */

  function banner(id, tone, text, actions) {
    var box = $("#banners");
    var old = document.getElementById(id);
    if (old) old.remove();
    var b = el("div", { class: "banner " + tone, id: id }, [el("span", { class: "grow", text: text })]);
    (actions || []).forEach(function (a) {
      b.appendChild(el("button", { class: "btn btn-sm", type: "button", text: a.label, onclick: a.fn }));
    });
    b.appendChild(el("button", { class: "btn btn-sm", type: "button", text: "知道了", onclick: function () { b.remove(); } }));
    box.appendChild(b);
  }

  function updateSyncButton() {
    var b = $("#btn-sync");
    var st = Sync.status();
    b.className = "sync-btn" + (st.enabled ? (st.writable ? " on" : " warn") : "");
    b.textContent = !st.enabled ? "本地" : st.writable ? "已同步" : "只读";
    b.title = !st.enabled ? "数据只存在这台设备上" :
      st.writable ? "云端同步正常（" + (st.type === "github" ? "GitHub Gist" : st.type) + "）" :
      "云端读不到，已暂停写入以免覆盖";
    $("#foot-storage").textContent = st.enabled ? (st.writable ? "云端同步中" : "只读模式") : "仅本机存储";
  }

  Sync.on(function (ev) {
    if (ev.kind === "readonly") {
      readonlyCloud = true;
      banner("b-readonly", "danger",
        "云端读不到（" + ev.message + "）。已暂停写云端，避免把本机的旧数据覆盖上去。你的改动仍在本机保存。",
        [
          { label: "重试", fn: function () { location.reload(); } },
          { label: "以本机为准覆盖云端", fn: function () {
              Sync.forcePush(state).then(function () { toast("已用本机数据覆盖云端"); updateSyncButton(); $("#b-readonly") && $("#b-readonly").remove(); })
                .catch(function (e) { toast("还是失败：" + e.message, { tone: "bad" }); });
            } }
        ]);
    }
    if (ev.kind === "conflict") {
      banner("b-conflict", "warn",
        "另一台设备改过云端数据（云端 " + String(ev.remoteAt).slice(0, 16).replace("T", " ") + "）。为免互相覆盖，已暂停写入。",
        [
          { label: "拉取云端版本", fn: function () { doPull(); } },
          { label: "以本机为准", fn: function () {
              Sync.forcePush(state).then(function () { toast("已覆盖云端"); updateSyncButton(); $("#b-conflict") && $("#b-conflict").remove(); })
                .catch(function (e) { toast("失败：" + e.message, { tone: "bad" }); });
            } }
        ]);
    }
    if (ev.kind === "push-failed") toast("云端保存失败：" + ev.message + "（本机已存）", { tone: "bad" });
    if (ev.kind === "local-full") toast(ev.message, { tone: "bad" });
    updateSyncButton();
  });

  function fillSyncModal() {
    var cfg = Sync.getCfg() || {};
    var isGh = !cfg.type || cfg.type === "github";
    $("#sync-token").value = isGh ? (cfg.token || "") : "";
    $("#sync-remember").checked = cfg.remember !== false;
    $("#sync-gist").value = cfg.gistId || "";
    $("#wrap-gist").hidden = !cfg.gistId;
    $("#sync-url").value = cfg.type === "supabase" ? (cfg.url || "") : "";
    $("#sync-key").value = cfg.type === "supabase" ? (cfg.key || "") : "";
    var st = Sync.status();
    var line = $("#sync-status");
    line.className = "status-line " + (st.writable ? "ok" : st.enabled ? "bad" : "");
    line.textContent = "状态：" + (!st.enabled ? "仅本地保存" : st.writable ? "云端同步正常" : "只读（云端读不到，已暂停写入）");
  }

  function openSync() {
    fillSyncModal();
    hidePairing();
    openModal("modal-sync", hidePairing);   // 关窗时也要把令牌从 DOM 里擦掉
  }

  /* =====================================================================
     设备配对
     在手机上重新申请一次 GitHub 令牌要走十来步，还得用手机键盘敲一长串。
     这里把已连接设备上的凭证编成一个二维码，另一台设备扫一下就完成配对。
     凭证走的是「屏幕 → 摄像头」，不经过网络，也不经过任何第三方。

     安全上做了三件事：
       1. 配对链接放在 URL 的 # 片段里 —— 浏览器不会把它发给服务器
       2. 另一台设备一打开就立刻清掉地址栏，不留在历史记录
       3. 内置 10 分钟有效期，万一被截图了过期也用不了
     ===================================================================== */

  var pairTimer = null;

  function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(s) {
    var b = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    return decodeURIComponent(escape(atob(b)));
  }

  function buildPairURL() {
    var cfg = Sync.getCfg() || {};
    var p = { exp: Date.now() + 10 * 60 * 1000 };
    if (cfg.type === "supabase") {
      if (!cfg.url || !cfg.key) return null;
      p.ty = "supabase"; p.u = cfg.url; p.k = cfg.key;
    } else {
      if (!cfg.token) return null;
      p.ty = "github"; p.t = cfg.token; if (cfg.gistId) p.g = cfg.gistId;
    }
    return location.origin + location.pathname + "#pair=" + b64urlEncode(JSON.stringify(p));
  }

  function loadQRLib() {
    if (window.QRCode) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js";
      s.onload = function () { resolve(!!window.QRCode); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
  }

  function showPairing() {
    var url = buildPairURL();
    if (!url) { toast("这台设备还没连上云端，先在上面填令牌并连接", { tone: "bad" }); return; }
    $("#pair-panel").hidden = false;
    $("#pair-link").value = url;

    var canvas = $("#pair-qr");
    var fb = $("#pair-fallback");
    canvas.hidden = false; fb.hidden = true;
    loadQRLib().then(function (ok) {
      if (!ok) { canvas.hidden = true; fb.hidden = false; return; }
      window.QRCode.toCanvas(canvas, url, { width: 208, margin: 1 }, function (err) {
        if (err) { canvas.hidden = true; fb.hidden = false; }
      });
    });

    clearTimeout(pairTimer);
    pairTimer = setTimeout(function () {
      hidePairing();
      toast("配对码已过期，需要的话重新点一次");
    }, 10 * 60 * 1000);
  }

  function hidePairing() {
    clearTimeout(pairTimer);
    var panel = $("#pair-panel");
    if (!panel) return;
    panel.hidden = true;
    $("#pair-link").value = "";     // 别把令牌留在 DOM 里
    var pin = $("#pair-in"); if (pin) pin.value = "";
    var c = $("#pair-qr");
    if (c && c.getContext) c.getContext("2d").clearRect(0, 0, c.width, c.height);
  }

  // 把配对码还原成一份同步配置；出问题就抛出中文原因
  function decodePair(code) {
    var p;
    try { p = JSON.parse(b64urlDecode(code)); }
    catch (e) { throw new Error("配对码读不出来，请在另一台设备上重新生成一个"); }

    if (p.exp && Date.now() > p.exp) throw new Error("配对码已过期（超过 10 分钟），请重新生成一个");

    var cfg = { remember: true, type: p.ty === "supabase" ? "supabase" : "github" };
    if (cfg.type === "supabase") { cfg.url = p.u; cfg.key = p.k; }
    else { cfg.token = p.t; if (p.g) cfg.gistId = p.g; }

    if (!(cfg.token || (cfg.url && cfg.key))) throw new Error("配对码不完整，请重新生成");
    return cfg;
  }

  // 从一段文本里把配对码抠出来：整条链接、或者光秃秃的码，都认
  function extractPairCode(text) {
    text = String(text || "").trim();
    var m = text.match(/pair=([A-Za-z0-9\-_]+)/);
    if (m) return m[1];
    if (/^[A-Za-z0-9\-_]{24,}$/.test(text)) return text;
    return null;
  }

  /*
   * 用配对码连接。
   *
   * 为什么需要这条路：iOS 上主屏幕图标和 Safari 是两套完全独立的存储
   * （cookie / localStorage / Service Worker 都不共享），所以在 Safari 里
   * 配好的令牌，PWA 里看不到。而扫码只会在 Safari 里打开，进不了 PWA。
   * 剪贴板是跨 App 通的，所以走「复制配对码 → 在 PWA 里粘贴」。
   */
  function applyPairCode(text) {
    var code = extractPairCode(text);
    if (!code) {
      toast("这不像是配对码。在另一台设备上点「生成配对码」再点「复制链接」，然后粘过来", { tone: "bad", timeout: 12000 });
      return;
    }
    var cfg;
    try { cfg = decodePair(code); }
    catch (e) { toast(e.message, { tone: "bad", timeout: 12000 }); return; }
    $("#pair-in").value = "";
    runConnect(cfg);
  }

  // 启动最早期调用：必须在读云端之前把凭证就位
  function consumePairing() {
    var m = location.hash.match(/[#&]pair=([A-Za-z0-9\-_]+)/);
    if (!m) return false;

    // 先清地址栏，再做别的 —— 不能让令牌留在浏览历史里
    try { history.replaceState(null, "", location.pathname + location.search); }
    catch (e) { location.hash = ""; }

    var cfg;
    try { cfg = decodePair(m[1]); }
    catch (e) { toast(e.message, { tone: "bad", timeout: 12000 }); return false; }

    Sync.saveCfg(cfg);
    return true;
  }

  function runConnect(cfg) {
    var line = $("#sync-status");
    line.className = "status-line";
    line.textContent = "状态：正在连接…";
    return Sync.connect(cfg, state).then(function (res) {
      if (res.mode === "adopted") {
        state = normalize(res.state);
        dirty = false;
        toast("连上了，已切换成云端那份数据");
      } else {
        toast("连上了，本机数据已作为第一份推上云端");
      }
      refresh();
      updateSyncButton();
      Sync.getGistId().then(function (id) {
        if (id) { $("#sync-gist").value = id; $("#wrap-gist").hidden = false; }
      }).catch(function () {});
      line.className = "status-line ok";
      line.textContent = "状态：云端同步正常";
    }).catch(function (e) {
      line.className = "status-line bad";
      line.textContent = "状态：连接失败 — " + e.message;
      toast("连接失败：" + e.message, { tone: "bad", timeout: 12000 });
    });
  }

  function doConnect() {
    var token = $("#sync-token").value.trim();
    var url = $("#sync-url").value.trim();
    var key = $("#sync-key").value.trim();
    var remember = $("#sync-remember").checked;

    // 有人会把配对链接直接贴进令牌框，认一下，省得他们再找一遍
    var asPair = extractPairCode(token);
    if (asPair && token.indexOf("pair=") >= 0) { applyPairCode(token); return; }

    var cfg;
    if (url && key) cfg = { type: "supabase", url: url, key: key, remember: remember };
    else if (token) cfg = { type: "github", token: token, gistId: $("#sync-gist").value.trim() || undefined, remember: remember };
    else { toast("填一个 GitHub 令牌，或者用下面的配对码", { tone: "bad" }); return; }

    runConnect(cfg);
  }

  function doPull() {
    Sync.pull().then(function (d) {
      if (!d) { toast("云端还没有数据"); return; }
      state = normalize(d);
      refresh(); updateSyncButton();
      var b = $("#b-conflict"); if (b) b.remove();
      var b2 = $("#b-readonly"); if (b2) b2.remove();
      toast("已拉取云端最新数据");
    }).catch(function (e) { toast("拉取失败：" + e.message, { tone: "bad" }); });
  }

  function exportBackup() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = el("a", { href: URL.createObjectURL(blob), download: "工作台备份-" + today() + ".json" });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    toast("已导出备份");
  }

  function importBackup(file) {
    var r = new FileReader();
    r.onload = function () {
      var parsed;
      try { parsed = JSON.parse(r.result); } catch (e) { toast("文件读不了，可能不是备份文件", { tone: "bad" }); return; }
      if (!parsed || !Array.isArray(parsed.ideas)) { toast("这不像是工作台的备份", { tone: "bad" }); return; }
      var backup = state;
      state = normalize(parsed);
      persist(); refresh();
      toast("已导入备份", { action: "撤销", onAction: function () { state = backup; persist(); refresh(); } });
    };
    r.readAsText(file);
  }

  function loadDemo() {
    var base = normalize(blankState());
    base.profile = Object.assign(base.profile, SEED.profile);
    base.hotspots = SEED.hotspots.map(function (h) { return Object.assign({ id: uid(), addedAt: today(), used: false }, h); });
    base.rivals = SEED.rivals.map(function (r) { return Object.assign({ id: uid() }, r); });
    base.ideas = SEED.ideas.map(function (i) {
      var o = Object.assign({}, i);
      o.due = fmtDate(addDays(new Date(), o.dueOffset || 0));   // 旧版把日期写死在种子里，一上线就是过期任务
      delete o.dueOffset;
      return o;
    });
    base.meta.initialized = true;
    base.meta.demo = true;
    state = normalize(base);
    persist(); refresh();
  }

  function resetAll() {
    var backup = state;
    state = normalize(blankState());
    state.meta.initialized = true;
    persist(); refresh();
    toast("已清空", { action: "撤销", onAction: function () { state = backup; persist(); refresh(); } });
  }

  /* =====================================================================
     主题
     ===================================================================== */

  /*
   * 主题另外存一个极小的 key。
   * index.html 头部有段内联脚本会同步读它，在第一帧之前就把 data-theme 设好 ——
   * 否则深色模式用户每次打开都会先闪一下白屏。读整个 state 太慢，所以单独存。
   */
  function applyTheme() {
    var t = state.ui.theme;
    if (t) document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    try {
      if (t) localStorage.setItem("xhs_theme", t);
      else localStorage.removeItem("xhs_theme");
    } catch (e) {}
  }
  function toggleTheme() {
    var cur = state.ui.theme;
    var sysDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    state.ui.theme = cur ? (cur === "dark" ? "light" : null) : (sysDark ? "light" : "dark");
    applyTheme(); persist();
    toast(state.ui.theme ? ("已切到" + (state.ui.theme === "dark" ? "深色" : "浅色")) : "跟随系统");
  }

  /* =====================================================================
     自检
     这几个纯函数算错是静默的 —— 你不会发现，但会照着错的数字做决定。
     打开 ?selftest=1 就会跑一遍。
     ===================================================================== */

  function selfTest() {
    var fails = [];
    function ok(name, cond) { if (!cond) fails.push(name); }

    ok("startOfWeek 周三应回到周一", fmtDate(startOfWeek(new Date(2026, 6, 29))) === "2026-07-27");
    ok("startOfWeek 周日应回到上周一", fmtDate(startOfWeek(new Date(2026, 7, 2))) === "2026-07-27");
    ok("startOfWeek 周一应是自己", fmtDate(startOfWeek(new Date(2026, 6, 27))) === "2026-07-27");
    ok("fmtDate 补零", fmtDate(new Date(2026, 0, 5)) === "2026-01-05");
    ok("daysBetween", daysBetween(parseDate("2026-07-01"), parseDate("2026-07-08")) === 7);
    ok("median 奇数", median([3, 1, 2]) === 2);
    ok("median 偶数", median([1, 2, 3, 4]) === 2.5);
    ok("median 空", median([]) === null);
    ok("bucketOfHour 晚间", bucketOfHour(20) === "evening");
    ok("bucketOfHour 跨零点", bucketOfHour(1) === "night" && bucketOfHour(23) === "night");
    ok("bucketOfHour 边界", bucketOfHour(11) === "noon" && bucketOfHour(14) === "after");
    ok("hourOf", hourOf("2026-07-29T20:30") === 20);
    ok("hourOf 空", hourOf("") === null);
    ok("合规去重 ChatGPT 不重复报 GPT", scanCompliance("我用 ChatGPT 做的").length === 1);
    ok("合规能查绝对化用语", scanCompliance("这是全网最好的方法").length >= 2);
    ok("合规空文本", scanCompliance("").length === 0);
    ok("followRate", round(followRate({ play: 1000, follow: 25 }), 1) === 2.5);
    ok("engageRate", round(engageRate({ play: 1000, like: 40, save: 60 }), 1) === 10);
    ok("num 容错", num("abc") === 0 && num("12") === 12);
    ok("normalize 旧阶段映射", normalize({ ideas: [{ stage: "edit" }, { stage: "review" }] }).ideas
      .map(function (i) { return i.stage; }).join(",") === "making,published");
    ok("normalize 旧字段改名", normalize({ profile: { startFans: 320 } }).profile.fansNow === 320);
    ok("normalize 旧 tag 转数组", normalize({ ideas: [{ tag: "AI实操" }] }).ideas[0].tags[0] === "AI实操");

    if (fails.length) {
      console.error("[自检] 失败：", fails);
      toast("自检失败 " + fails.length + " 项，见控制台", { tone: "bad", timeout: 20000 });
    } else {
      console.log("[自检] 全部通过");
      toast("自检全部通过", { timeout: 6000 });
    }
    return fails;
  }

  /* =====================================================================
     刷新与绑定
     ===================================================================== */

  function refresh() {
    applyTheme();
    renderStatusbar();
    renderActiveView();
    updateSyncButton();
  }

  function bind() {
    $$(".tab").forEach(function (b) { b.onclick = function () { go(b.dataset.view); }; });
    window.addEventListener("hashchange", readHash);

    $("#btn-new").onclick = function () { openIdea(null); };
    $("#m-save").onclick = saveIdea;
    $("#m-del").onclick = function () { var id = editingId; closeModal($("#modal-idea")); removeIdea(id); };
    $("#m-clone").onclick = function () { var id = editingId; closeModal($("#modal-idea")); cloneIdea(id); };

    var qTimer;
    $("#q").addEventListener("input", function (e) {
      clearTimeout(qTimer);
      qTimer = setTimeout(function () { filterText = e.target.value; renderBoard(); }, 160);
    });

    $("#mode-board").onclick = function () { setMode("board"); };
    $("#mode-cal").onclick = function () { setMode("cal"); };
    $("#cal-prev").onclick = function () { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1); renderCalendar(); };
    $("#cal-next").onclick = function () { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1); renderCalendar(); };
    $("#cal-today").onclick = function () { calCursor = new Date(); renderCalendar(); };

    $("#btn-new-hot").onclick = function () { editHotspot(null); };
    $("#btn-new-rival").onclick = function () { editRival(null); };
    $("#btn-hot-refresh").onclick = function () { loadSuggested().then(function () { toast("已重新读取"); }); };

    $("#rv-form").addEventListener("submit", submitReview);
    $("#rv-idea").addEventListener("change", function (e) { renderRecall(e.target.value); });

    $("#fans-save").onclick = function () {
      var v = Number($("#fans-input").value);
      if (!isFinite(v) || v < 0) { toast("填个数字", { tone: "bad" }); return; }
      state.profile.fansNow = v;
      var d = today();
      var exist = state.fansHistory.find(function (p) { return p.date === d; });
      if (exist) exist.count = v; else state.fansHistory.push({ date: d, count: v });
      state.fansHistory.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      $("#fans-input").value = "";
      persist(); renderBiz(); renderStatusbar();
      toast("记下了 " + v + " 粉");
    };

    fillSelect($("#deal-status"), C.dealStatus.map(function (s) { return { k: s, n: s }; }), "k", "n");
    $("#deal-add").onclick = function () {
      var brand = $("#deal-brand").value.trim();
      if (!brand) { toast("填一下品牌名", { tone: "bad" }); return; }
      state.deals.push({ id: uid(), brand: brand, amount: $("#deal-amount").value.trim(), status: $("#deal-status").value, at: today() });
      $("#deal-brand").value = ""; $("#deal-amount").value = "";
      persist(); renderBiz();
    };

    $("#btn-sync").onclick = openSync;
    $("#btn-settings").onclick = openSync;
    $("#sync-connect").onclick = doConnect;
    $("#btn-pull").onclick = doPull;
    $("#btn-export").onclick = exportBackup;
    $("#btn-import").onclick = function () { $("#import-file").click(); };
    $("#import-file").onchange = function (e) { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ""; };
    $("#btn-clear-creds").onclick = function () {
      Sync.clearCreds();
      updateSyncButton();
      fillSyncModal();          // 弹窗还开着，只刷字段，别再 openModal 一次把栈搞乱
      toast("令牌已从这台设备清除，数据仍在本机");
    };
    $("#btn-reset").onclick = function () { closeModal($("#modal-sync")); resetAll(); };
    $("#btn-theme").onclick = toggleTheme;

    $("#btn-pair").onclick = showPairing;
    $("#btn-pair-hide").onclick = hidePairing;
    $("#btn-pair-apply").onclick = function () { applyPairCode($("#pair-in").value); };
    $("#pair-in").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); applyPairCode($("#pair-in").value); }
    });
    $("#btn-pair-read").onclick = function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        $("#pair-in").focus();
        toast("这个浏览器不给读剪贴板，请在上面的框里长按粘贴", { tone: "bad", timeout: 8000 });
        return;
      }
      navigator.clipboard.readText().then(
        function (t) {
          if (!t) { toast("剪贴板是空的", { tone: "bad" }); return; }
          $("#pair-in").value = t.trim();
          applyPairCode(t);
        },
        function () {
          $("#pair-in").focus();
          toast("读不到剪贴板（可能被拒绝了），请在上面的框里长按粘贴", { tone: "bad", timeout: 8000 });
        }
      );
    };
    $("#btn-pair-copy").onclick = function () {
      var v = $("#pair-link").value;
      if (!v) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(
          function () { toast("已复制。10 分钟内有效，用完记得从聊天记录里删掉"); },
          function () { $("#pair-link").select(); toast("复制失败，已选中，请手动复制", { tone: "bad" }); }
        );
      } else {
        $("#pair-link").select();
        toast("已选中，请手动复制");
      }
    };

    $("#first-demo").onclick = function () { closeModal($("#modal-first")); loadDemo(); toast("示例已加载，随时可以在「数据与备份」里清空"); };
    $("#first-blank").onclick = function () { closeModal($("#modal-first")); state.meta.initialized = true; persist(); refresh(); };
  }

  function setMode(m, silent) {
    calMode = m === "cal";
    $("#pane-board").hidden = calMode;
    $("#pane-cal").hidden = !calMode;
    $("#mode-board").setAttribute("aria-pressed", calMode ? "false" : "true");
    $("#mode-cal").setAttribute("aria-pressed", calMode ? "true" : "false");
    if (silent) return;                    // 启动时由 readHash 统一渲染，别渲两遍
    if (calMode) renderCalendar(); else renderBoard();
  }

  /* =====================================================================
     启动
     ===================================================================== */

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("sw.js").then(function (reg) {
      // 缓存策略是「先给缓存再后台更新」，所以主动催一次版本检查，
      // 保证新版本最多晚一次打开就能拿到
      try { reg.update(); } catch (e) {}
      reg.addEventListener("updatefound", function () {
        var sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", function () {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            toast("有新版本", { action: "刷新", timeout: 15000, onAction: function () { sw.postMessage("skip-waiting"); location.reload(); } });
          }
        });
      });
    }).catch(function (e) { console.warn("SW 注册失败", e); });
  }

  /*
   * 云端回来之后的对账。
   *
   * 界面早就用本地数据画出来了，这里判断能不能把它换成云端那份：
   *   - 你还没动过任何东西 → 直接换，静默刷新
   *   - 你已经改过了 → 不能覆盖你的改动，挂冲突条让你自己选
   */
  function reconcileCloud(res, paired) {
    if (res.src === "cloud" && res.state) {
      if (JSON.stringify(res.state) === JSON.stringify(state)) {
        updateSyncButton();
        if (paired) toast("配对成功，数据已经是最新的", { timeout: 6000 });
        return;
      }
      if (dirty) {
        banner("b-conflict", "warn",
          "云端有一份和本机不一样的数据，而你刚才已经改过东西了。为免覆盖，先由你决定。",
          [
            { label: "用云端的", fn: function () {
                state = normalize(res.state); dirty = false; refresh();
                var b = $("#b-conflict"); if (b) b.remove();
                toast("已切换成云端那份");
              } },
            { label: "保留本机的", fn: function () {
                Sync.forcePush(state).then(function () {
                  updateSyncButton();
                  var b = $("#b-conflict"); if (b) b.remove();
                  toast("已用本机数据覆盖云端");
                }).catch(function (e) { toast("失败：" + e.message, { tone: "bad" }); });
              } }
          ]);
        return;
      }
      state = normalize(res.state);
      refresh();
      toast(paired ? "配对成功，已同步到你其它设备上的那份数据" : "已从云端更新", { timeout: paired ? 8000 : 2600 });
      return;
    }

    if (res.src === "local-readonly") {
      readonlyCloud = true;
      if (paired) toast("配对了，但云端读不通：" + (res.error || ""), { tone: "bad", timeout: 15000 });
      // 只读横幅由 Sync 的事件回调统一挂，这里不重复
    } else if (res.src === "cloud-empty" && paired) {
      toast("配对成功，云端还是空的，这台设备的数据会作为第一份推上去", { timeout: 10000 });
    }
    updateSyncButton();
  }

  // 浏览器闲下来再做，别跟首屏渲染抢主线程
  function whenIdle(fn) {
    if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 2000 });
    else setTimeout(fn, 300);
  }

  /*
   * 启动。
   *
   * 旧版是 await Sync.load() 之后才画界面 —— 等于每次打开都要先做一次
   * 网络往返，手机信号差的时候就是两三秒白屏。
   *
   * 现在分三步：本地数据同步读出来立刻画（几十毫秒）→ 云端后台对账 →
   * 次要的东西等空闲。感知上就是「点开就在」。
   */
  function boot() {
    initIdeaModal();
    bind();

    var paired = consumePairing();   // 必须最先跑，扫码进来的凭证要先就位

    /* 第一步：本地数据，立刻画 */
    var local = null;
    try { local = Sync.loadLocal(); } catch (e) { console.warn("本地数据读取失败", e); }
    state = normalize(local);

    applyTheme();
    activeStage = state.ideas.some(function (i) { return i.stage === "script"; }) ? "script" : "pool";
    setMode("board", true);
    readHash();              // 内部只渲染当前视图，整个启动只渲染一次
    renderStatusbar();
    updateSyncButton();
    $("#foot-version").textContent = "版本 " + C.build;

    if (!state.meta.initialized && !state.ideas.length && !Sync.cloudEnabled()) {
      openModal("modal-first");
    }

    /* 第二步：云端后台对账，不挡界面 */
    if (Sync.cloudEnabled()) {
      Sync.loadCloud()
        .then(function (res) { reconcileCloud(res, paired); })
        .catch(function (e) { console.warn("云端加载失败", e); updateSyncButton(); });
    }

    /* 第三步：等浏览器空了再做 */
    whenIdle(function () {
      registerSW();
      if (/[?&]selftest=1/.test(location.search)) selfTest();
    });
  }

  window.__wb = { selfTest: selfTest, getState: function () { return state; } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
