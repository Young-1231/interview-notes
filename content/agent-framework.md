## 框架概览

### 常见的 Agent 开发框架有哪些？各自定位是什么？
一句话结论：**LangChain 提供模型、Prompt、工具、检索等组件和高层 Agent 接口，LangGraph 负责有状态的流程编排**，此外还有偏 RAG 的 LlamaIndex、偏多 Agent 对话协作的 AutoGen 和 CrewAI 等。面试中一般围绕简历项目里实际用到的框架来问。

| 框架 | 定位 | 特点 |
| --- | --- | --- |
| LangChain | LLM 应用组件库 + 高层 Agent 接口 | 统一的模型、Prompt、工具、检索器接口，LCEL 组合；1.0 起用 `create_agent` 构建 Agent，底层运行在 LangGraph 上 |
| LangGraph | 有状态图编排框架 | StateGraph、条件边、循环、checkpointer 持久化、interrupt 人机协同，适合生产级复杂 Agent |
| LlamaIndex | 数据 / RAG 框架 | 文档解析、索引、查询引擎能力强，也提供 Agent 和 Workflow |
| AutoGen | 多 Agent 对话协作（微软） | Agent 之间通过消息对话推进任务；微软已推出 Microsoft Agent Framework 作为 AutoGen 与 Semantic Kernel 的后继 |
| CrewAI | 角色化多 Agent | 以角色、任务、团队（Crew）组织协作，上手快 |

版本背景：LangChain 1.0（2025 年 10 月发布）把 `LLMChain`、`ConversationBufferMemory`、`AgentExecutor` 等旧 API 移入 `langchain-classic`；LangGraph 同期发布 1.0，`create_react_agent` 被 `langchain.agents.create_agent` 取代。

### LangGraph 相比 LangChain 有什么区别和优势？两者是什么关系？
一句话结论：**LangChain 解决「用什么组件」，LangGraph 解决「组件按什么流程、带着什么状态运行」**；两者不是替代关系，LangGraph 节点里通常就是调用 LangChain 的模型和工具，LangChain 1.0 的 `create_agent` 底层也是一个 LangGraph 图。

| 维度 | LangChain（LCEL） | LangGraph |
| --- | --- | --- |
| 定位 | 组件库 + 链式组合 | 有状态的图编排运行时 |
| 流程 | 以 DAG / 线性管道为主（A → B → C） | 支持分支、循环、并行、动态路由 |
| 状态 | 需要自行管理中间变量和历史 | 统一 State + reducer，自动合并更新 |
| 持久化 | 无内置执行状态持久化 | checkpointer 按 thread 保存每一步快照 |
| 人机协同 | 需要自己实现 | `interrupt` + `Command(resume=...)` 原生支持 |
| 适合场景 | 简单问答、单轮 RAG、固定处理管道 | 多步 Agent、长流程、需要审批和恢复的生产系统 |

**LangGraph 的主要优势**
- **执行控制强**：显式的节点和边，每一步走向都可控、可调试，避免模型完全自由决策带来的不确定性。
- **复杂流程表达能力强**：循环（ReAct）、条件分支、扇出扇入并行、子图都是一等公民。
- **持久化执行**：checkpoint 支持断点续跑、故障恢复、时间回溯（time travel）和人工介入。
- **适合多 Agent**：通过子图、共享状态和 `Command` 交接实现多 Agent 编排。

### LangGraph 和 AutoGen 有什么区别？
一句话结论：**AutoGen 是会话驱动**，Agent 之间通过互发消息推进任务，流程较动态；**LangGraph 是状态驱动**，开发者显式定义图结构，流程更确定、更可控，更适合工程化落地。

| 维度 | AutoGen | LangGraph |
| --- | --- | --- |
| 驱动方式 | 多个 Agent 在对话中轮流发言，信息通过消息传递 | 节点读写共享 State，边决定下一步 |
| 流程控制 | 由发言选择策略或模型决定下一个说话者，路径不确定 | 由开发者定义的边和条件路由决定，可预测 |
| 状态管理 | 状态主要体现在对话历史中 | 结构化 State，可定义 reducer、私有字段 |
| 持久化与恢复 | 支持保存和加载 Agent 状态，粒度较粗 | 每一步 checkpoint，支持断点续跑、回溯 |
| 人机协同 | 可以把人作为一个参与对话的 Agent | `interrupt` 在任意节点暂停并恢复 |
| 适合场景 | 开放式多 Agent 讨论、问题拆解、研究型任务 | 业务流程明确、强约束、需要审计与恢复的生产系统 |

补充：AutoGen 0.4 起重写为事件驱动架构（AgentChat、Core 分层）；目前微软把新功能投入到 Microsoft Agent Framework。选型时 LangGraph 也能实现多 Agent 对话式协作，只是需要显式建模。

## LangChain 核心组件与 LCEL

### 用过 LangChain 吗？它包含哪些部分？
一句话结论：LangChain 是面向 LLM 应用开发的框架，把**模型调用、提示词、输出解析、工具、检索、记忆和编排**统一到一套标准接口中，所有组件都实现 `Runnable` 接口，可以用 LCEL 的 `|` 组合。

**核心组件**
- **Models / Messages**：`ChatModel`、`Embeddings` 统一接口，`init_chat_model("openai:gpt-4o-mini")` 按字符串初始化模型；消息分 System / Human / AI / Tool 四类。
- **Prompts**：`ChatPromptTemplate`、`MessagesPlaceholder`、Few-shot 模板。
- **结构化输出**：`StrOutputParser`、`PydanticOutputParser`，更推荐 `model.with_structured_output(Schema)`。
- **Retrieval**：Loader、Splitter、VectorStore、Retriever，支撑 RAG。
- **Tools / Agents**：`@tool` 定义工具、`bind_tools` 交给模型；1.0 用 `create_agent`，可加中间件做摘要、人工审批。
- **记忆**：短期用 LangGraph checkpointer（或 `RunnableWithMessageHistory`），长期用 LangGraph Store。
- **Callbacks**：配合 LangSmith 做 Trace 和评测。

易错点：`LLMChain`、`RetrievalQA`、`ConversationBufferMemory`、`initialize_agent` 都已废弃，现在用 LCEL 组合链、用 LangGraph 管理状态和 Agent。

### 什么是 LCEL 和 Runnable？LangChain 如何把多个组件连接起来处理一个下游任务？
一句话结论：**Runnable 是 LangChain 所有组件的统一接口，LCEL（LangChain Expression Language）用 `|` 把 Runnable 串成管道**，上一个的输出就是下一个的输入，组合后的链本身也是 Runnable。

**Runnable 统一接口**
- `invoke` / `ainvoke`：单次调用；`batch` / `abatch`：批量并发调用；`stream` / `astream`：流式输出；`astream_events`：流式输出中间事件。
- 组合出来的链自动具备同步、异步、批量、流式能力，还可以挂 `with_retry()`、`with_fallbacks([...])`、`with_config(...)`。

