## 8. Redis：缓存与短期状态 {按需}
> 一句话：在多个 API 实例和 Worker 之间共享那些「要快、可以丢、会过期」的状态，比如取消信号、限流计数、流式事件缓冲和工具结果缓存，而 Run 的事实记录仍然留在数据库。

### 在链路中的位置
研报助手部署成多实例后，一次任务会跨越好几个进程：用户的 SSE 连接落在 API 实例 A 上，Run 却在 Worker W3 里执行；用户点「停止」的请求可能打到 API 实例 B；同一个用户的请求被负载均衡分散到各个实例，限流计数却必须是全局的。这些场景的共同点是：需要一个所有进程都能低延迟访问的共享存储，数据量不大，生命周期短（几秒到几小时），丢了可以从数据库恢复或者影响可控。Redis 正好填这个位置：

- Worker 每产生一个 token 或工具事件，写入 Redis Stream，API 实例 A 从中读取并推给浏览器；
- API 实例 B 收到「停止」，写数据库的 `cancel_requested`，同时在 Redis 里设一个取消标记，Worker 在每个 Step 边界快速检查；
- 每个请求进来先在 Redis 里做限流和 token 配额检查；
- `web_search` 的结果、embedding 结果按参数哈希缓存，避免重复花钱。

### 什么时候引入 Redis，什么时候不需要
单实例、单进程的第一版不需要 Redis：取消标记可以放进进程内的 `asyncio.Event`，流事件直接从执行协程推到同进程的 SSE 生成器，限流用内存计数器，Run 状态本来就在 PostgreSQL 里。这时引入 Redis 只是多一个要运维、要监控、会故障的组件。

需要 Redis 的信号是**出现了多个进程要共享的短期状态**：

- API 和 Worker 拆成不同进程（用了 Celery 等），SSE 所在进程和执行进程不是同一个；
- API 部署了多个副本，进程内的限流计数、缓存各算各的，失去意义；
- 数据库被高频轮询打满，比如每个 Step 都查一次 `cancel_requested`、每个请求都 `SELECT count(*)` 做限流；
- 需要跨实例互斥，例如同一个用户同一时刻只允许一个 Run 在执行某个昂贵操作。

如果已经用 Celery 且 broker 选了 Redis，Redis 本身已经在架构里，复用同一套集群（不同 DB 编号或不同实例）是很自然的选择。但要注意 broker、缓存、状态三类用途对持久化和淘汰策略的要求不同，后文会讲。

### Redis 和数据库各放什么
判断标准只有一条：**丢了以后系统还能不能自洽**。能从数据库重建、或者丢失后果可控的，放 Redis；丢了就会出事故或对不上账的，必须进数据库。

| 数据 | 放在哪 | 理由 |
|---|---|---|
| Run / Step / ToolCall 记录、状态、结果 | 数据库 | 事实来源，用于 resume、审计、计费 |
| `tool_call.idempotency_key` | 数据库（UNIQUE） | 防重复发邮件必须可靠，不能依赖可能丢失的缓存 |
| token 用量明细 | 数据库 | 计费依据 |
| 取消标记 | Redis（快路径）+ 数据库 `cancel_requested`（兜底） | Worker 高频检查；Redis 丢了还能查库 |
| 限流计数、短期 token 配额 | Redis | 高频读写、天然按时间窗口过期，丢失只是短暂放宽限制 |
| 会话短期上下文（如最近 N 轮摘要） | Redis 缓存 + 数据库 `message` | 加速组装 prompt，未命中时从 message 表重建 |
| SSE 流事件缓冲 | Redis Stream | 支持断线重连回放，Run 结束后过期即可 |
| 工具结果、embedding 缓存 | Redis | 纯性能优化，未命中就重新计算 |
| 分布式锁 | Redis | 短期互斥；正确性最终仍要靠数据库条件更新兜底 |

<div class="note">易错点：把 Run 状态只写在 Redis 里「图快」，数据库定期同步。一旦 Redis 重启或主从切换丢了几秒数据，就会出现状态回退、任务被重复执行。状态先写数据库，Redis 里最多放一份可丢弃的副本。</div>

