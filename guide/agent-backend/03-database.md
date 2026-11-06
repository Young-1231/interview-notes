## 3. 数据库：记住任务执行到了哪 {必学}
> 一句话：把 Run、每个 Step、每次工具调用的状态和结果可靠地落库，让一个可能跑几分钟、随时失败的 Agent 任务能被查询、恢复、审计和计费。

### 在链路中的位置
用户在前端提交「调研 X 公司，整理成报告并发邮件给我」，API 层做的第一件事是往 `agent_run` 插一行 `status='queued'` 的记录并返回 run_id；Worker 从队列或数据库里认领这个 Run，改成 `running`，然后循环执行：调用 LLM（写一条 `agent_step`，type 为 `llm`）、模型决定调工具（写 `agent_step` + `tool_call`）、拿到结果再调 LLM……直到产出报告、发出邮件，最后把 Run 改成 `succeeded`。SSE 推给前端的每个事件、前端刷新后的历史回放、运营后台的成本报表、出问题时的排查，全都以数据库里的这几张表为准。

数据库在这条链路里是唯一的「事实来源」（source of truth）：Redis 里的取消标记、流事件缓冲可以丢，队列里的消息可以重投，但数据库里的 Run 状态和 ToolCall 记录必须准确，否则就会出现「邮件发了两次」「任务明明失败了前端还在转圈」「账单对不上」这类事故。

### 为什么不能只存聊天记录
普通 Chatbot 只存 `message` 表（谁说了什么）就够了，Agent 不够。一次 Run 内部发生了很多用户看不到的事：模型调用了哪些工具、参数是什么、工具返回了什么、哪一步报错、重试了几次、每一步花了多少 token。这些信息分别服务于四个目的：

| 需要持久化的内容 | 存在哪 | 解决什么问题 |
|---|---|---|
| Run 状态、attempt、租约 | `agent_run` | 前端查进度；Worker 崩溃后能被别的 Worker 接管（resume） |
| 每个 Step 的输入输出、耗时 | `agent_step` | 排查「模型为什么这么回答」；从中断的 Step 继续，而不是从头再来 |
| 工具名、参数、结果、幂等键 | `tool_call` | 审计「谁让 Agent 发了这封邮件」；重试时判断 `send_email` 是否已执行过 |
| tokens_in / tokens_out | `agent_step` | 按用户、按模型计费和限额；发现某类任务成本异常 |
| error、失败的 Step | `agent_run` / `agent_step` | 告警、统计失败率、给用户可读的失败原因 |
| 对话消息 | `message` | 多轮上下文、前端展示历史 |

其中最容易被忽略的是 resume：Run 跑到第 7 步时 Worker 被 Kubernetes 驱逐，如果只存了聊天记录，新 Worker 只能从头重跑，`web_search` 再搜一遍还只是浪费钱，`send_email` 再发一遍就是事故。有了逐步落库的 Step 和带幂等键的 ToolCall，新 Worker 可以重建上下文，从第 8 步继续，并且知道邮件已经发过。

<div class="note">易错点：只在 Run 结束时一次性写入所有 Step。这样中途崩溃就什么都没留下。正确做法是每个 Step 开始时写一行 <code>running</code>，结束时更新为终态，让数据库始终反映「执行到了哪」。</div>

### 表结构设计
下面是 PostgreSQL 的 DDL（主键用 UUID，`gen_random_uuid()` 从 PostgreSQL 13 起内置；更早版本需要 `pgcrypto` 扩展）。字段名与全文统一的数据模型一致，标注「扩展列」的是可选的补充字段。
```sql
CREATE TABLE agent_run (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          bigint      NOT NULL,
  status           text        NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','waiting_approval',
                      'succeeded','failed','cancelled')),
  input            jsonb       NOT NULL,          -- 用户请求、所选模型等
  output           jsonb,                         -- 最终报告（或其引用）
  error            jsonb,                         -- {code, message, step_seq}
  attempt          int         NOT NULL DEFAULT 0,
  cancel_requested boolean     NOT NULL DEFAULT false,
  lease_owner      text,                          -- 持有租约的 worker id
  lease_expires_at timestamptz,
  version          int         NOT NULL DEFAULT 0, -- 乐观锁
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);
```