**常用组合原语**
- `RunnableSequence`：`a | b | c`，顺序执行。
- `RunnableParallel`：`{"x": a, "y": b}`，并行执行多个分支，输出字典。
- `RunnablePassthrough`：原样透传输入，常用于把问题同时传给检索器和 Prompt。
- `RunnableLambda`：把普通函数包装成 Runnable。

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnableParallel

model = ChatOpenAI(model="gpt-4o-mini")
summary = ChatPromptTemplate.from_template("用一句话总结：{text}") | model | StrOutputParser()
keywords = ChatPromptTemplate.from_template("提取 3 个关键词：{text}") | model | StrOutputParser()

# 两个子链并行执行，结果合并为字典
chain = RunnableParallel(summary=summary, keywords=keywords)
result = chain.invoke({"text": "LangGraph 是一个有状态的 Agent 编排框架……"})
# {'summary': '...', 'keywords': '...'}
```

**适用边界**：LCEL 适合固定的 DAG 式流程；需要循环、条件跳转、持久化状态或人工介入时，应该改用 LangGraph。

### LangChain 如何调用 LLM 生成回复？
一句话结论：通过 **ChatModel** 统一封装不同厂商的接口，传入消息列表，调用 `invoke()` 得到 `AIMessage`；切换模型只需更换模型类或模型字符串，上层代码不变。

```python
from langchain.chat_models import init_chat_model
from langchain_core.messages import SystemMessage, HumanMessage

model = init_chat_model("openai:gpt-4o-mini", temperature=0)  # 也可以直接用 ChatOpenAI(model=...)

resp = model.invoke([
    SystemMessage("你是一个简洁的助手"),
    HumanMessage("请做个自我介绍"),
])
print(resp.content)          # 回复文本
print(resp.usage_metadata)   # token 用量（模型厂商支持时）
```

**要点**
- 输入可以是字符串（会被当作一条用户消息）、消息对象列表，或 `("role", "content")` 元组列表。
- 返回 `AIMessage`，除 `content` 外还有 `tool_calls`、`usage_metadata`、`response_metadata`。
- 国内模型可以用对应的集成类（如 `langchain_community` 中的 `ChatTongyi`），或用 `ChatOpenAI(base_url=..., api_key=...)` 接入兼容 OpenAI 协议的服务。
- 并发场景用 `ainvoke` / `abatch`，配合 `max_retries`、`timeout` 参数做容错。

### LangChain 如何实现流式输出？
一句话结论：调用 Runnable 的 **`stream()` / `astream()`**，模型每生成一段内容就返回一个 chunk，而不是等完整结果；整个 LCEL 链和 LangGraph 图也都支持流式。

```python
from langchain_openai import ChatOpenAI

model = ChatOpenAI(model="gpt-4o-mini")
for chunk in model.stream("请用一句话介绍人工智能"):
    print(chunk.content, end="", flush=True)   # chunk 是 AIMessageChunk
```

**不同层次的流式**
- **模型层**：`model.stream()` 返回 `AIMessageChunk`，多个 chunk 可以用 `+` 拼接成完整消息。
- **链层**：`(prompt | model | StrOutputParser()).stream(...)` 同样逐段输出，`StrOutputParser` 支持流式透传；而必须等完整文本才能解析的步骤会阻断流式。
- **事件层**：`chain.astream_events(input, version="v2")` 可以拿到链中每个组件的开始、token、结束等事件，适合展示中间过程。
- **LangGraph / Agent**：`graph.stream(input, config, stream_mode="messages")` 流式输出 LLM token；`stream_mode="updates"` 输出每个节点的状态更新；`"values"` 输出每步完整状态；`"custom"` 输出节点内自定义的进度信息。

**工程落地**：后端用 `astream` 配合 FastAPI 的 `StreamingResponse` 以 SSE 推给前端，注意客户端断开时取消生成，避免浪费 token。

### LangChain 如何组织提示词？
一句话结论：用 **PromptTemplate / ChatPromptTemplate** 把固定指令和动态变量分离，模板本身也是 Runnable，可以直接接到模型前面；多轮历史用 `MessagesPlaceholder` 插入。

**1. 文本模板 PromptTemplate**
```python
from langchain_core.prompts import PromptTemplate

tpl = PromptTemplate.from_template("请用{language}介绍{topic}，不超过100字。")
tpl.invoke({"language": "中文", "topic": "人工智能"})  # 返回 StringPromptValue
```

**2. 聊天模板 ChatPromptTemplate（最常用）**
```python
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一位{role}，用简洁易懂的方式解释概念。"),
    MessagesPlaceholder("history", optional=True),   # 插入多轮历史消息
    ("human", "{question}"),
])
chain = prompt | model
chain.invoke({"role": "物理学教授", "question": "什么是量子纠缠？"})
```

**3. 少样本模板**
- 固定示例：`FewShotChatMessagePromptTemplate(examples=..., example_prompt=...)`，把示例展开成多组 human / ai 消息。
- 动态示例：配合 Example Selector 按当前输入挑选最相关的示例。

**4. 其他能力**
- `partial()` 预填部分变量（如当前日期）。
- 变量缺失时会报错，便于发现模板问题。
- 模板可以托管在 LangSmith Prompt Hub 上做版本管理。

### LangChain 中的 Example Selector 是什么？选择的原理是什么？
一句话结论：Example Selector 是 **Few-shot Prompt 的动态选例组件**，根据当前输入从候选示例中挑出最合适的几条注入提示词，而不是把示例写死。

**内置选择器及原理**

| 选择器 | 原理 | 适用 |
| --- | --- | --- |
| `SemanticSimilarityExampleSelector` | 示例和输入向量化，选余弦相似度最高的 k 条 | 最常用 |
| `MaxMarginalRelevanceExampleSelector` | MMR：兼顾与输入的相关性和示例之间的多样性 | 避免选出的示例高度重复 |
| `LengthBasedExampleSelector` | 按长度累加，在长度上限内尽量多放示例 | 上下文窗口紧张 |
| `NGramOverlapExampleSelector`（community） | 按与输入的 n-gram 重合度打分，可设阈值 | 偏词面匹配 |

也可以继承 `BaseExampleSelector` 实现 `select_examples` 和 `add_example` 自定义选择逻辑（例如按业务类别过滤）。

```python
from langchain_core.prompts import PromptTemplate, FewShotPromptTemplate
from langchain_core.example_selectors import SemanticSimilarityExampleSelector
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import FAISS

examples = [{"question": "2+2", "answer": "4"}, {"question": "3+5", "answer": "8"},
            {"question": "北京是哪国首都", "answer": "中国"}]
selector = SemanticSimilarityExampleSelector.from_examples(
    examples, OpenAIEmbeddings(), FAISS, k=2)

