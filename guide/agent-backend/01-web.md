## 1. Web 服务层：把 Agent 做成服务 {必学}
> 一句话：把「调一次 LLM 的脚本」变成可被前端和其他系统可靠调用的 HTTP 服务——提交任务立即返回、进度流式推送、随时可取消，同时守住身份、限流和输入校验这几道门。

### 在链路中的位置
以「研报助手 Agent」为例，一次请求的路径是：浏览器 → 反向代理（Nginx / 网关）→ **Web 服务（FastAPI）** → 写入 `agent_run`（状态 `queued`）并投递到消息队列 → Worker 执行 Step（LLM 调用、`web_search`、`query_db`、`send_email`）→ 事件写回 → Web 服务通过 SSE 推给浏览器。

Web 服务层只做四件事：**接入**（鉴权、限流、校验）、**受理**（创建 Run、返回 `run_id`）、**查询**（状态、历史）、**推送**（流式事件、取消指令）。它本身不跑 Agent 循环，这一点决定了后面几乎所有设计。

### 框架选择
| 维度 | FastAPI（主线） | Spring Boot（Java 对照） |
|---|---|---|
| 并发模型 | ASGI + asyncio，天然适合大量等待 IO 的请求 | Servlet 线程池；JDK 21 虚拟线程或 WebFlux 可支撑高并发长连接 |
| 请求校验 | Pydantic 模型，类型注解即校验规则 | Bean Validation（`@Valid`、`@NotBlank`） |
| 流式输出 | `StreamingResponse`，或第三方 `sse-starlette` | `SseEmitter`（MVC）或 `Flux<ServerSentEvent<T>>`（WebFlux） |
| 文档 | 自动生成 OpenAPI / Swagger UI | springdoc-openapi |
| 生态 | 与 LLM SDK、向量库、评测工具同语言 | 企业集成、事务、权限体系成熟 |

选 FastAPI 的主要理由不是「快」，而是 Agent 生态（模型 SDK、Agent 框架、数据处理）以 Python 为主，Web 层和 Agent 逻辑同语言可以减少一层跨语言调用。已有 Java 体系的团队也常见「Spring Boot 做网关和业务、Python 服务做 Agent 执行」的拆分，两者之间用 HTTP 或消息队列通信。