几个设计取舍：

- `status` 用 `text + CHECK` 而不是 PostgreSQL 的 `ENUM` 类型。两者都能限制取值，但给 ENUM 加值要 `ALTER TYPE ... ADD VALUE`，删值则不支持；CHECK 约束改起来更直接。状态机会随业务演进（比如以后加 `paused`），选好改的那种。
- `input` / `output` / `error` 用 `jsonb`。Agent 的输入输出结构经常变化（换模型、加参数），用 JSON 避免频繁改表；`jsonb` 是解析后的二进制格式，支持 GIN 索引和 `->`、`->>`、`@>` 等操作符，比 `json` 类型更适合查询。真正要按它过滤、排序的字段（如 `user_id`、`status`）仍然拆成普通列。
- `updated_at` 的 `DEFAULT now()` 只在插入时生效，更新时要在 SQL 里显式 `SET updated_at = now()`，或者写触发器。PostgreSQL 没有 MySQL 那种 `ON UPDATE CURRENT_TIMESTAMP`。
- 时间一律用 `timestamptz`，按 UTC 存储，避免多时区 Worker 写出混乱的时间。

```sql
CREATE TABLE agent_step (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id      uuid   NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,
  seq         int    NOT NULL,                     -- Run 内从 1 递增
  type        text   NOT NULL CHECK (type IN ('llm','tool')),
  status      text   NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','succeeded','failed','cancelled')),
  input       jsonb,
  output      jsonb,
  tokens_in   int    NOT NULL DEFAULT 0 CHECK (tokens_in  >= 0),
  tokens_out  int    NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (run_id, seq)
);
```

`UNIQUE (run_id, seq)` 有两个作用：一是保证同一个 Run 里不会出现两个第 5 步（两个 Worker 同时接管同一个 Run 时，后写入的那个会因唯一约束冲突而失败，是一道兜底）；二是它本身建了一个 `(run_id, seq)` 的唯一索引，「按顺序取出某个 Run 的所有 Step」直接走这个索引，不用再单独建。Step 状态和 Run 状态是两套：Step 没有 `queued` 和 `waiting_approval`。

```sql
CREATE TABLE tool_call (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id          uuid   NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,
  step_id         bigint NOT NULL REFERENCES agent_step(id) ON DELETE CASCADE,
  tool_name       text   NOT NULL,
  args            jsonb  NOT NULL,
  idempotency_key text   NOT NULL UNIQUE,  -- 如 run_id || ':' || step_seq
  status          text   NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','failed')),
  result          jsonb,
  error           jsonb,
  attempt         int    NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_call_run_idx  ON tool_call (run_id);
CREATE INDEX tool_call_step_idx ON tool_call (step_id);

CREATE TABLE message (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id     uuid   NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,
  role       text   NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  content    jsonb  NOT NULL,   -- 文本或多段内容（含 tool_calls）
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_run_idx ON message (run_id, id);
```

`idempotency_key UNIQUE` 是整张表的核心。它必须由「这次调用在业务上是哪一次」决定，而不是随机生成：同一个 Run 的同一个 Step 无论重试多少次，算出来的 key 都一样。Worker 执行 `send_email` 前先 `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`，插入成功才真正调用；冲突则读出已有记录，`succeeded` 就直接复用 `result`。key 还应透传给下游（很多邮件、支付 API 支持 `Idempotency-Key` 请求头），这样即使「已调用但没来得及写回结果」也不会重复执行。这一机制的完整讨论在工具调用与可靠性相关章节，这里只保证表结构支持它。

PostgreSQL 不会自动给外键列建索引（MySQL InnoDB 会），所以 `tool_call.run_id`、`step_id` 要手动建；否则按 run_id 查工具调用、以及删除 Run 时的级联删除都会全表扫描。

#### MySQL 8.0 的对应写法