### 缓存 LLM 与工具结果
Agent 的成本大头是 LLM 调用和付费工具（搜索 API、第三方数据接口）。缓存能省钱、降延迟，但前提是**只缓存「同样输入一定可以复用同样结果」的调用**。

#### 什么能缓存
| 调用 | 能否缓存 | 说明 |
|---|---|---|
| embedding | 适合 | 同一模型同一文本结果确定，TTL 可以很长 |
| `web_search` | 可以，TTL 要短 | 搜索结果会变化，研报场景缓存几十分钟到几小时较合理 |
| `query_db`（只读） | 谨慎 | 必须把用户/租户身份放进 key，否则会把 A 有权限看的数据返回给 B |
| LLM 生成 | 一般不缓存 | temperature > 0 时本就不确定，且上下文几乎每次不同；可用于完全相同的分类、抽取类调用 |
| `send_email` 等有副作用的工具 | 绝不缓存 | 防重复靠数据库幂等键，不是缓存 |

注意区分应用层的结果缓存和模型厂商提供的 prompt caching：后者是厂商在服务端复用相同前缀的计算以降低输入 token 费用，不需要 Redis，也不会返回旧答案。

#### key 设计与 TTL
key 要包含所有影响结果的因素，并且有统一前缀和版本号，方便整体失效：

```python
import hashlib, json

def tool_cache_key(tool: str, args: dict, tenant_id: str, ver: str = "v1") -> str:
    # sort_keys 保证参数顺序不同但内容相同的调用命中同一个 key
    payload = json.dumps(args, sort_keys=True, ensure_ascii=False)
    digest = hashlib.sha256(payload.encode()).hexdigest()
    return f"cache:{ver}:tool:{tool}:{tenant_id}:{digest}"

async def cached_search(r, args, tenant_id):
    key = tool_cache_key("web_search", args, tenant_id)
    if (hit := await r.get(key)) is not None:
        return json.loads(hit)
    result = await web_search(**args)
    await r.set(key, json.dumps(result), ex=1800)   # 30 分钟
    return result
```

这里 `r` 是 `redis.asyncio.Redis` 客户端（redis-py 4.2+ 内置 asyncio 支持）。参数先规范化（去首尾空格、统一大小写等）能提升命中率，但要确认规范化不改变语义。所有缓存 key 都必须带 TTL，否则缓存实例会被慢慢塞满。

#### 缓存击穿
一个热门 key 过期的瞬间，大量并发请求同时未命中，一起去调用付费 API，这就是缓存击穿（cache stampede）。研报助手里，如果很多用户同时调研同一家热门公司，就会出现。常见应对：

- 单飞（single flight）：用 `SET lock:key 1 NX PX 5000` 只让一个请求去回源，其他请求短暂等待后重读缓存；
- TTL 加随机抖动，避免一批 key 同时过期；
- 提前刷新：快过期时由后台异步更新，请求方先拿旧值。

第一版做到「所有 key 有 TTL + 抖动」即可，单飞等出现明显的重复回源再加。

### 限流：保护钱包和上游配额
Agent 的一个请求可能触发十几次 LLM 调用，单个用户不加限制地提交任务，几分钟就能烧掉可观的费用，也会撞上模型厂商的 RPM/TPM（每分钟请求数/ token 数）限额，连累其他用户。限流要分两层：入口按「每用户每分钟提交几个 Run」限制请求数；执行中按「每用户、每模型的 token 用量」限制成本。多实例下计数必须集中在 Redis。

| 算法 | 实现 | 优点 | 缺点 |
|---|---|---|---|
| 固定窗口 | `INCR` + `EXPIRE` | 最简单，一个 key | 窗口边界可能瞬间放行 2 倍流量 |
| 滑动窗口日志 | ZSET 存每次请求时间戳 | 精确 | 每个请求一个成员，内存随限额增长 |
| 令牌桶 | Hash 存余量和时间，Lua 计算 | 允许突发、平滑限速，可按「消耗量」扣减 | 逻辑稍复杂 |

#### 固定窗口与原子性陷阱
最常见的写法是先 `INCR`，如果返回 1 再 `EXPIRE`。问题在于这是两条命令：进程在两者之间崩溃或网络中断，key 就没有过期时间，计数永远不归零，这个用户会被永久限流。解决办法是让设置过期和自增原子地完成：

