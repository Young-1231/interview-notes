## 4. 可靠性：调用失败以后怎么办 {必学}
> 一句话：LLM 和工具调用随时可能超时、被限流、返回坏数据，可靠性工程要做到三件事：该重试的有节制地重试，不该重复的绝不重复，进程崩溃后任务从断点继续，而不是从头再跑一遍、把邮件发两次。

### 在链路中的位置
「研报助手」的一次 Run 在 Worker 里是一个循环：调用 LLM → 解析出工具调用 → 执行 `web_search` / `query_db` / `send_email` → 把结果写回上下文 → 再调用 LLM，直到模型给出最终答案。可靠性相关的代码分布在这个循环的四个位置：

```text
Worker 取到 run
 └─ loop:
     ├─ [超时/重试/熔断/降级] 调用 LLM        → [校验] 解析工具参数(Pydantic)
     ├─ [审批] 危险工具先进入 waiting_approval
     ├─ [幂等键/状态查询] 执行工具             → 业务错误作为结果回传给模型
     └─ [checkpoint] 写 agent_step / tool_call / message，提交事务
 └─ 崩溃后：新的 Worker 读取已完成的 step，从断点继续
```

一次 Run 要串行几次到几十次外部调用，单次调用 99% 成功，20 次全部成功的概率只有约 82%。所以对 Agent 来说失败是常态，可靠性设计的目标不是「不出错」，而是「出错后结果仍然正确、成本可控」。

### 失败分类：先判断能不能重试
重试之前先回答两个问题：这个错误是暂时的吗？这个操作重复执行会产生额外后果吗？前者决定「值不值得重试」，后者决定「能不能安全地重试」。

| 失败类型 | 典型表现 | 是否重试 | 处理方式 |
|---|---|---|---|
| 连接失败 / 连接超时 | `ConnectError`、`ConnectTimeout` | 是 | 请求还没发出去，任何操作都可以安全重试 |
| 读超时 | 请求已发出，迟迟没有响应 | 看操作是否幂等 | 只读调用可重试；有副作用的调用先查状态（见下文） |
| 429 限流 | 响应头常带 `Retry-After` | 是 | 按 `Retry-After` 等待，计入重试预算 |
| 5xx / 过载 | 500、502、503、504；Anthropic API 过载时返回 529 | 是 | 退避重试，连续失败后熔断、降级 |
| 网络重置 / 流中断 | SSE 流式输出到一半连接断开 | LLM 调用可以 | 丢弃半截输出，重新发起整次调用 |
| 请求本身有问题 | 400、401、403、404、422 | 否 | 原样重试必然再失败；401/403 要告警，可能是 key 失效 |
| 上下文超长 | 400，提示超出 context length | 否（原样） | 压缩或截断历史消息后，作为新请求再试 |
| 模型输出不合法 | JSON 解析失败、工具参数不符合 schema | 是，但要改输入 | 带上错误信息让模型修复，限制次数 |
| 工具业务错误 | 公司名查不到、SQL 没有结果、收件人被拒 | 否（基础设施层） | 作为工具结果回传给模型，让模型换参数或换思路 |

最容易做错的是后两类。模型输出不合法，原样重试只是在赌随机性，应该把校验错误告诉模型再试。工具的业务错误不是基础设施故障，`query_db` 返回「表中没有这家公司」时，重试十次结果也一样，正确做法是把这句话作为 observation 交给模型，由它决定改用 `web_search`。可以记一个简单的划分：传输层错误由重试机制处理，语义层错误由模型处理，权限和配置错误由人处理。

<div class="note">易错点：<b>读超时不等于失败</b>。请求可能已经到达对方并执行成功，只是响应在回来的路上丢了。对 <code>send_email</code> 这类有副作用的工具，超时后直接重发就可能发两封邮件。</div>

### 分层超时：每一层都要有上限
没有超时的调用是最危险的失败：它不报错，只是一直挂着，占住 Worker、占住连接，用户看到的是永远在转圈的界面。Agent 至少需要三层超时，外层永远比内层宽：

