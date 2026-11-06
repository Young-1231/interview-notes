## 6. 部署与配置：让服务能交给别人用 {必学}
> 把 API、Worker、Redis、PostgreSQL 打包成可重复部署的服务，配置和密钥与镜像分离，并且在发版、重启时不打断正在流式输出的长任务。

### 在链路中的位置
研报助手在生产环境至少有四类进程：FastAPI（接收请求、推 SSE）、Celery Worker（执行 Agent 循环和工具调用）、Redis（broker 和事件通道）、PostgreSQL（`agent_run`、`agent_step`、`tool_call`、`message`）。部署这一层负责：

- 把代码和依赖做成镜像，保证开发机、测试环境、生产环境跑的是同一份东西；
- 编排这几个进程的启动顺序、网络、数据卷和健康检查；
- 注入每个环境不同的配置（数据库地址、模型厂商 API Key、超时与预算）；
- 发版时让旧进程体面地退出：API 不要粗暴掐断 SSE，Worker 不要把跑到一半的 Run 留在 `running` 状态。

最后一点是 Agent 服务和普通 CRUD 服务差别最大的地方。一个普通 HTTP 请求几十毫秒就结束，重启时多等一会即可；而一条 SSE 连接可能持续几分钟，一个 Run 可能跑十分钟，「等它们结束再退出」常常不现实，必须在设计上让中断可恢复。

### 日常用到的 Linux 操作
不需要成为运维，但下面这些排查服务问题时一定会用到：

| 需求 | 命令 | 说明 |
|---|---|---|
| 找进程 | `ps aux \| grep uvicorn`、`pgrep -af celery` | 看进程是否在、启动参数是什么 |
| 看端口被谁占用 | `ss -ltnp`、`lsof -i :8000` | 启动报 address already in use 时用 |
| 发信号 | `kill -TERM <pid>`、`kill -9 <pid>` | TERM 允许程序清理后退出；`-9` 即 SIGKILL，无法捕获，作为最后手段 |
| 资源 | `top` / `htop`、`free -h`、`df -h`、`du -sh /var/log/*` | 内存、磁盘；磁盘被日志写满是常见故障 |
| 网络连通 | `curl -v http://localhost:8000/healthz`、`nc -zv db 5432` | 区分「服务没起来」和「网络不通」 |
| systemd 服务 | `systemctl status/restart agent-api`、`journalctl -u agent-api -f --since "10 min ago"` | 不用容器、直接跑在机器上时的管理方式 |
| 容器资源 | `docker stats` | 每个容器的 CPU、内存占用 |

`kill -9` 不会给程序任何清理机会：Celery 任务不会回写状态，数据库事务会被服务端回滚，SSE 连接直接断开。因此本章后面所有「优雅退出」的设计都建立在先发 SIGTERM、等一段时间、再 SIGKILL 的流程上，`docker stop` 和 Kubernetes 都是这样做的。

### Docker：镜像与容器
镜像（image）是只读的分层文件系统加启动配置，由 Dockerfile 构建；容器（container）是镜像的一个运行实例，有自己的进程、网络和可写层。容器的可写层随容器删除而消失，所以数据库文件必须放在 volume 里，应用本身应该设计成无状态，可以随时删掉重建。

API 和 Worker 用同一个镜像，只是启动命令不同。这样两边的依赖版本、代码版本永远一致，避免 API 写入的数据 Worker 不认识。

#### 一个合格的 Dockerfile
```dockerfile
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

# 先只复制依赖清单：代码改动不会让依赖层缓存失效
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 不用 root 运行，降低容器被攻破后的影响
RUN useradd --create-home --uid 10001 app
USER app

EXPOSE 8000
# exec 形式：uvicorn 是 PID 1，能直接收到 SIGTERM
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--timeout-graceful-shutdown", "20"]
```

几个要点的原因：

