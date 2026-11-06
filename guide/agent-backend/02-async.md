## 2. 异步与并发：同时调多个工具 {必学}
> 一句话：Agent 后端的时间几乎都花在等 LLM 和工具返回上，用 asyncio 让一个进程同时等很多件事，并且能对这些并发调用统一限流、超时和取消。

### 在链路中的位置
异步与并发出现在两个地方：

- **Web 层**（[第 1 章](#c1)）：一个 FastAPI 进程同时维持成百上千个 SSE 连接、处理状态查询，每个连接绝大多数时间在等待新事件。
- **Worker 执行层**：执行一个 Run 时，LLM 一次返回多个工具调用（例如同时 `web_search("X 公司 财报")`、`web_search("X 公司 新闻")`、`query_db(...)`），它们彼此独立，可以并发执行；同时 Worker 还要监听「用户点了停止」。

本章讲进程内的并发模型和写法；任务如何在多个 Worker 进程之间分发，见[第 9 章](#c9)。

### 为什么 Agent 后端是 IO 密集型
拆开一次研报 Run 的耗时：LLM 调用每次几秒到几十秒，`web_search` 几百毫秒到几秒，`query_db` 几十毫秒，`send_email` 几百毫秒。这些时间里本进程的 CPU 基本空闲，只是在等网络对端返回字节。真正消耗 CPU 的部分——JSON 解析、拼 prompt、计算 token 数——通常只占毫秒级。

这类负载叫 **IO 密集型**（IO-bound）。优化方向不是「算得更快」，而是「等的时候别闲着」：一个请求在等 LLM 时，同一个进程应该去处理别的请求、推别的事件、发起别的工具调用。三个工具串行要 2 + 3 + 0.1 秒，并发只要约 3 秒，总耗时取决于最慢的那个。

例外是少数 CPU 密集的环节：本地 embedding 推理、PDF 解析、大文本分词、图表渲染。它们需要单独处理（见下文「阻塞调用与 CPU 密集任务」）。

### 进程、线程、协程
| 维度 | 进程 | 线程 | 协程（asyncio） |
|---|---|---|---|
| 调度者 | 操作系统 | 操作系统（抢占式） | 事件循环（协作式，在 `await` 处让出） |
| 内存 | 独立地址空间，开销最大 | 共享进程内存，每个线程有自己的栈 | 只是一个对象，开销极小 |
| 切换成本 | 高 | 中（内核上下文切换） | 低（用户态函数切换） |
| 数量级 | 几个到几十个 | 几十到几千 | 数万 |
| Python 中能否并行用多核 | 能 | 标准构建下受 GIL 限制，纯 Python 代码不能 | 不能，单线程 |
| 数据竞争 | 不共享内存，需要 IPC | 需要锁 | 两个 `await` 之间的代码不会被打断，竞争少得多 |
| Agent 中的用途 | Uvicorn / Celery 多 worker 进程、CPU 密集任务 | 包装不支持 async 的阻塞库 | 并发 LLM / 工具调用、大量 SSE 连接 |

典型组合是「多进程 × 每进程一个事件循环」：用多个进程吃满多核，每个进程内用协程处理大量并发 IO。

### GIL 意味着什么
CPython（标准 Python 解释器）的标准构建里有一把全局解释器锁（GIL）：同一时刻只有一个线程在执行 Python 字节码。它对 Agent 后端的影响要分开看：

- **对 IO 密集负载影响很小**。线程在阻塞等待网络、文件、`time.sleep` 时会释放 GIL，其他线程可以继续运行。所以「多线程并发调 HTTP」在 Python 里是有效的，只是线程比协程更重、数量有限。
- **对 CPU 密集负载是硬限制**。纯 Python 的计算在多线程下不会变快，要用多进程。NumPy 等 C 扩展在内部运算时可能释放 GIL，是否并行取决于具体库。
- **GIL 不等于线程安全**。GIL 保证的是解释器内部结构不被破坏，而 `counter += 1` 这类「读-改-写」仍可能在线程切换时交错，共享状态依然要加锁。

Python 3.13 引入了可选的 free-threaded 构建（PEP 703，可执行文件通常叫 `python3.13t`），去掉了 GIL，在 3.13 中标记为实验性。它不是默认构建，部分 C 扩展还需要适配。对 Agent 后端来说，主流方案仍然是「asyncio 处理 IO + 多进程利用多核」，不必依赖它。

### 事件循环模型
asyncio 的核心是一个**单线程的事件循环**：

1. 循环维护一组「就绪」的任务，依次运行每个任务，直到它遇到 `await` 一个尚未完成的操作（例如等待 socket 可读）。
2. 任务在这里挂起，把控制权交回循环；循环通过操作系统的 IO 多路复用（Linux 上是 epoll，macOS 上是 kqueue，见[第 11 章](#c11)）登记「这个 socket 有数据时通知我」。
3. 循环继续运行其他就绪任务；没有就绪任务时阻塞在多路复用调用上等待。
4. 某个 socket 有数据了，对应的任务重新变为就绪，从挂起处继续执行。

由此得出 asyncio 最重要的一条规则：**协程只在 `await` 处让出控制权**。如果一段代码不 `await` 而是长时间运行——调用同步的 `requests.get`、`time.sleep(5)`、同步数据库驱动、一个跑 2 秒的 CPU 计算——整个事件循环都被卡住，该进程里所有 SSE 连接停止推送、所有请求停止响应。这是 async 服务里最常见、也最隐蔽的性能问题。

### async/await 基础
- `async def` 定义协程函数，调用它只会得到一个协程对象，**不会执行**；必须 `await` 它或把它包装成 Task。
- `await` 只能出现在 `async def` 内部，表示「在这里等结果，等的时候让循环去做别的事」。
- `asyncio.create_task(coro)` 把协程包装成 Task 并立即排入调度，实现「先发起、后等待」。要保存 Task 的引用：事件循环对 Task 只持有弱引用，没有引用的 Task 可能在完成前被垃圾回收。
- `asyncio.run(main())` 是程序入口，创建事件循环并运行到结束；在 FastAPI 中由 Uvicorn 负责，不需要自己调用。

```python
async def run_step(tool_calls):
    # 错误写法：串行，总耗时 = 各工具耗时之和
    results = [await execute_tool(tc) for tc in tool_calls]

    # 正确写法：同时发起，总耗时 ≈ 最慢的一个
    results = await asyncio.gather(*(execute_tool(tc) for tc in tool_calls))
    return results
```

### 并发执行工具：gather 与 TaskGroup
#### asyncio.gather
`asyncio.gather(*aws, return_exceptions=False)` 并发运行多个 awaitable，按传入顺序返回结果列表。错误语义要记清：

- 默认 `return_exceptions=False`：第一个抛出的异常会立刻传给 `await gather(...)` 的调用方，但**其他任务不会被取消**，仍在后台继续跑。对研报助手来说，这意味着一个 `web_search` 失败后，另一个可能仍在消耗配额，结果却没人接收。
- `return_exceptions=True`：异常作为结果放进列表，所有任务都跑完。适合「部分失败可以接受」的场景：把成功的搜索结果和失败信息一起交给 LLM，让它决定下一步。
- 如果 `gather` 本身被取消，它会取消所有尚未完成的子任务。

#### asyncio.TaskGroup（Python 3.11+）
`TaskGroup` 是结构化并发的写法：任务的生命周期被限定在 `async with` 块内，块结束时保证所有任务都已结束。

- 任一任务抛出异常（`CancelledError` 除外），组内**其余任务会被取消**；
- 等所有任务结束后，异常被包装成 `ExceptionGroup` 抛出（可能包含多个），用 `except*`（同为 3.11 新增）按类型处理；
- 不会出现「失败后还有孤儿任务在后台跑」的情况。

```python
async def run_tools_strict(tool_calls):
    try:
        async with asyncio.TaskGroup() as tg:
            tasks = [tg.create_task(execute_tool(tc)) for tc in tool_calls]
    except* ToolTimeout as eg:
        raise StepFailed(f"{len(eg.exceptions)} tool(s) timed out")
    return [t.result() for t in tasks]

async def run_tools_tolerant(tool_calls):
    results = await asyncio.gather(*(execute_tool(tc) for tc in tool_calls),
                                   return_exceptions=True)
    return [{"ok": not isinstance(r, Exception),
             "value": r if not isinstance(r, Exception) else repr(r)}
            for r in results]
```

| 需求 | 选择 |
|---|---|
| 所有工具都必须成功，否则这一步失败 | `TaskGroup` |
| 允许部分失败，把错误回传给 LLM | `gather(..., return_exceptions=True)`，或在每个任务内部 `try/except` 后放进 `TaskGroup` |
| 谁先完成先处理（例如流式展示搜索结果） | `asyncio.as_completed` |
| Python 3.10 及以下 | 只能用 `gather` / `wait`，失败时自己取消其余任务 |

<div class="note">易错点：Agent 里一般更希望「一个工具失败不连坐其他工具」，因为工具错误本身就是要交给模型的信息。做法是让 <code>execute_tool</code> 内部捕获业务异常并返回结构化的错误结果，只把真正不可恢复的错误（例如 Run 被取消）向上抛。这样 <code>TaskGroup</code> 的取消语义只用于取消与致命错误。</div>

### 用 Semaphore 限制并发
并发不是越多越好。LLM 一次可能返回十几个工具调用，十几个 Run 同时在跑，就会对搜索 API 和 LLM 提供商同时发起上百个请求，很快触发 `429`；`query_db` 并发过高会耗尽数据库连接池。`asyncio.Semaphore(n)` 限制同时进入临界区的协程数：

```python
SEARCH_SEM = asyncio.Semaphore(5)    # 本进程内同时最多 5 个 web_search
LLM_SEM = asyncio.Semaphore(20)      # 本进程内同时最多 20 个 LLM 请求

async def web_search(query: str):
    async with SEARCH_SEM:            # 超出上限的协程在这里排队等待
        resp = await http.get(SEARCH_URL, params={"q": query})
        resp.raise_for_status()
        return resp.json()
```

- 信号量要在模块级或应用级创建并共享，在每次调用时新建一个等于没限。
- 按下游资源分别设置（每个工具、每个模型提供商各一个），而不是全局一个。
- `Semaphore` 只在**单进程**内有效。多个 Worker 进程共享上游配额时，需要基于 Redis 的分布式限流（见[第 8 章](#c8)）；进程内信号量仍然有用，用来防止单个进程瞬间打出过多请求。

### 超时：给每个等待设上限
LLM 偶尔会卡住几分钟不返回，搜索 API 会挂起连接。没有超时，一个 Step 就能让整个 Run 无限期停在 `running`。asyncio 提供两种写法：

- `asyncio.timeout(delay)`（Python 3.11+）：异步上下文管理器，块内代码超时后被取消，并在块的出口抛出 `TimeoutError`。可以包住多个 `await`，适合给「整个 Step」设上限；还能用 `cm.reschedule()` 调整截止时间。
- `asyncio.wait_for(aw, timeout)`：给单个 awaitable 设上限，超时时取消它并抛出 `TimeoutError`。3.11 以前的版本也可用。

从 Python 3.11 起 `asyncio.TimeoutError` 就是内置 `TimeoutError` 的别名，捕获 `TimeoutError` 即可。

```python
async def execute_tool(tc):
    try:
        async with asyncio.timeout(30):              # 单个工具最多 30 秒
            return await TOOLS[tc.tool_name](**tc.args)
    except TimeoutError:
        return {"error": "timeout", "tool": tc.tool_name}   # 交给 LLM 决定是否换个方式

async def run_step_with_budget(run, tool_calls):
    async with asyncio.timeout(120):                 # 整个 Step 的总预算
        return await run_tools_tolerant(tool_calls)
```

asyncio 层面的超时是「整体上限」，HTTP 客户端自己还要设连接、读取超时（见下文 httpx 部分和[第 11 章](#c11)），各层超时如何配合见[第 4 章](#c4)。注意 `send_email` 这类有副作用的工具超时后，**不能断定它没执行**，只能按「结果未知」处理，这是[第 4 章](#c4)幂等设计要解决的问题。

### 取消：CancelledError 的规则
`task.cancel()` 并不会立刻终止任务，而是在任务下一次 `await` 时，在该处抛出 `asyncio.CancelledError`。任务可以借此做清理，但必须遵守几条规则：

- **必须重新抛出**。`CancelledError` 从 Python 3.8 起继承自 `BaseException` 而不是 `Exception`，所以 `except Exception` 不会误吞它；但 `except BaseException` 或裸 `except:` 会。吞掉取消会让 `TaskGroup`、`asyncio.timeout` 等依赖取消实现的机制失效。
- **清理放在 `finally`**：释放信号量、关闭流、把 Step 状态写成 `cancelled`。`async with` 包住的资源会自动释放。
- **清理里的 `await` 也可能被再次取消**。必须完成的收尾写入（例如更新 `agent_step.status`）可以用 `asyncio.shield()` 保护：外层被取消时，被 shield 的内部操作继续执行。但 shield 不能阻止进程被杀死，真正可靠的兜底仍是数据库里的租约与超时回收（[第 3 章](#c3)）。

```python
async def run_llm_step(run, step):
    try:
        async for chunk in llm.stream(step.input):
            await events.publish(run.id, "token", {"text": chunk})
        await repo.finish_step(step.id, status="succeeded")
    except asyncio.CancelledError:
        # 用 shield 保证状态写入完成，然后继续向上抛
        await asyncio.shield(repo.finish_step(step.id, status="cancelled"))
        raise
```

### 实现「用户点停止」
[第 1 章](#c1)中取消接口只做了一件事：把 `agent_run.cancel_requested` 置为 true。Web 进程和 Worker 进程是分开的，Web 层无法直接调用 Worker 里某个 Task 的 `cancel()`，所以 Worker 要自己发现这个请求并执行取消。分两个粒度：

- **Step 之间检查**：Agent 循环每开始一个 Step 前读取 `cancel_requested`，为 true 就停止循环，把 Run 写成 `cancelled`。实现简单，但正在进行的 LLM 调用要等它结束，可能还要几十秒。
- **在途调用立即取消**：把当前 Step 作为 Task 运行，旁边起一个 watcher 协程定期轮询标志（或订阅 Redis 消息），发现取消请求后调用 `step_task.cancel()`，`CancelledError` 会传到正在 `await` 的 LLM 流或工具调用处。

```python
async def watch_cancel(run_id: str, target: asyncio.Task, interval: float = 1.0):
    while not target.done():
        if await repo.is_cancel_requested(run_id):
            target.cancel()
            return
        await asyncio.sleep(interval)

async def agent_loop(run):
    while not run.finished:
        if await repo.is_cancel_requested(run.id):        # Step 之间检查
            break
        step_task = asyncio.create_task(run_next_step(run))
        watcher = asyncio.create_task(watch_cancel(run.id, step_task))
        try:
            await step_task
        except asyncio.CancelledError:
            if asyncio.current_task().cancelling():        # 3.11+：本任务自身被取消
                raise                                      # 例如 Worker 停机，向上抛
            break                                          # 只是 step_task 被 watcher 取消
        finally:
            watcher.cancel()
    await repo.finish_run(run.id)   # 按 cancel_requested / 结果写入终态并推送 SSE 事件
```

这里区分了两种取消：`step_task` 被 watcher 取消时，`await step_task` 同样会抛 `CancelledError`，但 `agent_loop` 本身没有被取消；如果是 `agent_loop` 所在的任务被取消（例如 Worker 停机），等待中的 `step_task` 也会被连带取消，这时必须继续向上抛。`Task.cancelling()`（Python 3.11+）返回当前任务尚未处理完的取消请求数，可以准确区分这两种情况；只看 `step_task.cancelled()` 区分不了，因为两种情况下它都是 True。

<div class="note">易错点：取消只能撤回「还没发生的事」。如果 <code>send_email</code> 的请求已经发给邮件服务，取消协程并不会撤回邮件。有副作用的工具应该在执行前再检查一次 <code>cancel_requested</code>，或者放在人工确认（<code>waiting_approval</code>）之后执行；已经发出的调用按「结果未知」记录到 <code>tool_call</code>，由[第 4 章](#c4)的幂等与对账机制处理。</div>

#### 跨进程传递取消信号
轮询数据库标志是第一版最稳妥的做法：标志本身持久化，Worker 重启后也能看到；每秒一次的轮询对数据库压力很小（按主键查一行）。规模上来后可以改成 Redis：Web 层设置 `cancel:{run_id}` 键并发布一条 Pub/Sub 消息，Worker 订阅后立即响应，数据库标志保留作为兜底（Pub/Sub 消息不持久，Worker 不在线时会丢）。实现细节见[第 8 章](#c8)。

### 阻塞调用与 CPU 密集任务
项目里难免有不支持 async 的库：同步的 SDK、`requests`、某些数据库驱动、PDF 解析库。直接在 `async def` 里调用会卡住事件循环。处理方式按负载类型选择：

| 情况 | 做法 | 说明 |
|---|---|---|
| 有 async 版本 | 换成 async 库：`httpx.AsyncClient`、`asyncpg` / SQLAlchemy async、`redis.asyncio` | 首选 |
| 阻塞 IO，暂无 async 版本 | `await asyncio.to_thread(func, *args)`（Python 3.9+） | 放到默认线程池，等待期间 GIL 被释放 |
| 需要自定义线程池 | `await loop.run_in_executor(executor, func, *args)` | 可单独限制线程数，避免占满默认池 |
| CPU 密集（解析大 PDF、本地分词、本地 embedding） | `run_in_executor(ProcessPoolExecutor(), func, *args)`，或交给独立的 Celery 队列 | 绕开 GIL；参数和返回值要能 pickle |

FastAPI 也有相应约定：用 `def`（而不是 `async def`）声明的路由会被放到线程池执行，不会阻塞事件循环；但在 `async def` 路由里调用同步阻塞函数会阻塞。所以「写了 `async def` 却调用 `requests`」比「全部用 `def`」更糟。

<div class="tip">实践建议：开发环境开启 asyncio 调试模式（环境变量 <code>PYTHONASYNCIODEBUG=1</code> 或 <code>asyncio.run(..., debug=True)</code>），事件循环会记录执行时间超过 <code>loop.slow_callback_duration</code>（默认 0.1 秒）的回调，能快速定位卡住循环的同步调用。线上排查可用 py-spy 看事件循环线程在做什么（[第 11 章](#c11)）。</div>

### 复用异步 HTTP 客户端
LLM、搜索、邮件这些调用都走 HTTP。`httpx.AsyncClient` 内部维护连接池，**整个进程共享一个实例**，不要在每次工具调用时 `async with httpx.AsyncClient()` 新建：每次新建都要重新做 TCP 握手和 TLS 握手（对远端 LLM API 往往要几十到上百毫秒），连接也无法复用，高并发下还会留下大量 `TIME_WAIT` 连接（[第 11 章](#c11)）。在 FastAPI 中用 lifespan 管理它的生命周期：

```python
from contextlib import asynccontextmanager
import httpx

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=5.0, read=60.0, write=10.0, pool=5.0),
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
    )
    yield
    await app.state.http.aclose()        # 关闭时释放连接池

app = FastAPI(lifespan=lifespan)
```

- `httpx.Timeout` 分别控制建连、读取（两次收到数据之间的最长间隔）、写入、从池中取连接的等待时间。`read` 是「两次收到数据之间」的间隔而不是总时长，流式响应持续有 token 时不会触发，所以总时长仍要靠 `asyncio.timeout` 控制。
- `httpx.Limits` 控制连接池大小。池满时新请求排队等待，超过 `pool` 超时抛 `httpx.PoolTimeout`，这本身就是一种背压。
- 官方 LLM SDK（如 `openai`、`anthropic` 的 Python 包）的异步客户端内部也基于 httpx，同样应该创建一次、全局复用。Worker 进程（Celery）里同理，在进程启动时创建。

### Java 对照
| Python asyncio | Java |
|---|---|
| 协程 + 事件循环 | `CompletableFuture` + 线程池；JDK 21 起的虚拟线程（JEP 444，正式特性） |
| `asyncio.gather` | `CompletableFuture.allOf(...)`，再逐个 `join()` |
| `asyncio.TaskGroup` | 结构化并发 `StructuredTaskScope`：JDK 21 中为预览特性（JEP 453），之后的版本仍在预览、API 有调整，生产使用前要确认所用 JDK 版本的状态 |
| `asyncio.Semaphore` | `java.util.concurrent.Semaphore` |
| `asyncio.timeout` / `wait_for` | `CompletableFuture.orTimeout(...)`（JDK 9+）、`Future.get(timeout, unit)` |
| `task.cancel()` + `CancelledError` | `Future.cancel(true)` 中断线程，代码要响应 `InterruptedException` |
| `asyncio.to_thread` | 提交到 `ExecutorService` |

虚拟线程让 Java 可以用「每个任务一个线程」的同步写法获得接近协程的并发规模：`Executors.newVirtualThreadPerTaskExecutor()` 为每个任务创建一个虚拟线程，阻塞 IO 时底层平台线程会被释放。注意在 JDK 21 中，虚拟线程在 `synchronized` 块内阻塞会占住（pin）底层平台线程，高并发 IO 路径上可改用 `ReentrantLock`；JDK 24（JEP 491）已基本解决这一问题。

### 生产环境怎么做
第一版就该做：

- Web 层和 Worker 都用 async 技术栈：`httpx.AsyncClient`、async 数据库驱动、`redis.asyncio`；全进程共享客户端实例，lifespan 中创建与关闭。
- 一个 Step 里独立的工具调用并发执行；`execute_tool` 内部捕获业务异常，返回结构化错误给 LLM。
- 每个下游一个 `Semaphore`；每个工具、每个 Step、每个 Run 都有超时。
- 取消：Step 之间检查 `cancel_requested`，watcher 协程取消在途调用；`CancelledError` 一律重新抛出，收尾写库放在 `finally` 并用 `shield` 保护。
- 有副作用的工具执行前再检查一次取消标志。
- 代码审查里查「`async def` 中调用同步阻塞函数」，必要时用 `asyncio.to_thread` 包装。

规模上来再做：

- 跨进程的全局限流（Redis 令牌桶）替代或叠加进程内信号量，按上游配额分配给各 Worker。
- 取消信号从数据库轮询改为 Redis Pub/Sub 推送，数据库标志保留兜底。
- CPU 密集任务（文档解析、本地 embedding）拆到独立队列和独立 Worker 池，与 IO 型 Agent Worker 分开扩缩容。
- 监控事件循环延迟（定时任务测量 `sleep` 的实际唤醒延迟）作为指标，出现阻塞时告警（[第 5 章](#c5)）。

### 自测
- **为什么 Agent 后端适合用 asyncio？** 时间主要花在等待 LLM 和工具的网络响应上，属于 IO 密集型；协程在等待时让出事件循环，一个进程就能同时处理大量调用和 SSE 连接，开销远小于线程。
- **GIL 对 Agent 服务有什么影响？** 对 IO 密集负载影响很小，线程等待 IO 时会释放 GIL；CPU 密集任务在多线程下无法并行，要用多进程或独立 Worker。GIL 也不保证业务代码线程安全。
- **`asyncio.gather` 和 `TaskGroup` 的错误处理有什么区别？** `gather` 默认把第一个异常抛给调用方但不取消其他任务，`return_exceptions=True` 时把异常当结果返回；`TaskGroup`（3.11+）在任一任务失败时取消其余任务，并把异常汇总成 `ExceptionGroup`。
- **捕获 `CancelledError` 时要注意什么？** 做完清理后必须重新抛出，否则 `TaskGroup`、超时等机制会失效；清理放在 `finally`，必须完成的状态写入可用 `asyncio.shield` 保护。
- **用户点了停止，Worker 怎么停下正在进行的 LLM 调用？** API 只设置 `cancel_requested`；Worker 在 Step 之间检查标志，并用 watcher 协程轮询该标志，发现后对当前 Step 的 Task 调用 `cancel()`，`CancelledError` 会在 `await` LLM 流的地方抛出。已发出的有副作用调用无法撤回，要按结果未知记录。
- **为什么不能每次调用工具都新建 `httpx.AsyncClient`？** 每次都要重新做 TCP 和 TLS 握手，连接无法复用，增加延迟并产生大量 `TIME_WAIT`；应全进程共享一个客户端，并配置超时和连接池上限。
