// 板块 / 主题定义,以及「源文件章节 → 主题」的映射。
// 每个源文件的章节(一级标题或 PDF 的二级标题)都必须映射到一个主题,未映射的章节会让构建失败,
// 这样新资料加进来时不会悄悄丢内容。

// 页面结构:3 大块 → 若干章节 → 每章节合并若干内部主题(内部主题 id 只用于映射和 overlays)
const PARTS = [
  { id: 'java', title: 'Java 后端', sections: [
    { id: 'java-basic', title: 'Java 基础', topics: ['java-basic', 'java-io'] },
    { id: 'java-collection', title: 'Java 集合', topics: ['java-collection'] },
    { id: 'jvm', title: 'JVM', topics: ['jvm'] },
    { id: 'juc', title: '并发 JUC', topics: ['juc'] },
    { id: 'mysql', title: 'MySQL', topics: ['mysql'] },
    { id: 'redis', title: 'Redis', topics: ['redis'] },
    { id: 'mq', title: '消息队列', topics: ['mq'] },
    { id: 'spring', title: 'Spring 全家桶', topics: ['spring', 'springmvc-boot', 'mybatis'] },
    { id: 'distributed', title: '分布式', topics: ['distributed'] },
    { id: 'network', title: '计算机网络', topics: ['network'] },
    { id: 'os', title: '操作系统 & Linux', topics: ['os', 'linux'] },
    { id: 'design-pattern', title: '设计模式', topics: ['design-pattern'] },
  ] },
  { id: 'ai', title: 'AI & Agent', sections: [
    { id: 'llm', title: '大模型基础 & 微调', topics: ['llm-basic', 'finetune'] },
    { id: 'rag', title: 'RAG', topics: ['rag'] },
    { id: 'agent', title: 'Agent', topics: ['agent-core', 'agent-memory', 'multi-agent'] },
    { id: 'mcp-skill', title: 'MCP / Skill / 工具调用', topics: ['mcp-skill'] },
    { id: 'ai-dev', title: 'AI 框架 & Harness', topics: ['agent-framework', 'harness'] },
  ] },
  { id: 'more', title: '场景 & 面经', sections: [
    { id: 'scenario', title: '场景题 & 智力题', topics: ['scenario', 'brain'] },
    { id: 'hmdp', title: '黑马点评项目', topics: ['hmdp'] },
    { id: 'interviews', title: '大厂面经', topics: ['interviews'] },
    { id: 'real', title: '114 道真题清单', topics: [] },
  ] },
];

// order 决定站内顺序
const TOPICS = [
  { id: 'java-basic', title: 'Java 基础' },
  { id: 'java-collection', title: 'Java 集合' },
  { id: 'jvm', title: 'JVM' },
  { id: 'juc', title: '并发 JUC' },
  { id: 'java-io', title: 'Java IO' },
  { id: 'mysql', title: 'MySQL' },
  { id: 'redis', title: 'Redis' },
  { id: 'mq', title: '消息队列' },
  { id: 'distributed', title: '分布式' },
  { id: 'spring', title: 'Spring' },
  { id: 'springmvc-boot', title: 'SpringMVC / SpringBoot' },
  { id: 'mybatis', title: 'MyBatis' },
  { id: 'network', title: '计算机网络' },
  { id: 'os', title: '操作系统' },
  { id: 'linux', title: 'Linux' },
  { id: 'design-pattern', title: '设计模式' },
  { id: 'llm-basic', title: 'AI / 大模型基础' },
  { id: 'finetune', title: '微调与训练' },
  { id: 'rag', title: 'RAG' },
  { id: 'agent-core', title: 'Agent 通用 & 范式' },
  { id: 'agent-memory', title: '记忆与上下文' },
  { id: 'multi-agent', title: '多 Agent & 自进化' },
  { id: 'mcp-skill', title: 'MCP / Skill / Function Calling' },
  { id: 'harness', title: 'Harness & Vibe Coding' },
  { id: 'agent-framework', title: 'AI 框架 (LangChain / LangGraph)' },
  { id: 'scenario', title: '场景题' },
  { id: 'hmdp', title: '黑马点评项目' },
  { id: 'brain', title: '智力题' },
  { id: 'interviews', title: '大厂面经' },
];

// 源文件
const SOURCES = [
  { id: 'notes', file: 'notes.md', label: '原笔记', short: '笔记', desc: '原线上站内容:Agent 工程 + Java 后端精简高频(标红为核心)' },
  { id: 'javaai', file: 'javaai.md', label: 'Java+AI 八股', short: '八股', desc: '最全的一份:每块分「高频 / 扩展」两层,AI 部分带 LangChain / LangGraph 代码' },
  { id: 'bank', file: 'bank-java.md', label: '银行科技岗 Java', short: '银行', desc: '互联网 & 银行科技岗 Java 常见题,题目后标注出题公司' },
  { id: 'aikb', file: 'ai-kb.md', label: 'AI 应用开发八股', short: 'AI库', desc: 'Agent / RAG / MCP / Skill 专项 + 大模型微调' },
];

