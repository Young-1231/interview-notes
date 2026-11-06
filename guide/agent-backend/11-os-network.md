## 11. 操作系统与网络基础 {按需}
> 一句话：Agent 服务的性能和稳定性问题，最后常常落到连接、文件描述符、超时和 IO 模型上；掌握这些底层概念，才能看懂「连接数一多就报错」「流式卡住」「延迟忽高忽低」背后的原因。

### 在链路中的位置
研报助手一次 Run 在网络上至少有这些连接：浏览器到 Nginx 的 SSE 长连接、Nginx 到 FastAPI 的上游连接、Worker 到 LLM API 的 HTTPS 连接（通常是流式的）、Worker 到搜索 API 和邮件服务的连接、各进程到 PostgreSQL 和 Redis 的连接池。

每条连接在操作系统里都是一个 socket、占一个文件描述符，都有自己的超时和缓冲区。第 1、2 章讲的是应用层写法，本章解释它们底下发生了什么，以及出问题时用什么工具去看。本章只覆盖排查 Agent 后端问题够用的部分。

### 进程、线程与 IO 模型
#### 进程与线程
进程是资源分配的单位：独立的地址空间、自己的文件描述符表。线程是调度的单位：同一进程内的线程共享内存和文件描述符，各自有栈。Uvicorn `--workers 4` 就是 4 个进程，每个进程里一个事件循环线程，外加 `asyncio.to_thread` 用的线程池。Celery 的 prefork 模式同样是多进程。这决定了：**进程内的变量（内存缓存、信号量、连接池）不跨进程共享**，跨进程的状态必须放在数据库或 Redis。

#### 几种 IO 模型
| 模型 | 行为 | 并发方式 | 典型代表 |
|---|---|---|---|
| 阻塞 IO | `read()` 在数据到达前一直挂起线程 | 每个连接一个线程 | `requests`、传统 Servlet 线程池 |
| 非阻塞 IO | 没数据时 `read()` 立即返回 `EAGAIN`，需要反复询问 | 单独使用会忙等，浪费 CPU | 一般不单独使用 |
| IO 多路复用 | 一次系统调用同时等待大量 fd，哪个就绪就处理哪个 | 单线程管理成千上万连接 | Linux `epoll`、macOS/BSD `kqueue`，asyncio、Nginx、Netty 的底座 |
| 异步 IO | 提交请求，内核完成后通知 | 完成驱动 | Linux `io_uring`、Windows IOCP |

`select` / `poll` 是早期的多路复用接口，每次调用都要把整个 fd 集合交给内核扫描，开销随连接数线性增长，`select` 还受 `FD_SETSIZE`（通常为 1024）限制。`epoll` 先用 `epoll_ctl` 注册关心的 fd，再用 `epoll_wait` 只取回就绪的 fd，开销与就绪数量相关而不是与总连接数相关，所以适合「大量连接、大部分空闲」的场景——这正是成百上千个 SSE 连接在等待事件的状态。

asyncio 事件循环在 Linux 上默认使用 epoll（通过 `selectors` 模块）。可选的 uvloop 基于 libuv，是 asyncio 事件循环的替代实现，Uvicorn 安装了它就会默认使用。

### 文件描述符与 ulimit
在 Unix 中，打开的文件、socket、管道都由一个整数 fd（file descriptor）表示。每个进程能同时打开的 fd 数有上限，由 `RLIMIT_NOFILE` 控制，用 `ulimit -n` 查看。很多 Linux 发行版的交互式 shell 默认软限制是 1024。

一个 SSE 连接在 FastAPI 进程里至少占 1 个 fd；如果中间有 Nginx，Nginx 那边每个连接要占 2 个（客户端一侧和上游一侧）。再加上到 LLM API 的连接、数据库和 Redis 连接池、日志文件，1024 很快就会用完。用完后的典型现象：

