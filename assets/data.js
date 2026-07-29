/*
 * data.js — 示例数据（仅在你主动选择「加载示例」时才写入）
 *
 * 和以前的区别：这些内容不再默认混进你的真实数据里。
 * 首次打开时会问你「加载示例 / 从空白开始」，选空白就一条都不会有；
 * 加载了示例之后，设置里随时可以一键清空。
 */
window.SEED = {
  profile: {
    name: "宏的AI陪跑",
    platform: "小红书视频号",
    fansNow: 0
  },

  /*
   * 热点库种子。
   * 说明：抖音 / 小红书没有公开 API，站外抓取会被风控，所以这里不做也不假装做自动抓取。
   * 这是一个「你自己维护的选题库」——刷到好东西随手记一条，比一个跑不通的定时任务有用。
   */
  hotspots: [
    {
      title: "AI 做 PPT 保姆级教程持续爆",
      platform: "小红书",
      heat: "高",
      why: "打工人 / 学生刚需，收藏率极高，是涨粉黄金赛道",
      angle: "把海外最火的 AI PPT 工作流，拆成国内三步能抄的版本",
      suggestedTitle: "我把海外最火的 AI PPT 工作流，拆成 3 步国内就能抄",
      tip: "方法论讲具体，工具名用「某 AI / 国产平替」带过"
    },
    {
      title: "提示词模板合集长期走热",
      platform: "抖音",
      heat: "中高",
      why: "小白最爱的伸手党内容，转发率高，评论区容易起来",
      angle: "用自己平时收藏的提示词做一期汉化可直接用的合集",
      suggestedTitle: "10 条我天天在用的提示词，汉化好了直接抄",
      tip: "只发模板不提来源平台，「外网」也尽量换成「我整理」"
    },
    {
      title: "国产 AI 工具横评",
      platform: "小红书",
      heat: "中",
      why: "测评天然带信任感，适合立专业人设",
      angle: "重点讲测评维度和思路，而不是罗列工具",
      suggestedTitle: "国外博主测评 AI 的思路，套到国产工具上结论意外",
      tip: "工具名一笔带过，把「怎么判断好坏」讲透"
    },
    {
      title: "小白第一条 AI 作品全过程记录",
      platform: "抖音",
      heat: "中",
      why: "陪跑 / 真实记录人设最吸粉，评论区互动强",
      angle: "把踩坑和返工都留着，真实感比精致更有用",
      suggestedTitle: "和你一样的小白，第一次用 AI 做出了个东西",
      tip: "真实感 > 精致感，别怕粗糙"
    }
  ],

  /*
   * 爆款拆解库种子。
   * 数据都带记录日期——「4700 人用过」是某一天的快照，三个月后会误导你。
   */
  rivals: [
    {
      name: "歸藏",
      tag: "产品化表达",
      recordedAt: "2026-07",
      why: "把复杂 AI 能力拆成填空式场景，小白秒懂",
      hook: "你离高效，只差装一个 Skill",
      hookType: "result",
      learn: "学他把功能翻译成场景的能力：不说「支持批量生成」，说「你周报再也不用自己写」",
      xhs: "https://www.xiaohongshu.com/search_result?keyword=%E6%AD%B8%E8%97%8F",
      dy: "https://www.douyin.com/search/%E6%AD%B8%E8%97%8F"
    },
    {
      name: "栗氪聊AI",
      tag: "保姆级拆解",
      recordedAt: "2026-07",
      why: "抢热点首发 + 步骤截图红框标注，收藏率极高",
      hook: "手把手教你，看完就能用",
      hookType: "result",
      learn: "学他的节奏：每 15 秒一个可截图的信息点，让人不得不收藏",
      xhs: "https://www.xiaohongshu.com/search_result?keyword=%E6%A0%97%E6%B0%AA%E8%81%8AAI",
      dy: "https://www.douyin.com/search/%E6%A0%97%E6%B0%AA%E8%81%8AAI"
    },
    {
      name: "AI工具猎人",
      tag: "栏目化 / 信息差",
      recordedAt: "2026-07",
      why: "周更「外网最火玩法国内平替版」，定位清晰到一句话能说完",
      hook: "海外在疯传，国内还很少有人知道",
      hookType: "secret",
      learn: "学他的栏目化：固定格式周更，让人形成期待。这正是你的信息差主战场",
      xhs: "https://www.xiaohongshu.com/search_result?keyword=AI%E5%B7%A5%E5%85%B7%E7%8C%8E%E4%BA%BA",
      dy: "https://www.douyin.com/search/AI%E5%B7%A5%E5%85%B7%E7%8C%8E%E4%BA%BA"
    }
  ],

  /* 示例选题。不再写死过期日期——加载时按当天往后顺延。 */
  ideas: [
    {
      title: "我用一个 AI 把 3 小时 PPT 压到 3 分钟",
      hook: "以前做 PPT 熬到凌晨，现在喝杯咖啡就搞定",
      hookType: "contrast",
      cover: "前后对比：熬夜黑眼圈 vs 咖啡加成品",
      platform: ["xhs", "dy"],
      tags: ["AI实操", "效率"],
      stage: "script",
      dueOffset: 0
    },
    {
      title: "海外博主私藏的 10 条提示词，我汉化后直接能用",
      hook: "这 10 条，我愿称之为小白外挂",
      hookType: "secret",
      cover: "手机截图铺满 10 条提示词，高亮其中一条",
      platform: ["xhs"],
      tags: ["AI小白", "提示词"],
      stage: "pool",
      dueOffset: 1
    },
    {
      title: "和你一样的小白，用 AI 做出第一个作品（全程记录）",
      hook: "别怕，我也是昨天才第一次用",
      hookType: "story",
      cover: "真实工位自拍，屏幕里是半成品",
      platform: ["xhs", "dy"],
      tags: ["陪跑", "AI小白"],
      stage: "pool",
      dueOffset: 2
    }
  ]
};