FastAPI 应用通常用 Uvicorn 运行，多核机器上起多个 worker 进程（`uvicorn --workers N` 或 Gunicorn + Uvicorn worker）。每个进程内部是单线程事件循环，所以**任何阻塞调用都会卡住该进程的全部请求**，详见[第 2 章](#c2)。

### REST API 设计：围绕 Run 资源
Agent 任务的核心资源是 Run。接口按资源命名、用 HTTP 方法表达动作：

| 操作 | 方法与路径 | 成功状态码 | 说明 |
|---|---|---|---|
| 创建任务 | `POST /v1/runs` | `202 Accepted` | 只落库并入队，返回 `run_id` 与状态查询地址 |
| 查询状态 | `GET /v1/runs/{run_id}` | `200` | 返回 `status`、`output`、`error` 等 |
| 订阅事件 | `GET /v1/runs/{run_id}/events` | `200` | `text/event-stream`，推送 Step 进度与 token |
| 取消任务 | `POST /v1/runs/{run_id}/cancel` | `202 Accepted` | 只设置 `cancel_requested`，真正停止是异步的 |
| 历史列表 | `GET /v1/runs?cursor=...&limit=20` | `200` | 游标分页 |
| 步骤明细 | `GET /v1/runs/{run_id}/steps` | `200` | 读 `agent_step`，用于调试与回放 |

#### 为什么创建返回 202 而不是 200
Run 耗时几十秒到几分钟，请求返回时任务还没完成。`202 Accepted` 的语义正是「已受理，处理尚未完成」。响应体带 `run_id` 和 `status: "queued"`，并可在 `Location` 头里给出 `/v1/runs/{run_id}`，客户端据此轮询或订阅事件。

```python
from fastapi import FastAPI, Depends, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()

class CreateRunRequest(BaseModel):
    task: str = Field(min_length=1, max_length=4000)
    notify_email: str | None = None

@app.post("/v1/runs", status_code=status.HTTP_202_ACCEPTED)
async def create_run(req: CreateRunRequest, user=Depends(current_user)):
    run_id = await repo.insert_run(user_id=user.id, input=req.model_dump(),
                                   status="queued")
    await enqueue_run(run_id)          # 投递到队列，见第 9 章
    return JSONResponse(
        status_code=202,
        content={"run_id": run_id, "status": "queued"},
        headers={"Location": f"/v1/runs/{run_id}"},
    )
```

#### 取消也是「请求」而不是「命令」
`POST /v1/runs/{id}/cancel` 只把 `agent_run.cancel_requested` 置为 true 并返回 `202`。Worker 在两个 Step 之间检查这个标志，并取消正在进行的 LLM / 工具调用（[第 2 章](#c2)）。如果 Run 已经是 `succeeded` / `failed` / `cancelled` 这类终态，返回 `409 Conflict` 或幂等地返回当前状态都可以，关键是**团队统一口径并写进接口文档**。取消用 `POST` 子资源而不是 `DELETE /v1/runs/{id}`，因为 Run 记录要保留用于审计和计费，并没有被删除。

#### 状态码与错误体
| 场景 | 状态码 |
|---|---|
| 请求体校验失败 | `422`（FastAPI 默认）或 `400` |
| 未登录 / token 无效 | `401` |
| 已登录但无权访问别人的 Run | `403`，或为避免泄露存在性直接返回 `404` |
| Run 不存在 | `404` |
| 状态冲突（对终态 Run 取消、重复提交） | `409` |
| 触发限流 | `429`，带 `Retry-After` |
| 上游 LLM 不可用、服务过载 | `503`（可带 `Retry-After`） |

错误体保持统一结构，便于前端统一处理，也便于日志检索：

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many runs, retry later.",
    "request_id": "req_7f3c..."
  }
}
```

`code` 是机器可读的稳定枚举，`message` 给人看，`request_id` 与 trace 关联（[第 5 章](#c5)）。RFC 9457（Problem Details for HTTP APIs，`application/problem+json`）是标准化的可选格式。注意：**Run 执行失败不是 HTTP 错误**。`GET /v1/runs/{id}` 返回 `200` 且 `status: "failed"`、`error` 字段说明原因，HTTP 状态码只描述这次请求本身。

#### 历史分页用游标
历史 Run 列表按 `created_at` 倒序，数据持续增长。`OFFSET` 分页在页数深时要扫描并丢弃大量行，且翻页过程中有新 Run 插入会导致重复或漏读。游标分页把上一页最后一条的 `(created_at, id)` 编码成不透明字符串返回，下一页查询 `WHERE (created_at, id) < (:c, :i) ORDER BY created_at DESC, id DESC LIMIT :n`，配合 `(user_id, created_at, id)` 索引即可稳定高效。

#### 创建接口的幂等
用户双击提交或客户端超时重试，会创建两个 Run，进而发两封邮件。常见做法是客户端在请求头带 `Idempotency-Key`（UUID），服务端以 `(user_id, key)` 唯一约束落库，重复请求直接返回已有的 `run_id`。这是 Run 级别的去重；工具级别的去重靠 `tool_call.idempotency_key`，见[第 4 章](#c4)。

### 长任务不能阻塞请求
如果 `POST /v1/runs` 在请求里同步跑完整个 Agent 循环，会出现一连串问题：

- **超时**：浏览器、Nginx（`proxy_read_timeout` 默认 60 秒）、云负载均衡都有空闲超时，几分钟的任务大概率被中途切断。
- **丢任务**：连接断开或服务重启，正在执行的任务直接消失，没有重试的机会，也说不清已经执行到哪一步、邮件发没发。
- **容量被占满**：每个在途请求都占一个连接和一份内存，突发流量下 Web 层被打垮，连查询状态的请求都进不来。
- **无法水平拆分**：Web 层和执行层扩缩容的依据不同（连接数 vs. LLM 并发与配额），绑在一起无法分别伸缩。

正确的形态是「受理与执行分离」：Web 层落库 + 入队后立即返回 `202`，Worker 从队列取任务执行，状态与事件写回数据库 / Redis，Web 层再从那里读出来推送给前端。队列选型、重试、可见性超时等细节见[第 9 章](#c9)。

### 流式输出：SSE 与 WebSocket
Agent 任务慢，用户需要看到「正在搜索…已查到 3 条…正在写报告」以及逐 token 生成的正文，否则几分钟的空白等待体验很差。推送通道主要有两种选择：

| 维度 | SSE（Server-Sent Events） | WebSocket |
|---|---|---|
| 方向 | 服务端 → 客户端单向 | 全双工 |
| 协议 | 普通 HTTP 响应，`Content-Type: text/event-stream` | 通过 HTTP Upgrade 切换到独立协议 |
| 数据 | UTF-8 文本 | 文本或二进制帧 |
| 断线重连 | 浏览器 `EventSource` 自动重连，并带 `Last-Event-ID` | 需要自己实现重连与续传 |
| 基础设施 | 走现有 HTTP 栈：鉴权、网关、日志都能复用 | 网关、负载均衡要支持 Upgrade，常需单独配置 |
| 典型场景 | LLM token 流、任务进度 | 语音实时对话、协同编辑、需要频繁双向交互 |

研报助手的交互是「提交一次 → 持续接收进度」，客户端发起的动作（创建、取消）都是低频的普通 HTTP 请求，所以 **SSE 是默认选择**，主流 LLM 提供商的流式 API 也是 SSE。只有在需要高频双向消息（例如语音 Agent 边说边打断）时才考虑 WebSocket。

<div class="note">易错点：浏览器原生 <code>EventSource</code> 只能发 GET，且不能自定义请求头，无法直接带 <code>Authorization: Bearer</code>。常见解法是用同源 Cookie 鉴权，或前端改用 <code>fetch</code> 读取 <code>ReadableStream</code> 自行解析 SSE（此时自动重连要自己写）。把长期 token 放进 URL 查询参数会进入访问日志，不推荐；确需如此应换成短期、一次性的 token。</div>

#### SSE 报文格式
SSE 是按行组织的文本流，一个事件由若干 `字段: 值` 行组成，**以空行结束**：

```text
retry: 3000