prompt = FewShotPromptTemplate(
    example_selector=selector,
    example_prompt=PromptTemplate.from_template("Q: {question}\nA: {answer}"),
    prefix="参考示例回答问题：",
    suffix="Q: {input}\nA:",
    input_variables=["input"],
)
print(prompt.invoke({"input": "7+1"}).to_string())  # 只会带上两道算术示例
```

### LangChain 如何格式化输出（结构化输出）？
一句话结论：首选 **`model.with_structured_output(Schema)`**，利用模型原生的工具调用或 JSON Schema 能力直接返回 Pydantic 对象；不支持原生结构化输出的模型，再用 **Output Parser + 格式说明** 的方式解析。

**1. with_structured_output（推荐）**
```python
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI

class Joke(BaseModel):
    setup: str = Field(description="笑话铺垫")
    punchline: str = Field(description="笑点")

model = ChatOpenAI(model="gpt-4o-mini")
structured = model.with_structured_output(Joke)
joke = structured.invoke("讲一个程序员笑话")   # 返回 Joke 实例
print(joke.punchline)
```
Schema 可以是 Pydantic 类、TypedDict 或 JSON Schema；`include_raw=True` 可以同时拿到原始消息，便于处理解析失败。

**2. Output Parser**
```python
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate

parser = PydanticOutputParser(pydantic_object=Joke)
prompt = ChatPromptTemplate.from_template(
    "讲一个程序员笑话。\n{format_instructions}"
).partial(format_instructions=parser.get_format_instructions())
chain = prompt | model | parser
```
- `StrOutputParser`：取出 `AIMessage.content` 字符串。
- `JsonOutputParser`：解析 JSON，支持流式输出部分 JSON。
- `PydanticOutputParser`：解析并做类型校验。
- 解析失败时可用 `OutputFixingParser`（在 `langchain-classic` 中）让模型修正，或者对链加 `with_retry()`。

**3. Agent 中的结构化输出**：LangChain 1.0 的 `create_agent(..., response_format=Schema)` 会让 Agent 最终返回结构化结果，存放在返回值的 `structured_response` 中。

## LangChain 记忆、工具与 Agent

### 如何通过 LangChain 实现对话记忆（memory）？
一句话结论：记忆的本质是**把历史消息按会话保存下来，每轮和新输入一起传给模型**。当前有三种做法：手动维护消息列表、`RunnableWithMessageHistory`、LangGraph checkpointer（官方推荐的新方式）。`ConversationBufferMemory` + `ConversationChain` 等旧组件已废弃。

**1. 手动维护 history**：prompt 中放 `MessagesPlaceholder("history")`，每轮调用后把 `HumanMessage`、`AIMessage` 追加到列表，最直观但要自己管理存储。

**2. RunnableWithMessageHistory（LCEL 链的会话记忆）**
```python
store = {}
def get_history(session_id: str):
    if session_id not in store:
        store[session_id] = InMemoryChatMessageHistory()  # 生产中换成 Redis / 数据库实现
    return store[session_id]

chat = RunnableWithMessageHistory(
    prompt | model, get_history,
    input_messages_key="input", history_messages_key="history",
)
cfg = {"configurable": {"session_id": "user_1"}}
chat.invoke({"input": "我叫小李"}, config=cfg)
chat.invoke({"input": "我叫什么？"}, config=cfg)   # 能回答「小李」
```
调用前按 `session_id` 读取历史填入 `history`，调用后自动追加本轮问答；持久化可用 `RedisChatMessageHistory`、`SQLChatMessageHistory`。

**3. LangGraph checkpointer（推荐）**
```python
agent = create_agent(model="openai:gpt-4o-mini", tools=[], checkpointer=InMemorySaver())
cfg = {"configurable": {"thread_id": "user_1"}}
agent.invoke({"messages": [{"role": "user", "content": "我叫小李"}]}, cfg)
agent.invoke({"messages": [{"role": "user", "content": "我叫什么？"}]}, cfg)
```
同一个 `thread_id` 的 State（包括 messages）自动持久化，生产中把 `InMemorySaver` 换成 `PostgresSaver`、`RedisSaver` 等。

**历史过长的处理**：用 `trim_messages` 按 token 数保留最近的消息（注意保留 system 消息、从 human 消息开始截取），或对早期对话做摘要；LangChain 1.0 的 `create_agent` 可以直接使用 `SummarizationMiddleware`。

### 多用户并发下，LangChain 的 memory 怎么做隔离？怎么保证线程安全？
一句话结论：**隔离靠会话标识（session_id / thread_id）划分独立的存储作用域，线程安全靠不在进程内共享可变状态**，把记忆放到外部存储；同一会话的并发写入还需要额外串行化。

**隔离**
- 每个请求通过 `config={"configurable": {"session_id": ...}}`（RunnableWithMessageHistory）或 `{"thread_id": ...}`（LangGraph）定位自己的历史，不同会话的状态互不可见。
- 标识由服务端根据登录用户生成或校验，例如 `f"{user_id}:{conversation_id}"`，不能直接信任前端传来的任意 ID，否则可能越权读到别人的对话。
- 多租户场景在 key 或 Store 的 namespace 中带上租户 ID。

**线程安全**
- 链和 Agent 对象本身可以全局复用（无状态），**不要**把一个全局 `history` 列表或一个 Memory 对象给所有请求共用。
- 历史放到 Redis、PostgreSQL 或 LangGraph checkpointer 中，服务多实例部署时也能共享。
- **同一会话的并发请求**（用户连点两次、多端同时发消息）仍可能竞争：两个请求读到同一份历史、各自追加后写回，导致消息丢失或乱序。可以按会话加分布式锁、按 session 把请求路由到同一队列串行处理，或在前端禁止并发发送。
- 异步服务中优先使用 `ainvoke` 和异步版的 checkpointer（如 `AsyncPostgresSaver`），避免阻塞事件循环。

### LangChain 如何定义和封装工具？
一句话结论：工具就是**带名称、描述和参数 schema 的函数**，模型根据描述和 schema 决定是否调用以及传什么参数。最常用 `@tool` 装饰器，复杂场景用 `StructuredTool` 或继承 `BaseTool`，再通过 `bind_tools` 或交给 Agent 使用。

**1. @tool 装饰器（最常用）**
```python
from langchain_core.tools import tool
from pydantic import BaseModel, Field

class WeatherInput(BaseModel):
    city: str = Field(description="城市名，如 北京")
    date: str = Field(description="日期，如 2026-11-06")

@tool(args_schema=WeatherInput)
def get_weather(city: str, date: str) -> str:
    """查询指定城市指定日期的天气。"""
    return f"{city}{date}晴"