| 层级 | 管什么 | 研报助手里的参考值 | 实现方式 |
|---|---|---|---|
| 单次调用 | 一次 HTTP 请求：建连、等待数据 | connect 5s，read 30–60s | `httpx.Timeout`，SDK 的 `timeout` 参数 |
| 单个 Step | 一次 LLM 调用或一次工具调用，含其内部重试 | LLM 120s，`web_search` 30s | `asyncio.timeout()`（Python 3.11+） |
| 整个 Run | 整个任务的总时长、最大步数、最大 token | 10 分钟、30 步、20 万 token | 在 `agent_run` 上记录截止时间，每步开始前检查 |

几个细节决定了这些超时是否真的生效：

- **流式调用的读超时是「两个数据块之间」的等待上限**。httpx 的 read timeout 限制的是单次读取等待数据的时间，模型持续吐 token 时，一个 5 分钟的流不会触发它。要限制总时长，必须在外面再包一层 `asyncio.timeout`。
- **内层超时要根据剩余时间收缩**。Run 只剩 20 秒时，再发起一个 120 秒超时的 LLM 调用没有意义。做法是把截止时间（deadline）往下传，每层取「自身上限」和「剩余时间」中较小的那个。
- **超时会取消正在等待的协程，但不会撤销已经发生的副作用**。`asyncio.timeout` 到期后，被取消的协程里如果已经把邮件请求发出去了，对方照样会发信。

```python
import asyncio
import httpx

client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=5.0))

class RunDeadlineExceeded(Exception):
    pass

async def run_step(coro, step_limit: float, run_deadline: float):
    """step_limit：该步自身上限；run_deadline：整个 Run 的截止时刻(loop.time())"""
    remaining = run_deadline - asyncio.get_running_loop().time()
    if remaining <= 0:
        raise RunDeadlineExceeded()
    async with asyncio.timeout(min(step_limit, remaining)):  # Python 3.11+
        return await coro
```

Python 3.10 及以前可以用 `asyncio.wait_for(coro, timeout)` 达到同样效果。整个 Run 的最大步数和 token 上限同样属于「超时」的范畴：模型陷入「搜索 → 不满意 → 再搜索」的循环时，时间不一定先耗尽，但钱会先耗尽。

### 有限重试：指数退避 + 抖动
重试要满足三个条件：次数有上限、间隔逐渐拉长、间隔带随机性。

#### 退避公式
常用的「full jitter」写法：第 n 次重试（n 从 0 开始）前等待

`delay = random(0, min(cap, base × 2^n))`

例如 base = 1s、cap = 30s，第 0、1、2、3 次重试前分别在 [0,1]、[0,2]、[0,4]、[0,8] 秒内随机取值。指数增长给下游留出恢复时间，cap 防止等待无限变长。

#### 为什么要加抖动
模型服务一抖动，同一秒内会有几百个 Run 同时收到 429。如果大家都严格按 1s、2s、4s 重试，重试请求会在同一时刻再次集中到达，形成一波波的流量尖峰（惊群效应），服务刚恢复又被打垮。随机化让重试在时间上摊开。

#### 尊重 Retry-After
429 和 503 响应常带 `Retry-After` 头，表示服务端希望客户端至少等多久。它可能是秒数，也可能是 HTTP 日期。有这个头时，等待时间取「计算出的退避值」和「Retry-After」中较大者；如果 Retry-After 远超这一步剩下的时间预算，就不要傻等，直接走降级。

```python
import asyncio, random
import httpx

RETRYABLE_STATUS = {429, 500, 502, 503, 504, 529}

async def post_with_retry(client: httpx.AsyncClient, url: str, payload: dict,
                          max_attempts: int = 4, base: float = 1.0, cap: float = 30.0):
    """只用于 LLM 调用和只读工具；有副作用的调用不要套这个函数"""
    for attempt in range(max_attempts):
        retry_after = None
        try:
            resp = await client.post(url, json=payload)
            if resp.status_code not in RETRYABLE_STATUS:
                resp.raise_for_status()          # 其余 4xx 直接抛出，不重试
                return resp
            retry_after = resp.headers.get("retry-after")
        except httpx.TransportError:             # 连接失败、超时、连接被重置
            pass
        if attempt == max_attempts - 1:
            raise RuntimeError(f"retries exhausted: {url}")
        delay = random.uniform(0, min(cap, base * 2 ** attempt))   # full jitter
        if retry_after and retry_after.isdigit():                  # 这里只处理秒数形式
            delay = max(delay, float(retry_after))
        await asyncio.sleep(delay)
```

