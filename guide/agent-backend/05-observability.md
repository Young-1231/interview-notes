## 5. 可观测性：知道到底卡在哪 {必学}
> 一次 Run 要串起排队、多轮 LLM 调用、多个工具和下游 HTTP/DB，任何一环慢了、错了、贵了都只表现为「用户等了很久」；可观测性的作用是用日志、指标、链路追踪把这条链路拆开，能快速说清问题出在模型、工具、队列还是自己的后端。

### 在链路中的位置
研报助手的一次 Run：API 收到请求，写 `agent_run`（`queued`），投递 Celery 任务；Worker 取到任务后进入 Agent 循环，每一轮是一个 `agent_step`：要么调用 LLM，要么调用 `web_search` / `query_db` / `send_email`，工具内部又会发 HTTP 请求或查数据库；过程中的 token 通过 Redis Pub/Sub 和 SSE 推给前端。

可观测性不是链路上的一个新组件，而是横切在每一段上的「埋点」：API、Worker、工具适配层、LLM 客户端都要产出日志、指标和 span，统一送到后端存储（日志系统、Prometheus、Trace 后端或 LLM 专用平台），再用 `run_id` 和 `trace_id` 把它们关联起来。

和普通 Web 服务相比，Agent 的难点在于：

- 一个请求的耗时从毫秒级变成几十秒到几分钟，而且大部分时间花在外部（模型厂商、搜索 API），只看接口总耗时没有意义；
- 同样的输入，模型每次走的步骤数可能不同，「慢」可能是因为模型多绕了三轮工具调用，而不是哪个服务变慢；
- 成本按 token 计费，一次失控的循环可能花掉几十倍的钱，成本本身就是需要监控的指标；
- 跨进程：API 进程和 Worker 进程之间隔着队列，不做上下文传递，链路就会断成两截。

### 三种信号：日志、指标、链路追踪
三种信号回答的问题不同，不能互相替代。

| 信号 | 回答的问题 | 典型形式 | 研报助手里的例子 |
|---|---|---|---|
| Logs 日志 | 某件具体的事发生了什么、上下文是什么 | 每条一个 JSON 事件 | run 123 的第 4 步调用 `web_search` 返回 429 |
| Metrics 指标 | 整体趋势和比例，是否需要告警 | 计数器、直方图，按维度聚合 | 过去 5 分钟 Run 成功率 92%，LLM 调用 P95 18s |
| Traces 链路追踪 | 一次请求的时间花在哪一段、谁调用了谁 | 由 span 组成的树 | run 123 总共 90s，其中排队 40s、第 2 次 LLM 调用 25s |

一般的使用顺序是：指标告警发现「成功率掉了」或「P95 升高」，按维度定位到某类 step 或某个工具；再找一条具体的慢 trace 看时间分布；最后用 `trace_id` / `run_id` 查日志看具体错误信息。所以三者之间必须能互相跳转，关联字段是整章的关键。

<div class="note">易错点：指标的标签（label）不能放 <code>run_id</code>、<code>user_id</code> 这类高基数字段。每个标签值组合都会生成一条独立的时间序列，按 run_id 打标签会让 Prometheus 的序列数无限增长。单个 Run 的信息放日志和 trace，指标只放 step_type、tool_name、model、status 这类有限取值的维度。</div>

### 结构化日志：用 run_id 和 trace_id 串起来
#### 为什么要 JSON
纯文本日志适合人读，但在多实例、多 Worker 的情况下，需要按「某个 run 的所有日志」「某个工具的所有错误」来过滤。每行一个 JSON 对象，字段固定，日志系统（Loki、Elasticsearch、云厂商日志服务）可以直接按字段查询，不需要写正则解析。

每条日志至少带上这些关联字段：

- `run_id`：业务主键，客服和用户反馈时给的就是它；
- `step`（即 `agent_step.seq`）和 `step_type`：定位到第几步；
- `trace_id` / `span_id`：和链路追踪跳转；
- `service`（api / worker）、`level`、`event`（事件名，如 `llm_call_finished`）。