| PostgreSQL | MySQL 8.0 | 说明 |
|---|---|---|
| `uuid` + `gen_random_uuid()` | `BINARY(16)` + `UUID_TO_BIN(UUID(), 1)` | `swap_flag=1` 把时间部分前置，减少 InnoDB 聚簇索引页分裂；也可应用层生成 UUIDv7 |
| `jsonb` | `JSON` | MySQL 的 JSON 也是二进制存储，但不能直接建索引，需要生成列或 8.0.17+ 的多值索引 |
| `GENERATED ALWAYS AS IDENTITY` | `BIGINT AUTO_INCREMENT` | |
| `text + CHECK` | `VARCHAR(32) + CHECK` 或 `ENUM` | CHECK 约束从 8.0.16 起才真正生效，之前会被解析但忽略 |
| `timestamptz` | `DATETIME(3)` 存 UTC，或 `TIMESTAMP(3)` | `TIMESTAMP` 有 2038 年上限 |
| 部分索引 `WHERE ...` | 不支持 | 用普通复合索引代替 |
| `ON CONFLICT DO NOTHING` | `INSERT IGNORE` / `ON DUPLICATE KEY UPDATE` | `INSERT IGNORE` 会吞掉其他错误，更推荐后者 |

### 状态机：用 SQL 守住合法流转
Run 的状态流转是：

| 当前状态 | 允许变为 | 触发方 |
|---|---|---|
| `queued` | `running`、`cancelled` | Worker 认领 / 用户取消 |
| `running` | `waiting_approval`、`succeeded`、`failed`、`cancelled` | Worker |
| `waiting_approval` | `running`、`cancelled`、`failed` | 用户审批 / 拒绝 / 超时 |
| `succeeded` / `failed` / `cancelled` | 无（终态） | — |

`waiting_approval` 用在有副作用的工具之前：模型生成了 `send_email` 的参数，先暂停等用户点「确认发送」。Run 在这个状态可以停留很久，期间不占用 Worker。

问题在于：多个参与者会同时想改同一个 Run。Worker 正准备把它改成 `succeeded`，用户恰好点了「停止」；或者旧 Worker 卡顿后醒来，新 Worker 已经接管。如果代码先 `SELECT status`，在应用里判断，再 `UPDATE`，两步之间状态可能已被别人改了（典型的 check-then-act 竞态）。正确做法是把「前置状态」写进 `UPDATE` 的 `WHERE` 条件，让数据库原子地完成检查和修改，再看影响行数：

```python
import json
from sqlalchemy import text

async def finish_run(session, run_id, worker_id, output) -> bool:
    res = await session.execute(text("""
        UPDATE agent_run
           SET status = 'succeeded', output = CAST(:output AS jsonb),
               lease_owner = NULL, lease_expires_at = NULL,
               version = version + 1, updated_at = now()
         WHERE id = :id AND status = 'running' AND lease_owner = :worker
    """), {"id": run_id, "worker": worker_id, "output": json.dumps(output)})
    await session.commit()
    # 0 行：已被取消、已被别的 worker 接管，或已经是终态
    return res.rowcount == 1
```

`rowcount == 0` 不是异常而是一种正常结果，调用方要据此决定下一步：停止执行、丢弃结果、记录日志。WHERE 里带上 `lease_owner` 是为了防止「过期的 Worker」覆盖新 Worker 的结果。用户取消也是同样的写法：

```sql
-- queued 的可以直接取消；running 的只打标记，由 worker 在 step 边界检查后自行收尾
UPDATE agent_run SET status = 'cancelled', updated_at = now()
 WHERE id = $1 AND status IN ('queued', 'waiting_approval');
UPDATE agent_run SET cancel_requested = true, updated_at = now()
 WHERE id = $1 AND status = 'running';
```

对 `running` 的 Run 只设置 `cancel_requested`，而不是直接改成 `cancelled`，因为此时 Worker 可能正在执行工具调用，状态必须由真正执行的那一方在安全点收尾（写完当前 Step、不再发起新调用），否则会出现「Run 已取消，但邮件还是发出去了」而记录对不上的情况。

<div class="tip">实践建议：把所有状态变更收敛到一个 <code>transition(run_id, from_states, to_state, **fields)</code> 函数里，内部统一拼 <code>WHERE status = ANY(:from)</code> 并检查 rowcount。不要让业务代码到处直接写 <code>UPDATE agent_run SET status</code>。</div>

### 索引：从真实查询出发
索引不是按「哪些列重要」来建，而是按「系统里实际跑哪些查询」来建。研报助手这类服务的高频查询基本就是下面四条：