也可以用 `tenacity` 库：`@retry(stop=stop_after_attempt(4), wait=wait_random_exponential(multiplier=1, max=30))`，它同样支持 async 函数。OpenAI、Anthropic 的官方 Python SDK 自带少量自动重试（通过 `max_retries` 配置），自己外面再包一层时要清楚两层是相乘的。

#### 重试预算与重试放大
重试次数要从全局看。Agent 里的调用往往是嵌套的：SDK 重试 2 次，你的包装再重试 3 次，Celery 任务失败又整体重试 3 次，一次故障最多会变成 3 × 4 × 3 = 36 次请求。下游越是故障，上游打过去的流量越大，这叫重试放大。控制手段：

- **只在一层重试**。通常放在离调用最近的那层；任务级重试只处理「Worker 崩溃」这类整体失败，而且要配合 checkpoint，不能把已完成的步骤重跑一遍。
- **设置重试预算**。例如一个 Run 总共最多 10 次重试；或者按服务统计，重试请求不超过正常请求的 10%，超过就不再重试，直接失败或降级。
- **重试也计成本**。每次 LLM 重试都要重新发送全部上下文，一个 10 万 token 的上下文重试 3 次，就多花了 30 万输入 token 的钱。

#### 不要盲目重试非幂等操作
上面的 `post_with_retry` 只能用于 LLM 调用和 `web_search`、`query_db` 这类只读工具。LLM 调用本身没有外部副作用，重试最多多花一些 token。`send_email`、下单、转账、写入外部系统这类操作，只有在拿到幂等保证之后才能重试，下一节专门讲。

### 幂等：同一个操作执行多次，效果等于执行一次
重试、消息重复投递、Worker 崩溃后接手，都会让同一个工具调用执行不止一次。幂等是这些机制能够安全存在的前提。

#### 幂等键怎么设计
幂等键要满足一个要求：**同一个逻辑操作的每次重试，算出来的键都相同；不同的逻辑操作，键一定不同**。所以它不能是随机 UUID（每次重试都会变），也不能只用参数哈希（用户确实想发两封相同内容的邮件时会被误判为重复）。研报助手里的推荐做法：

`idempotency_key = f"{run_id}:{step_seq}:{tool_name}"`

`step_seq` 是这个工具调用所在 Step 的序号。Worker 崩溃后，新 Worker 从 checkpoint 恢复，执行到同一步时算出同一个键，自然就能识别出「这一步之前做过」。如果一个 Step 中模型并行发起多个工具调用，还要加上调用在该步内的序号，例如 `{run_id}:{step_seq}:{index}:{tool_name}`。

#### 数据库唯一约束 + 先查再做
`tool_call.idempotency_key` 上有 UNIQUE 约束。执行工具前先插入一条 `pending` 记录，插入成功才真正执行；插入冲突说明这个调用已经存在，读出它的状态决定下一步。

```python
async def execute_tool_once(db, run_id, step_id, step_seq, tool_name, args):
    key = f"{run_id}:{step_seq}:{tool_name}"
    row = await db.fetchrow(
        """INSERT INTO tool_call (run_id, step_id, tool_name, args, idempotency_key, status, attempt)
           VALUES ($1, $2, $3, $4, $5, 'pending', 1)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id""",
        run_id, step_id, tool_name, args, key)
    if row is None:                                   # 键已存在：之前执行过或正在执行
        existing = await db.fetchrow(
            "SELECT id, status, result FROM tool_call WHERE idempotency_key = $1", key)
        if existing["status"] == "succeeded":
            return existing["result"]                 # 直接复用结果，不再调用外部系统
        return await reconcile(db, existing, tool_name, key)   # pending/unknown：先对账
    result = await TOOLS[tool_name](args, idempotency_key=key)
    await db.execute("UPDATE tool_call SET status='succeeded', result=$1 WHERE id=$2",
                     result, row["id"])
    return result
```