这些字段不应该在每次打日志时手动传。Python 里用 `contextvars` 在进入 Run、进入 Step 时绑定一次，之后同一个协程链路里的日志自动带上。`structlog` 提供了现成的 `structlog.contextvars`，trace_id 则从 OpenTelemetry 当前 span 里取：

```python
import structlog
from opentelemetry import trace

def add_trace_ids(logger, method, event_dict):
    ctx = trace.get_current_span().get_span_context()
    if ctx.is_valid:
        event_dict["trace_id"] = format(ctx.trace_id, "032x")
        event_dict["span_id"] = format(ctx.span_id, "016x")
    return event_dict

structlog.configure(processors=[
    structlog.contextvars.merge_contextvars,   # 合并 bind_contextvars 绑定的字段
    add_trace_ids,
    structlog.processors.add_log_level,
    structlog.processors.TimeStamper(fmt="iso"),
    structlog.processors.JSONRenderer(),
])
log = structlog.get_logger()

# Worker 进入一个 Run / Step 时绑定一次
structlog.contextvars.bind_contextvars(run_id=run.id, user_id=run.user_id)
structlog.contextvars.bind_contextvars(step=step.seq, step_type="llm")
log.info("llm_call_started", model="gpt-4o")
```

<div class="note">易错点：Celery 的 prefork Worker 会复用进程执行不同任务，<code>bind_contextvars</code> 绑定的值会残留到下一个任务。任务开始时先调用 <code>structlog.contextvars.clear_contextvars()</code>，再绑定当前 run_id。</div>

#### LLM 调用该记什么
每次 LLM 调用结束打一条事件日志，同时把同样的数据写进 `agent_step`（`tokens_in`、`tokens_out`、`started_at`、`finished_at`），日志用于排查，表用于业务查询和计费对账。建议字段：

| 字段 | 说明 | 用途 |
|---|---|---|
| `model` | 请求的模型名，以及响应里实际返回的模型名 | 区分不同模型的延迟和成本；发现厂商侧悄悄切换版本 |
| `latency_ms`、`ttft_ms` | 总耗时、首 token 耗时（流式时） | 判断慢在排队/首包还是生成长度 |
| `tokens_in`、`tokens_out` | 来自响应的 usage 字段，不要自己估算 | 成本、上下文膨胀 |
| `finish_reason` | 如 `stop`、`length`、`tool_calls`（不同厂商取值不同） | `length` 说明输出被截断，常是 bug 源头 |
| `cost` | 按价目表计算的金额 | 每 Run 成本、预算告警 |
| `attempt`、`error_type` | 第几次重试、错误类别（429、超时、5xx） | 区分厂商限流和自身错误 |
| `request_id` | 厂商返回的请求 ID | 找厂商排查时必须提供 |

工具调用同理：`tool_name`、`tool_call_id`、`latency_ms`、`status`、`error`、`attempt`，以及参数的摘要。

#### 不该记什么
- 密钥：API Key、数据库连接串、OAuth token、Authorization 头。HTTP 客户端的 debug 日志会把请求头整个打出来，生产环境要关掉或过滤。
- 原始 PII：用户邮箱、手机号、身份证号等。`send_email` 的收件人记录为脱敏形式（如 `a***@example.com`）或哈希。
- 完整的 prompt 和模型输出：它们可能包含用户上传的文档、内部数据库查询结果。完整内容如需保留，放到有权限控制和保留期限的存储（例如 `message` 表或 LLM 观测平台），普通日志只记长度和摘要。

脱敏要在日志管道的入口统一做（一个 structlog processor，按字段名黑名单和正则替换），而不是依赖每个开发者自觉。日志一旦送出去，就会被复制到多个系统，事后很难清理干净。