```python
async def fixed_window_allow(r, user_id: str, limit: int, window: int = 60) -> bool:
    key = f"rl:run:{user_id}"
    async with r.pipeline(transaction=True) as pipe:   # MULTI/EXEC
        pipe.incr(key)
        pipe.expire(key, window, nx=True)   # EXPIRE ... NX：Redis 7.0+，仅在无过期时间时设置
        count, _ = await pipe.execute()
    return count <= limit
```

`MULTI/EXEC` 保证两条命令一起执行、中间不会插入其他客户端的命令。Redis 7.0 之前没有 `EXPIRE NX`，可改用 Lua 脚本，或者每次都 `EXPIRE`（这会让窗口随请求不断后移，语义变成「静默 60 秒后才恢复」，要清楚这一点）。另一种常见写法是把窗口编号放进 key（如 `rl:run:{user}:{unix_ts // 60}`），每个窗口一个新 key，过期只用来清理。

#### 滑动窗口（ZSET）
ZSET 的成员是每次请求的唯一 ID，score 是时间戳。判断时删掉窗口外的成员、数一下剩余个数，未超限才加入本次请求。这几步放进 Lua 脚本保证原子：

```lua
-- KEYS[1]=限流 key；ARGV: now_ms, window_ms, limit, member(唯一 id)
local now, window, limit = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
if redis.call('ZCARD', KEYS[1]) >= limit then
  return 0
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window)
return 1
```

member 必须唯一（如 UUID），否则同一毫秒的两个请求会合并成一个成员而少算。时间由调用方传入时，各实例的时钟偏差会影响精度，对限流这种场景通常可以接受。

#### 令牌桶（Lua 脚本）
令牌桶以固定速率往桶里补充令牌，桶有容量上限，每次请求扣掉相应数量的令牌，不够就拒绝。它允许短时间突发（桶满时可以一次用完），长期平均速率又被补充速率限制住；而且扣减量可以不是 1，正好用来做 token 配额：一次 LLM 调用预估要消耗多少 token，就扣多少。

```lua
-- KEYS[1]=桶 key；ARGV: capacity, refill_per_sec, now_ms, cost
local cap    = tonumber(ARGV[1])
local rate   = tonumber(ARGV[2])
local now    = tonumber(ARGV[3])
local cost   = tonumber(ARGV[4])
local b = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(b[1]) or cap
local ts     = tonumber(b[2]) or now
-- 按流逝时间补充令牌，不超过容量
local elapsed = math.max(0, now - ts)
tokens = math.min(cap, tokens + elapsed * rate / 1000)
local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
-- 桶补满所需时间之后自动删除，空闲用户不占内存
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / rate * 1000))
return {allowed, tostring(tokens)}
```

Python 侧用 `r.register_script(lua_src)` 得到可调用对象，按 `await bucket(keys=[key], args=[cap, rate, now_ms, cost])` 调用，redis-py 会自动走 `EVALSHA`，脚本未缓存时回退到 `EVAL`。返回值里用 `tostring` 是因为 Lua 数字转成 Redis 回复时会被截断为整数。Lua 脚本在 Redis 中原子执行、期间不处理其他命令，所以脚本要短，不要在里面做循环扫描。

#### 每用户、每模型的 token 配额
token 配额的难点在于：调用之前不知道确切会用多少 token，输出长度只有调用结束后才知道。常见做法是「预扣 + 结算」：

- 调用前，根据 prompt 长度（用 tokenizer 计算或估算）加上 `max_tokens` 估一个上限，从 key `quota:{user_id}:{model}` 的令牌桶里预扣；不够就让 Run 排队等待或直接以「额度不足」失败；
- 调用后，按响应里的 `usage` 实际值，把多扣的部分退回（对 Hash 用 `HINCRBYFLOAT`，或再执行一次带负 cost 的脚本）；
- 实际用量同时写入数据库 `agent_step.tokens_in/tokens_out`，作为计费依据。Redis 里的配额只是控制「花得多快」，日/月总额度以数据库汇总为准或定期校准。