- 日志里出现 `OSError: [Errno 24] Too many open files`；
- 新连接被拒绝或 `accept` 失败，已有连接看起来正常，于是问题时有时无；
- Nginx 报 `worker_connections are not enough` 或 `Too many open files`。

```bash
ulimit -n                              # 当前 shell 的软限制
cat /proc/<pid>/limits | grep "open files"   # 某个运行中进程的实际限制
ls /proc/<pid>/fd | wc -l              # 该进程当前打开的 fd 数
lsof -p <pid> | wc -l                  # 同上（macOS 也可用）
```

调整方式要作用到**服务实际运行的环境**，在 shell 里改 `ulimit` 对已经运行的服务无效：

- systemd 服务：在 unit 中设置 `LimitNOFILE=65535`；
- Docker：`docker run --ulimit nofile=65535:65535`，Compose 中用 `ulimits.nofile`；Kubernetes 一般继承容器运行时的默认值；
- Nginx：`worker_rlimit_nofile` 配合 `worker_connections`。

<div class="note">易错点：fd 耗尽也可能不是限制太低，而是泄漏。例如每次请求新建 HTTP 客户端却不关闭、SSE 生成器在客户端断开后没有退出、数据库连接没有归还。先观察 fd 数是否随时间单调增长、在流量回落后也不下降，是的话先查泄漏，再考虑调高上限。</div>

### Socket 与 TCP 要点
socket 是应用访问网络的接口，一条 TCP 连接由四元组（源 IP、源端口、目标 IP、目标端口）唯一确定。排查 Agent 服务需要掌握这几点：

