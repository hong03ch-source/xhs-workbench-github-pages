/*
 * fetch-hotspots.mjs —— 每周一次的热点聚合
 *
 * 做的事：用 Claude API 自带的 web_search 工具，搜公开网络上关于「抖音 / 小红书
 * AI 赛道最近在火什么」的公开信息（榜单聚合页、行业报道、第三方数据站、被搜索
 * 引擎收录的内容），归纳成选题建议，写进 data/hotspots.json。
 *
 * 明确不做的事：不访问抖音 / 小红书的任何接口，不绕过登录，不抓取受限内容。
 * 搜索的是搜索引擎已经公开索引的东西，跟你自己去 Google 搜一遍是同一类行为。
 *
 * 为什么每条都必须带来源链接：
 *   搜回来的东西里一定混着营销号，AI 归纳完之后看起来和真榜单一模一样。
 *   没有来源你没法分辨。有来源你能一眼判断值不值得信。
 *   所以下面的 prompt 里把「没有来源就不要输出这条」写成了硬要求。
 *
 * 本地跑一次：ANTHROPIC_API_KEY=sk-ant-xxx node scripts/fetch-hotspots.mjs
 */

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "hotspots.json");

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.HOTSPOT_MODEL || "claude-sonnet-5";
const MAX_SEARCHES = Number(process.env.HOTSPOT_MAX_SEARCHES || 6);
const WANT = Number(process.env.HOTSPOT_COUNT || 5);

if (!API_KEY) {
  console.error("没有 ANTHROPIC_API_KEY，跳过本次更新（不算失败）。");
  console.error("加到仓库 Settings → Secrets and variables → Actions 里即可。");
  process.exit(0);
}

const now = new Date();
const ym = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;

const PROMPT = `你在帮一位小红书 / 抖音的 AI 赛道视频博主找选题方向。她的定位是「AI 陪跑」：
面向小白，讲实操和信息差，人设是「和你一样是新手，但我先踩了坑」。目前处于涨粉期。

请用网络搜索，找出 ${ym} 前后，中文互联网上关于「抖音 / 小红书 AI 相关内容正在火什么」
的公开信息。可以搜的方向举例：AI 赛道内容趋势报道、第三方数据平台的公开榜单页、
行业周报月报、平台官方发布的创作方向、被搜索引擎收录的爆款内容标题与讨论。

严格要求：

1. 每一条都必须有真实可点开的来源链接。搜不到来源的，就不要输出这一条。
   宁可只给 2 条有据可查的，也不要凑够 ${WANT} 条。这一点比数量重要得多。
2. 不要编造具体数字。如果来源里没写点赞量 / 播放量，就不要写。
   来源里有的可以引用，但要说明是哪家、什么时间的数据。
3. 区分「方向在火」和「某条视频爆了」。搜索能可靠拿到的通常是前者，
   如果你只有方向级的信息，就老实按方向级来写，不要包装成具体爆款。
4. angle 字段要落到这位博主身上：她能怎么做这个选题，而不是泛泛的「可以讲讲这个」。
5. suggestedTitle 要是一个能直接用的视频标题，口语、有钩子、不超过 22 个字。
6. tip 写这条选题的注意事项，特别是发小红书时的合规风险
   （海外品牌名、绝对化用语如「最」「第一」「100%」、诱导互动措辞）。

只输出 JSON，不要任何解释文字、不要 markdown 代码块。格式：

{
  "items": [
    {
      "title": "这个热点是什么（一句话）",
      "platform": "小红书" | "抖音" | "两个都有",
      "heat": "高" | "中高" | "中",
      "why": "为什么火，讲机制不讲形容词",
      "angle": "她具体能怎么做这一条",
      "suggestedTitle": "可以直接用的视频标题",
      "tip": "注意事项 / 合规提醒",
      "sources": [{ "title": "来源标题", "url": "https://..." }]
    }
  ],
  "note": "这批结果的整体可信度说明：搜到的是方向级还是具体级、时效性如何、有什么局限"
}`;

async function callClaude() {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }],
      messages: [{ role: "user", content: PROMPT }]
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

// 返回体里混着 server_tool_use / web_search_tool_result / text 块，只要 text
function extractText(msg) {
  return (msg.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function extractJSON(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("返回里找不到 JSON");
  return JSON.parse(t.slice(start, end + 1));
}

function isHttpUrl(u) {
  try {
    const p = new URL(String(u));
    return p.protocol === "https:" || p.protocol === "http:";
  } catch {
    return false;
  }
}

/*
 * 校验。模型偶尔会忘掉要求，所以这里再挡一道：
 * 没有合法来源链接的条目直接丢掉，而不是带着一条看起来很像真的假热点上线。
 */
function sanitize(raw) {
  const items = Array.isArray(raw.items) ? raw.items : [];
  const clean = [];
  const dropped = [];

  for (const it of items) {
    const sources = (Array.isArray(it.sources) ? it.sources : [])
      .filter((s) => s && isHttpUrl(s.url))
      .map((s) => ({ title: String(s.title || s.url).slice(0, 120), url: String(s.url) }))
      .slice(0, 4);

    if (!it.title || !sources.length) {
      dropped.push(it.title || "(无标题)");
      continue;
    }
    clean.push({
      title: String(it.title).slice(0, 120),
      platform: ["小红书", "抖音", "两个都有"].includes(it.platform) ? it.platform : "小红书",
      heat: ["高", "中高", "中"].includes(it.heat) ? it.heat : "中",
      why: String(it.why || "").slice(0, 400),
      angle: String(it.angle || "").slice(0, 400),
      suggestedTitle: String(it.suggestedTitle || it.title).slice(0, 60),
      tip: String(it.tip || "").slice(0, 300),
      sources
    });
  }
  return { clean, dropped };
}

async function main() {
  console.log(`模型 ${MODEL} · 最多 ${MAX_SEARCHES} 次搜索`);
  const msg = await callClaude();

  const searches = (msg.content || []).filter((b) => b.type === "server_tool_use").length;
  const usage = msg.usage || {};
  console.log(`实际搜索 ${searches} 次 · 输入 ${usage.input_tokens || "?"} tok · 输出 ${usage.output_tokens || "?"} tok`);

  const parsed = extractJSON(extractText(msg));
  const { clean, dropped } = sanitize(parsed);

  if (dropped.length) console.warn(`丢掉 ${dropped.length} 条没有来源的：${dropped.join("、")}`);
  if (!clean.length) {
    console.error("这次一条有来源的都没拿到，保留上次的结果不覆盖。");
    process.exit(0);
  }

  // 内容没变就不写，避免每周产生一个空 commit
  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch {}
  const sameAsBefore =
    prev && JSON.stringify(prev.items || []) === JSON.stringify(clean);
  if (sameAsBefore) {
    console.log("结果和上次一样，不写文件。");
    process.exit(0);
  }

  const out = {
    generatedAt: now.toISOString(),
    model: MODEL,
    searches,
    method: "Claude API 的 web_search 工具，检索公开网络索引内容；不访问平台接口",
    note: String(parsed.note || "").slice(0, 500),
    items: clean
  };

  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`写入 ${clean.length} 条到 data/hotspots.json`);
}

main().catch((e) => {
  console.error("失败：", e.message);
  process.exit(1);
});
