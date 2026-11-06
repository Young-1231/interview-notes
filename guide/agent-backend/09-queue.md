## 9. 消息队列与任务调度：长任务交给 Worker {按需}
> 一句话：一个要跑几分钟、中途可能失败、需要独立扩容的 Agent 任务，不能塞在 HTTP 请求里执行；把它变成「数据库里的一条 Run 记录 + 队列里的一条消息」，交给 Worker 异步执行，任务才能在断线、发版、崩溃之后活下来。

### 在链路中的位置
```text
浏览器 ──POST /runs──► API(FastAPI) ──① 写 agent_run(status=queued)──► PostgreSQL
                          │                                                ▲
                          └─② 投递消息 {run_id} ──► Broker(Redis/RabbitMQ)    │ ④ 每步写 step / 状态
                                                        │                   │
浏览器 ◄──SSE 订阅进度── API ◄── Redis Pub/Sub ◄── ③ Worker 取消息执行 Run ───┘
                                                   Scheduler(Celery beat)：定时清扫卡住的 Run
```

API 只做三件事：校验请求、写一条 `queued` 的 Run、投递一条只带 `run_id` 的消息，然后立刻返回 `run_id`。真正的 Agent 循环在 Worker 里跑，进度通过 SSE 推回前端（推送链路在[第 1 章](#c1)讲）。本章关注中间这段：队列怎么保证任务不丢、重复了怎么办、卡住了谁来管。

在第一版系统里，任务时长在 30 秒以内、并发不高时，可以先在 API 进程里用后台协程跑，但只要出现下面任何一个问题，就该引入队列。

### 为什么长任务不能在 HTTP 请求里跑
| 问题 | 研报助手里的表现 |
|---|---|
| 网关 / 代理超时 | Nginx 的 `proxy_read_timeout` 默认 60 秒，云负载均衡也有空闲超时；3 分钟的任务会在中途被切断，客户端收到 504，后端却可能还在跑 |
| 客户端断开 | 用户关掉页面或手机切网络，请求处理协程被取消或成了无人接收的孤儿；任务的生死和一个 TCP 连接绑在一起 |
| 发版重启丢任务 | 滚动发布时旧 Pod 被终止，正在跑的几十个 Run 全部中断，没有任何地方记录「这些需要重跑」 |
| 无法独立扩容 | API 是 I/O 轻量的短请求，Agent 执行占用连接、内存长达几分钟；混在一起只能一起扩，也无法单独限制 Agent 的并发 |
| 没有重试 | 进程崩溃后任务就没了，用户只能重新提交 |

队列把「接收请求」和「执行任务」拆开：请求只负责登记，执行由独立的 Worker 进程池负责。Worker 可以按队列深度扩缩容，可以被重启，任务会被重新投递给别的 Worker。

### 角色与架构：数据库才是事实来源
#### 三个角色
- **Queue / Broker**：存放待执行消息的中间件，如 Redis、RabbitMQ、Kafka。API 是生产者（producer），Worker 是消费者（consumer）。
- **Worker**：从队列取消息、执行任务、确认完成的进程。Celery 里就是 `celery -A app worker` 启动的进程池。
- **Scheduler**：按时间触发任务的组件，如 Celery beat。它本身不执行任务，只是定时往队列里投消息。

#### 消息只带 run_id
消息体里只放 `run_id`，不放用户输入、对话历史、当前进度。原因：

- **状态只有一份**。Run 的状态、已完成的步骤都在 PostgreSQL 里。消息只是一个「去处理这个 Run」的通知，即使重复投递、延迟到达，Worker 也会先读数据库再决定做什么。
- **队列可以丢、可以重建**。Redis 宕机丢了消息，只要数据库里还有 `queued` 状态的 Run，清扫任务就能重新投递；反过来如果状态只存在消息里，队列一丢就全丢了。
- **消息小**。几十 KB 的对话历史放进 broker，会拖慢投递、占内存，还会在重试时带着过期的状态。

<div class="note">易错点：不要把「消息在队列里」当成「任务是 queued 状态」。查询任务状态、展示列表、统计积压，都以数据库为准；队列只是驱动执行的机制。</div>

### 投递语义：at-least-once 加幂等消费
消息系统对「一条消息会被处理几次」有三种保证：

| 语义 | 含义 | 怎么实现 | 风险 |
|---|---|---|---|
| at-most-once（最多一次） | 可能丢，不会重复 | 取到消息立即确认，再处理 | Worker 处理到一半崩溃，任务丢失 |
| at-least-once（至少一次） | 不会丢，可能重复 | 处理完成后再确认 | 处理完、确认前崩溃，消息被重新投递，任务执行两次 |
| exactly-once（恰好一次） | 不丢不重 | 依赖系统内部的事务机制 | 只在特定范围内成立 |

「exactly-once」需要谨慎理解。Kafka 的事务和幂等生产者可以做到「从 Kafka 读、处理、写回 Kafka」这条链路上的恰好一次，但它管不到外部系统：Worker 调用了邮件服务、然后在提交 offset 前崩溃，消息重新消费时邮件服务不会因为 Kafka 的事务而撤销。只要处理过程中有外部副作用，端到端的恰好一次就无法由消息系统单独保证。

所以实际的选择几乎总是：**at-least-once 投递 + 幂等的消费者**。不丢消息由队列的确认机制保证，不重复执行由消费者自己保证：检查 Run 的状态、靠 checkpoint 跳过已完成步骤、靠 `tool_call.idempotency_key` 防止副作用重复（[第 4 章](#c4)）。对 Agent 任务来说，丢任务是不可接受的（用户在等结果），而重复投递是可以在消费端消化的。

### ACK：什么时候确认消息
确认（acknowledge，ACK）是消费者告诉 broker「这条消息处理完了，可以删掉」。确认的时机决定了投递语义。

#### Celery
Celery 默认在任务**开始执行前**确认消息（early ack），这是 at-most-once：Worker 在执行中被 kill，消息已经被确认，任务就丢了。对 Agent 任务应改为执行完成后确认：

```python
from celery import Celery

app = Celery("agent", broker="redis://redis:6379/0")
app.conf.update(
    task_acks_late=True,               # 任务执行完才 ack
    task_reject_on_worker_lost=True,   # 执行任务的子进程被意外杀死(如 OOM)时，消息重新入队
    worker_prefetch_multiplier=1,      # 长任务不要预取多条，避免一个 Worker 囤积任务
)

@app.task(bind=True, acks_late=True)
def execute_run(self, run_id: str):
    # 先读数据库判断状态，再从 checkpoint 继续执行（见下文「幂等消费」）
    ...
```

`task_acks_late=True` 单独开启时，如果执行任务的子进程被 SIGKILL 或 OOM 杀掉，Celery 默认仍然会确认这条消息（为了避免一个让进程崩溃的任务被无限重投）；同时设置 `task_reject_on_worker_lost=True` 才会让消息重新入队。代价就是这类「毒消息」可能反复把 Worker 搞崩，所以要配合下面的最大尝试次数（`agent_run.attempt`）一起用。

#### RabbitMQ
RabbitMQ 原生支持手动确认：消费者处理完调用 `basic_ack`；处理失败调用 `basic_nack` / `basic_reject`，可以选择重新入队或丢弃（配置了死信交换机时进入死信队列）。消费者连接断开时，未确认的消息会自动重新投递给其他消费者。

`prefetch_count`（通过 `basic_qos` 设置）限制一个消费者同时持有的未确认消息数。Agent 任务一条要跑几分钟，应设成 1 或很小的值，否则一个 Worker 会预先领走多条消息，自己慢慢跑，其他空闲 Worker 却拿不到任务。另外，RabbitMQ 较新的版本对未确认的投递有超时（`consumer_timeout`，默认 30 分钟），超过会关闭该消费者的 channel 并重新投递消息；任务可能超过这个时长时要调整配置。

#### Kafka
Kafka 没有「逐条确认」，而是提交 offset：表示「这个分区到这个位置之前的消息都处理完了」。要实现 at-least-once，需关闭自动提交（`enable.auto.commit=false`），处理完成后再提交 offset。Kafka 不太适合直接承载几分钟级的 Agent 任务：同一分区内的消息顺序消费，一条慢消息会挡住后面的消息；两次 poll 之间超过 `max.poll.interval.ms`（默认 5 分钟），消费者会被判定失效并触发 rebalance。Kafka 更适合做事件流（Run 状态变更事件、审计日志、计费流水），而不是任务队列。

### 重试与死信队列
消费失败有两种：暂时性失败（模型服务 503、数据库连接被打满），值得过一会儿再试；永久性失败（Run 的输入非法、代码 bug 导致每次都抛同样的异常），重试多少次都一样。后者如果一直重新入队，就成了反复占用 Worker 的毒消息。处理原则：**有限次延迟重试，超过上限转入死信队列（dead-letter queue，DLQ）**，由人或单独的程序检查。

#### Celery 的任务重试
```python
from celery.exceptions import MaxRetriesExceededError

@app.task(bind=True, acks_late=True, max_retries=3)
def execute_run(self, run_id: str):
    try:
        run_agent(run_id)
    except TransientInfraError as exc:              # 只对基础设施层的暂时错误整体重试
        try:
            # countdown：多少秒后重新执行；这里用指数退避
            raise self.retry(exc=exc, countdown=30 * 2 ** self.request.retries)
        except MaxRetriesExceededError:
            mark_run_failed(run_id, reason="infra retries exhausted")
```

`self.retry()` 会重新发布一条同名任务消息并抛出 `Retry` 异常结束本次执行；超过 `max_retries` 时抛出原异常（传了 `exc` 的情况下）或 `MaxRetriesExceededError`。Celery 也支持声明式写法：`autoretry_for=(TransientInfraError,)`、`retry_backoff=True`、`retry_jitter=True`。

注意任务级重试和[第 4 章](#c4)的调用级重试不要叠加：单次 LLM 调用的 429 在调用内部退避重试；任务级重试只用来兜底「整个执行环境出了问题」。而且任务重试后的执行必须从 checkpoint 继续，而不是从第 1 步重来。

#### RabbitMQ 的死信交换机
在队列上声明参数 `x-dead-letter-exchange`（可选 `x-dead-letter-routing-key`），当消息被 `basic_reject` / `basic_nack` 且 `requeue=false`、消息 TTL 过期、或队列超出长度限制时，RabbitMQ 会把它转发到这个死信交换机，再路由到死信队列。常见的延迟重试做法也借助它：失败的消息先发到一个设置了 `x-message-ttl` 的等待队列，TTL 到期后死信回原队列，实现「过 N 秒再试」。

无论用哪种实现，进入死信的同时都要**更新数据库**：把 Run 置为 `failed` 并写明 `error`，否则前端看到的永远是 `running`。死信队列面向运维排查，Run 的状态面向用户，两者都要处理。

### Celery + Redis broker 的 visibility_timeout
用 Redis 作 broker 时，Redis 本身没有 RabbitMQ 那样的连接级确认机制，Celery 用 `visibility_timeout` 模拟：消息被 Worker 取走后，如果在这个时间内没有被确认，就认为 Worker 已经挂了，**把消息重新投递给其他 Worker**。默认值是 1 小时。

这个机制和 `acks_late=True` 结合，对长任务有两个坑：

- **任务执行超过 visibility_timeout 会被重复执行**。一个 Run 跑了 70 分钟还没结束（例如在等外部系统），消息会被重新投递，另一个 Worker 开始执行同一个 Run，两个 Worker 同时推进同一个任务。
- **ETA / countdown 任务也受影响**。`countdown` 超过 visibility_timeout 的延迟任务，同样可能被重复投递。

```python
app.conf.broker_transport_options = {
    "visibility_timeout": 2 * 3600,   # 秒；要大于最长任务时长 + 最长延迟重试间隔
}
```

调大 visibility_timeout 能缓解，但代价是 Worker 真的崩溃时，消息要等更久才会被重新投递。根本的解决方法不在 broker 配置里，而在消费端：限制单个 Run 的最长时长（[第 4 章](#c4)的 Run 级超时），并让 Worker 在执行前「认领」这个 Run，第二个 Worker 发现已经有人在跑就直接退出。最简单的认领是下一节的状态条件更新，更完整的做法是 [第 10 章](#c10)的租约（lease）和心跳。

<div class="note">易错点：<code>waiting_approval</code> 状态的 Run 不应该占着一条未确认的消息等人审批。进入等待状态时，Worker 应该正常结束任务、确认消息；用户审批后由 API 重新投递一条新消息。</div>

### 幂等消费：先查状态，再干活
at-least-once 意味着同一个 `run_id` 的消息可能被投递多次：网络抖动后生产者重发、visibility_timeout 到期重投、Worker 崩溃后重投、清扫任务补投。消费者拿到消息的第一件事，是用一条原子的条件更新「认领」这个 Run：

```python
def claim_run(conn, run_id: str) -> bool:
    """只有 queued 状态才能转为 running；返回 False 说明已被别人认领或已结束"""
    row = conn.execute(
        """UPDATE agent_run
              SET status = 'running', attempt = attempt + 1,
                  version = version + 1, updated_at = now()
            WHERE id = %s AND status = 'queued' AND cancel_requested = false
        RETURNING attempt""",
        (run_id,)).fetchone()
    return row is not None

@app.task(bind=True, acks_late=True)
def execute_run(self, run_id: str):
    with db.connect() as conn:
        if not claim_run(conn, run_id):
            return                      # 重复消息：直接确认并退出，什么都不做
        conn.commit()
    run_agent_from_checkpoint(run_id)   # 已完成的步骤重放，副作用靠幂等键去重
```

`WHERE status = 'queued'` 让两个同时到达的重复消息只有一个能更新成功，另一个影响行数为 0，直接退出。这里没有「先 SELECT 再 UPDATE」的竞态，因为判断和修改在一条语句里完成。

这个写法有一个缺口：Worker 认领后崩溃，Run 停在 `running`，重新投递的消息因为状态不是 `queued` 而被跳过，Run 永远卡住。解决方法有两种：一是由清扫任务把长时间没有进展的 `running` 改回 `queued` 并重新投递（见下文）；二是使用 [第 10 章](#c10)的租约，认领条件变成「`queued`，或 `running` 但租约已过期」。第一版用前者就够了。

### 选型：Celery、RabbitMQ、Kafka 与 Postgres 队列
这几个名字不在同一个层次：Celery 是 Python 的任务框架，底下需要一个 broker（Redis 或 RabbitMQ）；RabbitMQ 和 Kafka 是消息中间件；Postgres 队列是直接用业务数据库的表当队列。

| 方案 | 适合场景 | 优点 | 需要注意 |
|---|---|---|---|
| Celery + Redis | Python 团队起步，已有 Redis | 部署最简单，生态成熟（重试、定时、监控 Flower） | 靠 visibility_timeout 模拟确认，长任务会被重投；Redis 持久化配置不当会丢消息 |
| Celery + RabbitMQ | 对不丢消息要求高 | 真正的连接级 ack、死信交换机、优先级队列 | 多运维一个组件；注意 `consumer_timeout` |
| Kafka | 事件流、高吞吐、需要回放 | 消息持久保存、可按 offset 重放、多个消费组独立消费 | 不适合几分钟的单条任务：分区内顺序消费，慢消息阻塞后续；没有原生的逐条重试和延迟 |
| Postgres 队列（`SKIP LOCKED`） | 量不大的小系统，想少一个组件 | 入队和写业务数据在同一个事务里，天然一致；无需额外中间件 | 轮询给数据库带来压力；吞吐有上限；要自己实现重试和清理 |

#### Postgres 当队列
`agent_run` 表本身就可以是队列：Worker 用 `FOR UPDATE SKIP LOCKED` 领取一个 `queued` 的 Run，被别的事务锁住的行直接跳过，多个 Worker 并发领取也不会拿到同一行。`SKIP LOCKED` 需要 PostgreSQL 9.5+ 或 MySQL 8.0+。

```sql
UPDATE agent_run SET status = 'running', attempt = attempt + 1, updated_at = now()
 WHERE id = (
   SELECT id FROM agent_run
    WHERE status = 'queued'
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
 )
RETURNING id;
```

需要 `(status, created_at)` 上的索引，Worker 空闲时按间隔轮询（或配合 PostgreSQL 的 `LISTEN/NOTIFY` 减少空轮询）。每天几千到几万个 Run 的系统，这个方案完全够用，而且省掉了「写数据库和投递消息不一致」的整类问题。

<div class="tip">实践建议：第一版在「Celery + Redis」和「Postgres SKIP LOCKED」之间选一个即可。已经在用 Celery 的团队选前者，但要配置 <code>acks_late</code> 和 visibility_timeout；想要最少组件、最强一致性的选后者。Kafka 留给事件流，不要拿它做 Agent 任务队列。</div>

### 任务状态机：谁推动每一次转换
Run 状态：`queued → running → (waiting_approval) → succeeded | failed | cancelled`。每个转换都要明确由谁发起、用什么条件保护，否则会出现「两个组件同时改状态」的冲突。

| 转换 | 谁发起 | 触发条件 | 保护条件（UPDATE 的 WHERE） |
|---|---|---|---|
| （无）→ `queued` | API | 用户提交任务 | INSERT，同一事务写 outbox |
| `queued` → `running` | Worker | 领取消息并认领成功 | `status = 'queued'` |
| `running` → `waiting_approval` | Worker | 遇到需要审批的工具调用，或副作用结果未知 | `status = 'running'` |
| `waiting_approval` → `queued` | API | 用户批准或拒绝 | `status = 'waiting_approval'`，然后重新投递 |
| `running` → `succeeded` / `failed` | Worker | 模型给出最终答案 / 不可恢复错误或超出限额 | `status = 'running'` |
| `queued` / `waiting_approval` → `cancelled` | API | 用户点停止，任务尚未执行 | `status IN ('queued','waiting_approval')` |
| `running` → `cancelled` | Worker | 每步开始前发现 `cancel_requested = true` | `status = 'running'` |
| `running` → `queued` | Scheduler（清扫任务） | 长时间无进展，判定 Worker 已死 | `status = 'running' AND updated_at < now() - 阈值` |
| `waiting_approval` → `cancelled` | Scheduler | 审批超时 | `status = 'waiting_approval'` 且超时 |

几个设计要点：

- **用户「停止」正在运行的 Run，API 不直接改 status**，只设置 `cancel_requested = true`。真正执行的 Worker 在每步开始前检查这个标志，自己把状态改为 `cancelled`。如果 API 直接改成 `cancelled`，Worker 可能还在执行下一步，并在稍后把状态写回 `succeeded`。
- **终态不可逆**。`succeeded`、`failed`、`cancelled` 之后不允许任何转换，所有更新都带状态条件，迟到的重复消息自然什么都改不了。
- **每次转换都校验影响行数**。返回 0 行说明状态已被别人改过，当前操作应该放弃，而不是报错重试。

### 定时任务：Celery beat 清扫卡住的 Run
有些工作不是由用户请求触发的，而是需要定期执行：清扫卡住的 Run、补投丢失的消息、清理过期审批、汇总每日 token 用量。Celery beat 是 Celery 自带的调度进程，按配置定时投递任务。

```python
from celery.schedules import crontab

app.conf.beat_schedule = {
    "sweep-stuck-runs": {"task": "tasks.sweep_stuck_runs", "schedule": 60.0},  # 每 60 秒
    "expire-approvals": {"task": "tasks.expire_approvals", "schedule": crontab(minute="*/10")},
}

@app.task
def sweep_stuck_runs():
    with db.connect() as conn:
        rows = conn.execute(
            """UPDATE agent_run SET status = 'queued', version = version + 1, updated_at = now()
                WHERE status = 'running' AND updated_at < now() - interval '10 minutes'
                  AND attempt < 3
            RETURNING id""").fetchall()
        conn.execute("""UPDATE agent_run SET status = 'failed', error = 'stuck too many times'
                         WHERE status = 'running' AND updated_at < now() - interval '10 minutes'
                           AND attempt >= 3""")
        conn.commit()
    for (run_id,) in rows:
        execute_run.delay(str(run_id))
    # 另外：status='queued' 且很久没被领取的 Run 也重新投递，弥补丢失的消息
```

这个清扫任务依赖 Worker 每完成一步就更新 `updated_at`。阈值要大于最长单步耗时（一次慢 LLM 调用可能要 2 分钟），否则会把正常运行的 Run 误判为卡住，导致两个 Worker 同时执行。按 `updated_at` 判断存活是粗粒度的做法，[第 10 章](#c10)用心跳和租约给出更精确的版本。

beat 进程**只能运行一个实例**。部署多个 beat 会让每个定时任务被重复投递；虽然清扫任务本身是幂等的，但多余的投递会造成负载和混乱。容器部署时要单独给 beat 一个副本数为 1 的服务，不要和 Worker 合在一起随 Worker 扩容。

### Transactional outbox：写数据库和投递消息的一致性
API 创建 Run 要做两件事：INSERT `agent_run`、向 broker 投递消息。这两件事不在同一个事务里，任何一种顺序都有失败窗口：

- **先提交数据库，再投递**：提交成功后进程崩溃或 broker 不可用，Run 永远停在 `queued`，没有消息去驱动它。
- **先投递，再提交**：Worker 可能在数据库提交前就拿到消息，查不到这个 Run；或者投递成功后事务回滚，消息指向一个不存在的 Run。

Transactional outbox（事务性发件箱）的做法是：**在同一个数据库事务里，同时写业务数据和一条「待发送消息」记录**；再由一个独立的转发进程（relay）读取 outbox 表，投递到 broker，投递成功后标记为已发送。

```sql
BEGIN;
INSERT INTO agent_run (id, user_id, status, input, attempt, version)
VALUES ($1, $2, 'queued', $3, 0, 0);
INSERT INTO outbox (id, topic, payload, created_at)
VALUES (gen_random_uuid(), 'execute_run', jsonb_build_object('run_id', $1), now());
COMMIT;

-- relay 进程循环执行：领取一批未发送的记录，投递成功后标记
SELECT id, topic, payload FROM outbox
 WHERE sent_at IS NULL ORDER BY created_at LIMIT 100
 FOR UPDATE SKIP LOCKED;
-- ... 投递到 broker ...
UPDATE outbox SET sent_at = now() WHERE id = ANY($1);
```

`gen_random_uuid()` 在 PostgreSQL 13+ 内置。relay 在「投递成功」和「标记已发送」之间崩溃，同一条消息会被再投一次，所以 outbox 本身也是 at-least-once，消费端的幂等认领依然必要。更大规模的系统会用 CDC（如 Debezium 读取数据库日志）代替轮询 relay。

对研报助手的第一版，有一个更简单的等价方案：不单独建 outbox 表，把 `agent_run` 本身当作 outbox。API 只写 `queued` 的 Run 并尽力投递一次，投递失败也没关系，清扫任务会把「`queued` 且超过一分钟没被领取」的 Run 重新投递。如果直接用 Postgres SKIP LOCKED 作队列，这个问题则根本不存在。

### Java 对照
| 能力 | Python 主线 | Spring 对应 |
|---|---|---|
| 任务队列 / Worker | Celery `@app.task` | Spring AMQP 的 `@RabbitListener`，Spring for Apache Kafka 的 `@KafkaListener` |
| 手动确认 | `acks_late=True` | RabbitMQ：`AcknowledgeMode.MANUAL` + `Channel.basicAck`；Kafka：`AckMode.MANUAL` + `Acknowledgment.acknowledge()` |
| 预取 | `worker_prefetch_multiplier=1` | `spring.rabbitmq.listener.simple.prefetch=1` |
| 重试 / 死信 | `self.retry(countdown=...)`、DLX | Spring Retry 拦截器、`RepublishMessageRecoverer`；Kafka 的 `DefaultErrorHandler` + `DeadLetterPublishingRecoverer` |
| 定时任务 | Celery beat | `@Scheduled`；多实例部署时用 ShedLock 等保证只有一个实例执行 |
| Outbox | 同一事务写 outbox 表 | `@Transactional` 中写 outbox 表，relay 或 Debezium 转发 |

### 生产环境怎么做
第一版就该做：

- **API 只登记，Worker 执行**。`POST /runs` 写一条 `queued` 的 Run，投递只含 `run_id` 的消息，立即返回；状态以数据库为准。
- **at-least-once + 幂等消费**。Celery 开启 `task_acks_late` 和 `task_reject_on_worker_lost`，`worker_prefetch_multiplier=1`；Worker 用 `WHERE status='queued'` 的条件更新认领 Run，认领失败直接退出。
- **用 Redis 作 broker 时设好 visibility_timeout**，大于 Run 级超时；Run 级超时必须存在。
- **有限重试 + 失败落库**。任务级重试最多几次，超过就把 Run 置为 `failed` 并写明原因。
- **一个 beat 实例跑清扫任务**：卡住的 `running` 改回 `queued` 并重投，`attempt` 超限置为 `failed`；长期没被领取的 `queued` 重投；审批超时取消。
- **Worker 单独部署**，和 API 分开扩缩容；限制单个 Worker 的并发数，防止一台机器同时跑太多 Run。

规模上来再做：

- 切换到 RabbitMQ，用死信队列和延迟重试；按优先级或租户拆分队列，防止某个大客户的任务挤占所有 Worker。
- Transactional outbox 或 CDC，保证写库与投递严格一致。
- 用租约和心跳取代基于 `updated_at` 的粗粒度存活判断（[第 10 章](#c10)）。
- 监控：队列深度、任务等待时长（从 `queued` 到 `running`）、执行时长分布、重试与死信数量、清扫任务每次回收的 Run 数。回收数持续不为零说明 Worker 在频繁崩溃。

### 自测
- **为什么 Agent 任务不能直接在 HTTP 请求里跑？** 网关和代理有读超时，客户端会断开，发版重启会丢掉进行中的任务，API 和执行无法独立扩容，崩溃后也没有重试；队列把登记和执行解耦。
- **为什么选 at-least-once 而不是 exactly-once？** 消息系统的 exactly-once 只覆盖它自己的读写链路，管不到邮件服务等外部副作用；at-least-once 保证不丢，重复由幂等消费者（状态条件认领、checkpoint、幂等键）消化。
- **Celery 的 `acks_late=True` 解决什么？还需要配合什么？** 默认在执行前确认，Worker 崩溃会丢任务；`acks_late` 改为执行完再确认。子进程被杀时还要 `task_reject_on_worker_lost=True` 才会重新入队，并设 `worker_prefetch_multiplier=1`。
- **Celery 用 Redis 作 broker，长任务为什么可能被执行两次？** Redis broker 用 `visibility_timeout`（默认 1 小时）模拟确认，任务执行超过它还没 ack 就会被重投给另一个 Worker；要调大超时、限制 Run 时长，并在消费端认领去重。
- **Transactional outbox 解决什么问题？** 写数据库和投递消息无法放进同一个事务，任一顺序都可能「写了没发」或「发了没写」；把待发消息和业务数据在同一事务写入 outbox 表，再由 relay 转发，保证至少发一次。
- **用户点「停止」时，API 为什么不直接把 status 改成 cancelled？** 正在执行的 Worker 不知道，可能继续执行并把状态覆盖为 `succeeded`；应设置 `cancel_requested`，由 Worker 在步与步之间检查并自己转为 `cancelled`。