- **三次握手**：客户端 SYN → 服务端 SYN+ACK → 客户端 ACK，耗时约 1 个 RTT。到 HTTPS 的 LLM API 还要再做 TLS 握手（TLS 1.3 为 1 个 RTT，TLS 1.2 通常为 2 个）。对跨地域的 API，新建一条连接可能就要上百毫秒，这是连接复用的根本理由。
- **四次挥手与 TIME_WAIT**：**主动关闭**连接的一方在关闭后进入 `TIME_WAIT` 状态，持续 2×MSL（Linux 上固定约 60 秒），用来确保迟到的报文不会干扰同一四元组上的新连接。客户端频繁新建、关闭到同一个 LLM API 的短连接时，会堆积大量 `TIME_WAIT`，极端情况下耗尽本地临时端口（`ip_local_port_range`），新连接报 `Cannot assign requested address`。根治方法是复用连接，而不是调内核参数。
- **CLOSE_WAIT**：对端已关闭，本端应用还没调用 `close()`。大量 `CLOSE_WAIT` 基本说明应用代码没有关闭连接，是泄漏的信号。
- **TCP keepalive**：操作系统层面的空闲探测，Linux 默认空闲 2 小时（`tcp_keepalive_time = 7200`）后才开始探测，对检测几十秒级的 SSE 断线基本没用。所以 SSE 依赖[第 1 章](#c1)的应用层心跳，而不是 TCP keepalive。
- **缓冲区**：发送和接收都有内核缓冲区。`send` 成功只表示数据进入了本机发送缓冲区，不代表对端已收到。客户端读得慢时，服务端发送缓冲区被填满，写操作开始阻塞（或在 asyncio 中 `drain()` 等待），这就是 TCP 层面的背压。

### HTTP keep-alive 与 HTTP/2
#### HTTP/1.1 keep-alive
HTTP/1.1 默认使用持久连接：一个请求结束后连接不关闭，后续请求接着用，省掉 TCP 和 TLS 握手。限制是**同一条连接上同一时刻只能有一个在途请求**（pipelining 实际上没人用）。Worker 同时发 20 个 LLM 流式请求，就需要 20 条连接；一个流式响应持续几十秒，这条连接在这几十秒里也不能给别人用。所以 HTTP/1.1 下连接池的大小直接决定了到上游的最大并发数。

#### HTTP/2 多路复用
HTTP/2 在一条 TCP 连接上划分多个 stream，多个请求和响应的帧交错传输，互不等待，同时压缩头部。对 Agent 的意义：到同一个 LLM API 的大量并发流式请求可以共用少量连接，握手次数和 fd 占用都更少。需要注意：

- 能否使用取决于对端是否支持（通过 TLS 的 ALPN 协商），并且客户端要开启。httpx 需要安装 `httpx[http2]` 并设置 `httpx.AsyncClient(http2=True)`，默认只用 HTTP/1.1。
- 多路复用发生在 HTTP 层，底下仍是一条 TCP 连接，丢包时所有 stream 都要等重传（TCP 层的队头阻塞）。HTTP/3 基于 QUIC（UDP）解决了这个问题，但服务端 SDK 中还很少用到。
- 服务端会限制每条连接的并发 stream 数（`SETTINGS_MAX_CONCURRENT_STREAMS`），超过时客户端要排队或另开连接。

<div class="tip">实践建议：先用 HTTP/1.1 + 合理的连接池上线，确认上游支持 HTTP/2 且连接数或握手开销确实成为问题后，再开启 HTTP/2 并压测对比。SSE 本身在 HTTP/1.1 和 HTTP/2 下都能工作；浏览器在 HTTP/1.1 下对同一域名通常只开 6 个左右的连接，同时打开多个 SSE 标签页会被卡住，HTTP/2 没有这个问题。</div>

### 连接池
连接池保存一组已建立的连接，请求时借出、用完归还，解决两个问题：**避免重复握手**，以及**给并发设上限**，保护自己和下游。

#### HTTP 客户端连接池
[第 2 章](#c2)已经给出 `httpx.AsyncClient` 全局复用的写法。每次请求新建客户端的代价：每次都重新做 TCP + TLS 握手（多出几十到几百毫秒）、主动关闭留下 `TIME_WAIT`、连接数没有上限、忘记关闭还会泄漏 fd。池的大小（`max_connections`）应与下游配额相匹配：HTTP/1.1 下到 LLM API 的连接数上限就是并发流式请求数的上限，设得比 `Semaphore` 小会出现排队和 `PoolTimeout`。

#### 数据库连接池
PostgreSQL 每个连接对应服务器上的一个后端进程，内存开销不小，`max_connections` 默认是 100。算总数时要乘上进程数：

```python
from sqlalchemy.ext.asyncio import create_async_engine

engine = create_async_engine(
    "postgresql+asyncpg://agent:***@db:5432/agent",
    pool_size=10,          # 常驻连接数
    max_overflow=5,        # 高峰时最多再借出 5 个
    pool_timeout=5,        # 借不到连接时最多等 5 秒，然后报错
    pool_pre_ping=True,    # 借出前探测，避免拿到已被服务端或防火墙断开的连接
)
# 总连接数上限 ≈ 进程数 × (pool_size + max_overflow)
# 例如 4 个 Uvicorn 进程 + 8 个 Celery 进程：12 × 15 = 180 > 100，必须调小或加 PgBouncer
```

池并不是越大越好：数据库能同时高效执行的查询数大致与它的 CPU 核数和磁盘能力相关，连接再多也只是在数据库内部排队。Agent 场景的关键规则是：**不要在持有数据库连接（尤其是开着事务）的同时等待 LLM 调用**。一次 LLM 调用要几十秒，期间连接被占着，几十个并发 Run 就能把池耗尽。正确的做法是短事务：读出需要的数据 → 归还连接 → 调用 LLM → 再借连接写结果。进程数多到连接总数不够时，在中间加 PgBouncer 这类连接池代理（事务池模式下，会话级特性如 prepared statement、`SET` 需要额外注意）。

### 超时的三个层次
一次对 LLM API 的调用会卡在不同阶段，每个阶段的含义和合理取值都不一样：

| 层次 | 含义 | 卡住的典型原因 | 参考取值 |
|---|---|---|---|
| 连接超时（connect） | 完成 TCP（及 TLS）握手的上限 | 对端不可达、DNS 异常、防火墙丢包 | 几秒，例如 3–5 秒 |
| 读超时（read） | **两次收到数据之间**的最长间隔 | 对端处理慢、流式输出中途停住 | 非流式要覆盖首个响应的生成时间；流式按首 token 延迟设置，例如 30–60 秒 |
| 总超时（total / deadline） | 整个调用从发起到完成的上限 | 流式响应持续有数据但总时长失控 | 按业务预算，例如单次 LLM 调用 2–5 分钟 |
| 连接池等待（pool） | 从池里借到连接的上限 | 池太小或连接泄漏 | 几秒，超时说明容量不够 |

关键在于**读超时不是总时长**：一个流式响应只要每隔几秒吐一个 token，读超时永远不会触发，但它可能持续十分钟。所以总时长要在应用层用 `asyncio.timeout` 单独设上限（[第 2 章](#c2)）。反过来，非流式调用 LLM 生成长文本时，第一个字节要等到全部生成完才到，读超时设成 10 秒会大量误判。

各层超时要从外到内**逐层收紧**：前端/网关的等待 > Run 的总预算 > 单个 Step > 单次 HTTP 调用。否则外层先超时放弃了，内层还在继续消耗 token。超时之后能否重试、怎么退避，见[第 4 章](#c4)。

### 背压
背压（backpressure）指下游处理不过来时，把「慢下来」的信号传回上游，而不是在中间无限堆积。Agent 后端里有几个典型位置：

- **慢客户端**：SSE 客户端网络差、读得慢，服务端每个 token 都 `yield` 出去，数据先堆在 socket 发送缓冲区，满了以后写操作开始等待。如果生成器之外还有一个无界的内存队列在接收 Worker 事件，这个队列就会无限增长直到内存耗尽。做法是用有界队列（`asyncio.Queue(maxsize=...)`），或者像[第 1 章](#c1)那样从持久化的事件存储按游标拉取，读得慢的客户端只是游标落后，不占额外内存。
- **任务入口**：每用户并发 Run 上限、队列长度上限，超出时直接返回 `429` / `503`，而不是全部接下来再让用户等十分钟。
- **上游调用**：`Semaphore`、连接池上限、上游配额都是背压点；池满时快速失败（`pool` 超时）比无限排队更容易发现问题。

原则是：**每一个缓冲都要有界，满了以后要么等待、要么拒绝、要么丢弃**，三选一并且显式决定。可以丢弃的只有可重新获取的数据（例如心跳、可从事件存储补发的 token 事件），工具调用结果和终态事件不能丢。

### 排查工具箱
| 现象 | 先用什么 | 看什么 |
|---|---|---|
| CPU 高或负载高，不知道是谁 | `top` / `htop`（按 `H` 看线程） | 哪个进程、哪个线程占 CPU；`wa` 高说明在等磁盘 IO |
| 连接数异常、端口耗尽、怀疑泄漏 | `ss -s`、`ss -tanp`（旧系统用 `netstat -anp`） | 各状态连接数，`TIME_WAIT` / `CLOSE_WAIT` 是否堆积，连到了哪个对端 |
| `Too many open files` | `lsof -p <pid>`、`ls /proc/<pid>/fd` | fd 总数、是 socket 还是文件、是否持续增长 |
| 进程卡住不响应、不知道在等什么 | `strace -p <pid> -f`（Linux） | 停在哪个系统调用上：`epoll_wait` 表示在正常等待，卡在 `connect` / `read` 表示在等某个对端 |
| Python 进程慢、事件循环被阻塞 | `py-spy dump --pid <pid>`、`py-spy top --pid <pid>` | 每个线程当前的 Python 调用栈；事件循环线程停在同步调用里就是阻塞点 |
| 想知道一段时间的热点 | `py-spy record -o profile.svg --pid <pid>` | 火焰图，找耗时最多的函数 |

```bash
ss -tan state time-wait | wc -l                 # TIME_WAIT 数量
ss -tan state close-wait                        # CLOSE_WAIT 及其四元组，常指向泄漏
ss -tnp dst :5432 | wc -l                       # 到 PostgreSQL 的连接数，对照连接池上限
lsof -p <pid> -a -i TCP | awk '{print $9}' | sort | uniq -c | sort -rn | head
py-spy dump --pid <pid>                         # 不需要重启、不修改代码
```

几点使用注意：`strace` 会显著拖慢被跟踪的进程，生产环境短时间使用；py-spy 采样开销低，但在容器中需要 `SYS_PTRACE` 权限；macOS 没有 `ss` 和 `/proc`，本地可用 `lsof` 和 `netstat`，线上问题以 Linux 环境为准。

### 生产环境怎么做
第一版就该做：

- 容器和 systemd 中把 `nofile` 调到数万级别，Nginx 同步调整 `worker_rlimit_nofile` 与 `worker_connections`。
- HTTP 客户端、数据库连接池、Redis 客户端全部进程级复用；按「进程数 × 每进程池大小」核算数据库总连接数，不超过 `max_connections` 并留出余量。
- 每个外部调用都配置 connect / read / pool 超时，并在应用层设总超时；不在持有数据库连接或事务时等待 LLM。
- SSE 用应用层心跳检测断线；事件从持久化存储按游标读取，不在内存中无界堆积。
- 指标中暴露连接池使用率、等待时间、打开的 fd 数，便于在耗尽之前告警（[第 5 章](#c5)）。

规模上来再做：

- PostgreSQL 前加 PgBouncer；按读写分离或业务拆分连接池。
- 评估并开启到 LLM API 的 HTTP/2，压测对比连接数和延迟。
- 大量 SSE 连接独立部署成推送服务，与处理普通 API 的进程分开扩缩容。
- 在压测环境复现极限：连接数、fd、端口、连接池分别先到瓶颈时的表现，写进运维手册。

### 自测
- **为什么 asyncio 一个线程能维持上千个 SSE 连接？** 底层用 epoll 等 IO 多路复用，一次系统调用等待大量 fd，只处理就绪的连接；空闲连接只占一个 fd 和少量内存，不占线程。
- **服务报 `Too many open files`，怎么排查？** 先用 `cat /proc/<pid>/limits` 看进程的实际上限，再用 `lsof -p` 或 `ls /proc/<pid>/fd` 看 fd 数量和类型；如果 fd 持续增长、流量下降后也不回落，先查连接或客户端泄漏，再在 systemd / Docker 层面调高 `nofile`。
- **大量 `TIME_WAIT` 和大量 `CLOSE_WAIT` 分别说明什么？** `TIME_WAIT` 出现在主动关闭方，大量出现通常是频繁新建短连接，应复用连接；`CLOSE_WAIT` 是对端已关闭而本端没调用 `close()`，基本说明应用有连接泄漏。
- **HTTP 客户端的读超时设成 60 秒，为什么流式 LLM 调用还是可能卡十分钟？** 读超时是两次收到数据之间的间隔，流式响应持续吐 token 就不会触发；总时长需要在应用层用 `asyncio.timeout` 单独限制。
- **数据库连接池怎么定大小？Agent 场景有什么特殊注意？** 总连接数约为进程数乘以每进程的池上限，要低于 `max_connections`，池大不等于更快；关键是不在持有连接或事务时等待 LLM，否则少量长调用就能占满池。
- **进程看起来卡住了，用什么工具定位？** Python 进程用 `py-spy dump` 看各线程调用栈，确认事件循环是否停在同步调用上；需要看系统调用层面时用 `strace -p`；连接状态用 `ss`，fd 用 `lsof`。
