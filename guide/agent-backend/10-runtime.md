## 10. Agent Runtime：租约、心跳与故障恢复 {进阶}
> 一句话：Worker 随时会死、会卡住、会「假死后复活」，Runtime 要保证每个 Run 在任一时刻只有一个合法的执行者，执行者消失后能被及时发现并由别人从 checkpoint 接手，而复活的旧执行者写不进任何东西。

### 在链路中的位置
前两章分别解决了「单次调用失败怎么办」（可靠性）和「任务怎么交给 Worker」（队列）。本章处理两者之间的空白：**Worker 进程本身出问题**。

```text
            ┌──────────── PostgreSQL：agent_run(status, attempt, lease_owner, lease_expires_at, version)
            │                    ▲ 认领(attempt+1)      ▲ 心跳续租          ▲ 每次写入校验 attempt
队列 ──► Worker A ── 认领 run ──┘── 执行 step ... ────┘── 写 step ─────────┘
                       ✗ 崩溃 / 卡住 / 网络分区
                       └─► 租约到期 ──► Worker B 认领(attempt+1) ──► 从 checkpoint 继续
                                         Worker A 复活后写入 ──► attempt 不匹配，被拒绝
Scheduler：清扫租约过期但无人接手的 run，重新投递
```

只做本章内容的前提：每步 checkpoint（[第 4 章](#c4)）、幂等消费和清扫任务（[第 9 章](#c9)）已经就位。本章把其中「按 `updated_at` 判断 Worker 是否还活着」的粗粒度做法，换成租约 + 心跳 + fencing token 的精确机制。这部分是 Agent Infra / Runtime 方向的核心内容，做业务 Agent 的第一版可以先不实现，但要能讲清原理。

### 问题：Worker 半路死了，谁发现、谁接手
研报助手的一个 Run 跑到第 7 步，Worker 所在的机器出现以下任何一种情况：

| 情况 | 现象 | 难点 |
|---|---|---|
| 进程崩溃 / OOM / 机器宕机 | 进程消失，数据库里 Run 仍是 `running` | 没有人会主动报告「我死了」 |
| 发版时被 SIGTERM | 有几十秒的宽限期，然后被 SIGKILL | 要在宽限期内收尾 |
| 进程卡住 | 进程还在，但不再推进（死锁、同步调用阻塞事件循环） | 进程存在不等于在工作 |
| 暂停后恢复 | JVM Full GC、进程被挂起、虚拟机迁移，几十秒后继续运行 | 它自己不知道暂停过，会接着写数据 |
| 网络分区 | Worker 正常运行，但连不上数据库或被隔离 | 外界认为它死了，它认为自己活着 |

前三种需要「发现」：有一个机制能在合理时间内判断这个 Run 已经没人在跑。后两种更危险：被判定死亡的 Worker 其实还活着，等它恢复时，新 Worker 已经接手，两个 Worker 同时推进同一个 Run，可能写出交错的 step、发出两封邮件。这就是分布式系统里的「僵尸 Worker」问题。

队列层的重投递（Celery 的 visibility_timeout、RabbitMQ 连接断开后重投）只能解决一部分「发现」的问题，而且粒度很粗，也完全不处理僵尸写入。所以 Runtime 需要在数据库层面建立执行权的概念。

### 租约：带过期时间的执行权
租约（lease）是一把会自动过期的锁：Worker 认领 Run 时写入 `lease_owner`（自己的标识，如 `hostname:pid`）和 `lease_expires_at`（当前时间 + TTL）。只要租约没过期，其他 Worker 就不能接手；Worker 死了不续租，租约到期后执行权自动释放，不需要谁去「解锁」。

#### 原子认领
认领条件是「排队中，或者正在运行但租约已过期」，用一条 UPDATE 原子完成，同时把 `attempt` 加 1：

```sql
UPDATE agent_run
   SET status = 'running',
       lease_owner = $2,
       lease_expires_at = now() + interval '60 seconds',
       attempt = attempt + 1,
       version = version + 1,
       updated_at = now()
 WHERE id = $1
   AND cancel_requested = false
   AND (status = 'queued'
        OR (status = 'running' AND lease_expires_at < now()))
RETURNING attempt;
```

返回空说明别人持有有效租约或 Run 已结束，当前 Worker 直接退出。返回的 `attempt` 是本次执行的「代号」，后面每次写入都要带上它。

不靠队列消息、由 Worker 主动扫描可接手的 Run 时，用 `FOR UPDATE SKIP LOCKED`（PostgreSQL 9.5+ / MySQL 8.0+）在子查询里挑一行，多个 Worker 并发扫描不会抢同一行，写法和[第 9 章](#c9)的 Postgres 队列一致，只是 WHERE 条件换成上面的租约条件。

时间统一用数据库的 `now()`，不用 Worker 本地时钟。多台机器的时钟会有偏差，用本地时间计算过期，会出现「A 认为租约还有 10 秒，B 认为已经过期」的情况。

#### 心跳续租
Worker 在执行期间定期续租，这就是心跳：

```python
import asyncio

class LeaseLost(Exception):
    pass

async def heartbeat(db, run_id: str, owner: str, attempt: int,
                    ttl: int = 60, interval: int = 15):
    while True:
        await asyncio.sleep(interval)
        updated = await db.execute(
            """UPDATE agent_run
                  SET lease_expires_at = now() + make_interval(secs => $4), updated_at = now()
                WHERE id = $1 AND lease_owner = $2 AND attempt = $3 AND status = 'running'""",
            run_id, owner, attempt, ttl)
        if updated == "UPDATE 0":          # asyncpg 返回命令状态字符串
            raise LeaseLost(run_id)        # 租约已被别人接手、或 run 已被取消/结束
```

心跳和 Agent 主循环并发运行（例如在同一个 `asyncio.TaskGroup` 里，Python 3.11+）。续租失败时心跳抛出 `LeaseLost`，TaskGroup 会取消主循环，Worker 立即停止推进这个 Run。心跳要跑在独立的协程或线程里，不能放在「每步结束时」续租：一次 LLM 调用可能就要 2 分钟，按步续租会让租约在步内过期。

要注意的是：心跳在事件循环里运行，只有事件循环健康时才能续租。主循环里如果有同步阻塞调用（例如同步的 HTTP 客户端），心跳也会停下，租约随之过期，这恰好是正确的结果：卡住的 Worker 就应该被视为死亡。

#### TTL 与心跳间隔怎么选
| 参数 | 太小 | 太大 | 常见取值 |
|---|---|---|---|
| 租约 TTL | 一次数据库抖动、短暂 GC 就会误判死亡，触发不必要的接手 | Worker 真死后，Run 要等很久才被接手，用户看到长时间停滞 | 30–120 秒 |
| 心跳间隔 | 数据库写入压力大（每个运行中的 Run 每隔几秒一次 UPDATE） | 偶尔一次心跳失败就会导致租约过期 | TTL 的 1/3 到 1/4 |

心跳间隔取 TTL 的三分之一左右，意味着连续两次心跳失败仍然不会丢租约，可以容忍短暂的网络或数据库抖动。TTL 决定了故障恢复时间的下限：TTL 60 秒，Worker 宕机后至少 60 秒才会有人接手。对用户来说，几分钟的研报任务停顿一分钟可以接受；对交互式对话 Agent，TTL 要更短。

### 租约过期后：接手并从 checkpoint 继续
Worker B 通过上面的认领语句拿到一个租约已过期的 Run，`attempt` 从 1 变成 2。接下来的流程和普通恢复一样：

1. 读出该 Run 所有 `succeeded` 的 step 和 message，重建上下文（重放，不重新调用）。
2. 检查最后一个未完成的 step：LLM 步骤直接丢弃重做；工具步骤按 `tool_call.idempotency_key` 对账，`pending` / `unknown` 的副作用调用走[第 4 章](#c4)的「查状态 / 带键重试 / 转人工」流程。
3. 从下一个 `seq` 继续执行，并启动自己的心跳。

接手次数要有上限。`attempt` 超过阈值（如 3）说明这个 Run 本身可能是导致 Worker 崩溃的原因（例如某个工具结果大到撑爆内存），继续接手只会拖垮更多 Worker，应该直接置为 `failed` 并告警。

### 僵尸 Worker 与 fencing token
租约解决了「发现死亡」，但带来一个新问题：租约过期不代表持有者真的死了。

一个典型的时序：Worker A 持有 attempt=1 的租约，在调用 LLM 期间所在进程被暂停了 90 秒（GC、虚拟机迁移、宿主机过载）。期间租约过期，Worker B 认领，attempt=2，开始从第 7 步继续执行。90 秒后 A 恢复运行，拿到 LLM 的响应，它并不知道自己暂停过，于是把第 7 步的结果写入数据库，接着执行第 8 步。现在两个 Worker 在同一个 Run 上交替写入。

心跳检查救不了这个场景：A 恢复后的第一件事可能是写 step，而不是发心跳；即使先检查租约，「检查」和「写入」之间仍然可能再次暂停。唯一可靠的办法是让**数据库在每次写入时拒绝旧执行者**，这就是 fencing token。

#### attempt 就是 fencing token
`attempt` 每次认领加 1，单调递增。Worker 把认领时拿到的 attempt 当作 token，所有对这个 Run 的写入都在 WHERE 条件里带上它：

```sql
-- 写 step 前：在同一个事务里校验 token，并锁住 run 行防止并发接手
SELECT 1 FROM agent_run
 WHERE id = $1 AND attempt = $2 AND status = 'running'
 FOR UPDATE;
-- 0 行：执行权已经属于更新的 attempt，回滚事务并停止执行
INSERT INTO agent_step (run_id, seq, type, status, input, output, tokens_in, tokens_out,
                        started_at, finished_at)
VALUES ($1, $3, 'tool', 'succeeded', $4, $5, $6, $7, $8, now());

-- 改 run 状态：直接在 UPDATE 里带 token
UPDATE agent_run SET status = 'succeeded', output = $3, version = version + 1, updated_at = now()
 WHERE id = $1 AND attempt = $2 AND status = 'running';
```

A 恢复后带着 attempt=1 去写，而数据库里已经是 2，校验失败，A 的写入被拒绝，它应当立即放弃这个 Run。B 的 attempt=2 才是唯一被接受的执行者。`SELECT ... FOR UPDATE` 让「校验」和「写入」在同一事务内对 Run 行持锁，认领语句要等这个事务提交后才能修改 attempt，从而消除校验与写入之间的竞态。另外 `agent_step` 上建 `(run_id, seq)` 的唯一约束作为第二道防线，同一个 seq 不可能被写两次。

`version` 列的作用类似但更通用：它在每次修改 Run 时加 1，用于乐观锁（读出 version，更新时 `WHERE version = 读到的值`），防止任意两个组件的并发修改互相覆盖，例如 API 设置 `cancel_requested` 与 Worker 更新状态同时发生。`attempt` 标识「哪一次执行」，`version` 标识「哪一个版本的记录」。

#### fencing 管不到外部系统
fencing token 只对**会校验它的存储**有效。A 被暂停前如果已经把 `send_email` 的请求发出去，B 接手后又执行一次，数据库层面的 fencing 拦不住第二封邮件。这里起作用的是幂等键：B 对同一步算出相同的 `idempotency_key`，`tool_call` 的唯一约束让它进入对账流程，而不是直接发送；下游支持幂等键时，重复请求在对方那里被去重。也就是说，fencing token 保护内部状态，幂等键保护外部副作用，两者缺一不可。

### 为什么只用 Redis 锁不够
常见的第一反应是：执行 Run 前在 Redis 里 `SET lock:run:{id} {worker} NX PX 60000`，执行完删除。它能防止大多数并发，但有几个根本缺陷：

- **锁过期后，旧持有者不知道自己已经失去锁**。和上面的 GC 暂停场景完全一样，A 恢复后继续写，Redis 锁对数据库写入没有任何约束力。
- **锁和数据不在同一个系统**。「检查锁」发生在 Redis，「写入状态」发生在 PostgreSQL，两步之间没有原子性，无法用一个事务保证「持有锁才写入」。
- **Redis 的可用性语义**。主从异步复制下，主节点宕机时锁可能还没同步到从节点，故障切换后另一个 Worker 能再次拿到同一把锁。

Redis 锁可以用来减少无谓的竞争（大部分时候让第二个 Worker 根本不去尝试），但正确性必须落在数据库里：执行权的记录（`lease_owner` / `attempt`）和业务数据在同一个库，每次写入都校验 fencing token。分布式锁只是一个性能优化，不是安全保证。

### 优雅退出：收到 SIGTERM 之后
发版、缩容时，容器平台先给进程发 SIGTERM，等待一段宽限期后再发 SIGKILL（Kubernetes 的 `terminationGracePeriodSeconds` 默认 30 秒）。一个 Run 往往要几分钟，宽限期内大多跑不完，所以优雅退出的目标不是「跑完」，而是「交接干净」：

1. **停止认领新 Run**。不再从队列取消息、不再扫描可接手的 Run。
2. **让正在执行的 Run 在步与步之间停下**。设置一个进程内的 `shutting_down` 标志，主循环每步开始前检查；当前这一步如果预计能在宽限期内完成就让它完成，否则取消。
3. **确保最后一个完成的步骤已经 checkpoint**。checkpoint 本来就是每步提交的，这一步通常不需要额外工作。
4. **主动释放租约**。把 Run 改回 `queued` 并清空 `lease_owner`（带 attempt 条件），然后重新投递消息。这样其他 Worker 立刻就能接手，不必等租约 TTL 到期。

```python
async def release_lease(db, run_id: str, owner: str, attempt: int):
    await db.execute(
        """UPDATE agent_run
              SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
                  version = version + 1, updated_at = now()
            WHERE id = $1 AND lease_owner = $2 AND attempt = $3 AND status = 'running'""",
        run_id, owner, attempt)
    # 提交后再投递 execute_run(run_id)；投递失败也无妨，清扫任务会补投
```

使用 Celery 时，Worker 收到 SIGTERM 会进入 warm shutdown：不再接收新任务，等待正在执行的任务结束。如果任务时长远超宽限期，仍然会被 SIGKILL，所以任务代码内部要自己感知退出信号并按上面的步骤交接。即使优雅退出完全失败（进程被直接 SIGKILL），租约过期 + checkpoint 也会兜底，优雅退出只是把恢复时间从「TTL」缩短到「几秒」。

### 清扫任务：处理没人接手的 Run
租约过期后，如果没有消息驱动，就没有 Worker 会去认领这个 Run。清扫任务（由 Celery beat 等调度器定时运行，单实例）负责找出它们：

| 发现的情况 | 处理 |
|---|---|
| `running` 且 `lease_expires_at < now()`，`attempt` 未超限 | 重新投递消息，由 Worker 通过认领语句接手（不在清扫任务里改 attempt，避免两处都递增） |
| `running` 且租约过期，`attempt` 已超限 | 置为 `failed`，记录错误，告警 |
| `queued` 且长时间未被领取 | 重新投递，弥补丢失的消息 |
| `cancel_requested = true` 且租约过期 | 没有 Worker 会再执行它，直接置为 `cancelled` |
| `waiting_approval` 超过审批期限 | 置为 `cancelled`（或按业务规则 `failed`） |

和[第 9 章](#c9)基于 `updated_at` 的清扫相比，这里判断依据换成了租约，误判的可能性小得多：只要心跳还在，即使单步耗时很长，Run 也不会被清扫。

### 跨 Worker 的取消
用户点「停止」时，请求到达的是 API 节点，而执行 Run 的是某台 Worker。API 不知道 Worker 在哪，也不应该直接通知它。做法是以数据库为中介：

1. API 执行 `UPDATE agent_run SET cancel_requested = true, version = version + 1 WHERE id = $1 AND status IN ('queued','running','waiting_approval')`；对 `queued`、`waiting_approval` 的 Run 可以在同一语句里直接置为 `cancelled`，因为没有 Worker 在执行。
2. 执行中的 Worker 在**每步开始前**以及**每次心跳时**读取 `cancel_requested`。心跳语句可以顺便 `RETURNING cancel_requested`，不需要额外查询。
3. 发现取消请求后，Worker 取消正在进行的 LLM 调用（取消 asyncio 任务会关闭流式连接，模型侧停止生成，避免继续计费），把 Run 置为 `cancelled`（带 attempt 条件），释放租约。
4. 需要更快响应时，API 再通过 Redis Pub/Sub 发一条取消通知，Worker 订阅后立即触发取消。Pub/Sub 不保证送达，所以它只是加速手段，数据库标志才是可靠来源。

取消的边界要和用户说清楚：已经执行完的副作用（发出去的邮件）无法撤回；正在进行的工具调用如果不可中断，会等它结束后再停止。取消的响应时间取决于检查频率，最坏情况约等于一个心跳间隔或一次工具调用的时长。

### 最终一致：数据库、队列与外部副作用
一个 Run 的状态分散在三个地方：数据库里的 Run 和 step、broker 里的消息、外部系统里已发生的副作用（邮件、工单）。三者之间不存在跨系统的事务，任何时刻都可能短暂不一致：

| 不一致 | 例子 | 收敛机制 |
|---|---|---|
| 数据库有任务，队列没消息 | 写库后投递失败 | 清扫任务补投 / outbox |
| 队列有消息，数据库已结束 | 重复投递、迟到的消息 | 条件认领失败，直接确认退出 |
| 外部已发生，数据库没记录 | 邮件发出后、写结果前崩溃 | `pending` 记录 + 幂等键对账 |
| 数据库认为未发生，外部也不确定 | 超时、下游无查询接口 | 标记 `unknown`，进入 `waiting_approval` 让人确认 |

设计思路是：**以数据库为事实来源，承认其他地方会暂时不一致，并为每一种不一致准备一个收敛机制**（重投、去重、对账、人工）。不要追求强一致，那需要跨系统事务，代价远高于收益；要保证的是所有不一致最终都会被某个机制发现并修正，不会永久停在中间状态。

### 按用户和租户控制并发
Worker 池是共享资源。一个用户一次提交 50 个研报任务，可能占满所有 Worker，其他用户的任务全部排队；模型厂商的速率限制（每分钟请求数、token 数）也是全局共享的。常见的控制层次：

- **提交时限制**：API 检查该用户 `queued` + `running` 的 Run 数，超过上限（如 3 个）直接拒绝或提示排队。
- **认领时限制**：认领语句额外加条件「该用户当前 `running` 的 Run 少于 N」。条件里的计数和更新在并发下可能同时通过，严格限制需要对用户维度加锁（例如先 `SELECT ... FOR UPDATE` 锁住该用户的一行配额记录），或者接受偶尔的少量超额。
- **调用时限制**：对模型和工具的调用按租户做速率限制（Redis 令牌桶等），防止单个租户耗尽厂商配额。
- **队列隔离**：大客户或高优先级任务走单独的队列和 Worker 池，互不影响。

并发限制和成本控制是一体的：每个运行中的 Run 都在持续消耗 token，限制并发也就限制了单位时间的花费上限。

### 工业级答案：durable execution 引擎
把上面的机制全部自己实现：租约、心跳、fencing、checkpoint、重放、定时器、重试、取消、审批等待，工作量相当大，而且每个环节都有微妙的边界情况。Temporal 等 durable execution（持久化执行）引擎把这些能力做成了平台。核心思路：

- **把编排逻辑和副作用分开**。编排逻辑（Workflow）描述「先搜索、再分析、需要审批、再发邮件」；每个外部调用（LLM、工具）是一个 Activity。
- **事件历史即 checkpoint**。引擎把每个 Activity 的调用和结果都记录为事件历史。Worker 崩溃后，另一个 Worker 从头重放 Workflow 代码，遇到已完成的 Activity 时直接返回历史中的结果，不再真正执行，于是程序状态被精确地恢复到崩溃前的位置。
- **因此 Workflow 代码必须是确定性的**。不能直接读当前时间、生成随机数、发网络请求，这些都要通过引擎提供的方式或放进 Activity。这和[第 4 章](#c4)「非确定的值必须记录下来」是同一个原则，只是由框架强制执行。
- **重试、超时、心跳、长时间等待是声明式的**。Activity 的重试策略和超时由配置给出；长时间运行的 Activity 可以上报心跳；Workflow 可以等待一个外部信号（如用户审批）几天，而不占用任何 Worker。

这类引擎解决的是 Run 的编排与恢复，不会自动解决外部副作用的幂等：Activity 在执行成功、但结果未被记录前崩溃，仍然会被重试，所以 `send_email` 这样的 Activity 依然需要幂等键。引入引擎的代价是多运维一套服务、团队要适应确定性编程模型；Run 数量和复杂度上来、自研 Runtime 的边界情况开始频繁出事时，才值得迁移。

### 一次 Worker 崩溃的完整时序
把本章的机制串起来，看研报助手的一个 Run 在 Worker A 崩溃后如何恢复（TTL 60 秒，心跳间隔 15 秒）：

1. **T0**：API 写入 Run（`queued`，attempt=0）并投递消息。
2. **T0+1s**：Worker A 取到消息，执行认领语句：`status='running'`，`lease_owner='A'`，attempt=1，租约到 T0+61s。启动心跳和 Agent 主循环。
3. **T0+1s ~ T0+90s**：A 完成第 1–6 步，每步提交 checkpoint；心跳每 15 秒把租约往后延 60 秒，每次都校验 `attempt=1`。
4. **T0+95s**：A 进入第 7 步，插入 `tool_call`（`pending`，幂等键 `run:7:web_search`），发出搜索请求。
5. **T0+100s**：A 所在机器宕机。最后一次心跳在 T0+91s，租约到 T0+151s。
6. **T0+100s ~ T0+151s**：Run 仍显示 `running`，前端停止收到新进度。这段停顿就是 TTL 的代价。
7. **T0+180s**：清扫任务（每 60 秒一次）发现租约已过期、attempt=1 未超限，重新投递消息。
8. **T0+181s**：Worker B 执行认领语句，条件 `status='running' AND lease_expires_at < now()` 成立：`lease_owner='B'`，attempt=2。
9. **T0+182s**：B 读出第 1–6 步的 step 和 message，重建上下文；发现第 7 步的 `tool_call` 是 `pending`。`web_search` 是只读工具，直接重新执行；如果这一步是 `send_email`，就走对账流程。
10. **T0+183s 起**：B 从第 7 步继续，所有写入带 attempt=2。假如 A 其实只是被暂停、此刻恢复并尝试写第 7 步的结果，它带的是 attempt=1，校验失败，写入被拒绝，A 放弃这个 Run。
11. **完成**：B 以 `WHERE attempt=2 AND status='running'` 把 Run 置为 `succeeded`，释放租约，确认消息。

从宕机到恢复的时间约等于「租约剩余时间 + 清扫间隔」。要缩短它，可以减小 TTL、提高清扫频率，或让空闲 Worker 主动扫描过期租约，而不只依赖清扫任务投递消息。

### 生产环境怎么做
第一版（做业务 Agent 时）可以只做：

- 每步 checkpoint、条件认领、清扫任务按 `updated_at` 回收卡住的 Run（前两章内容）。
- Run 写入带 `attempt` 条件，即使没有心跳，也能挡住大部分僵尸写入。
- SIGTERM 时停止认领、在步与步之间停下、把 Run 改回 `queued` 并重投。

做 Agent Runtime / 平台时再补全：

- 租约 + 独立的心跳协程，TTL 30–120 秒，心跳间隔约 TTL 的 1/3；时间一律用数据库 `now()`。
- 所有对 Run 及其子记录的写入都校验 fencing token（`attempt`），配合 `(run_id, seq)` 唯一约束；Redis 锁最多作为减少竞争的优化。
- 取消以数据库标志为准，心跳顺带读取，Redis Pub/Sub 作为加速。
- 按用户 / 租户的并发配额，按租户的模型调用限流，必要时拆分队列和 Worker 池。
- 接手次数上限，超限置为 `failed` 并告警，防止毒任务拖垮整个集群。
- 监控：租约过期次数、接手（attempt > 1）的 Run 比例、fencing 拒绝的写入次数、从租约过期到被接手的耗时、优雅退出成功率。fencing 拒绝次数不为零，说明确实发生过僵尸写入，要排查 GC 或网络问题。
- 编排复杂度继续上升时，评估 Temporal 等 durable execution 引擎，而不是在自研 Runtime 上不断打补丁。

### 自测
- **租约和普通锁有什么区别？为什么 Agent Runtime 用租约？** 租约有过期时间，持有者死后不需要任何人解锁，到期自动释放；Worker 可能随时消失，不会主动释放普通锁，所以只能靠「不续约即失效」来发现死亡。
- **心跳间隔和租约 TTL 怎么选？** TTL 决定故障后恢复时间的下限，太短容易因抖动误判死亡；心跳间隔取 TTL 的 1/3 到 1/4，容忍一两次心跳失败。心跳要在独立协程里跑，不能按步续租，否则长 LLM 调用会让租约在步内过期。
- **什么是僵尸 Worker？fencing token 怎么解决？** 被判定死亡的 Worker（GC 暂停、网络分区）恢复后继续写入，与接手者同时推进同一个 Run。每次认领让 `attempt` 单调递增，所有写入在同一事务里校验 attempt，旧执行者的写入因 token 过期被数据库拒绝。
- **为什么只用 Redis 分布式锁不够？** 锁过期后旧持有者不知道自己失去了锁，Redis 锁对数据库写入没有约束；检查锁和写数据不在同一系统，没有原子性；主从切换时锁可能丢失。正确性必须靠数据库里的 fencing token。
- **Worker 收到 SIGTERM 应该做什么？** 停止认领新任务，让当前 Run 在步与步之间停下，确认最后一步已 checkpoint，带 attempt 条件把 Run 改回 `queued` 并重投，让别人立刻接手而不必等租约过期。
- **Temporal 这类引擎的核心思路是什么？能替代幂等键吗？** 把每个外部调用作为 Activity 记录到事件历史，崩溃后重放确定性的 Workflow 代码，已完成的 Activity 直接取历史结果。它解决编排和恢复，不能替代幂等键：Activity 执行成功但未记录时仍会被重试。