### 指标：Agent 服务该看哪些数
#### 核心指标
| 指标 | 类型 | 维度（label） | 回答的问题 |
|---|---|---|---|
| Run 成功率 | Counter，按终态计数 | `status`（succeeded / failed / cancelled） | 服务整体是否健康；failed 和 cancelled 要分开看，用户主动取消多也可能是体验问题 |
| Run 端到端耗时 | Histogram | 无或 `agent_type` | 用户实际等了多久 |
| Step 耗时 P50/P95/P99 | Histogram | `step_type`、`model`、`tool_name` | 慢在哪类步骤 |
| TTFT 首 token 时间 | Histogram | `model` | 流式体验；用户感知的「卡住」大多是首 token 慢 |
| 每 Run token 数与成本 | Histogram / Counter | `model` | 成本趋势、异常 Run（循环、上下文爆炸） |
| 每 Run 步数 | Histogram | 无 | 模型是否在绕圈；步数分布右移往往先于成本告警 |
| 工具错误率 | Counter | `tool_name`、`error_type` | 某个外部依赖是否出问题 |
| LLM 错误与重试次数 | Counter | `model`、`error_type` | 厂商限流（429）、超时、5xx |
| 队列深度、排队时间 | Gauge / Histogram | `queue` | Worker 是否不够用 |

看延迟要看分位数而不是平均值：Agent 的耗时分布长尾很重，平均值会被大量快速 Run 拉低，掩盖少数几分钟的 Run。P50 反映典型体验，P95/P99 反映最差的那批用户。

排队时间的计算方式：投递任务时把 `enqueued_at` 时间戳放进任务参数或 header，Worker 开始执行时用当前时间减去它。队列深度对 Redis broker 可以直接查对应 list 的长度（Celery 默认队列名是 `celery`），RabbitMQ 则看队列的 messages 数。

```python
from prometheus_client import Counter, Histogram

# LLM 调用的耗时远超默认桶（默认最大 10s），必须自定义 buckets
STEP_SECONDS = Histogram(
    "agent_step_duration_seconds", "Step duration",
    ["step_type", "name"],               # name = 模型名或工具名
    buckets=(0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300),
)
TOKENS = Counter("agent_llm_tokens_total", "LLM tokens", ["model", "direction"])
RUNS = Counter("agent_runs_total", "Finished runs", ["status"])

with STEP_SECONDS.labels("tool", "web_search").time():
    result = await web_search(query)
TOKENS.labels("gpt-4o", "input").inc(usage.input_tokens)
RUNS.labels("succeeded").inc()
```

<div class="note">易错点：Celery prefork 是多进程，<code>prometheus_client</code> 默认每个进程各自持有计数，直接暴露 HTTP 端点会只看到其中一个子进程的数据。要么使用 <code>prometheus_client</code> 的多进程模式（设置 <code>PROMETHEUS_MULTIPROC_DIR</code>），要么改用 OpenTelemetry Metrics 通过 OTLP 推送到 Collector。</div>

#### RED 与 USE
两套常用的检查清单，帮助确定「至少要有哪些指标」：

- RED（面向服务/请求）：Rate 请求速率、Errors 错误率、Duration 耗时。适用于 API、LLM 调用、每个工具——每个都应该有这三项。
- USE（面向资源）：Utilization 使用率、Saturation 饱和度、Errors 错误。适用于 Worker 池、数据库连接池、Redis、CPU 和内存。对 Agent 服务而言，最常见的饱和点是 Worker 并发槽位（队列深度持续上涨）、数据库连接池（等待连接超时）和 LLM 厂商的速率配额（429 增多）。

### 链路追踪：一次 Run 的 span 树
#### span 模型
Trace 由 span 组成，每个 span 有开始和结束时间、父 span、属性（attributes）和状态。研报助手的一次 Run 建议建模为：

```text
POST /runs                         (api, SERVER span)
└─ celery publish run_agent        (api, PRODUCER)
   └─ run_agent  run_id=123        (worker, CONSUMER)   ← 整个 Run
      ├─ step 1  llm               ── chat gpt-4o        (CLIENT, HTTP 到模型厂商)
      ├─ step 2  tool web_search   ── GET search API     (CLIENT)
      ├─ step 3  tool query_db     ── SELECT ...         (CLIENT, SQLAlchemy)
      ├─ step 4  llm               ── chat gpt-4o
      └─ step 5  tool send_email   ── POST mail API
```