get_weather.invoke({"city": "上海", "date": "明天"})
```
函数名就是工具名，docstring 就是工具描述，类型标注生成参数 schema；描述要写清楚**什么时候用、参数含义和格式**，这直接影响模型调用的准确率。

**2. 继承 BaseTool（有状态、依赖注入、鉴权等）**
```python
from langchain_core.tools import BaseTool

class CityInput(BaseModel):
    city: str = Field(description="城市名")

class WeatherTool(BaseTool):
    name: str = "get_weather"
    description: str = "查询城市实时天气"
    args_schema: type[BaseModel] = CityInput
    api_key: str                                # 工具自身的配置

    def _run(self, city: str) -> str:
        return f"{city}多云"                    # 实际调用天气 API
```

**3. 绑定到模型**
```python
llm_with_tools = model.bind_tools([get_weather])
msg = llm_with_tools.invoke("北京明天天气如何？")
for call in msg.tool_calls:          # [{'name': 'get_weather', 'args': {...}, 'id': '...'}]
    result = get_weather.invoke(call["args"])
```
模型只负责生成调用意图（`tool_calls`），工具由程序执行，结果以 `ToolMessage`（带对应 `tool_call_id`）回传给模型，这个循环由 Agent 或 LangGraph 的 `ToolNode` 自动完成。

**工程注意点**
- 工具内部做参数校验和权限校验，用户身份等敏感参数从运行时上下文注入，不让模型生成。
- 工具异常要返回可读的错误信息，帮助模型自我修正；LangGraph 的 `ToolNode` 可以通过 `handle_tool_errors` 参数把异常转成 `ToolMessage` 返回给模型。
- 工具数量多时按场景动态筛选，减少模型选错工具的概率。
- 也可以通过 MCP（Model Context Protocol）适配器（`langchain-mcp-adapters`）把 MCP Server 暴露的工具接入 LangChain / LangGraph。

### LangChain 如何实现一个 Agent？
一句话结论：LangChain 1.0 用 **`langchain.agents.create_agent`** 创建 Agent，它底层是一个 LangGraph 图，实现「模型推理 → 调用工具 → 观察结果 → 再推理」的 ReAct 循环；旧的 `initialize_agent`、`AgentExecutor` 已废弃，LangGraph 预置的 `create_react_agent` 也被 `create_agent` 取代。

```python
from langchain.agents import create_agent
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver

@tool
def get_weather(city: str) -> str:
    """查询城市天气"""
    return {"北京": "晴，15-25度"}.get(city, "暂无数据")

agent = create_agent(
    model="openai:gpt-4o-mini",          # 也可以传模型实例，如 ChatTongyi(...)
    tools=[get_weather],
    system_prompt="你是专业的中文助手，需要时调用工具。",
    checkpointer=InMemorySaver(),        # 开启会话记忆
)

cfg = {"configurable": {"thread_id": "s1"}}
result = agent.invoke({"messages": [{"role": "user", "content": "北京天气怎么样？"}]}, cfg)
print(result["messages"][-1].content)
```

**执行过程**：模型节点根据消息决定是否产生 `tool_calls` → 有则进入工具节点执行，结果作为 `ToolMessage` 追加到 messages → 回到模型节点 → 直到模型给出不含工具调用的最终回答。

**扩展能力**
- `response_format=Schema`：要求最终返回结构化结果。
- `middleware=[...]`：在模型调用前后插入逻辑，例如 `SummarizationMiddleware`（历史过长自动摘要）、`HumanInTheLoopMiddleware`（指定工具调用前人工审批）、动态切换模型或裁剪工具。
- `agent.stream(..., stream_mode="messages")`：流式输出 token。

**取舍**：`create_agent` 适合标准的工具调用型 Agent，开发快；需要自定义状态结构、多分支流程、并行或多 Agent 协作时，直接用 LangGraph 的 StateGraph 自己搭图更灵活。

### 用 LangChain 实现一个简单的智能助手，整体怎么组织？
一句话结论：**工具单独定义 + `create_agent` 组装模型、工具、系统提示词和 checkpointer + 按用户会话传 thread_id**，就是一个具备工具调用和多轮记忆的助手。

**组织方式**：`tools/` 下每个工具一个模块（天气、翻译、知识库检索……），API Key 放 `.env` 不提交仓库，`main.py` 组装 Agent。

```python
# ... import 省略，load_dotenv() 读取 API Key
SYSTEM_PROMPT = """你是小智，一个智能助手，可以查询天气、翻译文本。
先理解用户意图再选择工具；信息不足时先向用户确认；回答简洁。"""

agent = create_agent(
    model="openai:gpt-4o-mini",
    tools=[get_weather, translate],
    system_prompt=SYSTEM_PROMPT,
    checkpointer=InMemorySaver(),
)

def chat(user_id: str, text: str) -> str:
    cfg = {"configurable": {"thread_id": user_id}}   # 每个用户一个会话
    out = agent.invoke({"messages": [{"role": "user", "content": text}]}, cfg)
    return out["messages"][-1].content
```

**走向生产需要补的部分**
- checkpointer 换成 `PostgresSaver` / `RedisSaver`，支持多实例部署和重启恢复。
- 用 FastAPI 暴露接口，`astream` + SSE 流式返回；接口要做身份认证，thread_id 与登录用户绑定。
- 工具的异常处理、超时和权限控制；计算类工具不要用 `eval` 执行模型生成的表达式（存在代码注入风险），改用 `numexpr` 或基于 `ast` 的安全求值。
- 接入 LangSmith 等工具做 Trace，并配置最大步数（`recursion_limit`）防止循环失控。

### 用 LangChain 实现一个完整的 RAG 流程
一句话结论：RAG 分为**离线索引**（加载 → 切块 → 向量化 → 入库）和**在线问答**（检索 → 拼接上下文 → 生成）两段，在线部分用 LCEL 串成一条链。

```python
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_community.vectorstores import FAISS
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser

# 1. 离线索引
docs = PyPDFLoader("manual.pdf").load()
chunks = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=80).split_documents(docs)
vs = FAISS.from_documents(chunks, OpenAIEmbeddings(model="text-embedding-3-small"))
retriever = vs.as_retriever(search_kwargs={"k": 4})

# 2. 在线问答链
prompt = ChatPromptTemplate.from_template(
    "只根据以下上下文回答问题，上下文中没有答案就回答「根据已知信息无法回答」。\n"
    "上下文：\n{context}\n\n问题：{question}")

def format_docs(docs):
    return "\n\n".join(f"[{d.metadata.get('page')}] {d.page_content}" for d in docs)