按模型区分 key，是因为不同模型单价差别很大，厂商限额也是按模型给的；也可以按金额而不是 token 数扣减，把不同模型统一成一个「预算」桶。

<div class="tip">实践建议：限流被拒绝时返回 HTTP 429 并带上 <code>Retry-After</code> 头；对已经在运行中的 Run，配额不足时应让它在 Step 边界暂停或失败并写明原因，而不是在 LLM 调用中途硬中断。</div>

### 分布式锁
在 Agent 后端里，分布式锁用于「同一时刻只允许一个进程做某件事」的短期互斥，例如：同一个用户的会话上下文正在被压缩成摘要时，其他请求不要同时去压缩；缓存单飞回源；某个定时回收任务在多实例中只跑一份。

#### 加锁与安全释放
加锁用一条命令完成「不存在才设置 + 设置过期时间」：

```bash
SET lock:summarize:conv_42 "worker-3:8f1c2a" NX PX 30000
# 返回 OK 表示拿到锁；返回 nil 表示锁已被别人持有
```

value 必须是持有者独有的随机值（进程 ID + UUID）。释放时不能直接 `DEL`：假设持有者 A 执行时间超过了 30 秒，锁已自动过期并被 B 拿到，A 这时执行 `DEL` 就会删掉 B 的锁。正确做法是「比较 value 相同才删除」，并且比较和删除必须原子，所以用 Lua：

```lua
-- KEYS[1]=锁 key；ARGV[1]=加锁时写入的 value
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
```

早年常见的 `SETNX` + `EXPIRE` 两步写法有和固定窗口限流一样的问题：两步之间崩溃就留下一个永不过期的锁。`SET` 命令的 `NX`、`PX` 选项自 Redis 2.6.12 起支持，应始终使用一条命令的形式。redis-py 自带 `r.lock(name, timeout=...)`，内部就是 `SET NX PX` 加 Lua 释放，可以直接用。

#### TTL 的两难与锁不是正确性保证
TTL 设短了，任务没做完锁就过期，另一个进程进入临界区，出现两个持有者；设长了，持有者崩溃后要等很久才能恢复。常用的折中是「看门狗」续期：持有者在后台定期延长 TTL，进程死了自然停止续期。Java 生态的 Redisson 就提供这种机制：`RLock.lock()` 不指定租期时，看门狗默认每 10 秒把锁续到 30 秒（`lockWatchdogTimeout` 默认 30 秒）；显式指定 `leaseTime` 时不续期。Redisson 的 `RLock` 还是可重入的。

但续期也不能解决根本问题：持有者可能因为 GC 停顿、进程被挂起、网络分区，停住的时间超过 TTL，醒来后仍以为自己持有锁，继续写数据。Redis 主从异步复制下，主节点宕机切换时刚写入的锁也可能丢失。所以 **Redis 锁只能提高效率（减少重复工作），不能作为正确性保证**。