Run 和 Step 这两层是业务 span，需要手动创建；最底层的 HTTP、数据库 span 由自动埋点生成。手动 span 上设置 `run.id`、`step.seq`、`tool.name` 这类自定义属性，便于在 Trace 后端按 run_id 搜索。

```python
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

tracer = trace.get_tracer("agent.worker")

async def run_step(run, step):
    with tracer.start_as_current_span(f"step {step.type}") as span:
        span.set_attribute("run.id", str(run.id))
        span.set_attribute("step.seq", step.seq)
        try:
            return await execute(step)          # 内部的 httpx / SQLAlchemy 调用自动成为子 span
        except Exception as e:
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, str(e)))
            raise
```

一个 Run 可能持续几分钟、几十个 step，span 树会比普通请求大很多。如果 Run 中途进入 `waiting_approval`，等用户审批可能要几个小时，此时不要让一个 span 一直开着：把审批前后拆成两个 trace，用 span link 或在属性里记录 `run.id` 关联，否则 span 迟迟不结束，Trace 后端里看不到数据。

#### 跨队列的上下文传递
API 进程创建 trace，任务通过 Redis/RabbitMQ 交给 Worker 进程，两边没有共享内存。要让 Worker 里的 span 挂在同一个 trace 下，必须把 trace 上下文序列化后随任务一起发送，这就是 context propagation。OpenTelemetry 默认使用 W3C Trace Context 格式，核心是一个 `traceparent` 字符串（包含 trace_id、父 span_id 和采样标记）。

- 推荐做法：安装 `opentelemetry-instrumentation-celery`，它会在发布任务时把上下文注入任务 header，在 Worker 执行前提取出来，生成 PRODUCER / CONSUMER span。
- 手动做法（理解原理，或使用不支持自动埋点的队列时）：用 `inject` 写入一个 dict 随任务发送，Worker 端用 `extract` 还原，作为新 span 的父上下文。

```python
from opentelemetry.propagate import inject, extract

# API 端：投递任务时注入
carrier: dict[str, str] = {}
inject(carrier)                          # carrier 里多出 traceparent
run_agent.apply_async(args=[run_id], kwargs={"trace_ctx": carrier})

# Worker 端：执行时提取，作为父上下文
@celery_app.task(bind=True)
def run_agent(self, run_id, trace_ctx=None):
    ctx = extract(trace_ctx or {})
    with tracer.start_as_current_span("run_agent", context=ctx) as span:
        span.set_attribute("run.id", str(run_id))
        # ...
```

同样的问题也出现在 SSE 推流链路：Worker 通过 Redis Pub/Sub 发事件给 API 进程，若需要追踪推送延迟，可以在消息体里带上 `traceparent`。第一版通常不需要做到这一步，在事件里带上 `run_id` 和时间戳就够了。

<div class="note">易错点：Celery prefork 模式下，OpenTelemetry 的 SDK 和 instrumentor 要在子进程里初始化（例如在 <code>worker_process_init</code> 信号里调用），而不是只在主进程初始化。否则 fork 之后 BatchSpanProcessor 的后台导出线程不在子进程里，span 会静默丢失。</div>


### OpenTelemetry 基础
OpenTelemetry（OTel）是 CNCF 下的开放标准和实现，统一了 traces、metrics、logs 的 API、SDK 和传输协议。它本身不存储数据，只负责采集和导出，后端可以是 Jaeger、Tempo、Prometheus、各家云 APM，也可以是支持 OTLP 的 LLM 观测平台。选它的理由是：埋点写一次，后端可以换。

几个组成部分：

