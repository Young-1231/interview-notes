## 导读
面试主要看你能不能讲清「什么时候不该用多 Agent」：先背单 Agent 与多 Agent 的边界、Supervisor/流水线/对等/层级几种架构的取舍、冲突仲裁和防死循环的硬约束。
协议层容易混：Function Calling 是模型调用本地函数，MCP 是 Agent 接工具和数据，A2A 是 Agent 和 Agent 协作。三者互补，不互相替代。
自进化部分要分清 Reflection（当次复盘）和自进化（经验持久化、验证、发布、回滚）。

## 补充: A2A是什么？主要做什么
A2A 由 Google 在 2025 年 4 月发布，同年 6 月捐给 Linux Foundation。几个常追问的关键词：Agent Card（JSON 格式的能力名片，放在 well-known 路径下供发现）、Task（有状态生命周期，如 submitted / working / input-required / completed）、Message 和 Artifact（产物）。
传输基于 HTTP + JSON-RPC 2.0，长任务用 SSE 流式推送或 webhook 推送通知。

## 补充: MCP、A2A、Function Calling 三者有什么本质区别
三者是叠加关系：MCP 暴露的工具最终仍是通过模型的 tool calling（Function Calling）被调用的；A2A 把对方 Agent 当成「黑盒同事」，不暴露其内部工具和记忆。常见组合是对外 A2A、对内 MCP。

## 补充: 它相比Single-Agent最大优势是什么
常被追问代价。Anthropic 公开过其多 Agent 研究系统的数据：Agent 比普通对话多用约 4 倍 token，多 Agent 系统约 15 倍。收益主要来自并行和更多 token 预算，所以只适合价值高、可并行的任务；强耦合的任务（如多数写代码场景）多 Agent 反而容易因上下文不一致出错。

## 自测
### Multi-Agent 一定比 Single-Agent 好吗？
不一定。任务简单、线性、强依赖同一份状态时，单 Agent 更快、更便宜、更好调试。
### 什么情况适合多 Agent？
子任务可并行、需要不同工具或权限、上下文太长单 Agent 装不下、需要独立复核。
### Supervisor 架构的优缺点？
中心 Agent 负责拆解、分配、验收，流程清晰可控；缺点是 Supervisor 是瓶颈和单点故障。
### Hierarchical 和 Supervisor 有什么区别？
Hierarchical 是多层 Supervisor 分级管理，适合大型多领域任务，但层级越多信息损失和开销越大。
### 流水线架构的主要缺点？
一环失败整体阻塞，没有并行能力。
### 多 Agent 协作最难的点是什么？
让各 Agent 对世界状态的理解一致。一个 Agent 基于旧信息判断，后续 Agent 会把错误放大。
### 消息传递、共享状态、黑板模式各适合什么？
消息传递做控制面（委派、进度、完成），版本化共享状态做数据面，黑板放开放问题和可复用发现。
### 为什么投票不能完全解决多 Agent 冲突？
相同模型、提示词和数据的多个 Agent 不独立，可能重复同一个错误。多数票不能替代证据。
### 如何防止多 Agent 死循环和推诿？
任务唯一 ID 和幂等键、依赖成 DAG、限制 Handoff 和重试次数及预算、单一负责人、熔断规则。
### 多个 Agent 同时写同一份状态怎么办？
设单一写入负责人，或用带版本号的提交和合并机制。
### 上下文如何在多 Agent 间传递？
给每个 Agent 最小任务包（目标、约束、验收标准、输入产物引用），大内容传引用和摘要，不复制完整对话。
### 怎么评估某个 Agent 的贡献？
做消融：移除或替换成简单规则，比较质量、时间和成本变化，不看消息条数。
### 多 Agent 系统最重要的基线是什么？
同样任务、同样工具和相近预算下的单 Agent。
### A2A、MCP、Function Calling 分别解决什么？
Function Calling：模型调用本地函数；MCP：标准化接入工具和数据源；A2A：Agent 之间发现能力和协作任务。
### MCP 用的是什么消息格式？
JSON-RPC 2.0，client-host-server 架构。
### 自进化 Agent 和 Reflection Agent 的区别？
Reflection 只在当次任务复盘重试；自进化会把经验持久化成 Prompt/Memory/Skill/Policy，并经过验证、发布和回滚。
### 自进化时优先改哪一层？
优先 Memory 和 Prompt，成本低；模型参数最后考虑，成本高且可能遗忘旧能力。
### 奖励信号的可靠性排序？
确定性验证器 > 环境结果 > 专用判别器 > 多评委共识 > 单个 LLM 评委 > Agent 自评。
### 如何限制 Agent 修改自身的安全风险？
Agent 只能提出修改，不能自己批准；权限在独立的执行层落实，配合沙箱、白名单、审批和审计。