id: 42
event: step_started
data: {"seq": 3, "type": "tool", "tool_name": "web_search"}

id: 43
event: token
data: {"text": "X 公司 2025 年营收"}

: keep-alive

```

- `event:`：事件类型，前端用 `addEventListener("token", ...)` 分别处理；缺省时为 `message`。
- `data:`：负载。多行 `data:` 会被客户端用换行拼接，实践中通常每个事件一行 JSON。
- `id:`：事件 ID，客户端会记住最后一个；断线重连时以 `Last-Event-ID` 请求头发回。
- `retry:`：告诉客户端断线后等多少毫秒再重连。
- 以冒号开头的行是注释，客户端忽略，常用作心跳。

#### 断线重连与续传
网络抖动、手机切后台、网关超时都会断开 SSE。要做到「重连后不丢不重」，前提是**事件可回放**：Worker 产生的每个事件带单调递增的序号（例如每个 Run 内的 `seq`），持久化到 Redis Stream 或数据库。SSE 接口收到 `Last-Event-ID: 42` 时，先补发 42 之后的历史事件，再接上实时事件。这也意味着 SSE 连接和 Worker 之间是解耦的：Web 进程只是事件的「读者」，连接断开不影响任务执行。Redis Stream 的具体用法见[第 8 章](#c8)。

#### FastAPI 实现 SSE 接口
下面的接口先补发历史事件，再阻塞等待新事件；超过 15 秒没有新事件就发一行注释作为心跳。`events.read_after` 是事件存储的封装（例如基于 Redis Stream 的 `XREAD BLOCK`），`events.read_after(..., block_ms=...)` 超时返回空列表。

```python
import json
from fastapi import Request, Header
from fastapi.responses import StreamingResponse

def sse(ev) -> str:
    return f"id: {ev.seq}\nevent: {ev.type}\ndata: {json.dumps(ev.data, ensure_ascii=False)}\n\n"