| 组件 | 作用 |
|---|---|
| API / SDK | 代码里创建 span、记录指标；SDK 负责采样、批量处理和导出 |
| Instrumentation 自动埋点 | 对常用库打补丁，自动生成 span，如 FastAPI、httpx、SQLAlchemy、Celery、Redis |
| OTLP | OTel 的传输协议，gRPC 默认端口 4317，HTTP 默认端口 4318 |
| Collector | 独立部署的代理/网关进程，接收 OTLP，做批处理、采样、脱敏、打标签，再转发到一个或多个后端 |

Python 侧初始化示例（API 进程；Worker 类似，额外加 Celery 埋点）：

```python
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

provider = TracerProvider(resource=Resource.create({"service.name": "agent-api"}))
# endpoint 不写时读取 OTEL_EXPORTER_OTLP_ENDPOINT 环境变量
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)

FastAPIInstrumentor.instrument_app(app)
HTTPXClientInstrumentor().instrument()          # 调模型厂商、搜索 API 的 HTTP 请求
SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)  # 异步引擎传 sync_engine
```

也可以不改代码，用 `opentelemetry-instrument uvicorn app.main:app` 这种命令行包装方式启用自动埋点，配置全部走 `OTEL_*` 环境变量（如 `OTEL_SERVICE_NAME`、`OTEL_EXPORTER_OTLP_ENDPOINT`）。业务 span（Run、Step）仍需手动创建。

<div class="tip">实践建议：应用只往本机或同集群的 Collector 发 OTLP，由 Collector 决定转发到哪里。这样切换后端、加采样策略、在出口统一删除敏感属性，都不需要改应用代码和重新发版。</div>

#### GenAI 语义约定
OTel 的 semantic conventions 规定了属性该叫什么名字，例如 HTTP span 用 `http.request.method`。针对 LLM 调用，OTel 有一套 GenAI semantic conventions，定义了模型调用 span 的命名和属性。它目前仍处于实验（Development）阶段，属性名在不同版本间有过调整，使用时要以所依赖的版本文档为准。比较确定的常用属性：

| 属性 | 含义 |
|---|---|
| `gen_ai.operation.name` | 操作类型，如 `chat` |
| `gen_ai.request.model` | 请求的模型名 |
| `gen_ai.response.model` | 响应中实际使用的模型名 |
| `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` | 输入、输出 token 数 |
| `gen_ai.response.finish_reasons` | 结束原因列表 |

按约定命名的好处是：支持 GenAI 约定的后端能直接识别这些 span，自动展示 token 和模型维度，不需要自定义解析。prompt 和补全内容是否记录到 span 上，相关埋点库一般默认关闭、需要显式开启，原因同上一节的隐私问题。

### LLM 专用观测平台 vs 通用 APM
通用 APM（Jaeger、Tempo、Datadog、各云厂商 APM）擅长看延迟、错误和服务拓扑，但不理解「这个 span 是一次 LLM 调用」：看不到 prompt 和回复的内容、不会按模型价目算成本、不能对输出打分。LLM 专用平台补的是这一块：

| 工具 | 特点 |
|---|---|
| Langfuse | 开源，可自托管；trace / generation 视图、token 与成本统计、prompt 版本管理、评测打分 |
| LangSmith | LangChain 团队的平台，与 LangChain / LangGraph 集成最紧密，也提供不依赖 LangChain 的 SDK；以托管服务为主 |
| Arize Phoenix | 开源，基于 OpenTelemetry 和 OpenInference 约定，侧重 trace 可视化与评测 |

两者不是二选一。常见组合是：通用 APM 和 Prometheus 负责服务级的延迟、错误、资源和告警；LLM 平台负责看具体某次 Run 的 prompt、模型输出、工具参数，以及评测和成本分析。选型时要关注：数据是否允许出境或送到第三方（研报助手会查内部数据库，prompt 里可能有敏感内容，这往往决定了必须自托管）、是否支持 OTLP 接入以避免两套埋点。

### 实战：这个 Run 跑了 90 秒，慢在哪
用户反馈 run 123 「转了一分半才出结果」。排查顺序如下。