// 章节映射:[源 id, 章节标题正则, 主题 id, 额外标记]
// 章节标题已去掉 emoji 和 HTML。tier: 'high' | 'ext' 来自「(高频)」「(扩展)」
const CHAPTER_MAP = [
  // ---------- 原笔记 notes.md(一级标题) ----------
  ['notes', /^跳转目录/, null],
  ['notes', /^Agent（持续更新/, 'agent-core'],
  ['notes', /^Agent开发框架/, 'agent-framework'],
  ['notes', /^vibe coding/i, 'harness'],
  ['notes', /^memory记忆管理/, 'agent-memory'],
  ['notes', /^上下文管理/, 'agent-memory'],
  ['notes', /^Agent范式/, 'agent-core'],
  ['notes', /^多agent协作/i, 'multi-agent'],
  ['notes', /^自进化/, 'multi-agent'],
  ['notes', /^MCP$/, 'mcp-skill'],
  ['notes', /^Skill$/, 'mcp-skill'],
  ['notes', /^RAG$/, 'rag'],
  ['notes', /^Harness Engineering/, 'harness'],
  ['notes', /^MySQL高频重点手撕/, 'mysql'],
  ['notes', /^JavaSE/, 'java-basic'],
  ['notes', /^Java集合/, 'java-collection'],
  ['notes', /^JVM$/, 'jvm'],
  ['notes', /^JUC$/, 'juc'],
  ['notes', /^MySQL$/, 'mysql'],
  ['notes', /^Redis$/, 'redis'],
  ['notes', /^Spring$/, 'spring'],
  ['notes', /^消息队列$/, 'mq'],
  ['notes', /^设计模式$/, 'design-pattern'],
  ['notes', /^计算机网络$/, 'network'],
  ['notes', /^操作系统$/, 'os'],
  ['notes', /^史上最全黑马点评/, 'hmdp'],
  ['notes', /^分布式/, 'distributed'],
  ['notes', /^Linux/, 'linux'],
  ['notes', /^场景题$/, 'scenario'],
  ['notes', /^智力题/, 'brain'],
  ['notes', /^本人所有大厂面试全记录/, 'interviews'],
  ['notes', /面试八股通关秘籍/, null],
  // ---------- Java+AI 八股 javaai.md(一级标题) ----------
  ['javaai', /^(投票|前言|导航目录|老版本java八股|更新记录)/, null],
  ['javaai', /^Java基础/, 'java-basic'],
  ['javaai', /^Java集合/, 'java-collection'],
  ['javaai', /^JVM/, 'jvm'],
  ['javaai', /^Java并发/, 'juc'],
  ['javaai', /^MySQL/, 'mysql'],
  ['javaai', /^Redis/, 'redis'],
  ['javaai', /^Spring/, 'spring'],
  ['javaai', /^计算机网络/, 'network'],
  ['javaai', /^消息队列/, 'mq'],
  ['javaai', /^Linux操作/, 'linux'],
  ['javaai', /^设计模式/, 'design-pattern'],
  ['javaai', /^AI基础/, 'llm-basic'],
  ['javaai', /^RAG/, 'rag'],
  ['javaai', /^Agent/, 'agent-core'],
  ['javaai', /^AI框架/, 'agent-framework'],
  ['javaai', /^AI编程篇/, null], // 与「AI框架」92% 重复,跳过
  ['javaai', /^AI编程$/, 'harness'],
  ['javaai', /^智力题/, 'brain'],
  ['javaai', /^场景题/, 'scenario'],
  ['javaai', /^大厂面经/, 'interviews'],
  ['javaai', /^扩展$/, 'jvm'], // 只有一题:gc 问题排查真实场景
  // ---------- 银行科技岗 bank-java.md(二级标题) ----------
  ['bank', /^Java基础/, 'java-basic'],
  ['bank', /^Java集合/, 'java-collection'],
  ['bank', /^JVM/, 'jvm'],
  ['bank', /^多线程并发/, 'juc'],
  ['bank', /^JavaIo/i, 'java-io'],
  ['bank', /^MySQL/, 'mysql'],
  ['bank', /^Redis/, 'redis'],
  ['bank', /^Mybatis/i, 'mybatis'],
  ['bank', /^Spring$/, 'spring'],
  ['bank', /^SpringMVC/, 'springmvc-boot'],
  ['bank', /^SpringBoot/, 'springmvc-boot'],
  // ---------- AI 应用开发八股 ai-kb.md(二级标题) ----------
  ['aikb', /^Agent通用专项/, 'agent-core'],
  ['aikb', /^RAG专项/, 'rag'],
  ['aikb', /^MCP专项/, 'mcp-skill'],
  ['aikb', /^Skill专项/, 'mcp-skill'],
  ['aikb', /^大模型微调/, 'finetune'],
];

// 原笔记的 Agent 通用章节里,有几题更适合放到别的主题(按题目关键词二次分流)
const REROUTE = [
  // [主题, 关键词正则, 目标主题]
  ['agent-core', /记忆|memory|上下文(管理|压缩|窗口)|长对话/i, 'agent-memory'],
  ['agent-core', /多\s*agent|multi-agent|A2A/i, 'multi-agent'],
  ['agent-core', /MCP|Function Calling|Tool Calling|工具调用|Skill/i, 'mcp-skill'],
  ['agent-core', /LangChain|LangGraph|LlamaIndex|AutoGen|CrewAI|Dify|Coze|SpringAI|Spring AI/i, 'agent-framework'],
  ['agent-core', /网关/, 'mcp-skill'],
  ['llm-basic', /LoRA|QLoRA|微调|SFT|RLHF|DPO|PPO|GRPO|预训练|显存|BF16|FP16|量化/i, 'finetune'],
  ['java-basic', /\bIO\b|BIO|NIO|AIO|IO流|IO模型/i, 'java-io'],
  ['java-collection', /BIO|NIO|AIO/, 'java-io'],
  ['spring', /SpringBoot|Spring Boot|自动装配|Starter|SpringMVC|Spring MVC|DispatcherServlet/i, 'springmvc-boot'],
  ['spring', /MyBatis|Mybatis/, 'mybatis'],
  ['mysql', /MyBatis|Mybatis/, 'mybatis'],
  ['redis', /分布式锁|Redisson|红锁/i, 'redis'],
  ['juc', /分布式锁/, 'distributed'],
];

module.exports = { PARTS, TOPICS, SOURCES, CHAPTER_MAP, REROUTE };