rag_chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | prompt
    | ChatOpenAI(model="gpt-4o-mini")
    | StrOutputParser()
)
print(rag_chain.invoke("设备如何恢复出厂设置？"))
```

**各环节可替换的组件**
- **加载**：`PyPDFLoader`、`UnstructuredWordDocumentLoader`、`WebBaseLoader` 等 Document Loader。
- **切块**：`RecursiveCharacterTextSplitter`（通用）、`MarkdownHeaderTextSplitter`（按标题）、语义切分。
- **向量库**：FAISS、Chroma（本地）、Milvus、Elasticsearch、pgvector（生产）。
- **检索增强**：`search_type="mmr"` 增加多样性；`EnsembleRetriever` 组合 BM25 与向量做混合检索；`ContextualCompressionRetriever` 接 Reranker 做重排；`MultiQueryRetriever` 做查询改写。
- **Agentic RAG**：把 retriever 包装成工具交给 `create_agent`，由 Agent 决定是否检索、检索几次，适合多跳问题。

**生产注意点**：向量库持久化与增量更新、元数据过滤和权限控制、返回引用来源、用评测集衡量召回率与答案忠实度。

## LangGraph 核心概念与编排

### 介绍一下 LangGraph 框架
一句话结论：LangGraph 是 LangChain 团队推出的**有状态图编排框架**，把 Agent 或工作流建模成「共享状态 + 节点 + 边」的有向图（允许有环），用来构建可控、可持久化、支持人工介入的复杂 Agent 系统。

**核心理念**
- **状态驱动**：所有节点围绕同一份 State 读写，上下文、中间结果、路由标记都放在 State 里。
- **图结构编排**：节点负责具体逻辑（调用模型、执行工具、做判断），边定义流转关系，支持分支、循环、并行和子图。
- **持久化执行**：配置 checkpointer 后，每一步的状态都会保存，支持断点续跑、故障恢复、时间回溯和 human-in-the-loop。
- **底层而不绑定**：节点里可以调用任何代码，不强制使用 LangChain 组件；也提供预置的 Agent（LangChain 1.0 的 `create_agent` 就构建在 LangGraph 上）。

**执行模型**：基于 Pregel / BSP 思想按 **super-step（超步）** 推进：同一超步内被触发的节点并行执行，执行结束后统一把更新合并到 State，再决定下一超步要执行的节点，直到到达 `END` 或没有可执行的节点。

**生态**：LangGraph Platform（现名 LangSmith Deployment）提供部署和托管运行时，LangGraph Studio 提供可视化调试，LangSmith 做 Trace 和评测。

### LangGraph 为什么采用状态图，而不是链式结构？
一句话结论：Agent 的本质是「思考 → 行动 → 观察 → 再思考」的**循环**，并伴随大量分支和中间状态，链式结构（DAG）表达不了循环，也不擅长管理状态和中断恢复，状态图正好匹配这些需求。

1. **能表达循环和复杂分支**：LCEL 链本质是有向无环图，写 ReAct 循环、多层重试、条件跳转会变成难以维护的嵌套代码；状态图中把边连回前面的节点就形成循环，流转规则与业务节点解耦。
2. **统一的结构化状态**：所有节点共享一份带 schema 的 State，不需要在链之间零散传递变量、历史和中间结果；reducer 明确规定每个字段如何合并。
3. **可控性**：哪些步骤由模型自由决策、哪些是固定流程，都在图中显式定义，执行路径可预测、可调试。
4. **持久化与可恢复**：状态在每个超步结束时可以序列化保存，任意节点都能暂停、恢复、回溯；链式调用很难做到精确断点。
5. **便于人机协同和多 Agent**：人工审批就是图中的一个中断点，多 Agent 就是子图或节点之间的交接。

### LangGraph 的核心概念和组件有哪些？
一句话结论：**State、Node、Edge 组成 Graph**；State 承载共享数据，Node 执行步骤并返回状态更新，Edge 控制流转；**Checkpointer、Thread、Store** 提供持久化、会话隔离和长期记忆。

- **State**：通常用 `TypedDict` 定义；字段用 `Annotated[类型, reducer]` 指定合并方式，没有 reducer 的默认覆盖。内置 `MessagesState` 的 `messages` 使用 `add_messages` 追加。
- **Node**：普通函数，输入当前 State，返回**部分更新**的字典；也可以返回 `Command` 同时更新状态并跳转。
- **Edge**：`add_edge` 固定边，`add_conditional_edges` 按路由函数返回值决定下一节点；`START` / `END` 是入口和出口。
- **Graph**：`StateGraph(State)` 构建，`compile()` 做结构检查并挂载 checkpointer、store、中断点，编译后是 Runnable。
- **Checkpointer / Thread / Store**：checkpointer 保存每个超步的状态快照；`thread_id` 区分独立的执行和会话历史；Store 是跨 thread 的长期记忆存储。
- **Command / Send / interrupt**：`Command` 更新状态并跳转（也用于恢复中断），`Send` 动态扇出并行任务，`interrupt` 暂停等待人工输入。

```python
# ... import 省略
class State(TypedDict):
    messages: Annotated[list, add_messages]   # 追加合并
    step: int                                 # 默认覆盖

def chatbot(state: State):
    reply = model.invoke(state["messages"])
    return {"messages": [reply], "step": state.get("step", 0) + 1}

builder = StateGraph(State)
builder.add_node("chatbot", chatbot)
builder.add_edge(START, "chatbot")
builder.add_edge("chatbot", END)
graph = builder.compile(checkpointer=InMemorySaver())