- `python:3.11-slim` 基于 Debian，体积比完整镜像小很多，同时仍使用 glibc，绝大多数带 C 扩展的 wheel 可以直接安装。Alpine 使用 musl libc，很多科学计算、加密类包需要现场编译，构建慢且容易出问题，Python 项目一般不推荐。
- 先 `COPY requirements.txt` 再安装依赖，最后才 `COPY . .`。Docker 按层缓存，只要依赖清单没变，改代码后重新构建会跳过耗时的 `pip install`。
- `PYTHONUNBUFFERED=1` 让日志立即写到 stdout，否则容器崩溃时最后几行日志可能还在缓冲区里。
- CMD 用 JSON 数组（exec 形式）。如果写成 `CMD uvicorn app.main:app`（shell 形式），实际 PID 1 是 `/bin/sh -c`，SIGTERM 发给了 shell，不一定转发给 uvicorn，结果是等满超时被 SIGKILL。
- 如果依赖需要编译（如 `psycopg` 非 binary 版本），可以用多阶段构建：在 builder 阶段装编译工具并构建 wheel，最终阶段只复制产物，不把 gcc 带进生产镜像。

#### .dockerignore
`COPY . .` 会把构建上下文里的所有文件复制进去。没有 `.dockerignore` 时，本地的 `.env`（含真实 API Key）、`.git`、虚拟环境都会进入镜像，密钥随镜像推送到仓库，任何能拉镜像的人都能读到。

```text
.git
.venv
__pycache__/
*.pyc
.env
.env.*
tests/
*.log
docker-compose*.yml
```

### Docker Compose：一条命令拉起整套服务
Compose 适合本地开发、测试环境和单机部署。下面是研报助手的最小编排：

```yaml
services:
  api:
    build: .
    env_file: .env
    ports: ["8000:8000"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
  worker:
    build: .
    command: ["celery", "-A", "app.worker", "worker", "--loglevel=INFO", "--concurrency=4"]
    env_file: .env
    stop_grace_period: 60s
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
  redis:
    image: redis:7
    healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s, retries: 5 }
  postgres:
    image: postgres:16
    env_file: .env.db
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"], interval: 5s, retries: 5 }
volumes:
  pgdata:
```

需要理解的几个点：

- `depends_on` 的短写法只保证容器启动顺序，不保证依赖已经可用。PostgreSQL 容器启动后还要几秒初始化，API 此时连接会失败。`condition: service_healthy` 会等依赖的 healthcheck 通过后才启动当前服务。
- `$${POSTGRES_USER}` 中的 `$$` 是 Compose 的转义，表示把字面量 `$` 交给容器内的 shell 展开，读的是容器里的环境变量。
- `pgdata` 是命名 volume，`docker compose down` 不会删除它；`docker compose down -v` 才会删除，等于清空数据库，要小心。
- 服务之间用服务名互相访问：API 里的数据库地址写 `postgres:5432`，Redis 写 `redis://redis:6379/0`，而不是 `localhost`。容器里的 `localhost` 指容器自己。
- Redis 和 PostgreSQL 不映射 `ports`，只在 Compose 内部网络可达，避免把数据库端口暴露到公网。
- Worker 的 `stop_grace_period` 默认是 10 秒，对 Agent 任务明显不够，这里调到 60 秒，原因见后面的优雅退出一节。

日常操作：

```bash
docker compose up -d --build          # 构建并后台启动
docker compose ps                     # 查看状态与健康检查结果
docker compose logs -f --tail=100 worker   # 跟踪某个服务的日志
docker compose restart api            # 重启单个服务（不会重新构建镜像）
docker compose up -d --build api      # 代码变更后重建并替换 api
docker compose exec postgres psql -U agent agent   # 进入容器执行命令
```

<div class="note">易错点：<code>docker compose restart</code> 只是重启已有容器，不会读取新镜像，也不会应用 compose 文件里的大部分改动。改了代码或配置后要用 <code>docker compose up -d</code>（必要时加 <code>--build</code>），它会按需重建容器。</div>

### 配置管理：同一个镜像，不同环境
#### 12-factor 的配置原则
The Twelve-Factor App 中关于配置的一条是：配置（随部署环境变化的东西）存放在环境变量里，与代码严格分离。判断标准是：这个仓库能否现在就开源而不泄露任何凭据。对研报助手而言，配置包括：

- 连接信息：`DATABASE_URL`、`REDIS_URL`；
- 密钥：模型厂商 API Key、搜索 API Key、邮件服务凭据；
- 业务参数：默认模型、每 Run 最大步数、token 预算、LLM 超时、工具超时、`send_email` 是否需要审批；
- 运行参数：日志级别、OTel 导出地址、Worker 并发数。