单纯的「先 SELECT 看有没有，没有再执行」在并发下有竞态：两个 Worker 同时查到「没有」，然后都执行。必须靠唯一约束的 `INSERT ... ON CONFLICT DO NOTHING`（MySQL 8.0 用 `INSERT IGNORE` 或捕获重复键错误）把「检查」和「占位」合并成一个原子操作。

#### 把幂等键传给下游
数据库里的记录只能保证「我这边不重复发起」，保证不了「请求发出去后超时，我不知道对方有没有收到」。真正可靠的做法是把同一个键传给支持幂等的下游 API：Stripe 等支付 API 支持 `Idempotency-Key` 请求头，同一个键的重复请求会返回第一次的结果而不会重复扣款。很多邮件、消息、工单系统也提供类似的请求 ID 或去重参数，接入工具时要先查清楚目标 API 是否支持、去重窗口多长。下游不支持时，只能靠下面的状态查询和人工确认兜底。

### 难点：send_email 超时了，到底发没发
这是面试最常追问的场景。Worker 调用邮件服务，30 秒后读超时。此时有三种可能：请求没到达对方；对方收到并发出了邮件，只是响应丢了；对方还在处理。客户端**无法区分**这三种情况，所以「超时就重发」是错的，「超时就当失败」也是错的。

正确的处理顺序：

1. **把 tool_call 标记为 `unknown`**，而不是 `failed`。它表达的是「结果未知」，后续流程不能把它当成「没发」。
2. **用幂等键重试**（如果下游支持）。同一个键再发一次，对方会识别为重复请求并返回第一次的结果，这时重试是安全的。
3. **查询状态**（如果下游提供查询接口）。用请求 ID 或幂等键查询这封邮件是否已经被接受，查到就补记为 `succeeded`，查不到且确认对方没有处理才重发。
4. **两者都不支持时，交给人**。Run 进入 `waiting_approval`，界面提示「邮件可能已发送，请检查收件箱后选择：重新发送 / 视为已发送 / 放弃」。

```python
async def reconcile(db, call, tool_name, key):
    """处理 pending/unknown 的工具调用：绝不直接重发"""
    tool = TOOLS[tool_name]
    if tool.supports_idempotency_key:                 # 下游会去重：带同一个键重试是安全的
        return await retry_with_same_key(db, call, key)
    if tool.supports_status_query:
        status = await tool.query_status(key)         # 例如按请求 ID 查发送记录
        if status == "sent":
            return await mark_succeeded(db, call, status)
        if status == "not_found":
            return await retry_with_same_key(db, call, key)
    await db.execute("UPDATE tool_call SET status='unknown' WHERE id=$1", call["id"])
    raise NeedsHumanDecision(call["id"])              # 上层把 run 置为 waiting_approval
```

`pending` 状态同样要走对账：Worker 插入 `pending` 记录后、拿到结果前崩溃，新 Worker 看到的就是一条 `pending`，它和超时一样无法判断外部操作有没有发生。

<div class="tip">实践建议：给每个工具打上元数据：<code>side_effect</code>（是否有副作用）、<code>supports_idempotency_key</code>、<code>supports_status_query</code>。重试策略按元数据自动选择，而不是在每个工具里各写一套。只读工具自由重试，有副作用但支持幂等键的带键重试，两者都不支持的超时后一律转人工。</div>

### 模型输出不合法：校验、修复、限次
模型给出的工具参数是不可信输入：JSON 可能缺括号，字段名可能拼错，`to` 可能不是邮箱，`limit` 可能是 `"十"`。处理流程是「schema 校验 → 失败则把错误反馈给模型 → 最多修复 N 次」。

```python
from pydantic import BaseModel, EmailStr, Field, ValidationError

class SendEmailArgs(BaseModel):          # EmailStr 需要安装 email-validator
    to: EmailStr
    subject: str = Field(max_length=200)
    body: str

async def parse_tool_args(llm, messages, schema: type[BaseModel], raw: str, max_repairs: int = 2):
    for i in range(max_repairs + 1):
        try:
            return schema.model_validate_json(raw)          # Pydantic v2：解析 + 校验一步完成
        except ValidationError as e:
            if i == max_repairs:
                raise
            messages = messages + [{"role": "user", "content":
                f"上一次的参数不合法：{e.errors()}。请只输出修正后的 JSON。"}]
            raw = await llm.complete(messages)               # 修复提示：附上具体错误
```

