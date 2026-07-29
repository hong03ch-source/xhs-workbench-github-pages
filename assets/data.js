// 工作台种子数据 —— 视频博主版
// 自动化任务每天会更新 hotspots；这里内置初始内容
window.SEED = {
  profile: {
    name: "宏的AI陪跑",
    platform: "小红书视频号",
    goalFans: 5000,      // 前期涨粉目标（开蒲公英门槛附近）
    startFans: 0
  },

  // 商单报价参考（AI / 科技赛道，仅供参考）
  bizRates: [
    { tier: "1k – 5k",  post: "300 – 800",   video: "800 – 2,000" },
    { tier: "5k – 10k", post: "800 – 2,000", video: "2,000 – 5,000" },
    { tier: "10k – 50k",post: "2,000 – 6,000",video: "5,000 – 15,000" },
    { tier: "50k+",     post: "6,000 – 20,000",video: "15,000 – 50,000" }
  ],

  // 今日可二创热点（每天 9 点自动刷新，这里为初始种子）
  hotspots: [
    {
      id: "h1",
      title: "小红书 RED Skill 上线：一句话让 AI 帮你做图 / 做 PPT",
      platform: "小红书",
      heat: "高",
      why: "WAIC 刚发布，平台级流量扶持，站内 AI 话题讨论量破 160 万",
      angle: "《海外博主早就在用的“一句话生成 PPT”玩法，现在小红书也能平替了》——把你在 X 上看到的 AI 做 PPT 工作流，翻译成 RED Skill 实操",
      tip: "提「RED Skill / 小红书」安全；别点名海外模型，说「海外博主」即可"
    },
    {
      id: "h2",
      title: "AI 做 PPT 教程爆了：保姆级拆解单篇 2.2 万赞 / 4 万藏",
      platform: "小红书",
      heat: "高",
      why: "打工人 / 学生刚需，收藏率极高，是涨粉黄金赛道",
      angle: "《我把海外最火的 AI PPT 工作流，拆成 3 步国内就能抄》——你的信息差价值在“玩法”，不是工具名",
      tip: "方法论具体化，工具名用「某 AI / 国产平替」模糊化"
    },
    {
      id: "h3",
      title: "提示词模板 / 咒语分享合集持续走热",
      platform: "抖音",
      heat: "中高",
      why: "小白最爱的“伸手党”内容，转发率高",
      angle: "《海外大佬私藏的 10 条提示词，我汉化后直接能用》——用你 X 上的收藏做选题",
      tip: "只发模板不提来源平台；「外网」一词也尽量换成「我整理」"
    },
    {
      id: "h4",
      title: "国产 AI 工具横向横评（借信息差：海外早这么玩）",
      platform: "小红书",
      heat: "中",
      why: "「测评」天然带信任感，适合立专业人设",
      angle: "《国外博主测评 AI 的思路，套到国产工具上，结论意想不到》",
      tip: "重点讲“测评维度 / 思路”，工具名一笔带过"
    },
    {
      id: "h5",
      title: "AI 小白第一条视频：从 0 到发出去的全过程记录",
      platform: "抖音",
      heat: "中",
      why: "「陪跑 / 真实记录」人设最吸粉，评论区互动爆炸",
      angle: "《和你一样的小白，用 AI 搞出了第一个作品》——你的人设锚点",
      tip: "真实感 > 精致感，别怕粗糙"
    }
  ],

  // 对标博主（站外无法直接内嵌，做成拆解卡 + 一键跳转）
  rivals: [
    {
      name: "歸藏",
      tag: "RED Skill 标杆",
      why: "一篇 PPT Skill 笔记 4700+ 人用过，场景填空式教学",
      hook: "「你离高效，只差装一个 Skill」",
      learn: "把复杂 AI 能力拆成「填空式」场景，小白秒懂；学他的产品化表达",
      xhs: "https://www.xiaohongshu.com/search_result?keyword=%E6%AD%B8%E8%97%8F",
      dy: "https://www.douyin.com/search/%E6%AD%B8%E8%97%8F"
    },
    {
      name: "栗氪聊AI",
      tag: "保姆级拆解王",
      why: "一篇教程 2.2 万赞 / 4 万收藏，抢首发 + 超详细步骤",
      hook: "「手把手教你，看完就能用」",
      learn: "学他的「步骤截图 + 红框标注」视频节奏；抢热点首发窗口",
      xhs: "https://www.xiaohongshu.com/search_result?keyword=%E6%A0%97%E6%B0%AA%E8%81%8AAI",
      dy: "https://www.douyin.com/search/%E6%A0%97%E6%B0%AA%E8%81%8AAI"
    },
    {
      name: "AI工具猎人",
      tag: "合集型打法",
      why: "周更「外网最火 AI 玩法国内平替版」，信息差定位清晰",
      hook: "「海外在疯传，国内还很少有人知道」",
      learn: "学他的「周更合集」栏目化；这正是你的海外信息差主战场",
      xhs: "https://www.xiaohongshu.com/search_result?keyword=AI%E5%B7%A5%E5%85%B7%E7%8C%8E%E4%BA%BA",
      dy: "https://www.douyin.com/search/AI%E5%B7%A5%E5%85%B7%E7%8C%8E%E4%BA%BA"
    }
  ],

  // 初始选题（视频卡片，带钩子 + 封面概念）
  seedIdeas: [
    {
      id: "i1",
      title: "我用一个 AI 把 3 小时 PPT 压到 3 分钟",
      hook: "「以前做 PPT 熬到凌晨，现在喝杯咖啡就搞定」",
      cover: "前后对比：熬夜黑眼圈 vs 咖啡+成品封面",
      platform: ["xhs", "dy"],
      tag: "AI实操",
      stage: "script",
      due: "2026-07-29",
      note: ""
    },
    {
      id: "i2",
      title: "海外博主私藏的 10 条提示词，我汉化后直接能用",
      hook: "「这 10 条，我愿称之为小白外挂」",
      cover: "手机截图铺满 10 条提示词 + 高亮一条",
      platform: ["xhs"],
      tag: "AI小白",
      stage: "pool",
      due: "2026-07-30",
      note: ""
    },
    {
      id: "i3",
      title: "和你一样的小白，用 AI 做出第一个作品（全程记录）",
      hook: "「别怕，我也是昨天才第一次用」",
      cover: "真实工位自拍 + 屏幕里半成品",
      platform: ["xhs", "dy"],
      tag: "陪跑",
      stage: "pool",
      due: "2026-07-31",
      note: ""
    }
  ]
};