graph.invoke({"messages": [("user", "你好")]}, {"configurable": {"thread_id": "1"}})
```

### LangGraph 中的 State 是如何存储和流转的？
一句话结论：State 是图运行过程中的**共享数据中心**：节点读取 State、返回部分更新，框架按每个字段的 **reducer** 把更新合并回 State；边根据最新 State 决定下一个节点；checkpointer 负责把每一步的 State 持久化。

**更新与合并**
- 节点只返回需要修改的字段，例如 `return {"answer": "..."}`，未返回的字段保持不变。
- 无 reducer 的字段直接覆盖；有 reducer 的字段按 reducer 合并，例如 `Annotated[list, operator.add]` 表示列表拼接，`add_messages` 会按消息 ID 追加或替换，并支持用 `RemoveMessage` 删除消息。
- 同一超步内多个并行节点写同一个**没有 reducer** 的字段时，框架会抛出 `InvalidUpdateError`，所以并行写入的字段必须定义 reducer。

**流转**
- 固定边：`a` 执行完必然到 `b`。
- 条件边：路由函数读取 State 返回下一个节点名（或节点名列表、`Send` 列表）。
- `Command(goto=...)`：节点内部直接决定下一跳。

**存储**
- 没有配置 checkpointer 时，State 只存在于本次调用的内存中，调用结束即丢弃。
- 配置 checkpointer 后，每个超步结束时会把完整 State 和下一步要执行的节点保存为一个 checkpoint，按 `thread_id` 组织；可以用 `graph.get_state(config)` 查看最新状态，用 `graph.get_state_history(config)` 查看历史快照。
- 还可以为图定义不同的输入 / 输出 schema 和节点私有的状态字段，只对外暴露必要的数据。

### 如果任务节点非常多，如何防止状态对象过大导致内存溢出？
一句话结论：问题通常不是节点多，而是**每一步都把大量中间结果堆进 State**，导致内存、序列化和 checkpoint 存储成本一起膨胀；思路是精简、外置、裁剪和限制增长。

1. **只放必要字段**：State 中只保留路由标记、关键中间结论和必要的消息，原始大文本、完整工具返回、日志不要长期保存在 State 中。
2. **大对象外置**：文件内容、检索结果、长文档等存到对象存储、数据库或 Store，State 中只保存 ID、路径或摘要。
3. **消息历史裁剪与摘要**：用 `trim_messages` 只保留最近 N 轮或 token 预算内的消息，或者把旧消息总结为摘要后通过 `RemoveMessage` 删除原始消息（LangChain 1.0 中可以直接用 `SummarizationMiddleware`）。
4. **避免无界追加**：使用 `operator.add` 等追加型 reducer 的字段要限制长度，或者自定义 reducer 只保留最近若干项。
5. **用子图和私有状态隔离**：子图内部的大量中间状态不必全部回传到父图，只把最终结果映射回父图 State。
6. **持久化放外部存储**：长流程使用 `PostgresSaver` 等数据库 checkpointer，而不是 `InMemorySaver`；定期清理过期 thread 的 checkpoint。

### 如何在 LangGraph 中实现条件分支、循环、并行执行和动态路由？
一句话结论：**条件分支和循环**用条件边，**并行**用一个节点连多条边（扇出）再汇合（扇入），**动态路由**用路由函数返回节点列表或 `Send`，也可以在节点里用 `Command(goto=...)` 跳转。

**1. 条件分支**
```python
def route_by_risk(state: State) -> str:
    return "human_review" if state["risk_level"] > 7 else "llm_answer"

builder.add_conditional_edges("judge_risk", route_by_risk, ["human_review", "llm_answer"])
```
第三个参数可以是可能的目标节点列表或「返回值 → 节点名」的映射，用于图的可视化和校验。

**2. 循环（ReAct）**
```python
from langgraph.prebuilt import ToolNode, tools_condition

builder.add_node("agent", call_model)              # call_model 中使用 model.bind_tools(tools)
builder.add_node("tools", ToolNode(tools))
builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", tools_condition)  # 有 tool_calls 去 "tools"，否则 END
builder.add_edge("tools", "agent")                 # 工具执行完回到模型，形成循环
```

**3. 并行（扇出 / 扇入）**
```python
builder.add_edge("plan", "web_search")
builder.add_edge("plan", "sql_query")
builder.add_edge("plan", "kb_search")              # 三个节点在同一超步并行执行
builder.add_edge(["web_search", "sql_query", "kb_search"], "merge")  # 全部完成后才执行 merge
```
并行节点写入的同一字段需要 reducer（如 `Annotated[list, operator.add]`）合并结果。

**4. 动态路由与 Map-Reduce（Send）**
```python
from langgraph.types import Send

def dispatch(state: State):
    # 运行时根据子任务数量动态扇出，每个 Send 携带独立的输入
    return [Send("worker", {"task": t}) for t in state["subtasks"]]

builder.add_conditional_edges("planner", dispatch, ["worker"])
```

**5. 节点内跳转（Command）**
```python
from typing import Literal
from langgraph.types import Command

def classifier(state: State) -> Command[Literal["legal", "medical"]]:
    target = "legal" if "合同" in state["question"] else "medical"
    return Command(update={"category": target}, goto=target)
```
不同领域可以各自是一个子图（编译后的图直接作为节点加入），实现「法律问题走法律子图、医疗问题走医疗子图」。

### LangGraph 图结构支持循环吗？如何定义终止条件防止 Agent 陷入死循环？
一句话结论：**支持循环**，这是它区别于 LCEL 链的关键能力；防止死循环要把**业务终止条件**和**框架步数上限（recursion_limit）**结合起来。

**1. 明确的业务终止条件**
- State 中设计 `done`、`status` 等字段，节点执行后更新，条件边据此决定继续循环还是走向 `END`。
- ReAct 循环中，模型不再产生工具调用即结束（`tools_condition` 的逻辑）。

**2. 重试计数**
```python
def route(state: State):
    if state["done"] or state["retry_count"] >= 3:
        return END
    return "agent"
```
对重试、补充检索、自我修正等循环单独维护计数器，达到阈值就退出或转兜底节点，终止条件比总步数更精细。

**3. 框架兜底：recursion_limit**
```python
from langgraph.errors import GraphRecursionError

try:
    graph.invoke(inputs, {"recursion_limit": 30, "configurable": {"thread_id": "1"}})
except GraphRecursionError:
    ...  # 返回已有结论或提示用户
```
`recursion_limit` 限制的是超步数量，超出时抛出 `GraphRecursionError`；默认值随版本可能变化，生产中建议按业务复杂度显式设置。

**4. 检测无进展**
- 记录工具名 + 参数的哈希，相同调用重复出现即判定陷入循环；或比较关键 State 字段在几轮之间是否有变化。

**5. 优雅降级**
- 达到上限前路由到一个「总结」节点，让模型基于已有信息给出当前最佳回答并说明卡点，而不是直接抛异常给用户。

## LangGraph 持久化、记忆与人机协同

### LangGraph 的 Checkpoint、Store 和 Thread 分别解决什么问题？
一句话结论：**Thread 是一次会话或任务的标识，Checkpoint 是该 thread 每一步的状态快照，Store 是跨 thread 共享的长期存储**。

| 概念 | 解决的问题 | 作用范围 | 典型内容 |
| --- | --- | --- | --- |
| Thread | 区分不同会话 / 任务，隔离状态 | 单个 thread | 通过 `thread_id` 标识 |
| Checkpoint | 保存执行进度，支持恢复、回溯、人工介入 | 单个 thread 内的每个超步 | 完整 State、下一步要执行的节点、元数据 |
| Store | 跨会话复用信息 | 全局，按 namespace 隔离 | 用户画像、偏好、长期记忆、共享知识 |

**Thread**
- 调用时传 `{"configurable": {"thread_id": "..."}}`；同一 thread 的多次调用接续同一份 State，不同 thread 完全隔离。
- 一般用「用户 + 会话」生成 thread_id。

**Checkpoint**
- 编译时传入 checkpointer：开发用 `InMemorySaver`，生产用 `PostgresSaver`、`SqliteSaver`、`RedisSaver` 等。
- 每个超步结束都会生成一个 checkpoint（有 `checkpoint_id`），一个 thread 会有一串历史快照，可通过 `get_state_history` 遍历，并从任意快照回放或分叉（time travel）。
- 某个超步中部分节点失败时，已成功节点的写入（pending writes）也会被保存，恢复时不会重复执行这些节点。

**Store**
```python
from langgraph.store.memory import InMemoryStore
from langgraph.store.base import BaseStore

