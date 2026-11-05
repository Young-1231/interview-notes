// 站点结构:3 大块 → 章节,每个章节一个页面;每章节由 content/ 下的一个或多个统一稿组成
// 统一稿格式见 scripts/check-content.cjs:## 子分组 / ### 题目 | 高频 | 公司
module.exports = [
  { id: 'java', title: 'Java 后端', sections: [
    { id: 'java-basic', title: 'Java 基础', files: ['java-basic', 'java-io'], fileTitles: { 'java-io': 'Java IO' } },
    { id: 'java-collection', title: 'Java 集合', files: ['java-collection'] },
    { id: 'jvm', title: 'JVM', files: ['jvm'] },
    { id: 'juc', title: '并发 JUC', files: ['juc'] },
    { id: 'mysql', title: 'MySQL', files: ['mysql'] },
    { id: 'redis', title: 'Redis', files: ['redis'] },
    { id: 'mq', title: '消息队列', files: ['mq'] },
    { id: 'spring', title: 'Spring', files: ['spring', 'springmvc-boot', 'mybatis'], fileTitles: { 'springmvc-boot': 'SpringMVC & SpringBoot', mybatis: 'MyBatis' } },
    { id: 'distributed', title: '分布式', files: ['distributed'] },
    { id: 'network', title: '计算机网络', files: ['network'] },
    { id: 'os', title: '操作系统 & Linux', files: ['os', 'linux'], fileTitles: { linux: 'Linux' } },
    { id: 'design-pattern', title: '设计模式', files: ['design-pattern'] },
  ] },
  { id: 'ai', title: 'AI & Agent', sections: [
    { id: 'llm', title: '大模型基础', files: ['llm-basic'] },
    { id: 'finetune', title: '训练与微调', files: ['finetune'] },
    { id: 'rag', title: 'RAG', files: ['rag'] },
    { id: 'agent', title: 'Agent', files: ['agent-core'] },
    { id: 'agent-memory', title: '记忆与上下文', files: ['agent-memory'] },
    { id: 'multi-agent', title: '多 Agent & 自进化', files: ['multi-agent'] },
    { id: 'mcp-skill', title: 'MCP / Skill / 工具调用', files: ['mcp-skill'] },
    { id: 'agent-framework', title: 'AI 框架', files: ['agent-framework'] },
    { id: 'harness', title: 'Harness & AI 编程', files: ['harness'] },
  ] },
  { id: 'more', title: '场景 & 真题', sections: [
    { id: 'real', title: '114 道真题', files: ['real-1', 'real-2'] },
    { id: 'scenario', title: '场景题', files: ['scenario'] },
    { id: 'hmdp', title: '黑马点评项目', files: ['hmdp'] },
    { id: 'brain', title: '智力题', files: ['brain'] },
    { id: 'interviews', title: '大厂面经', files: ['interviews'], unit: '场' },
  ] },
];
