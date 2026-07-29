/*
 * config.js — 全站唯一配置源
 * 平台规则会变。以前 1000 / 5000 这些数字散落在三四个文件里，改一次要全局搜索。
 * 现在只改这里。
 */
window.CONFIG = {
  build: "2026-07-29",
  version: 4,

  goals: {
    fans: 5000,
    pgyThreshold: 1000,
    weeklyPosts: 3,
    thresholdNote: "蒲公英入驻门槛以官方最新公告为准，请定期核对"
  },

  stages: [
    { key: "pool",      name: "灵感池",  hint: "想到就丢进来" },
    { key: "script",    name: "写脚本",  hint: "钩子 + 三段式" },
    { key: "making",    name: "制作中",  hint: "拍摄 / 剪辑" },
    { key: "published", name: "已发布",  hint: "等数据回流" }
  ],

  subStages: [
    { key: "shoot", name: "拍摄" },
    { key: "edit",  name: "剪辑" }
  ],

  hookTypes: [
    { key: "question", name: "提问式",   eg: "你是不是也每次做 PPT 都熬到半夜？" },
    { key: "result",   name: "结果前置", eg: "3 小时的活，我 3 分钟做完了" },
    { key: "contrast", name: "反差对比", eg: "同样的图，左边花了我 2 天，右边 2 分钟" },
    { key: "secret",   name: "信息差",   eg: "海外在疯传，国内还很少有人知道" },
    { key: "story",    name: "故事开场", eg: "上周我差点因为一个 PPT 被老板骂哭" },
    { key: "other",    name: "其它",     eg: "" }
  ],

  platforms: [
    { key: "xhs", name: "小红书" },
    { key: "dy",  name: "抖音" }
  ],

  dealStatus: ["洽谈中", "已签约", "已结款"],

  /*
   * 诊断阈值。
   * 冷启动（复盘不足 baselineMinSamples 条）用这套绝对值；
   * 攒够之后自动切换成跟你自己近 baselineWindow 条的中位数比较。
   */
  diagnose: {
    baselineMinSamples: 5,
    baselineWindow: 10,
    cold: { ret2: 40, finish: 15, engage: 5, follow: 0.5 }
  },

  /*
   * 合规词库。可在设置里增删，改动存本地。
   * brand  —— 海外品牌名，小红书站内提及可能限流
   * absolute —— 绝对化用语，《广告法》高风险词，实测比品牌名更容易被限
   * induce —— 诱导互动，平台明确打击
   */
  compliance: {
    brand: [
      ["ChatGPT", "海外某对话AI"], ["GPT", "海外某对话AI"],
      ["Claude", "海外某对话AI"], ["Anthropic", "海外某AI公司"],
      ["OpenAI", "海外某AI公司"], ["Midjourney", "海外某绘图AI"],
      ["Perplexity", "海外某搜索AI"], ["Gemini", "海外某AI"],
      ["Grok", "海外某AI"], ["Poe", "海外某AI助手"],
      ["Twitter", "海外某社交平台"], ["推特", "海外某社交平台"],
      ["Discord", "海外某社群平台"], ["Reddit", "海外某论坛"],
      ["YouTube", "海外某视频平台"], ["油管", "海外某视频平台"]
    ],
    absolute: [
      ["最好", "很好用"], ["最强", "很能打"], ["最牛", "很能打"],
      ["第一", "很靠前"], ["唯一", "少见的"], ["100%", "基本上"],
      ["百分百", "基本上"], ["绝对", "基本"], ["必看", "推荐看"],
      ["永久", "长期"], ["彻底", "大幅"], ["国家级", "行业内"],
      ["顶级", "很不错"], ["史上", "目前"], ["全网", "不少平台"]
    ],
    induce: [
      ["点赞关注", "有用的话留个眼熟"], ["双击", "顺手点一下"],
      ["扣1", "评论区聊聊"], ["求关注", "想看下期就留个眼熟"],
      ["私信我", "评论区见"], ["加微信", "主页有联系方式"]
    ]
  },

  /* 报价参考。行业数字会过期，所以带上记录日期，UI 会显示。 */
  bizRates: {
    recordedAt: "2026-07",
    note: "AI / 科技赛道通常溢价 30–50%。数字来自公开信息，仅供还价时心里有底，不是标准。",
    rows: [
      { tier: "1k – 5k",   post: "300 – 800",     video: "800 – 2,000" },
      { tier: "5k – 10k",  post: "800 – 2,000",   video: "2,000 – 5,000" },
      { tier: "10k – 50k", post: "2,000 – 6,000", video: "5,000 – 15,000" },
      { tier: "50k+",      post: "6,000 – 20,000", video: "15,000 – 50,000" }
    ]
  },

  /* 发布时段分桶，用于「什么时候发效果最好」 */
  hourBuckets: [
    { key: "morning", name: "早 6–11 点",  from: 6,  to: 11 },
    { key: "noon",    name: "午 11–14 点", from: 11, to: 14 },
    { key: "after",   name: "下午 14–18 点", from: 14, to: 18 },
    { key: "evening", name: "晚 18–22 点", from: 18, to: 22 },
    { key: "night",   name: "深夜 22–6 点", from: 22, to: 6 }
  ]
};