store = InMemoryStore()   # 生产可用 PostgresStore；配置 index 后支持语义检索

def call_model(state: MessagesState, config, *, store: BaseStore):
    ns = ("memories", config["configurable"]["user_id"])
    memories = store.search(ns, query=state["messages"][-1].content, limit=3)
    ...
    store.put(ns, "food", {"pref": "喜欢吃辣"})

graph = builder.compile(checkpointer=checkpointer, store=store)
```
namespace 是元组（如 `("memories", user_id)`），用来隔离不同用户或类型的数据。

### LangGraph 如何实现记忆机制？
一句话结论：**短期记忆 = thread 级 State（通常是 messages）+ checkpointer 持久化；长期记忆 = Store 中按 namespace 存放的跨会话信息**。

**1. 短期记忆（会话内）**
- State 中定义 `messages: Annotated[list, add_messages]`（或直接用 `MessagesState`），每轮对话的消息自动追加。
- 编译时配置 checkpointer，同一个 `thread_id` 的后续调用会自动加载之前的 State，实现多轮上下文和断点续执行。
- 历史过长时裁剪（`trim_messages`）或摘要（摘要节点 + `RemoveMessage` 删除旧消息）。

**2. 长期记忆（跨会话）**
- 通过 Store API 写入和检索，例如以 `("memories", user_id)` 为 namespace 存储从对话中抽取出的用户事实和偏好。
- 记忆可以分为语义记忆（事实、偏好）、情景记忆（过往经历、成功案例，可用作 few-shot）、程序记忆（系统提示词或规则，可以由 Agent 自我更新）。
- 写入时机：在主流程中（热路径）由模型调用「保存记忆」工具实时写入，或在会话结束后由后台任务异步抽取（不增加响应延迟）。LangMem 库提供了记忆抽取与管理的现成工具。
- Store 配置 Embedding 索引后支持语义检索，每轮按当前问题召回相关记忆注入 Prompt。

### LangGraph 里的 Checkpoint 和 Memory 有什么区别？
一句话结论：**Checkpoint 是底层的状态持久化机制，Memory 是上层的记忆语义**；前者回答「执行到哪了、怎么继续」，后者回答「哪些信息值得记住并复用」。

| 维度 | Checkpoint | Memory |
| --- | --- | --- |
| 层次 | 运行时机制 | 应用语义 |
| 保存什么 | 每个超步的完整 State，不区分是否有用 | 经过筛选、摘要、结构化的有价值信息 |
| 作用 | 中断恢复、断点续跑、时间回溯、人工介入、容错 | 多轮上下文连贯、跨会话个性化 |
| 范围 | 绑定单个 thread | 短期记忆在 thread 内，长期记忆跨 thread |
| 实现 | checkpointer（InMemorySaver / PostgresSaver 等） | 短期：State 中的 messages + checkpointer；长期：Store |

**关系**：短期记忆就是 State 的一部分，依赖 checkpoint 实现持久化；长期记忆通过 Store 独立实现，不依赖具体某次执行的状态。可以理解为 checkpoint 是短期记忆的底层支撑，但 checkpoint 中大量的执行细节并不都是「记忆」。

### LangGraph 中多 Agent 之间的记忆是怎么组织的？
一句话结论：多 Agent 场景通常采用**共享状态 + 私有状态**的双层结构：所有 Agent 通过父图的 State 共享对话历史、任务目标和中间结果，各 Agent 的内部推理过程放在自己的子图状态中；长期知识则统一放在 Store。

**1. 共享记忆**
- 父图 State 中存放全局信息：`messages`（全局对话）、任务目标、计划、各 Agent 产出的中间结果。
- 所有 Agent 节点读取并写回这份 State，节点跳转时自动继承最新状态；并行写入的字段要定义 reducer。

**2. 私有记忆**
- 每个 Agent 实现为一个子图，子图可以有自己的 State schema（如自己的工具调用历史、草稿），只把最终结果映射回父图，避免中间过程污染其他 Agent 的上下文，也控制了 token 消耗。
- 可以在 State 中按 Agent 划分字段（如 `researcher_notes`、`coder_notes`），只让对应节点读写。

**3. 交接（handoff）**
- 子图中的 Agent 通过 `Command(goto="other_agent", update={...}, graph=Command.PARENT)` 把控制权和必要信息交给其他 Agent。
- 常见架构：Supervisor（主管 Agent 负责路由，`langgraph-supervisor` 提供了预置实现）、Swarm（Agent 之间直接交接，`langgraph-swarm`）、层级式（多层 Supervisor）。

**4. 持久化与长期记忆**
- checkpointer 挂在父图上，会自动作用于子图，整个多 Agent 执行过程都可以中断恢复。
- 跨会话的用户信息、共享知识放到 Store，用 namespace 区分用户和 Agent，例如 `(user_id, "researcher")`。
- 控制上下文规模：Agent 之间传递摘要而不是完整历史。

### LangGraph 如何实现人类在循环中（Human-in-the-loop）？
一句话结论：依靠 **checkpointer + `interrupt()`**：节点内调用 `interrupt()` 暂停图并把待审信息返回给调用方，状态被保存；人工处理后用相同的 `thread_id` 调用 `graph.invoke(Command(resume=...))`，从中断处继续。

**1. 动态中断（推荐）**
```python
from langgraph.types import interrupt, Command
from langgraph.checkpoint.memory import InMemorySaver

def approve_tool(state: State):
    decision = interrupt({                      # 暂停，payload 返回给调用方展示
        "question": "是否执行退款？",
        "args": state["refund_args"],
    })
    if decision["approved"]:
        return Command(goto="do_refund")
    return Command(goto="revise", update={"feedback": decision.get("comment")})

graph = builder.compile(checkpointer=InMemorySaver())   # 必须配置 checkpointer
cfg = {"configurable": {"thread_id": "order-42"}}

result = graph.invoke({"messages": [...]}, cfg)
print(result["__interrupt__"])                  # 拿到中断信息，推给前端或审批系统