| 查询 | 谁在调 | 索引 |
|---|---|---|
| 某用户的 Run 列表，按时间倒序分页 | 前端「历史任务」页 | `(user_id, created_at DESC)` |
| 取最早的若干个 `queued` Run | Worker 认领任务 | 部分索引 `(created_at) WHERE status='queued'` |
| 找租约过期的 `running` Run | 回收器（reaper）定时扫描 | 部分索引 `(lease_expires_at) WHERE status='running'` |
| 某 Run 的所有 Step，按 seq 排序 | 回放、resume、详情页 | `UNIQUE (run_id, seq)` 已覆盖 |

```sql
CREATE INDEX run_user_time_idx ON agent_run (user_id, created_at DESC);

-- 部分索引（partial index）：只索引满足条件的行
CREATE INDEX run_queued_idx  ON agent_run (created_at)
  WHERE status = 'queued';
CREATE INDEX run_lease_idx   ON agent_run (lease_expires_at)
  WHERE status = 'running';

-- 对应的查询
SELECT id, status, created_at FROM agent_run
 WHERE user_id = $1 AND created_at < $2      -- 游标分页，$2 为上一页最后一条的时间
 ORDER BY created_at DESC LIMIT 20;

SELECT id FROM agent_run
 WHERE status = 'running' AND lease_expires_at < now();
```

#### 复合索引的列顺序
B-tree 复合索引按列的先后排序，只有从最左列开始连续使用才能用上（最左前缀原则）。通用规则是：等值条件的列放前面，范围条件或排序的列放后面。`(user_id, created_at)` 先按 user_id 分组，组内按时间有序，所以「某用户 + 按时间排序 + LIMIT」可以直接从索引里按顺序读 20 条就停，不需要排序。反过来建成 `(created_at, user_id)`，就得扫描大量其他用户的记录。

用户列表分页用游标（keyset）而不是 `OFFSET`：`OFFSET 10000` 需要先扫过并丢弃前一万行，越往后翻越慢；`created_at < 上一页最后时间` 每次都只读一页的量。时间可能重复时，用 `(created_at, id)` 组合作为游标更严谨。

#### 为什么用部分索引
`agent_run` 里绝大多数行是终态，`queued` 和 `running` 只占极少数。对 `status` 建普通索引，选择性差、体积大；部分索引只包含当前处于 `queued` 的那几十行，体积小、常驻内存，Worker 每秒轮询也几乎没有成本。行状态变化后（如 `queued → running`），它会自动从 `run_queued_idx` 里移除。MySQL 不支持部分索引，可用 `(status, created_at)` 复合索引代替，效果接近但索引更大。

<div class="note">易错点：给 <code>input</code>、<code>output</code> 这类大 JSONB 字段随手建 GIN 索引。GIN 索引写入代价高，而 Agent 场景的这些字段几乎只按主键读取，很少按内容检索。真有检索需求（如按 <code>input->>'model'</code> 统计），只给那个表达式建 B-tree 索引即可。</div>

### 事务：哪些写入要放在一起
事务的作用是让一组写入要么全部生效、要么全部不生效。判断标准是：如果只写成功了一半，系统会不会处于自相矛盾的状态。

| 一起提交的写入 | 只成功一半的后果 |
|---|---|
| 结束 Step（写 output、tokens、`succeeded`）+ 更新 Run 的 `updated_at`/续租 | Step 已完成但 Run 看起来卡住，被回收器误判为过期 |
| 工具 Step 完成 + `tool_call` 写入 result + 追加 `role='tool'` 的 message | resume 时上下文缺一条工具结果，模型会重复调用工具 |
| 最后一个 Step 完成 + Run 改为 `succeeded` 并写 output | 前端看到所有步骤都完成，Run 却永远是 `running` |
| 插入 Run + 写入首条 user message | 出现没有输入的空 Run |

反过来，有些写入**必须分开、必须先提交**：调用 `send_email` 之前，`tool_call` 那行 `pending/running` 记录要先单独提交。如果把「插入 tool_call → 调用邮件 API → 写回结果」包在一个事务里，邮件发出后进程崩溃，事务回滚，数据库里就没有任何痕迹表明邮件已发，重试时会再发一次。