对 Agent 来说，真正需要正确性保证的是「同一个 Run 只能由一个 Worker 推进」和「`send_email` 只执行一次」。前者靠数据库里的租约字段（`lease_owner`、`lease_expires_at`）加条件 UPDATE，并用单调递增的 fencing token（如 `attempt` 或 `version`）让过期的持有者的写入被拒绝；后者靠 `tool_call.idempotency_key` 的唯一约束和下游幂等键。这部分的完整设计见 [第 10 章](#c10)。不要用 Redis 锁去「保证 Run 不被重复执行」。

<div class="note">易错点：以为 Redlock（多个独立 Redis 节点上多数派加锁）可以解决上述问题。它降低了单点故障导致锁丢失的概率，但同样依赖时钟和进程不停顿的假设，也不能提供 fencing，业界对其安全性一直有争议。需要强一致的互斥，用数据库或 etcd/ZooKeeper 这类基于共识的系统。</div>

### 把流事件从 Worker 送到 SSE 所在实例
浏览器的 SSE 连接落在 API 实例 A 上，Run 在 Worker W3 里执行，两者不在同一个进程，W3 产生的 token、「开始调用 web_search」「工具返回」等事件需要一个中转。Redis 提供两种机制：Pub/Sub 和 Streams。

| 维度 | Pub/Sub | Streams（Redis 5.0+） |
|---|---|---|
| 投递语义 | 发后即忘（fire-and-forget），只发给当前在线的订阅者 | 消息追加到日志里持久保留，按 ID 读取 |
| 没有订阅者时 | 消息直接丢弃 | 消息保留，之后连接上来的读者也能读到 |
| 断线重连 | 断开期间的消息全部丢失 | 带上最后收到的 ID 继续读，可回放 |
| 内存占用 | 几乎不占 | 需要用 `MAXLEN` / `XTRIM` 控制长度 |
| 适合 | 取消广播、配置变更通知等「只关心此刻」的信号 | 需要可恢复的流式输出 |

研报助手的典型问题：用户网络抖动，SSE 断开 3 秒后浏览器自动重连，按 SSE 规范会带上 `Last-Event-ID` 请求头，值是最后收到事件的 `id`。如果用 Pub/Sub，这 3 秒的事件已经丢了，前端报告中间缺一段；而且重连可能落到另一个实例 B 上。用 Streams 时，把 Redis 生成的消息 ID（形如 `1730880000000-0`，毫秒时间戳加序号，单调递增）直接作为 SSE 的 `id`，任何实例收到重连请求，都能从这个 ID 之后继续读。因此**需要可恢复的 SSE 时推荐 Streams**。

Worker 端写入，每个 Run 一个 Stream：

```python
STREAM_TTL = 3600

async def emit(r, run_id: str, event: str, data: dict):
    key = f"run:{run_id}:events"
    await r.xadd(key, {"event": event, "data": json.dumps(data, ensure_ascii=False)},
                 maxlen=5000, approximate=True)   # 即 XADD key MAXLEN ~ 5000 * ...
    await r.expire(key, STREAM_TTL)              # Run 结束后一段时间自动清理
```

API 端读取并转成 SSE：

```python
async def sse_events(r, run_id: str, last_event_id: str | None):
    key = f"run:{run_id}:events"
    last_id = last_event_id or "0-0"            # 首次连接从头读，重连从断点读
    while True:
        resp = await r.xread({key: last_id}, block=15000, count=100)
        if not resp:                            # 15 秒无新事件，发注释行保活
            yield ": keep-alive\n\n"
            continue
        for msg_id, fields in resp[0][1]:
            last_id = msg_id
            yield f"id: {msg_id}\nevent: {fields['event']}\ndata: {fields['data']}\n\n"
            if fields["event"] in ("done", "error", "cancelled"):
                return
```

（示例假设客户端以 `decode_responses=True` 创建，字段为 str。）几个要点：

- `XREAD BLOCK` 会占住一个连接直到有数据或超时，每个 SSE 连接都这样读时，要给 API 实例单独配置足够大的 Redis 连接池，或者让一个后台任务批量读多个 Stream 再分发给本地连接。
- `MAXLEN ~ N` 中的 `~` 表示近似裁剪，Redis 按内部节点整块删除，效率远高于精确裁剪，实际长度可能略多于 N。也可以单独调用 `XTRIM`。被裁掉的事件无法回放，所以 N 要大于一个 Run 通常产生的事件数；token 级事件很多时，可以在 Worker 端把多个 token 合并成一个事件再写。
- Stream 只是缓冲，Run 的最终结果仍写数据库。用户第二天打开历史任务，读的是 `agent_run.output` 和 `agent_step`，而不是 Stream。如果 `Last-Event-ID` 对应的事件已被裁剪或 Stream 已过期，API 应回退到从数据库加载当前完整状态。
- 这里用的是 `XREAD` 而不是消费者组（`XREADGROUP`）：每个 SSE 连接都要看到全部事件，是广播语义；消费者组是「一组消费者分摊消息」的队列语义，用于任务分发。

### 取消信号
用户点「停止」，请求落在任意 API 实例上。处理顺序是：先写数据库（`cancel_requested = true` 或直接把 `queued` 改为 `cancelled`，见[第 3 章](#c3)），再通知 Worker。通知有两种方式：

- 标记 key：`SET run:{id}:cancel 1 EX 3600`。Worker 在每个 Step 边界、每次工具调用前 `EXISTS` 一下，开销极小，比查数据库轻。这是最简单可靠的做法。
- Pub/Sub：`PUBLISH run:{id}:control cancel`，Worker 订阅后能立即收到，适合想要在 LLM 流式输出中途就中断的场景（收到后取消当前的 asyncio 任务）。因为是发后即忘，Worker 恰好在重连时会错过，所以只能作为加速手段。

两种方式都要以数据库为兜底：Worker 在 Step 结束提交时用 `WHERE status='running'` 的条件更新，并读取 `cancel_requested`，即使 Redis 的信号丢了，最迟在下一个 Step 边界也会停下。取消的完整流程（如何中断正在进行的 LLM 调用、已发起的有副作用工具如何处理）见 [第 10 章](#c10)。

### 持久化：为什么 Redis 不能当 Run 的事实来源
Redis 是内存数据库，提供两种持久化方式：

| 方式 | 原理 | 可能丢失的数据 |
|---|---|---|
| RDB | 按配置的条件定期 fork 子进程生成快照文件 | 上次快照之后的所有写入，通常是分钟级 |
| AOF | 把每条写命令追加到日志，`appendfsync` 控制刷盘频率 | `everysec`（默认）最多约 1 秒；`always` 最安全但吞吐下降明显 |
| RDB + AOF | 同时开启，重启时优先用 AOF 恢复 | 同 AOF |

即使开了 AOF，仍有两个原因不能把 Run 状态只放在 Redis：一是主从复制是异步的，主节点宕机、哨兵或集群把从节点提升为主时，最后一批还没复制过去的写入会丢失，这和本地是否刷盘无关；二是 Redis 不提供跨 key 的约束（没有 UNIQUE、外键、CHECK），也没有可回滚的事务（`MULTI/EXEC` 中某条命令执行出错，其他命令照样执行），无法表达「Step 完成和 Run 更新必须一起生效」。Run、Step、ToolCall 这些数据丢一秒都可能导致重复发邮件或账单错误，所以放数据库；Redis 里的数据都按「随时可能丢」来设计，丢了能从数据库恢复或影响可控。

对研报助手而言，缓存实例可以完全不开持久化（重启后冷启动，只是多花点调用费）；放 Stream 缓冲、限流计数的实例开 AOF `everysec` 即可，丢失 1 秒数据的后果是少量事件需要从数据库回填、限流短暂放宽。

### 内存淘汰策略：缓存实例和状态实例要分开
Redis 内存达到 `maxmemory` 后的行为由 `maxmemory-policy` 决定：

| 策略 | 行为 | 适合 |
|---|---|---|
| `noeviction`（默认） | 不淘汰，写命令直接报错 | 存状态、队列的实例（Celery broker、Stream、限流、锁） |
| `allkeys-lru` / `allkeys-lfu` | 在所有 key 中按最近最少使用 / 使用频率淘汰（LFU 自 Redis 4.0 起） | 纯缓存实例 |
| `volatile-lru` / `volatile-lfu` / `volatile-ttl` | 只淘汰设置了过期时间的 key | 混用实例，但要求不能被淘汰的 key 都不设 TTL，很难保证 |
| `allkeys-random` / `volatile-random` | 随机淘汰 | 很少使用 |

问题出在混用：如果缓存和状态放在同一个实例，选 `allkeys-lru`，内存紧张时可能把某个 Run 的事件 Stream、某个锁、Celery 队列里的任务消息淘汰掉，表现为前端流式输出突然中断、任务凭空消失，非常难排查；选 `noeviction`，缓存把内存塞满后连限流计数都写不进去，整个服务报错。而本章的取消标记、Stream、限流 key 都带 TTL，`volatile-*` 策略同样会淘汰它们。所以规模上来后应把**缓存**和**状态/队列**拆成两个实例（或两个集群）：前者 `allkeys-lfu`、可不持久化；后者 `noeviction`、开 AOF，并对内存使用率告警。只有一个实例时，至少选 `noeviction` 并给所有缓存 key 设 TTL，宁可报错也不要静默丢状态。

### Spring Boot 对应做法
Java 侧使用 Spring Data Redis（默认客户端是 Lettuce）。`StringRedisTemplate.opsForValue().setIfAbsent(key, value, Duration)` 对应 `SET NX PX`；`opsForStream()` 提供 `add`、`read`、`trim`；`execute(RedisScript, keys, args)` 执行 Lua 脚本，用于限流和安全释放锁；`RedisMessageListenerContainer` 订阅 Pub/Sub 频道；`@Cacheable` 配合 `RedisCacheManager` 做方法级结果缓存，TTL 在 `RedisCacheConfiguration.entryTtl` 中配置。分布式锁和限流也可以直接用 Redisson 的 `RLock`、`RRateLimiter`，比手写 Lua 少出错。SSE 那一端用 `SseEmitter`，读取 Stream 后调用 `send(SseEmitter.event().id(msgId).name(event).data(data))`。

### 生产环境怎么做
第一版就该做（在已经多实例或 API/Worker 分离的前提下）：

- 所有 key 统一前缀命名（`cache:`、`rl:`、`run:{id}:`、`lock:`），并且都带 TTL。
- 流事件用 Streams，SSE 的 `id` 用 Stream 消息 ID，支持 `Last-Event-ID` 重连；Stream 设 `MAXLEN ~` 和过期时间，回放失败时回退到从数据库加载。
- 入口限流用固定窗口（原子地设置过期）即可；执行中的 token 配额用令牌桶 Lua 脚本，实际用量以数据库为准。
- 取消用「数据库标记 + Redis 标记 key」，Worker 在 Step 边界检查。
- Run 状态、幂等键只在数据库；Redis 锁只用于减少重复工作。
- 客户端设置连接超时和命令超时；Redis 不可用时明确降级策略：缓存未命中直接回源，限流是放行还是拒绝要事先决定（成本敏感的场景通常选拒绝新 Run）。

规模上来再做：

- 缓存实例和状态/队列实例分离，分别配置淘汰策略和持久化。
- 高可用：哨兵或 Redis Cluster。Cluster 下 Lua 脚本和 `MULTI` 涉及的多个 key 必须在同一个 slot，用 hash tag（如 `run:{42}:events` 和 `run:{42}:cancel`）保证。
- 缓存单飞、提前刷新；监控命中率、内存、淘汰数、慢日志（`SLOWLOG`）、大 key 和热 key。
- SSE 读取改为每个 API 实例一个后台读者批量 `XREAD` 多个 Stream，减少阻塞连接数。

### 自测
- **什么时候需要引入 Redis？** 出现多个进程（多个 API 副本、API 与 Worker 分离）需要共享短期状态时，如跨实例的取消信号、全局限流、流事件中转；单进程第一版用进程内结构即可。
- **INCR + EXPIRE 实现限流有什么坑？** 两条命令不是原子的，中间崩溃会留下没有过期时间的计数，用户被永久限流；用 `MULTI/EXEC`、`EXPIRE NX`（Redis 7.0+）或 Lua 脚本保证原子。
- **Redis 分布式锁怎么加、怎么释放？为什么不能只靠它防止 Run 重复执行？** `SET key 随机值 NX PX ttl` 加锁，Lua 比较 value 后再 DEL 释放；持有者可能因 GC、网络分区停顿超过 TTL，主从切换也会丢锁，锁不提供 fencing，正确性要靠数据库租约、fencing token 和幂等键。
- **SSE 断线重连要补齐丢失的事件，用 Pub/Sub 还是 Streams？** Streams：消息按单调递增的 ID 保留，重连时按 `Last-Event-ID` 从断点 `XREAD`，任何实例都能接续；Pub/Sub 无订阅者时消息直接丢弃，无法回放。
- **为什么 Run 状态不能只存 Redis？** RDB/AOF 都可能丢最近的写入，主从异步复制在故障切换时也会丢数据；Redis 没有唯一约束和可回滚事务，无法保证 Step 与 Run 的一致更新。
- **缓存和状态放在同一个 Redis 实例时，淘汰策略怎么选？** 两难：`allkeys-*` 可能淘汰掉 Stream、锁和队列消息，`noeviction` 会让缓存写满后所有写入报错；应拆成两个实例，缓存用 `allkeys-lfu`，状态用 `noeviction`，只有一个实例时选 `noeviction` 并给缓存设 TTL。