1. 先看数据库里的时间线。`agent_run.created_at` 到第一个 `agent_step.started_at` 的差就是排队时间加 Worker 启动时间；之后每个 step 的 `finished_at - started_at` 是执行时间；相邻 step 之间的空隙是 Agent 循环自身的开销（拼 prompt、写库、推 SSE）。

```sql
SELECT seq, type, output->>'tool_name' AS tool,
       started_at - lag(finished_at) OVER (ORDER BY seq) AS gap,
       finished_at - started_at AS duration,
       tokens_in, tokens_out
FROM agent_step WHERE run_id = 123 ORDER BY seq;
-- 第一步与 run 创建时间的差：排队时间
SELECT min(s.started_at) - r.created_at AS queue_wait
FROM agent_run r JOIN agent_step s ON s.run_id = r.id
WHERE r.id = 123 GROUP BY r.created_at;
```

（`output->>'tool_name'` 假设工具名存在 step 的 JSON 输出里，实际以表结构为准，也可以 join `tool_call`。）

2. 再打开对应的 trace，按 span 耗时排序，把 90 秒归到四类之一：

| 现象 | 归因 | 进一步确认 | 常见处理 |
|---|---|---|---|
| Run 创建到 `run_agent` CONSUMER span 开始有 40s | 队列 | 同时段队列深度指标、Worker 并发是否打满 | 扩 Worker、拆分队列（长任务与短任务分开）、按用户限流 |
| 某个 LLM span 25s，且 `tokens_out` 很大 | 模型生成长 | TTFT 正常、总耗时随输出 token 线性增长 | 限制 `max_tokens`、要求简洁输出、换更快的模型 |
| LLM span 的 TTFT 就有 15s | 模型厂商侧慢或排队 | 同模型 TTFT P95 是否整体升高；输入 token 是否异常大 | 降级到备用模型、缩减上下文 |
| LLM span 内有多次重试子 span | 429 限流或超时重试 | 错误日志里的 `error_type`、`attempt` | 调整并发、退避策略，申请更高配额 |
| `web_search` span 30s，其下 HTTP span 也是 30s | 工具 / 外部依赖 | 工具错误率、该 API 的 P95 | 工具级超时、缓存、并行化 |
| step 本身不慢，但步数达到 15 步 | 模型行为 | 看模型每轮的工具选择，是否重复搜索同样的问题 | 改 prompt、限制最大步数、去重工具调用 |
| step 之间的空隙累计十几秒 | 自己的后端 | 子 span 里的 DB 查询、Redis 发布耗时 | 修慢 SQL、连接池等待、避免在事件循环里做同步阻塞调用 |

3. 最后用 `trace_id` 查日志，看具体的错误信息、厂商 `request_id`，确认结论。

关键在于第一步就能把时间拆成「排队 / 模型 / 工具 / 自身」四块，这要求埋点时就记录了 `enqueued_at`、每个 step 的起止时间和 TTFT。如果只记了接口总耗时，以上分析都无从做起。

### 告警
告警的原则是：只对需要人立即处理的症状告警，并且每条告警都对应一个明确的处理动作。基于指标告警，不要基于单条日志。

建议的第一批告警：

- Run 失败率：如 10 分钟内 failed 占比超过 5%（阈值按历史基线定）；
- 队列排队时间 P95 超过 30 秒，或队列深度持续上涨（Worker 不够或卡死）；
- LLM 调用错误率或 429 比例突增（厂商故障或配额耗尽）；
- 某个工具的错误率突增；
- 成本：每小时花费超过预算，或单个 Run 的 token 数超过上限（循环失控的信号）；
- 存在 `running` 状态但 lease 已过期很久的 Run（Worker 崩溃后没有被回收）。

告警要用持续时间窗口（Prometheus 规则里的 `for:`）过滤抖动；对于用户数少的早期服务，比例类告警要设置最小样本量，否则一次失败就是 100% 失败率。

<div class="tip">实践建议：成本告警和失败率告警同样重要。Agent 的故障模式里有一类是「没报错但一直在跑」，例如模型反复调用同一个工具，错误率指标完全正常，只有 token 消耗和步数会暴露问题。除了告警，代码里也应该有每 Run 的最大步数和 token 预算作为硬上限。</div>