#### 不要跨 LLM 调用持有事务
一次 LLM 调用可能要 10–60 秒，工具调用也可能挂起很久。如果在事务里调用它们：

- 连接被独占，连接池很快耗尽，其他请求（包括前端查进度）全部排队；
- 事务中已经 `UPDATE` 过的行持有行锁，用户点「停止」时的 `UPDATE` 会被阻塞到 LLM 返回为止；
- PostgreSQL 中长事务会阻止 VACUUM 清理旧版本行，表和索引膨胀；
- 长时间 idle in transaction 的连接还可能被 `idle_in_transaction_session_timeout` 或中间件掐断。

正确的执行循环是「短事务 — 无事务的外部调用 — 短事务」：

```python
async def run_llm_step(sm, run_id, seq, messages):
    async with sm() as s, s.begin():           # 事务 1：登记 Step
        step_id = await insert_step(s, run_id, seq, "llm", messages)

    resp = await llm.chat(messages)            # 不持有任何连接和事务

    async with sm() as s, s.begin():           # 事务 2：结果 + Run 一起提交
        await finish_step(s, step_id, resp.content,
                          resp.usage.input_tokens, resp.usage.output_tokens)
        ok = await touch_run(s, run_id, WORKER_ID)   # WHERE status='running' AND lease_owner=...
        if not ok:
            raise RunLostError(run_id)         # 已被取消或被接管，事务回滚
    return resp
```

这里 `sm` 是 SQLAlchemy 的 `async_sessionmaker`，`s.begin()` 在块正常结束时提交、异常时回滚。`touch_run` 返回影响行数是否为 1，用来顺带检测取消和租约丢失。

<div class="tip">实践建议：给数据库连接设置 <code>statement_timeout</code> 和 <code>idle_in_transaction_session_timeout</code>（PostgreSQL 参数），作为「有人不小心在事务里调用了 LLM」的兜底。</div>

### 锁：并发写同一行时怎么办
上一节的条件 `UPDATE` 本身就是最常用的并发控制手段。除此之外还有三种工具，各自对应不同场景。

#### 乐观锁：version 字段
乐观锁假设冲突很少，不提前加锁，而是在写入时检查「我读到之后有没有人改过」：

```sql
-- 读出时拿到 version = 7
UPDATE agent_run
   SET input = $2, version = version + 1, updated_at = now()
 WHERE id = $1 AND version = 7;
-- 影响 0 行 = 期间被别人改过，重新读取后重试或报冲突
```

适用于「读出来、在应用里算一会儿、再写回」的场景，比如运营后台编辑 Run 的元数据，或者把整段对话上下文读出、裁剪后写回。它和状态条件 `WHERE status='running'` 是同一个思路，区别是 version 能检测**任何**字段的变化。Spring Data JPA 中给实体字段加 `@Version` 注解，Hibernate 会自动生成这个条件，冲突时抛 `OptimisticLockException`（Spring 包装为 `ObjectOptimisticLockingFailureException`）。

#### 悲观锁：SELECT ... FOR UPDATE
悲观锁在读取时就锁住行，其他事务想修改或同样 `FOR UPDATE` 这一行必须等待，直到持锁事务提交或回滚。适用于需要在锁内做多步判断的短操作，例如审批：读出 `waiting_approval` 的 Run 和待执行的 `tool_call`，校验审批人权限，再一起修改。锁只在事务内有效，所以前面「不跨 LLM 调用持有事务」的原则在这里更重要：持有 `FOR UPDATE` 等待 LLM，等于把这个 Run 锁死几十秒。可以配合 `NOWAIT`（拿不到锁立即报错）或 PostgreSQL 的 `lock_timeout` 避免无限等待。

#### 认领任务：FOR UPDATE SKIP LOCKED
多个 Worker 同时从数据库取 `queued` 的 Run，如果都用普通 `FOR UPDATE` 锁「最早的那一行」，它们会排队等同一行，只有一个能拿到，其余等它提交后才发现该行已不是 `queued`。`SKIP LOCKED` 让查询直接跳过已被其他事务锁住的行，每个 Worker 拿到不同的 Run，互不阻塞。PostgreSQL 9.5+ 和 MySQL 8.0+ 支持。