要点：

- **修复提示要带具体错误**，例如「`to` 字段不是合法邮箱」。只说「格式不对，请重试」，模型往往再错一次。
- **次数要少**，一般 1–2 次。修复两次仍失败，多半是提示词或 schema 本身有问题，继续重试只是浪费 token。
- **能从源头减少错误就先从源头减少**：使用模型厂商提供的工具调用（function calling）或结构化输出能力，让输出受 JSON Schema 约束，比让模型在纯文本里写 JSON 可靠得多。即便如此，业务规则（例如收件人必须在白名单内）仍然要在服务端校验。
- **校验通过不代表可以执行**。Pydantic 只保证格式正确，`query_db` 的 SQL 能不能执行、`send_email` 的收件人是否被允许，属于权限与安全层面的检查，在安全章节展开。

### 降级与熔断：重试救不回来的时候
重试解决的是「偶发」失败。如果模型服务持续故障十分钟，每个 Run 都重试满 4 次再失败，只会让用户多等、让下游更忙。这时需要降级和熔断。

#### 降级（fallback）
按代价从低到高排列：

- **备用模型 / 备用厂商**：主模型持续 5xx 或 429 时切到同厂商的另一个模型，或另一家厂商的同档模型。要注意不同模型的工具调用格式、上下文长度、输出风格都不同，切换前要在评测集上验证过，并在 `agent_step` 里记录实际使用的模型，方便事后排查。
- **能力降级**：`web_search` 不可用时，只基于 `query_db` 的内部数据生成报告，并在报告里明确标注「未包含公开网络信息」。
- **部分结果**：报告已生成但邮件发不出去时，Run 不应整体判为失败，而是返回报告内容，提示用户「邮件发送失败，可手动下载」。

降级必须对用户可见。悄悄把高质量模型换成低质量模型、悄悄省略数据源，用户会把降级后的结果当成正常结果使用。

#### 熔断器（circuit breaker）
熔断器有三个状态：

| 状态 | 行为 | 何时切换 |
|---|---|---|
| closed（闭合） | 正常放行请求，统计失败率 | 滑动窗口内失败率超过阈值（如 50%）→ open |
| open（断开） | 直接拒绝，不发请求，立即走降级 | 等待一段时间（如 30s）→ half-open |
| half-open（半开） | 放行少量试探请求 | 试探成功 → closed；失败 → 重新 open |

熔断的价值是「快速失败」：下游已经挂了，就不要让每个请求都等满超时，把 Worker 和连接耗尽。熔断器要按下游维度设置（每个模型厂商、每个工具服务各一个），而不是全局共用一个。多 Worker 部署时，每个进程各自维护熔断状态通常就够用；需要全局一致时可以把统计放到 Redis，但这会增加复杂度，第一版不必做。

### 补偿与 Saga：多步副作用怎么回滚
数据库事务只能回滚数据库里的修改，回滚不了已经发出的邮件、已经创建的工单。一个 Run 里有多个副作用步骤、而中途失败时，需要 Saga 模式：**每个有副作用的步骤都配一个补偿操作，失败时按相反顺序执行已完成步骤的补偿**。

假设研报助手扩展为「创建共享文档 → 写入报告 → 发邮件附上链接」：

| 步骤 | 正向操作 | 补偿操作 |
|---|---|---|
| 1 | 创建共享文档 | 删除文档 |
| 2 | 写入报告内容 | 无需补偿（随文档删除） |
| 3 | 发送邮件 | 无法撤回，只能再发一封更正邮件 |