同一个镜像从测试环境晋升到生产环境，只改注入的环境变量，不重新构建。这样「测过的就是上线的」。

#### 用 pydantic-settings 集中读取
不要在代码各处 `os.environ["..."]`。用 `pydantic-settings`（Pydantic v2 中从 pydantic 拆出的独立包）定义一个配置类，启动时一次性读取并校验类型，缺少必填项直接启动失败，而不是在第一次调用模型时才报错。

```python
from functools import lru_cache
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AGENT_", env_file=".env")

    env: str = "dev"                      # dev / staging / prod
    database_url: str                     # 无默认值 = 必填，读 AGENT_DATABASE_URL
    redis_url: str = "redis://redis:6379/0"
    llm_api_key: SecretStr                # repr 和日志里显示为 '**********'
    default_model: str = "gpt-4o"
    llm_timeout_s: float = 60
    max_steps_per_run: int = 20
    token_budget_per_run: int = 200_000
    email_requires_approval: bool = True

@lru_cache
def get_settings() -> Settings:
    return Settings()

# 使用处：get_settings().llm_api_key.get_secret_value()
```

环境变量的优先级高于 `.env` 文件，所以本地用 `.env`，生产环境由平台注入变量即可覆盖。按环境区分的配置有两种常见做法：每个环境一份 env 文件（`.env.staging`、`.env.prod`，由部署系统选择），或者由部署平台（Compose 的 `env_file`、Kubernetes 的 ConfigMap/Secret）注入。不建议在代码里写 `if env == "prod":` 分支，那会让配置散落在代码里。

#### 密钥不能进镜像
- 不要在 Dockerfile 里 `ENV LLM_API_KEY=...` 或 `COPY .env`：镜像的每一层都可以被解包查看，`docker history` 也能看到 ENV 和构建参数。删掉文件的后续层不会抹掉之前层里的内容。
- 构建期需要凭据（如访问私有 PyPI）时，用 BuildKit 的 `RUN --mount=type=secret`，凭据只在该步骤可见，不写入层。
- 运行期密钥由环境变量或密钥管理服务注入；生产环境的 `.env` 文件不要提交到仓库，只提交一份不含真实值的 `.env.example`。