graph.invoke(Command(resume={"approved": True}), cfg)    # 人工确认后恢复
```
- `interrupt()` 的参数会出现在返回结果的 `__interrupt__` 中；恢复时 `Command(resume=...)` 的值成为 `interrupt()` 的返回值。
- **注意**：恢复时会从**该节点开头重新执行**，所以 `interrupt()` 之前的代码要幂等（或把副作用放在 interrupt 之后、或单独的节点中）；同一节点内多个 `interrupt` 按调用顺序匹配恢复值，不要放在顺序会变化的条件分支里。

**2. 静态断点**
- `compile(interrupt_before=["tools"])` 或 `interrupt_after=[...]`，在指定节点前后固定暂停，恢复时调用 `graph.invoke(None, cfg)`。官方更推荐把它用于调试，业务审批用 `interrupt()`。

**3. 查看与修改状态**
- `graph.get_state(cfg)` 查看当前 State 和下一步待执行节点；`graph.update_state(cfg, {...})` 修改状态（如修正工具参数），再继续执行。

**4. 常见模式**
- 审批或拒绝高风险工具调用；编辑模型生成的参数或草稿；向人追问缺失信息；审核最终输出。
- LangChain 1.0 的 `create_agent` 可以直接用 `HumanInTheLoopMiddleware(interrupt_on={"send_email": True})` 为指定工具开启审批。

### 如何实现 Agent 的中断恢复、人工审批和断点续跑？
一句话结论：三者都建立在 **checkpointer 持久化**之上：每个超步结束都保存状态，主动暂停用 `interrupt`，故障后用同一 `thread_id` 重新调用即可从最后一个成功的 checkpoint 继续，还能回到任意历史快照重跑。

- **持久化**：生产用 `PostgresSaver` / `RedisSaver`，进程重启或换机器后仍能恢复；LangGraph 0.6+ 可用 `durability` 参数（`"exit"` / `"async"` / `"sync"`）权衡性能与持久化强度。
- **断点续跑**：中途异常时已完成超步的状态已保存，修复后用相同 config 调用 `graph.invoke(None, cfg)` 从中断处继续。
- **人工审批**：审批节点调用 `interrupt(payload)` 挂起，业务系统据 `__interrupt__` 生成待办；审批人提交结果后用 `Command(resume=审批结果)` 恢复，条件路由决定执行、重新生成或结束。等待期间不占进程资源，可以几天后再恢复。
- **时间回溯**：`get_state_history(cfg)` 列出历史 checkpoint，带上 `checkpoint_id` 调用即从该点重跑；也可先 `update_state` 修改再执行，形成新分支。

易错点：恢复时节点可能被重复执行，节点要幂等，外部副作用（扣款、发消息）要加幂等键；长期挂起的 thread 要有超时和清理策略。

## 选型与工程化

### 什么情况下用 LangChain、LangGraph，什么情况下自研 Agent 框架？为什么很多公司选择手写 Agent？
一句话结论：**简单链路和快速原型用 LangChain，复杂有状态流程用 LangGraph，对可控性、性能、安全和内部体系集成要求很高时自研**；实际中很多公司借鉴框架的设计思想，核心链路自己实现。

| 选择 | 适用场景 |
| --- | --- |
| LangChain（LCEL / `create_agent`） | 单轮或简单多轮问答、基础 RAG、标准工具调用 Agent、快速验证 |
| LangGraph | 多步骤、有循环和分支、需要人工审批、长任务和断点续跑、多 Agent 编排 |
| 自研 | 内网隔离、深度对接内部权限 / 审计 / 日志 / 网关体系，高 QPS 低延迟调度，复杂业务规则，或语言栈不是 Python（如 Java 服务用 Spring AI 等） |

**公司选择自研的常见原因**
- **抽象层厚，排查困难**：框架封装多层，出问题时难以定位到底发给模型的是什么 Prompt。
- **版本迭代快**：API 变动频繁（例如 0.x 到 1.0 大量接口废弃），升级成本和兼容性风险高。
- **与内部体系集成**：权限、审批、审计、监控、配置中心等需要深度定制。
- **成本和性能精细控制**：每一步的 Prompt、token、工具调用都需要精确优化。
- **安全合规**：严格控制数据访问和工具权限，依赖链越短越容易审计。

**常见折中**：参考 LangGraph 的状态图、checkpoint、interrupt 等设计思想，自己实现工具注册、任务状态机、Prompt 模板、日志监控和权限控制；也可以只用框架的底层部分（如只用 LangGraph 做编排，模型调用和工具层自己封装）。

### LangChain 旧版 API 有哪些已经废弃？应该如何迁移？
一句话结论：LangChain 0.1 之后逐步废弃了以「Chain 类 + Memory 类 + AgentExecutor」为核心的旧设计，1.0 把它们移入 `langchain-classic` 包；新代码应使用 **LCEL、`create_agent` 和 LangGraph**。

| 旧 API（已废弃） | 推荐替代 |
| --- | --- |
| `LLMChain` | `prompt \| model \| StrOutputParser()` |
| `ConversationChain`、`ConversationBufferMemory` 等 Memory 类 | `RunnableWithMessageHistory`，或 LangGraph checkpointer + `trim_messages` / 摘要 |
| `initialize_agent`、`AgentExecutor`、`langgraph.prebuilt.create_react_agent` | `langchain.agents.create_agent`（LangChain 1.0），或 LangGraph 自定义图 |
| `RetrievalQA`、`ConversationalRetrievalChain` | LCEL 组装 RAG 链，或把检索器包装成工具交给 Agent |
| `SequentialChain`、`RouterChain` | LCEL 组合 `RunnableParallel` / `RunnableBranch`，复杂路由用 LangGraph |
| `chain.run()`、`chain.predict()`、`__call__` | `invoke()` / `stream()` / `batch()` |

包结构：`langchain-core` 放核心抽象，`langchain` 1.0 只保留 `create_agent`、中间件等高层接口，厂商集成拆成 `langchain-openai` 等独立包，`langchain-classic` 只用于兼容旧代码。LangChain 1.0 要求 Python 3.10+。

### 如何对 Agent 的执行链路做日志记录和评测？
一句话结论：**链路追踪靠 Callback / Trace（LangSmith、Langfuse 或 OpenTelemetry）记录每一步的输入输出，评测分离线数据集评测和线上反馈监控两部分**，按链路指标和效果指标分别衡量。

**日志与追踪**
- 记录内容：query、thread_id / trace_id、每个节点输入输出与耗时、模型 Prompt / 回复 / token、工具参数与返回、异常和重试。
- 实现：设置 `LANGSMITH_TRACING=true` 即可自动追踪每一步，或用开源 Langfuse 的 CallbackHandler；自研则实现 `BaseCallbackHandler`，在 `on_llm_start`、`on_tool_end`、`on_chain_error` 等回调埋点，输出结构化日志到 ELK 或 OpenTelemetry。
- 日志中的隐私和密钥要脱敏。

**评测指标**
- 链路指标：任务成功率、工具调用成功率、平均步数、人工介入率、P95 延迟、token 成本。
- 效果指标：答案正确率、幻觉率、工具选择和参数是否正确、轨迹是否有多余步骤。

**评测方法**
- 离线：带标准答案的测试集批量跑，规则检查 + LLM-as-a-Judge + 人工抽检；每次改 Prompt、模型或工具都跑回归。
- 轨迹评测：除最终答案外，对比实际工具调用序列与期望轨迹（如 agentevals 的轨迹匹配评估器）。
- 线上：收集点赞 / 点踩、转人工等信号，关联 trace_id 定位问题节点，bad case 回流离线测试集。