@app.get("/v1/runs/{run_id}/events")
async def run_events(run_id: str, request: Request, user=Depends(current_user),
                     last_event_id: str | None = Header(default=None)):
    await ensure_owner(run_id, user)                # 越权检查放在开始推流之前
    cursor = int(last_event_id or 0)

    async def gen():
        nonlocal cursor
        yield "retry: 3000\n\n"
        while not await request.is_disconnected():
            batch = await events.read_after(run_id, cursor, block_ms=15000)
            if not batch:
                yield ": keep-alive\n\n"            # 心跳，防止中间设备判定空闲
                continue
            for ev in batch:
                cursor = ev.seq
                yield sse(ev)
                if ev.type in ("run_succeeded", "run_failed", "run_cancelled"):
                    return                          # 终态事件后主动结束流
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})
```

几个要点：`Header` 参数名 `last_event_id` 会被 FastAPI 自动映射到 `Last-Event-ID` 请求头；客户端断开后，Starlette 会结束这个响应并停止迭代生成器（具体机制随 Starlette 版本有差异），循环里的 `is_disconnected()` 检查让生成器能在等待事件的间隙主动退出；终态事件后主动 `return`，否则浏览器 `EventSource` 会在连接关闭后不停自动重连，需要前端收到终态事件后调用 `close()`。社区库 `sse-starlette` 提供了 `EventSourceResponse`，封装了格式与心跳（`ping` 参数），可以替代手写。

Spring Boot 对应做法是返回 `SseEmitter`（MVC）并在另一个线程里 `emitter.send(SseEmitter.event().id(..).name(..).data(..))`，或在 WebFlux 中返回 `Flux<ServerSentEvent<T>>`。

#### 心跳与反向代理缓冲
SSE 连接上长时间没有字节流动时，Nginx（`proxy_read_timeout` 默认 60s）、云负载均衡（例如 AWS ALB 空闲超时默认 60s）、企业代理都可能断开它。Agent 等待 LLM 思考或工具返回时恰好会长时间沉默，所以要**定期发送注释行心跳**，间隔小于链路上最短的空闲超时，常取 15–30 秒。

另一个常见问题是「本地正常，上线后事件一次性到达」：Nginx 默认开启 `proxy_buffering`，会攒满缓冲区再转发。解决方式二选一：

```nginx
location /v1/runs/ {
    proxy_pass http://agent_api;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;          # 关闭响应缓冲
    proxy_read_timeout 3600s;     # 长于心跳间隔即可，按任务时长设置
}
```

或者由应用在响应头中返回 `X-Accel-Buffering: no`，Nginx 会对这一个响应关闭缓冲，不影响其他接口。此外还要确认中间没有对 `text/event-stream` 做 gzip 压缩缓冲，以及 CDN 是否支持流式回源。

### 身份认证：按客户端类型选方案
Web 层要先回答「这个请求是谁发的」，才能做归属检查（只能看自己的 Run）、限流和计费。几种方案各有适用场景：

| 方案 | 形态 | 适合的客户端 | 注意点 |
|---|---|---|---|
| API Key | 请求头 `Authorization: Bearer sk-...` 或自定义头 | 服务端到服务端、开发者调用开放 API、内部脚本 | 只存哈希；支持多 key、轮换与吊销；绝不放进前端代码 |
| Session + Cookie | 服务端存会话，浏览器带 `HttpOnly` Cookie | 自家 Web 前端（同站） | 天然适配 `EventSource`；要设 `Secure`、`SameSite` 并防 CSRF |
| JWT | 自包含、签名的令牌，服务端无状态校验 | 多服务、移动端、前后端分离 | 难以即时吊销，令牌要短期（分钟级）+ refresh token；必须校验签名算法、`exp`、`aud`、`iss` |
| OAuth2 / OIDC | 由身份提供方（企业 SSO、Google 等）颁发令牌 | 企业登录、第三方应用代用户调用 | 浏览器端用 Authorization Code + PKCE；后端只做令牌校验 |

在 FastAPI 中，认证逻辑封装成依赖（如上文的 `current_user`），用 `Depends` 注入每个路由；`fastapi.security` 里有 `HTTPBearer`、`OAuth2PasswordBearer`、`APIKeyHeader` 等工具类负责从请求中取凭证。

Agent 场景有一个特殊点：**Agent 代表用户行动**。`send_email` 只能发给当前用户允许的地址，`query_db` 只能查该用户有权限的数据，所以认证得到的身份要随 Run 一路传到 Worker 和工具层，而不是只在 Web 层用一下就丢掉。工具级授权、RBAC、提示注入防护等见[第 7 章](#c7)。

### 限流：两个层面
Agent 服务的成本主要是 LLM token，一个失控的客户端或一段死循环的 Agent 就能在几分钟内烧掉大量预算，所以限流同时是**稳定性**和**成本**问题。它分两个方向。

#### 对下游：限制用户调用你的 API
- **请求频率**：例如每用户每分钟最多创建 10 个 Run。
- **并发数**：每用户同时处于 `queued` / `running` 的 Run 不超过 N 个，比频率限制更贴合长任务。
- **token / 费用配额**：按用户或租户统计每日 `tokens_in + tokens_out`（来自 `agent_step`），超额拒绝新 Run 或降级到便宜模型。
- 超限返回 `429 Too Many Requests`，带 `Retry-After`（秒数或 HTTP 日期）；许多 API 还会返回 `X-RateLimit-Limit` / `X-RateLimit-Remaining` 这类非标准头，方便客户端自我调节。

#### 对上游：遵守 LLM 提供商的限制
LLM 提供商通常同时按**每分钟请求数**和**每分钟 token 数**限流，超过就返回 `429`，过载时也可能返回 `5xx` 或厂商自定义的过载错误。应对方式：

- 读取并遵守响应里的 `Retry-After`，没有时用指数退避 + 随机抖动重试，并设置最大重试次数（[第 4 章](#c4)）。
- 在调用侧做**全局**的客户端限流：所有 Worker 共享一个令牌桶，按估算的 token 数扣减，避免一起撞墙后又一起重试（惊群）。
- 把上游配额当作容量规划的输入：它决定了 Worker 并发上限，比 CPU 和内存更早成为瓶颈。

#### 常见算法
| 算法 | 思路 | 优点 | 缺点 |
|---|---|---|---|
| 固定窗口 | 每个时间窗（如每分钟）一个计数器 | 实现最简单 | 窗口边界处可出现 2 倍突发 |
| 滑动窗口 | 记录窗口内每次请求时间（日志法），或按前后两个窗口加权估算（计数法） | 平滑，无边界突发 | 日志法内存随请求量增长 |
| 令牌桶 | 以固定速率往桶里加令牌，请求消耗令牌，桶有上限 | 允许受控突发，且可按「成本」扣多个令牌 | 需要维护令牌数与上次补充时间 |

令牌桶特别适合 token 配额：一次请求按预估 token 数扣减，结束后按实际用量校正。多实例部署时计数必须放在共享存储里，Redis + Lua 原子实现见[第 8 章](#c8)。

### 请求校验：Pydantic
Web 层的输入来自不可信的客户端，进入系统后会被拼进 prompt、写进数据库、甚至作为工具参数，所以要在入口处收紧：

- **长度与大小**：`task` 限制最大长度，既防滥用，也直接控制 token 成本；在网关层同时限制请求体大小。
- **类型与枚举**：模型名、工具开关等用 `Literal[...]` 或 `Enum` 限定，避免客户端指定任意昂贵模型。
- **格式**：邮箱可用 Pydantic 的 `EmailStr`（需要额外安装 `email-validator`）。
- **拒绝未知字段**：`model_config = ConfigDict(extra="forbid")`，防止客户端夹带 `user_id` 之类本应由服务端决定的字段。

```python
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, EmailStr

class CreateRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task: str = Field(min_length=1, max_length=4000)
    model: Literal["fast", "quality"] = "fast"
    notify_email: EmailStr | None = None
    tools: list[Literal["web_search", "query_db", "send_email"]] = Field(
        default_factory=lambda: ["web_search", "query_db"], max_length=3)
```

校验失败时 FastAPI 自动返回 `422`，响应体列出出错字段；如需统一成上文的错误体结构，可以注册 `RequestValidationError` 的异常处理器。需要强调：**Pydantic 校验的是客户端输入，不是模型输出**。LLM 生成的工具参数同样要用 Pydantic 模型（或 JSON Schema）再校验一次，那是工具层的职责，见[第 4 章](#c4)和[第 7 章](#c7)。

### CORS 基础
前端页面在 `https://app.example.com`、API 在 `https://api.example.com` 时，浏览器的同源策略会拦截跨域读取响应。CORS 是服务端用响应头声明「允许哪些源访问」的机制；对带自定义头（如 `Authorization`）或 JSON 请求体的请求，浏览器会先发一个 `OPTIONS` 预检请求。

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com"],   # 明确列出，不用 "*"
    allow_credentials=True,                      # 需要带 Cookie 时开启
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)
```

<div class="note">易错点：CORS 只约束浏览器，不是安全边界，curl 和服务端调用完全不受影响，鉴权仍然必须做。另外，带凭证（Cookie）的请求不能配合 <code>Access-Control-Allow-Origin: *</code>，必须返回具体的源。前后端同域部署（例如都在 <code>app.example.com</code> 下，API 走 <code>/api</code> 路径）可以完全绕开 CORS。</div>

### 生产环境怎么做
第一版就该做：

- 创建 Run 返回 `202 + run_id`，执行放到 Worker；Run 状态以数据库为准，前端刷新页面后能通过 `GET /v1/runs/{id}` 恢复。
- SSE 推进度，事件带 `id`，支持 `Last-Event-ID` 续传；15–30 秒心跳；Nginx 关闭缓冲或返回 `X-Accel-Buffering: no`。
- 取消接口只置 `cancel_requested`，返回 `202`。
- 统一错误体，每个响应带 `request_id`，并写入日志与 trace。
- 认证依赖注入到每个路由，所有按 `run_id` 访问的接口都做归属检查。
- 每用户并发 Run 上限 + 每日 token 配额；上游 `429` 遵守 `Retry-After` 并退避重试。
- Pydantic 严格校验，`extra="forbid"`，限制 `task` 长度与请求体大小。
- 健康检查分开：`/healthz`（进程存活）与 `/readyz`（依赖的数据库、Redis 可用），供容器编排使用（见[第 6 章](#c6)）。

规模上来再做：

- 网关层统一做认证、限流和 WAF，应用层只保留业务相关的配额检查。
- 按租户分级配额、按模型分别计价，配额与账单系统打通。
- 跨区域部署时，SSE 连接可以落在任意实例，前提是事件存储是共享的（Redis / 数据库），而不是存在 Web 进程内存里。
- 优雅停机：发布时先停止接收新连接，通知已有 SSE 客户端重连到其他实例（客户端靠 `Last-Event-ID` 无缝续上）。
- API 版本化（`/v1` → `/v2`）与 OpenAPI 生成的客户端 SDK。

<div class="tip">实践建议：上线前用 <code>curl -N</code> 直接经过生产同款的代理链路测试 SSE 接口（<code>-N</code> 关闭 curl 自身缓冲），确认事件是逐条到达的，并且空闲 2 分钟以上连接不断。很多流式问题只在经过代理和负载均衡之后才出现。</div>

### 自测
- **为什么创建 Agent 任务的接口返回 202 而不是 200？** 任务耗时长，请求返回时尚未完成；202 表示「已受理、处理中」，响应带 `run_id`，客户端再通过状态查询或 SSE 获取进度和结果。
- **SSE 和 WebSocket 怎么选？** 研报助手这类「服务端持续推进度、客户端低频操作」的场景选 SSE：基于普通 HTTP、自动重连、复用现有鉴权与网关；高频双向交互（如语音打断）才用 WebSocket。
- **SSE 断线后如何不丢事件？** 每个事件带递增 `id` 并持久化到 Redis Stream 或数据库；客户端重连时带 `Last-Event-ID`，服务端先补发之后的历史事件再接实时流。
- **本地流式正常、上线后事件一次性到达，可能是什么原因？** 反向代理开启了响应缓冲；在 Nginx 配置 `proxy_buffering off`，或由应用返回 `X-Accel-Buffering: no`，同时排查中间的压缩和 CDN。
- **Agent 服务的限流和普通 API 有什么不同？** 除了请求频率，还要限制每用户并发 Run 数和 token 配额；同时要对上游 LLM 的请求数与 token 限制做全局客户端限流，收到 429 时按 `Retry-After` 退避。
- **用户点「停止」，接口应该做什么？** 只把 `cancel_requested` 置为 true 并返回 202；Worker 在 Step 之间检查标志并取消在途调用，最终把状态写为 `cancelled`，通过 SSE 推给前端。