```sql
-- PostgreSQL：一条语句完成「挑选 + 认领」
UPDATE agent_run
   SET status = 'running', lease_owner = $1,
       lease_expires_at = now() + interval '60 seconds',
       attempt = attempt + 1, version = version + 1, updated_at = now()
 WHERE id = (
   SELECT id FROM agent_run
    WHERE status = 'queued'
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
 )
RETURNING id, input, attempt;
```

MySQL 8.0 不支持 `UPDATE ... RETURNING`，写法是在一个事务里先 `SELECT id ... FOR UPDATE SKIP LOCKED`，再按 id `UPDATE`，然后提交。认领事务要立即提交，之后在事务外执行 Agent 循环；Worker 是否还「拥有」这个 Run 由租约（`lease_owner` + `lease_expires_at`）而不是数据库锁来表达。租约续期、过期回收、fencing 的完整设计在 [第 10 章](#c10)。

用数据库表当队列的好处是 Run 状态和队列天然一致（不会出现「消息发了但 Run 没插进去」）；代价是 Worker 需要轮询，吞吐量有上限。第一版、每秒几十个任务以内，这种方案足够；规模上来再引入 Celery 等消息队列，表仍然是状态的事实来源。

#### 死锁
两个事务各持有一把锁、又都在等对方的锁，就形成死锁。数据库会自动检测并中止其中一个事务：PostgreSQL 报错 SQLSTATE `40P01`（deadlock_detected），MySQL 报错 `1213`（ER_LOCK_DEADLOCK）。Agent 后端常见的成因是不同代码路径以不同顺序锁行，例如审批流程先锁 `agent_run` 再锁 `tool_call`，而 Worker 先更新 `tool_call` 再更新 `agent_run`。应对方式：

- 所有路径按固定顺序加锁（如统一先 Run 后 Step 后 ToolCall）；
- 事务尽量短、尽量少锁行，`SKIP LOCKED` 认领时 `LIMIT` 取小批量；
- 把死锁和序列化失败视为可重试错误，在应用层捕获后整体重试事务（带次数上限）。

### 隔离级别：哪些异常在这里真正有影响
SQL 标准定义了四个隔离级别，以「允许出现哪些异常」来区分。两个主流数据库的默认值不同，这是面试高频点。

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 备注 |
|---|---|---|---|---|
| Read Uncommitted | 可能 | 可能 | 可能 | PostgreSQL 中实际按 Read Committed 执行 |
| Read Committed | 不会 | 可能 | 可能 | **PostgreSQL 默认** |
| Repeatable Read | 不会 | 不会 | 标准允许 | **MySQL InnoDB 默认**；PG 的 RR 基于快照，也不会出现幻读 |
| Serializable | 不会 | 不会 | 不会 | PG 用 SSI 实现，冲突时报 `40001` 需重试 |

几个异常在 Agent 场景下的具体表现：

- 不可重复读：同一个事务里两次读 Run，第一次 `running`，第二次已被用户取消为 `cancelled`。只要遵循「短事务 + 条件 UPDATE」，这通常无害，因为最终写入时 WHERE 会重新检查。
- 丢失更新（lost update）：两个 Worker 都读出 `attempt=2`，各自在应用里加 1 写回 3，实际应该是 4。解决方法是让数据库计算 `SET attempt = attempt + 1`，或者用 version 乐观锁，而不是依赖提高隔离级别。
- 写偏斜（write skew）：「每个用户最多同时运行 3 个 Run」，两个事务各自 `SELECT count(*)` 看到 2，都插入成功，变成 4 个。Read Committed 和 Repeatable Read 都挡不住，需要 Serializable，或者对用户行 `SELECT ... FOR UPDATE` 串行化，或者改用计数器列加 CHECK 约束。

条件 UPDATE 在 Read Committed 下是安全的：PostgreSQL 执行 `UPDATE ... WHERE status='running'` 时，如果目标行正被另一个事务修改，会等待对方提交，然后在最新版本上**重新判断** WHERE 条件；MySQL InnoDB 的 UPDATE 是「当前读」，同样读取最新提交的版本并加锁。所以本章的大部分写法在默认隔离级别下就正确，不需要全局调高隔离级别。

<div class="note">易错点：以为 MySQL 的 Repeatable Read 下「先 SELECT 再 UPDATE」是安全的。普通 SELECT 读的是事务开始时的快照，而 UPDATE 作用于最新版本，二者看到的数据可能不同。需要基于读到的值做决定时，用 <code>SELECT ... FOR UPDATE</code>（加锁的当前读）或把条件写进 UPDATE。</div>

### 大字段与数据保留
Agent 的数据体量比普通业务表大得多：一次 `web_search` 可能返回几十 KB 的网页正文，一个 LLM Step 的 input 是整段上下文（可能超过 100K token），一个 Run 有十几个 Step，每个 Step 都存全量上下文会让 `agent_step` 迅速膨胀。

#### 截断与外置
| 方式 | 做法 | 适用 |
|---|---|---|
| 存增量而非全量 | LLM Step 的 input 只存「本步新增的消息」，完整上下文由 message 表按序重建 | 默认做法 |
| 截断 | 超过阈值（如 64KB）的工具结果截断存储，并记录原始长度、`truncated: true` | 调试用途、不需要完整回放 |
| 对象存储 + 引用 | 完整内容写入 S3/OSS，库里只存 `{"ref": "s3://bucket/run/123/step/5.json", "size": ..., "sha256": ...}` | 报告正文、网页快照、附件 |

PostgreSQL 对超过约 2KB 的值会自动启用 TOAST（压缩并移到行外存储），所以大 JSONB 不至于拖慢只读其他列的查询；但它仍然占用磁盘、备份和复制带宽，`SELECT *` 也会把它整个读出来。列表接口只查需要的列。

注意：截断的是**存储**，不是发给模型的内容。是否把超长工具结果截断后再喂给模型，属于上下文管理的问题，和这里是两个决策。

#### 数据保留
工具结果和 LLM 输入里经常包含用户隐私、内部数据（`query_db` 查到的内容）。需要明确保留策略：例如原始 Step 内容保留 30 天，之后清空 `input`/`output` 只保留 token、耗时、状态等元数据用于计费和统计；审计需要的 `tool_call`（尤其是 `send_email` 这种有副作用的）保留更久。清理用定时任务分批删除（`DELETE ... WHERE id IN (SELECT id ... LIMIT 1000)`），避免一次大事务。数据量很大时，按 `created_at` 做 PostgreSQL 声明式分区（10+），按月 `DROP`/`DETACH` 旧分区，比 DELETE 快得多，也不会产生大量死元组。分区有约束：分区表上的主键和唯一约束必须包含分区键，所以要在建表之初就规划好，后期改造成本较高，第一版不必做。

### PostgreSQL 还是 MySQL
两者都能胜任，选团队最熟、运维最成熟的那个。如果从零开始，Agent 场景下 PostgreSQL 略有优势：

| 维度 | PostgreSQL | MySQL 8.0 |
|---|---|---|
| JSON | `jsonb` 操作符丰富，可直接建 GIN 或表达式索引 | `JSON` 可用，索引要借助生成列/多值索引 |
| 认领任务 | `UPDATE ... RETURNING` 一条语句完成 | 需要 SELECT FOR UPDATE + UPDATE 两步 |
| 部分索引 | 支持 | 不支持 |
| 默认隔离级别 | Read Committed | Repeatable Read |
| 外键索引 | 需手动建 | InnoDB 自动建 |
| 团队经验 | 功能全面，扩展生态丰富 | 国内互联网公司更普及，DBA 经验更多 |

顺带一提：PostgreSQL 有 pgvector 扩展，可以把向量检索和业务数据放在同一个库里，第一版做 RAG 时能少引入一个组件。向量检索的细节不属于本章。

### ORM 与连接池
FastAPI 主线推荐 SQLAlchemy 2.x 的 async 模式：`create_async_engine("postgresql+asyncpg://...")` 配合 `async_sessionmaker`，驱动用 asyncpg。状态流转、认领任务这类关键 SQL 可以直接写 `text()` 或用 Core 的 `update(...).where(...)`，比通过 ORM 对象的「读出—修改属性—flush」更容易控制 WHERE 条件和影响行数。Java 侧对应 Spring Data JPA：`@Version` 做乐观锁、`@Lock(LockModeType.PESSIMISTIC_WRITE)` 生成 `FOR UPDATE`、`@Modifying @Query` 写条件 UPDATE 并返回影响行数，`@Transactional` 方法里同样不要调用 LLM。

连接池的要点：

- 池大小不是越大越好。数据库每个连接都是一个后端进程（PostgreSQL）或线程（MySQL），总连接数 = 实例数 × 每实例池大小，要小于数据库的 `max_connections` 并留余量。SQLAlchemy 的 `pool_size` 默认 5、`max_overflow` 默认 10。
- 设置 `pool_pre_ping=True` 和 `pool_recycle`，处理被网络设备或数据库掐掉的空闲连接。
- Worker 数量多时，在应用和 PostgreSQL 之间加 PgBouncer。用 transaction 模式时要注意 asyncpg 的 prepared statement 缓存会出问题，需按文档关闭（如 `statement_cache_size=0`）。
- 连接只在短事务期间借出，等待 LLM 时必须已经归还——这正是前面「短事务 — 外部调用 — 短事务」结构的另一个收益。Java 侧 HikariCP 同理。

### 生产环境怎么做
第一版就该做：

- 四张表按本章 DDL 建好，`status` 有 CHECK，`tool_call.idempotency_key` 有 UNIQUE，外键列有索引。
- 每个 Step 开始和结束都落库；所有状态变更走条件 UPDATE 并检查影响行数。
- 用 `FOR UPDATE SKIP LOCKED` 认领任务，租约字段与回收器配合，Worker 崩溃后 Run 能被重新认领。
- 有副作用的工具：先提交 `tool_call` 记录，再调用外部 API，再提交结果，三步分开。
- 事务内不调用 LLM 和工具；配置 `statement_timeout`、`idle_in_transaction_session_timeout`。
- 用 Alembic（Java 侧 Flyway/Liquibase）管理表结构变更，不手工改线上库。
- 记录 token 用量，能按用户、按天汇总成本。

规模上来再做：

- 大字段迁到对象存储，库里只留引用；按时间分区与自动归档。
- 读写分离：前端历史列表、统计报表走只读副本（注意复制延迟，刚提交的 Run 状态要从主库读）。
- 任务分发从轮询数据库改为消息队列，数据库仍是状态的事实来源。
- 成本统计改为离线汇总表或导入分析型数据库，避免在线库上跑大聚合。
- 监控：慢查询、连接池使用率、长事务、死锁次数、表膨胀。

### 自测
- **Agent 后端除了聊天记录还要持久化什么，为什么？** Run 状态与租约、每个 Step 的输入输出和 token、每次工具调用的参数结果与幂等键、错误信息；分别用于 resume、调试、审计（尤其是有副作用的工具）和计费。
- **如何保证用户点「停止」和 Worker 写完成状态不会互相覆盖？** 把前置状态写进 WHERE（如 `WHERE id=? AND status='running' AND lease_owner=?`），由数据库原子地判断和修改，再检查影响行数；0 行说明状态已被别人改变，按此处理而不是覆盖。
- **为什么不能在一个事务里完成「调用 LLM 并写入结果」？** LLM 调用耗时几十秒，会长期占用连接和行锁，耗尽连接池、阻塞取消操作，在 PG 中还会阻碍 VACUUM；应拆成短事务、事务外调用、短事务。
- **多个 Worker 如何无冲突地认领 queued 任务？** `SELECT ... FOR UPDATE SKIP LOCKED` 跳过已被锁住的行（PG 9.5+、MySQL 8.0+），在同一短事务里改为 running 并写租约后立即提交。
- **PostgreSQL 和 MySQL 的默认隔离级别分别是什么？条件 UPDATE 在默认级别下安全吗？** PG 是 Read Committed，MySQL InnoDB 是 Repeatable Read；安全，因为 UPDATE 作用于最新提交版本并在等待锁后重新检查 WHERE。真正要防的是先 SELECT 后在应用里判断的竞态和写偏斜。
- **`agent_run` 上「找 queued 任务」应该怎么建索引？** PG 用部分索引 `(created_at) WHERE status='queued'`，只索引极少量活跃行，体积小；MySQL 不支持部分索引，用 `(status, created_at)` 复合索引代替。