密钥的轮换、权限划分以及「模型永远不应看到密钥」的问题在[第 7 章](#c7)展开。

### 多进程与扩容
#### API：uvicorn workers 与 gunicorn
一个 uvicorn 进程只用一个 CPU 核心跑事件循环。研报助手的 API 进程主要在做 I/O（读写数据库、订阅 Redis、推 SSE），单进程就能承载大量并发连接，但 CPU 密集的部分（JSON 序列化、鉴权）多了以后需要多进程：

- `uvicorn app.main:app --workers 4`：uvicorn 自带的多进程模式，主进程管理子进程；
- `gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 4`：由 gunicorn 管理进程，传统部署中常见。新版 uvicorn 已将该 worker 类标为弃用，推荐改用独立包 `uvicorn-worker`（类路径 `uvicorn_worker.UvicornWorker`）。

容器化部署时更常见的是「每个容器一个进程，多副本扩容」：每个容器只跑一个 uvicorn 进程，需要扩容就多起几个容器，由负载均衡分发。好处是进程崩溃、内存上限、日志都由容器平台按容器统一管理，扩缩容粒度也一致。单机 Compose 部署且不想引入负载均衡时，才用 `--workers` 吃满多核。

无论哪种方式，都要注意：多个进程之间不共享内存。SSE 的事件不能只存在某个进程的内存队列里，必须经过 Redis Pub/Sub 或 Stream，否则用户的 SSE 连接落在进程 A，而事件发布在进程 B，就收不到。

#### Worker：并发与扩容
Celery Worker 的 `--concurrency` 决定一个容器里同时执行几个任务（prefork 模式下是子进程数）。Agent 任务大部分时间在等 LLM，CPU 占用低，但每个任务占用一个槽位几十秒到几分钟，所以吞吐量约等于「槽位数 / 平均 Run 时长」。队列排队时间上涨时，扩 Worker 容器数量；同时要核对下游配额：Worker 翻倍会让模型厂商的并发请求翻倍，可能直接撞上 429，扩容前先确认速率上限。

### 健康检查：liveness 与 readiness
两个端点回答不同的问题，混为一谈会造成事故：

| 端点 | 回答的问题 | 检查内容 | 失败时平台的动作 |
|---|---|---|---|
| `/healthz`（liveness） | 进程是否还活着、能否响应 | 只返回 200，不查依赖 | 重启容器 |
| `/readyz`（readiness） | 现在能否接新流量 | 数据库、Redis 是否可连 | 从负载均衡摘除，不重启 |

liveness 不能检查数据库。假如数据库抖动 30 秒，所有 API 实例的 liveness 一起失败，平台会把它们全部重启，正在推送的 SSE 连接全部断开，而重启并不能修好数据库。依赖不可用应该体现在 readiness 上：暂时不接新请求，等依赖恢复。

```python
from fastapi import FastAPI, Response
from sqlalchemy import text

app = FastAPI()

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

@app.get("/readyz")
async def readyz(response: Response):
    try:
        async with engine.connect() as conn:          # SQLAlchemy AsyncEngine
            await conn.execute(text("SELECT 1"))
        await redis.ping()                            # redis.asyncio 客户端
    except Exception:
        response.status_code = 503
        return {"status": "dependency_unavailable"}
    return {"status": "ready"}
```

依赖检查要设置短超时（如 1–2 秒），否则 readiness 探针本身会卡住。Worker 没有 HTTP 端口，可以用 `celery -A app.worker inspect ping` 判断是否在线；但它要经过 broker 往返，较重，更常见的做法是监控「队列在增长但没有任务被消费」这一现象，以及 `running` 状态但 lease 过期的 Run 数量。

### 优雅退出：长连接和长任务怎么办
#### 退出流程
`docker stop`、`docker compose up` 替换容器、Kubernetes 滚动更新，都遵循同一个流程：先给 PID 1 发 SIGTERM，等待宽限期（Docker 默认 10 秒，Kubernetes 默认 `terminationGracePeriodSeconds: 30`），超时后发 SIGKILL。程序要做的是在宽限期内：停止接新工作，处理完或交接手上的工作，然后退出。

#### API 进程与 SSE
uvicorn 收到 SIGTERM 后会停止监听、不再接受新连接，然后等待已有连接和请求结束。普通请求很快结束，但 SSE 连接是长期打开的，会一直等到 `--timeout-graceful-shutdown` 设定的秒数（不设置时会一直等，直到被平台 SIGKILL），超时后 uvicorn 取消剩余的请求任务，然后执行 lifespan 的 shutdown 逻辑。

所以「等所有 SSE 自然结束」不可行，正确的思路是让断开变得无害：

1. 状态不在 API 进程里。Run 的执行在 Worker，进度在数据库和 Redis，API 进程只是一个转发通道。API 实例被替换，Run 照常运行。
2. 前端断线重连。SSE 事件带上递增的 `id`，浏览器的 `EventSource` 断线后会自动重连并发送 `Last-Event-ID` 请求头，新实例从 Redis Stream 或 `agent_step` 表中补发之后的事件。
3. 设置 `--timeout-graceful-shutdown`（如 20 秒），让平台的宽限期大于它，确保 uvicorn 有机会自己关闭连接、执行清理，而不是被 SIGKILL。
4. 在 Kubernetes 中，Pod 进入 Terminating 后会被从 Service 的 endpoints 中移除，但这一变更传播到各节点需要时间，SIGTERM 可能先于摘流量到达。常见做法是加一个短暂的 `preStop` 等待（如 sleep 5 秒），让新连接先停止进来，再开始关闭。

<div class="note">易错点：「用户断开 SSE」和「用户点击停止」是两件事。API 实例重启导致的断开不能被当作取消，否则每次发版都会把所有进行中的 Run 取消掉。取消只能由显式的停止请求触发（写 <code>agent_run.cancel_requested = true</code>），Worker 在每个 step 之间检查这个标志。</div>

#### Worker 进程与长任务
Celery Worker 收到 SIGTERM 会进入 warm shutdown：不再领取新任务，等当前任务执行完再退出。如果 Run 要跑 5 分钟而宽限期只有 60 秒，任务仍会被 SIGKILL 中断。因此要组合使用：

- 适当加大宽限期（Compose 的 `stop_grace_period`、Kubernetes 的 `terminationGracePeriodSeconds`），覆盖大多数 Run；
- 任务配置 `acks_late=True`，任务执行完才确认消息，进程被杀时消息会重新投递。使用 Redis broker 时，未确认的消息要等 `visibility_timeout`（默认 1 小时）后才会重新投递，这个值必须大于最长 Run 的时长，否则正常执行中的任务也会被重复投递；
- 依靠 `agent_run` 的 lease（`lease_owner`、`lease_expires_at`）判断 Run 是否仍有人在执行，过期的 Run 由其他 Worker 接管，从最后一个已完成的 `agent_step` 继续，而不是从头再来；
- 有副作用的工具（`send_email`）依赖 `tool_call.idempotency_key` 保证重放时不会重复发送。

这几点在任务队列和可靠性相关章节有详细展开，部署层面要记住的是：发版必然会打断一部分 Run，系统要设计成「被打断可以恢复」，而不是「祈祷发版时没有任务在跑」。

### 数据库迁移作为发版步骤
表结构变更用 Alembic 管理：每次变更生成一个版本脚本（`alembic revision --autogenerate -m "add tool_call.approver"`，自动生成的脚本必须人工检查），提交到仓库，发版时执行 `alembic upgrade head`。数据库里的 `alembic_version` 表记录当前版本。

执行方式上的要点：

- 迁移作为发版流程中独立的一步，在新版本 API/Worker 启动之前执行，例如 `docker compose run --rm api alembic upgrade head`，或 Kubernetes 的 Job / init container。不要放在每个 API 容器的启动命令里：多副本同时启动会并发执行迁移，而且迁移失败会让所有实例反复重启。
- 滚动更新期间新旧代码同时运行，迁移必须对旧代码兼容，即 expand / contract 两阶段：先加列（可空或带默认值）、新代码同时兼容新旧结构；全部切到新版本后，下一次发版再删旧列或加约束。直接重命名列会让还没下线的旧 Worker 立刻报错。
- 大表上的变更要关注锁：在 PostgreSQL 中，`ALTER TABLE` 会获取 ACCESS EXCLUSIVE 锁，如果它在等待一个长事务，后续所有查询都会排在它后面。迁移前设置 `SET lock_timeout = '5s'`，拿不到锁就失败重试，而不是阻塞整个服务。建索引用 `CREATE INDEX CONCURRENTLY`（不能在事务块中执行，Alembic 里需要放到 autocommit 块）。
- 迁移脚本写好 `downgrade`，但不要把回滚寄希望于它：删列这类操作不可逆。回滚应用版本比回滚数据库结构安全得多，这也是 expand / contract 的意义。

### 什么时候上 Kubernetes
单机 Compose 足够支撑早期的研报助手。出现以下需求时再考虑 Kubernetes：需要多台机器、需要按负载自动扩缩容、需要零停机滚动更新和故障自动迁移、团队已经有现成的集群。

| 概念 | 作用 | 对应本章内容 |
|---|---|---|
| Deployment | 声明「运行 N 个这样的 Pod」，负责滚动更新与回滚 | API、Worker 各一个 Deployment，同一镜像不同 command |
| Service | 为一组 Pod 提供稳定的访问地址和负载均衡 | API 的 Service；Worker 不需要对外 Service |
| livenessProbe / readinessProbe | 分别决定重启容器、是否接收流量 | `/healthz`、`/readyz` |
| ConfigMap / Secret | 注入配置和敏感配置 | 对应 env_file；Secret 默认只是 base64 编码，需要配合加密存储和 RBAC |
| HPA | 按指标自动调整副本数 | API 按 CPU；Worker 更适合按队列深度（需要自定义或外部指标） |

Worker 用 CPU 做扩容指标通常不准：它大部分时间在等 LLM，CPU 很低，但队列可能已经积压。按队列长度扩缩容常用 KEDA 这类组件。数据库和 Redis 在生产环境一般使用云厂商托管服务，而不是自己跑在集群里。

### Java 对照
| 关注点 | Python 主线 | Spring Boot |
|---|---|---|
| 打包 | 镜像内装依赖 + 源码 | 可执行 fat jar（`java -jar app.jar`） |
| 镜像分层 | 先装依赖再复制代码 | layered jar（`java -Djarmode=layertools -jar app.jar extract`，3.3 起推荐 `-Djarmode=tools`）分离依赖层与代码层；或用 `mvn spring-boot:build-image`（Buildpacks）、Jib 直接构建镜像 |
| 配置 | 环境变量 + pydantic-settings | `application.yml` + profiles，环境变量通过 relaxed binding 覆盖（`SPRING_DATASOURCE_URL`），`@ConfigurationProperties` 绑定 |
| 健康检查 | `/healthz`、`/readyz` | Actuator 的 `/actuator/health/liveness`、`/actuator/health/readiness` |
| 优雅退出 | uvicorn `--timeout-graceful-shutdown` | `server.shutdown=graceful` 加 `spring.lifecycle.timeout-per-shutdown-phase` |
| 迁移 | Alembic | Flyway / Liquibase |

### 生产环境怎么做
第一版就该做：

- 一个镜像，API 和 Worker 用不同的启动命令；slim 基础镜像、非 root 用户、exec 形式的 CMD、`.dockerignore` 排除 `.env` 和 `.git`；
- Compose 编排四个服务，依赖用 `condition: service_healthy`，数据库用命名 volume，数据库和 Redis 不暴露端口；
- 配置全部来自环境变量，pydantic-settings 启动时校验，密钥用 `SecretStr`，镜像里没有任何密钥；
- `/healthz` 不查依赖，`/readyz` 查依赖；
- 设置 uvicorn 的 `--timeout-graceful-shutdown` 和 Worker 的宽限期；前端 SSE 支持断线重连补发；Run 依靠 lease 和幂等键在 Worker 被杀后可恢复；
- 迁移作为独立步骤，写成向后兼容的 expand / contract 形式；
- 发版前后的固定检查：`docker compose ps` 看健康状态、`logs -f` 看启动错误、在可观测性面板确认错误率和排队时间。

规模上来再做：

- 镜像推送到私有仓库并打不可变的版本标签（git commit SHA），不用 `latest` 部署，便于回滚；
- 迁到 Kubernetes 或云厂商托管容器服务，API 按 CPU、Worker 按队列深度自动扩缩容；
- 数据库、Redis 换成托管服务，配置备份与故障切换；
- 密钥从环境变量文件迁到密钥管理服务（如 Vault、云厂商 Secrets Manager），支持轮换；
- 长任务和短任务拆到不同的 Celery 队列和 Worker 组，分别设置宽限期和扩缩容策略。

### 自测
- **Dockerfile 为什么先复制 requirements.txt 再复制代码？** Docker 按层缓存，依赖清单不变时安装依赖那一层可以复用，改代码后重建只需几秒。
- **CMD 写成 shell 形式有什么问题？** PID 1 变成 `/bin/sh`，SIGTERM 不一定转发给 uvicorn，应用没有机会优雅退出，等宽限期结束后被 SIGKILL。
- **`depends_on` 能保证 API 启动时数据库已经可用吗？** 短写法只保证启动顺序。要配合依赖服务的 healthcheck 和 `condition: service_healthy`；应用自身连接也应有重试。
- **liveness 探针为什么不能检查数据库？** 数据库故障会让所有实例的 liveness 同时失败并被重启，断掉全部 SSE 连接，却修不好数据库。依赖检查放在 readiness，只摘流量不重启。
- **发版时正在推流的 SSE 和正在执行的 Run 怎么办？** API 不保存 Run 状态，连接断开后前端用 `Last-Event-ID` 重连补发；Worker warm shutdown 等任务结束，超时被杀的 Run 依靠 `acks_late`、lease 过期接管和工具幂等键恢复。断开连接不等于取消。
- **为什么不在每个 API 容器启动时自动跑 `alembic upgrade head`？** 多副本会并发执行迁移，失败时所有实例一起重启；迁移应作为独立的发版步骤，并且写成对旧代码兼容的形式。