### Java 对照
| 关注点 | Python 主线 | Spring Boot |
|---|---|---|
| 指标 | `prometheus_client` / OTel Metrics | Micrometer（`MeterRegistry`、`Timer`、`Counter`），通过 Actuator 暴露 `/actuator/prometheus` |
| 追踪 | OTel SDK + 各库 instrumentor | OpenTelemetry Java agent（`-javaagent:` 启动参数，零代码自动埋点），或 Micrometer Tracing 桥接到 OTel |
| 日志关联 | structlog + contextvars | SLF4J 的 MDC 放 `run_id`；OTel Java agent 可把 `trace_id`、`span_id` 注入 MDC |
| 跨线程/异步传上下文 | contextvars 随协程自动传递 | ThreadLocal 不会自动跨线程池，需要用 OTel 的 `Context.taskWrapping` 或 agent 对 Executor 的埋点 |

### 生产环境怎么做
第一版就该做：

- 全部日志输出 JSON 到 stdout，带 `run_id`、`step`、`trace_id`，由容器平台收集；脱敏 processor 在第一天就加上；
- `agent_step` 表记录每步的起止时间、token，`agent_run` 记录 `created_at`，任务参数带 `enqueued_at`——这是成本最低、最可靠的「可观测性」，很多问题直接查表就能回答；
- OTel 自动埋点 FastAPI、httpx、SQLAlchemy、Celery，加上 Run / Step 两层手动 span，导出到 Collector；
- 核心指标：Run 终态计数、step 耗时直方图（按 step_type 和名称）、token 计数、工具错误计数、排队时间；
- 失败率、排队时间、成本三类告警；每 Run 最大步数和 token 预算作为硬限制。

规模上来再做：

- 采样：全量 trace 存储成本高时，在 Collector 用 tail-based sampling，保留所有出错和慢的 trace，正常 trace 按比例采样；
- 引入或自托管 LLM 观测平台，做 prompt 版本对比、在线评测、按用户/租户的成本分摊；
- SLO 化：如「95% 的 Run 在 120 秒内完成」，基于错误预算告警，取代零散的阈值告警；
- 日志分级保留：调试日志短期保留，含 prompt 内容的数据单独存储并设置更短的保留期和更严的访问权限。

### 自测
- **日志、指标、trace 分别回答什么问题？** 指标回答「整体是否异常、比例和趋势」，用于告警；trace 回答「一次请求的时间花在哪一段」；日志回答「某件事的具体细节和错误信息」。三者通过 `trace_id` / `run_id` 关联跳转。
- **为什么不能把 run_id 作为 Prometheus 指标的 label？** 每个 label 值组合都是一条独立时间序列，run_id 无限增长会造成高基数，拖垮存储和查询。单个 Run 的信息放日志和 trace。
- **API 和 Worker 之间隔着 Celery 队列，trace 怎么串起来？** 投递任务时把 W3C `traceparent` 等上下文 inject 进任务 header（或参数），Worker 执行前 extract 出来作为父上下文。`opentelemetry-instrumentation-celery` 会自动完成这一步。
- **LLM 调用至少要记录哪些字段？** 模型名、总耗时和 TTFT、输入输出 token（取自响应 usage）、finish_reason、成本、重试次数与错误类型、厂商 request_id。不记录密钥和原始 PII，完整 prompt 放受控存储。
- **一个 Run 跑了 90 秒，怎么定位？** 按时间线拆成排队（run 创建到 Worker 开始）、模型（LLM span，再看 TTFT 和输出 token）、工具（工具 span 及其下的 HTTP span）、自身开销（step 间隙、DB/Redis 子 span），再看步数是否异常。
- **Langfuse 这类工具和通用 APM 有什么区别？** 通用 APM 看延迟、错误、拓扑；LLM 平台理解 LLM 调用语义，能查看 prompt 与输出、按模型算成本、做评测。通常组合使用，敏感数据场景优先考虑自托管。