两个要点：一是补偿操作本身也会失败，也要能重试、要幂等；二是有些操作根本无法补偿，发出去的邮件收不回来。所以**不可补偿的步骤要放到最后执行**，确保它前面的步骤都已成功；风险高的还要在执行前加人工审批。完整的 Saga 编排通常交给工作流引擎（见 [第 10 章](#c10)），第一版只需要做到：副作用步骤后置、每个副作用都有 tool_call 记录、失败时知道哪些已经发生。

### Checkpoint 与断点恢复
研报助手跑到第 12 步时，Worker 因为发版被重启。如果没有 checkpoint，新 Worker 只能从第 1 步重来：重新搜索、重新调用 LLM，已花掉的 token 白费，邮件还可能发第二次。

#### 每一步完成后立即持久化
规则很简单：**每个 Step 完成后，在同一个事务里写入该步的结果，然后才开始下一步**。写入内容包括 `agent_step`（状态、输入输出、token 数）、`tool_call`（参数、结果）、新增的 `message`。恢复时按 `seq` 读出所有 `succeeded` 的 step 和 message，重建上下文，从下一个 seq 继续。

```python
async def resume_run(db, run_id):
    steps = await db.fetch(
        "SELECT seq, type, output FROM agent_step "
        "WHERE run_id=$1 AND status='succeeded' ORDER BY seq", run_id)
    messages = await db.fetch(
        "SELECT role, content FROM message WHERE run_id=$1 ORDER BY created_at, id", run_id)
    next_seq = (steps[-1]["seq"] + 1) if steps else 1
    # 没完成的 step（running/pending）不能直接复用：
    # LLM 步骤丢弃重做；工具步骤走 execute_tool_once，靠幂等键对账
    return [dict(m) for m in messages], next_seq
```

#### 重放（replay）与重新执行（re-execute）
恢复时，已完成的步骤是「重放」：直接读取记录下的结果，不再调用模型和工具。未完成的那一步是「重新执行」：要真正调用一次。区分的依据只有一个：数据库里有没有这一步的成功记录。

这带来一个约束：**决定「下一步做什么」的逻辑必须是确定性的，非确定的东西必须作为结果记录下来**。LLM 的输出、工具的返回、当前时间、随机数，都只能在执行时产生一次并写入 step，恢复时读记录，不能重新生成。否则恢复后重算出来的第 8 步和崩溃前的第 8 步不一样，后面已记录的步骤就对不上了。

崩溃发生在「外部调用完成」和「写入 checkpoint」之间，是唯一的灰色地带：LLM 调用可以直接重做（多花点 token）；工具调用要靠前面讲的幂等键和对账来处理。checkpoint 无法消除这个窗口，只能把它缩小到一步。

<div class="note">易错点：checkpoint 只存「最终消息列表」是不够的。至少要能区分每一步的状态，否则恢复时无法判断最后一个工具调用是「已完成」还是「发出去了但没记录结果」。</div>

#### 和 LangGraph 的关系
LangGraph 内置了 checkpointer 机制：编译图时传入一个 checkpointer（如内存版 `MemorySaver`，或 `langgraph-checkpoint-postgres` 包提供的 `PostgresSaver`），调用时在 config 里指定 `thread_id`，框架在每个节点执行后保存图的状态，之后可以从最近的 checkpoint 继续。它解决的是同一个问题。用框架时仍然要清楚：checkpointer 保存的是图状态，不会替你处理外部副作用的幂等，`send_email` 的去重依然要自己做。

### 人工审批：危险操作先停下来
对 `send_email`、删除数据、对外付款这类不可逆操作，最可靠的防线是执行前让人确认。实现上，它是 Run 状态机里的一个等待状态：

1. 模型决定调用 `send_email`，工具元数据标记为 `requires_approval`。
2. Worker 写入 tool_call（`status='pending_approval'`）和完整参数，Run 状态改为 `waiting_approval`，然后**释放 Worker**，不要占着进程等人。
3. 前端通过 SSE 收到审批事件，展示收件人、标题、正文，用户点「批准」或「拒绝」。
4. 审批接口校验当前状态确实是 `waiting_approval`（防止重复提交），记录审批人和时间，把 Run 重新入队。
5. Worker 从 checkpoint 恢复，执行已批准的调用；被拒绝时把「用户拒绝发送」作为工具结果交给模型。

等待审批可能持续几小时，所以审批必须建立在 checkpoint 之上，不能靠「Worker 里 await 一个 Future」。还要设置审批超时，例如 24 小时未处理就把 Run 置为 `cancelled` 或 `failed`。前面「超时结果未知」的转人工，复用的也是这套机制。

### Java 对照
| 能力 | Python 主线 | Spring Boot 对应 |
|---|---|---|
| 重试 + 退避 | `tenacity`、手写循环 | Spring Retry 的 `@Retryable(maxAttempts, backoff = @Backoff(delay, multiplier, random = true))` + `@Recover` |
| 熔断 / 重试 / 限流 / 超时 | 手写或 `pybreaker` 等库 | Resilience4j：`CircuitBreaker`、`Retry`、`RateLimiter`、`TimeLimiter`、`Bulkhead`，提供 Spring Boot starter 和注解 |
| 超时 | `asyncio.timeout` | `CompletableFuture.orTimeout`（Java 9+）、HTTP 客户端的 connect/read timeout |
| 幂等键 | UNIQUE 约束 + `ON CONFLICT` | 同样依赖数据库唯一约束，捕获 `DuplicateKeyException` |
| 参数校验 | Pydantic | Jackson 反序列化 + Bean Validation（`@Valid`、`@Email`） |

### 生产环境怎么做
第一版就该做：

- **所有外部调用都有超时**，三层齐全：单次调用、单步、整个 Run（含最大步数和 token 上限）。
- **只在一层做有限重试**：指数退避 + full jitter，尊重 `Retry-After`，只对可重试错误重试；关掉或明确知道 SDK 自带的重试次数。
- **工具分级**：只读工具自由重试；有副作用的工具必须有幂等键（`run_id:step_seq:tool_name`）+ `tool_call.idempotency_key` 唯一约束；超时进入 `unknown`，不直接重发。
- **工具参数用 Pydantic 校验**，修复最多 1–2 次；业务错误作为工具结果回传模型。
- **每步 checkpoint**，Worker 重启后从最后完成的步骤继续。
- **`send_email` 等不可逆操作走人工审批**，或至少限定收件人白名单。

规模上来再做：

- 按下游维度的熔断器、备用模型/厂商的自动切换（切换前跑过评测）。
- 全局重试预算、按租户的重试与成本限额。
- 有多个副作用步骤时的 Saga 补偿，或直接迁移到 durable execution 引擎。
- 监控指标：各下游的错误率与 429 比例、重试次数分布、`unknown` 状态的 tool_call 数量、熔断器状态变化、恢复（resume）次数。`unknown` 数量上涨通常意味着某个下游超时设置不合理。

### 自测
- **哪些错误可以重试，哪些不能？** 连接失败、429、5xx、流中断可以退避重试；400/401/403/422 原样重试必然失败；模型输出不合法要带错误信息让模型修复；工具业务错误交给模型处理，不在基础设施层重试。
- **为什么退避要加抖动？** 大量客户端同时失败后，如果都按相同间隔重试，重试请求会同时到达，形成惊群，把刚恢复的服务再次打垮；随机化把重试在时间上摊开。
- **幂等键为什么不用随机 UUID，也不用参数哈希？** 随机 UUID 每次重试都不同，起不到去重作用；参数哈希会把用户确实想做的两次相同操作误判为重复。应由 `run_id + step_seq + tool_name` 这类稳定的逻辑位置推导。
- **`send_email` 超时了怎么办？** 超时不代表失败，先把 tool_call 标为 `unknown`；下游支持幂等键就带同一个键重试，支持状态查询就先查；两者都不支持就进入 `waiting_approval` 让人确认，绝不直接重发。
- **Checkpoint 恢复时，为什么要求决策逻辑是确定性的？** 恢复时已完成步骤读记录重放而不重新执行，如果下一步的决策依赖重新生成的 LLM 输出、时间或随机数，恢复后的路径会与崩溃前不一致；非确定的值必须在执行时记录下来。
- **熔断器解决什么问题？三个状态怎么切换？** 下游持续故障时快速失败，避免每个请求都等满超时、耗尽 Worker。closed 统计失败率，超过阈值转 open 直接拒绝；等待一段时间转 half-open 放行试探请求，成功回 closed，失败回 open。
