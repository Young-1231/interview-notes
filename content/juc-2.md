## AQS 与 Lock
### 什么是 AQS？核心原理是什么？基于它构建了哪些锁？ | 高频
AQS（`AbstractQueuedSynchronizer`，JDK 5）是 JUC 构建锁和同步器的基础框架：用 `state` 加等待队列封装"获取失败 → 排队阻塞 → 唤醒重试"，子类只定义"怎样算获取成功"。

**核心组成**
- **`volatile int state`**：同步状态，含义由子类决定，用 CAS（`compareAndSetState()`）修改。
- **CLH 变体的 FIFO 双向队列**：获取失败的线程封装成 `Node` CAS 入队尾，只有前驱是头节点的线程才尝试获取；用 `LockSupport.park()` / `unpark()` 阻塞和唤醒。
- **条件队列**：`ConditionObject`，`await()` 释放锁进入条件队列，`signal()` 把节点转移到同步队列。

**模板方法**：子类重写 `tryAcquire` / `tryRelease`（独占）或 `tryAcquireShared` / `tryReleaseShared`（共享），排队、阻塞、唤醒由 AQS 处理。

**独占流程**：`acquire(1)` → `tryAcquire` 失败则 `addWaiter` 入队 → `acquireQueued` 中前驱是头节点就重试，否则标记前驱 SIGNAL 后 `park`；`release(1)` 让 `state` 归零后 `unpark` 头节点的后继。

**基于 AQS 的组件**

| 组件 | state 的含义 | 模式 |
| --- | --- | --- |
| `ReentrantLock` | 0 未加锁，>0 为重入次数 | 独占 |
| `ReentrantReadWriteLock` | 高 16 位读锁计数，低 16 位写锁重入次数 | 读共享、写独占 |
| `Semaphore` | 剩余许可数 | 共享 |
| `CountDownLatch` | 剩余计数 | 共享 |

易错点：`FutureTask` JDK 7 起不再基于 AQS（改用 CAS + `LockSupport`）；`CyclicBarrier` 基于 `ReentrantLock` + `Condition`，不直接继承 AQS。

### AQS 的独占模式和共享模式是什么？
AQS 支持两种获取资源的方式：

| 对比 | 独占模式（Exclusive） | 共享模式（Shared） |
| --- | --- | --- |
| 含义 | 同一时刻只有一个线程能获取资源 | 同一时刻允许多个线程获取资源 |
| 子类实现 | `tryAcquire` / `tryRelease`，返回 boolean | `tryAcquireShared` 返回 int（负数失败，0 成功但无剩余，正数成功且还有剩余）/ `tryReleaseShared` |
| 唤醒行为 | 释放时只唤醒一个后继 | 获取成功且还有剩余资源时，会继续向后传播唤醒（`setHeadAndPropagate`） |
| 典型实现 | `ReentrantLock`、`ReentrantReadWriteLock` 的写锁 | `Semaphore`、`CountDownLatch`、`ReentrantReadWriteLock` 的读锁 |

state 在不同组件中的含义：
- `ReentrantLock`：锁的持有状态和重入次数。
- `Semaphore`：剩余许可数，`acquire` 减、`release` 加。
- `CountDownLatch`：剩余计数，`countDown` 减到 0 时，所有在 `await` 的线程被依次传播唤醒。
- `ReentrantReadWriteLock`：一个 int 拆成两半，同时支持两种模式。

### ReentrantLock 的实现原理是什么？如何实现可重入？ | 高频
`ReentrantLock` 基于 AQS 的独占模式实现。

**结构**：内部类 `Sync` 继承 AQS，有 `NonfairSync`（默认）和 `FairSync` 两个子类，构造时由 `new ReentrantLock(boolean fair)` 决定用哪个。`lock()`、`unlock()` 等方法都委托给 `sync`。

**加锁**（以非公平锁为例）
1. 先 CAS 把 `state` 从 0 改为 1，成功就用 `setExclusiveOwnerThread(当前线程)` 记录持有者。
2. 失败则进入 AQS 的 `acquire(1)`，调用 `tryAcquire` 再试一次（包括判断重入）。
3. 仍失败就封装成 Node 进入等待队列并 `park` 挂起，等待前驱释放时被唤醒后再竞争。

**可重入的实现**：靠 `state` 计数 + 持有线程记录。

```java
// 简化后的 tryAcquire 逻辑
int c = getState();
Thread current = Thread.currentThread();
if (c == 0) {
    if (compareAndSetState(0, 1)) {          // 公平锁会先判断 !hasQueuedPredecessors()
        setExclusiveOwnerThread(current);
        return true;
    }
} else if (current == getExclusiveOwnerThread()) {
    setState(c + 1);                          // 重入：已经持有锁，直接加计数，无需 CAS
    return true;
}
return false;
```

**解锁**：`tryRelease` 先检查当前线程是否为持有者（否则抛 `IllegalMonitorStateException`），把 `state` 减一；减到 0 时清空持有线程，返回 true，AQS 再唤醒队列中的后继节点。所以 `lock()` 了几次就必须 `unlock()` 几次。

常用的扩展能力：`tryLock()`、`tryLock(timeout, unit)`、`lockInterruptibly()`、`newCondition()`、`getHoldCount()`、`isHeldByCurrentThread()`。

### ReentrantLock 如何实现公平锁和非公平锁？
**区别**
- **公平锁**：按申请锁的先后顺序（FIFO）获取，先到先得，不会饿死线程。
- **非公平锁**：新来的线程可以插队，直接抢锁，抢不到才排队。`ReentrantLock` 默认非公平，`new ReentrantLock(true)` 才是公平锁。

**底层实现**：两者都基于 AQS，区别只在获取锁时是否考虑队列中已有的等待者。
- **非公平锁**：`lock()` 时先直接 CAS 抢锁；失败后 `tryAcquire` 中如果 `state == 0` 也再次直接 CAS，不看队列。
- **公平锁**：`tryAcquire` 中即使 `state == 0`，也要先调用 `hasQueuedPredecessors()` 判断队列中是否有排在自己前面的线程，有就放弃，老实入队排队。

注意：两者一旦进入等待队列，被唤醒的顺序都是 FIFO 的；"不公平"只发生在新线程刚到达、锁刚好被释放的那一刻。

**为什么默认非公平**：锁释放后，唤醒队首线程需要时间（unpark + 线程被调度），这段时间里刚好到达的新线程直接拿到锁执行，减少了线程挂起和唤醒的次数，CPU 利用率和吞吐量更高。代价是队列中的线程可能等待更久，极端情况下饥饿。只有对顺序或等待时间有严格要求时才用公平锁。`synchronized` 也是非公平锁。

### ReentrantLock 和 synchronized 有什么区别？ | 高频 | 滴滴、交通银行
**相同点**：都是可重入的独占锁（悲观锁），都能保证原子性、可见性、有序性。

| 对比 | synchronized | ReentrantLock |
| --- | --- | --- |
| 层面 | Java 关键字，JVM 实现（Monitor、对象头） | JDK 类，基于 AQS（CAS + `volatile state` + `LockSupport`） |
| 加锁释放 | 自动加锁，代码块结束或抛异常时自动释放 | 手动 `lock()` / `unlock()`，必须在 `finally` 中释放，否则可能永远不释放 |
| 公平性 | 只有非公平锁 | 默认非公平，可设为公平 |
| 可中断 | 等待锁时不响应中断 | `lockInterruptibly()` 可响应中断 |
| 超时 / 尝试获取 | 不支持 | `tryLock()`、`tryLock(timeout, unit)` |
| 条件变量 | 一个 WaitSet，`wait/notify/notifyAll` | 可以创建多个 `Condition`，`await/signal` 实现精确唤醒 |
| 锁状态查询 | 不支持 | `isLocked()`、`getHoldCount()`、`getQueueLength()` 等 |
| 锁优化 | JVM 有锁升级、锁消除、锁粗化 | 无 JVM 层面的优化 |

```java
lock.lock();
try {
    // 业务代码
} finally {
    lock.unlock();
}
```

**性能**：JDK 6 引入锁升级后，两者性能已经相差不大，不能再说 `ReentrantLock` 一定更快。
**选择**：简单的同步场景优先用 `synchronized`，不会忘记释放锁，JVM 还会持续优化；需要可中断、超时、公平锁、多个条件变量时用 `ReentrantLock`。JDK 21 的虚拟线程场景中，在 `synchronized` 块内阻塞会导致 Pinning，当时官方建议改用 `ReentrantLock`（JDK 24 已基本解决）。

### ReentrantLock 和 synchronized 都可重入吗？
**都可重入。**

可重入是指同一个线程在已经持有锁的情况下再次获取同一把锁时不会被阻塞。这避免了线程自己锁死自己，比如同步方法中调用同一对象的另一个同步方法、递归调用、子类同步方法调用父类同步方法。

两者的实现思路一样：**记录持有锁的线程 + 重入计数**。
- `synchronized`：由 JVM 实现。重量级锁时 `ObjectMonitor` 用 `_owner` 记录持有线程、`_recursions` 记录重入次数；轻量级锁时通过在栈帧中多压入 Lock Record 记录重入。退出同步块时计数减一，减到 0 才真正释放。
- `ReentrantLock`：由 AQS 实现。`exclusiveOwnerThread` 记录持有线程，`state` 记录重入次数。`lock()` 时若持有者是自己就 `state + 1`；`unlock()` 时 `state - 1`，到 0 才释放。因此加锁和解锁次数必须配对。

## 线程池
### 线程池有什么好处？ | 高频
线程池的核心是**线程复用 + 统一管理**。

1. **降低资源消耗**：复用已创建的线程，避免频繁创建、销毁线程（每个平台线程都对应一个操作系统线程，有栈内存和系统调用开销）。
2. **提高响应速度**：任务到达时可以直接交给已有线程执行，不必等待线程创建。
3. **控制并发数量**：限制最大线程数，防止无限制创建线程导致 CPU 过度切换、内存耗尽甚至 OOM。
4. **削峰与流控**：用任务队列缓冲突发流量，队列满后通过拒绝策略做降级或背压（如 `CallerRunsPolicy` 让提交方变慢）。
5. **便于管理和监控**：统一设置线程名、异常处理器，可以统计活跃线程数、队列长度、完成任务数等；还支持定时和周期任务（`ScheduledThreadPoolExecutor`）。

### 线程池有哪些类型？了解哪些线程池？ | 高频
`Executors` 提供了几种预定义线程池，本质大多是不同参数的 `ThreadPoolExecutor`：

| 方法 | 核心 / 最大线程数 | 队列 | 特点 |
| --- | --- | --- | --- |
| `newFixedThreadPool(n)` | n / n | `LinkedBlockingQueue`（无界） | 固定线程数，负载稳定 |
| `newSingleThreadExecutor()` | 1 / 1 | `LinkedBlockingQueue`（无界） | 按提交顺序串行执行 |
| `newCachedThreadPool()` | 0 / `Integer.MAX_VALUE` | `SynchronousQueue` | 复用空闲线程否则新建，空闲 60 秒回收，适合大量短任务 |
| `newScheduledThreadPool(n)` | n / `Integer.MAX_VALUE` | `DelayedWorkQueue`（无界） | 延迟和周期执行 |
| `newWorkStealingPool()`（JDK 8） | 并行度默认 CPU 核数 | 每线程一个双端队列 | 基于 `ForkJoinPool`，空闲线程"偷"任务 |
| `newVirtualThreadPerTaskExecutor()`（JDK 21） | 不限 | 无 | 每任务一个虚拟线程，适合 I/O 密集 |

另有 `ForkJoinPool.commonPool()`，是并行流和 `CompletableFuture` 默认的公共池。生产推荐直接用 `ThreadPoolExecutor` 构造函数明确设置参数。

### 线程池的核心参数有哪些？ | 高频
`ThreadPoolExecutor` 最完整的构造函数有 7 个参数：

```java
public ThreadPoolExecutor(int corePoolSize,
                          int maximumPoolSize,
                          long keepAliveTime,
                          TimeUnit unit,
                          BlockingQueue<Runnable> workQueue,
                          ThreadFactory threadFactory,
                          RejectedExecutionHandler handler)
```

| 参数 | 含义 |
| --- | --- |
| `corePoolSize` | 核心线程数。默认情况下核心线程即使空闲也不回收；`allowCoreThreadTimeOut(true)` 后也会超时回收 |
| `maximumPoolSize` | 最大线程数 = 核心线程 + 非核心线程，只有队列满了才会创建非核心线程 |
| `keepAliveTime` | 非核心线程空闲多久后被回收 |
| `unit` | `keepAliveTime` 的时间单位 |
| `workQueue` | 存放待执行任务的阻塞队列 |
| `threadFactory` | 创建线程的工厂，用来设置有意义的线程名、是否守护线程、`UncaughtExceptionHandler` 等，方便排查问题 |
| `handler` | 拒绝策略，线程数达到最大且队列已满（或线程池已关闭）时如何处理新任务 |

常用工作队列：
- `ArrayBlockingQueue`：数组实现的有界队列，生产推荐，容量必须指定。
- `LinkedBlockingQueue`：链表实现，不指定容量时为 `Integer.MAX_VALUE`，近似无界，此时 `maximumPoolSize` 失效。
- `SynchronousQueue`：不存储元素，每个插入必须等待一个线程取走，常配合很大的最大线程数（如 `CachedThreadPool`）。
- `PriorityBlockingQueue`：无界优先级队列。
- `DelayQueue` / `DelayedWorkQueue`：延迟队列，用于定时任务。

### 线程池提交任务的执行流程是怎样的？ | 高频
调用 `execute(task)` 后的流程：

1. **当前线程数 < `corePoolSize`**：创建一个新的核心线程执行该任务，即使已有核心线程空闲也会新建。
2. **核心线程已满**：尝试把任务放入 `workQueue`。
3. **队列已满**：如果当前线程数 < `maximumPoolSize`，创建非核心线程**直接执行这个新任务**（而不是去执行队列中的旧任务）。
4. **线程数已达最大值且队列已满**：执行拒绝策略。
5. 非核心线程空闲超过 `keepAliveTime` 后被回收，线程数回落到 `corePoolSize`。

要点：
- 顺序是"核心线程 → 队列 → 非核心线程 → 拒绝"。核心线程满后新任务先进队列，不会马上创建非核心线程，所以使用无界队列时最大线程数永远用不上。
- 入队成功后还会二次检查：线程池若已不是 RUNNING 就移除任务并拒绝；若此时工作线程数为 0（比如核心线程数为 0），会补一个线程，保证队列中的任务有人执行。
- 线程池创建后默认没有线程，任务到来才创建；可以用 `prestartAllCoreThreads()` 预热。
- Tomcat 的线程池对流程做了改造：核心线程满后优先创建非核心线程，达到最大线程数后才入队，更适合 I/O 密集的请求处理。

### 线程池有哪些拒绝策略？ | 高频
触发时机：线程数达到 `maximumPoolSize` 且队列已满，或者线程池已经 `shutdown`。JDK 内置 4 种 `RejectedExecutionHandler`：

| 策略 | 行为 | 适用场景 |
| --- | --- | --- |
| `AbortPolicy`（默认） | 抛出 `RejectedExecutionException` | 需要调用方明确感知失败 |
| `CallerRunsPolicy` | 由提交任务的线程自己执行该任务（线程池已关闭时直接丢弃） | 任务不能丢，并能借此降低提交速度，形成天然的背压 |
| `DiscardPolicy` | 静默丢弃新任务，不抛异常 | 允许丢失的非关键任务 |
| `DiscardOldestPolicy` | 丢弃队列头部最老的任务，再尝试提交当前任务 | 新任务比老任务更有价值的场景 |

注意点：
- 重要任务不建议静默丢弃，很难发现问题。
- `CallerRunsPolicy` 如果提交方是 Tomcat 请求线程，可能拖慢整体接口响应，需要评估。
- 可以实现 `RejectedExecutionHandler` 自定义策略：记录日志并告警、把任务持久化到数据库或 MQ 后续补偿、阻塞等待入队等。

### 线程池有什么好处、创建方式、核心参数、执行流程和拒绝策略？（综合题）
按"好处 → 创建 → 参数 → 流程 → 拒绝 → 调整 → 关闭 → 异常"的顺序回答，细节见对应单题。

- **好处**：线程复用降低开销、提高响应速度、控制并发数、便于统一管理监控。
- **创建方式**：`Executors` 工厂方法或直接 `new ThreadPoolExecutor(...)`，生产推荐后者。
- **核心参数**：`corePoolSize`、`maximumPoolSize`、`keepAliveTime`、`unit`、`workQueue`、`threadFactory`、`handler`。
- **执行流程**：核心线程未满就新建 → 满了入队 → 队列满且未达最大线程数就建非核心线程 → 都满了执行拒绝策略。
- **拒绝策略**：`AbortPolicy`（默认，抛异常）、`CallerRunsPolicy`、`DiscardPolicy`、`DiscardOldestPolicy`，或自定义。
- **参数依据**：任务类型（CPU / I/O 密集）、核数、耗时、QPS；公式估初值再压测，队列必须有界。
- **动态调整**：`setCorePoolSize()` 等运行时生效，队列容量需自定义可变队列，配合配置中心即动态线程池。

**优雅关闭**：`shutdown()` 不再接新任务，已提交的继续执行完；`shutdownNow()` 尝试中断执行中的线程并返回未执行的任务。推荐先 `shutdown()` 再 `awaitTermination`，超时后 `shutdownNow()` 兜底。JDK 19 起 `ExecutorService` 实现了 `AutoCloseable`。

```java
pool.shutdown();
if (!pool.awaitTermination(30, TimeUnit.SECONDS)) {
    pool.shutdownNow();
}
```

**任务抛异常**：`execute()` 提交时异常交给 `UncaughtExceptionHandler`，该工作线程终止，线程池新建线程替代；`submit()` 提交时异常被 `FutureTask` 保存，只有 `Future.get()` 才以 `ExecutionException` 抛出，不调用就看不到。处理方式：任务内 try-catch、`ThreadFactory` 设置 `UncaughtExceptionHandler`（只对 `execute` 有效）、重写 `afterExecute` 统一记录。

### 线程池的底层实现是怎样的？ | 高频
核心实现类是 `ThreadPoolExecutor`，由 `ctl`、`Worker`、`workQueue` 三部分加一套执行流程组成。

**`ctl`**：一个 `AtomicInteger`，高 3 位存线程池状态，低 29 位存工作线程数，一次 CAS 同时改两者。状态依次为 RUNNING（正常）→ SHUTDOWN（`shutdown()` 后不接新任务、继续处理队列）/ STOP（`shutdownNow()` 后不处理队列并中断线程）→ TIDYING（任务清空、线程数为 0，即将调 `terminated()`）→ TERMINATED。

**`Worker`**：每个工作线程封装为 `Worker`，继承 AQS（不可重入独占锁）并实现 `Runnable`，持有 `Thread` 和 `firstTask`。所有 Worker 放在 `HashSet<Worker> workers` 中，由 `mainLock` 保护。

**`workQueue`**：`BlockingQueue<Runnable>`，核心线程满后任务在此排队。

**主要流程**
- `execute()`：按"核心线程 → 入队 → 非核心线程 → 拒绝"处理，需要新线程时调 `addWorker()`（CAS 增加线程数、创建并启动 Worker）。
- `runWorker()`：循环执行 `firstTask` 和 `getTask()` 取到的任务。
- `getTask()`：线程数大于核心数（或允许核心线程超时）时用 `poll(keepAliveTime)`，超时返回 null，线程退出被回收，这就是 `keepAliveTime` 的原理；否则 `take()` 阻塞。
- `processWorkerExit()`：从 `workers` 移除，必要时补充新线程。

易错点：线程池并不区分"核心线程"和"非核心线程"对象，只是根据当前线程数决定 `getTask` 是否超时退出。

### 线程池内部 Worker 执行任务的逻辑是怎样的？
Worker 启动后执行 `runWorker(this)`，逻辑大致如下：

```java
final void runWorker(Worker w) {
    Runnable task = w.firstTask;
    w.firstTask = null;
    w.unlock();                       // 允许被中断
    boolean completedAbruptly = true;
    try {
        while (task != null || (task = getTask()) != null) {
            w.lock();                 // 标记为"正在执行任务"
            // 线程池为 STOP 时确保线程被中断，否则清除中断标志
            try {
                beforeExecute(w.thread, task);   // 钩子
                try {
                    task.run();
                    afterExecute(task, null);    // 钩子
                } catch (Throwable ex) {
                    afterExecute(task, ex);
                    throw ex;
                }
            } finally {
                task = null;
                w.completedTasks++;
                w.unlock();
            }
        }
        completedAbruptly = false;
    } finally {
        processWorkerExit(w, completedAbruptly);
    }
}
```

要点：
1. **先执行 `firstTask`**：创建 Worker 时携带的任务直接执行，不经过队列。
2. **循环取任务**：之后不断调用 `getTask()` 从队列获取任务。`take()` 阻塞等待，或 `poll(keepAliveTime)` 超时等待；返回 null 就跳出循环，线程结束。线程就是这样被复用的：同一个线程循环执行不同任务的 `run()`。
3. **执行期间加锁**：Worker 自己是一把不可重入锁。`shutdown()` 只会中断能 `tryLock` 成功的空闲 Worker，正在执行任务的 Worker 因为持有锁不会被打断；不可重入也防止任务内部调用 `setCorePoolSize` 之类方法时把自己中断掉。
4. **钩子方法**：`beforeExecute` / `afterExecute` 可以被子类重写，用于埋点、记录耗时、统一处理异常、清理 `ThreadLocal`。
5. **异常退出**：任务抛异常时，异常会继续抛出，`completedAbruptly = true`，`processWorkerExit` 移除该 Worker 并新建一个 Worker 补位。

### 为什么不建议用 Executors 创建线程池？生产中如何正确创建？
《阿里巴巴 Java 开发手册》明确禁止用 `Executors` 创建线程池，原因是这些工厂方法隐藏了参数，存在资源耗尽的风险：

| 方法 | 风险 |
| --- | --- |
| `newFixedThreadPool`、`newSingleThreadExecutor` | 使用 `LinkedBlockingQueue` 且容量为 `Integer.MAX_VALUE`，任务堆积会导致 OOM |
| `newCachedThreadPool` | 最大线程数为 `Integer.MAX_VALUE`，任务暴增时会创建大量线程，导致 OOM（`unable to create new native thread`）或 CPU 被切换拖垮 |
| `newScheduledThreadPool` | `DelayedWorkQueue` 无界，任务堆积同样会导致 OOM |

另外，默认的线程名是 `pool-1-thread-1` 这种形式，出问题时很难从线程栈定位到业务。

**生产中的正确做法**：直接用 `ThreadPoolExecutor` 构造，显式指定每个参数。

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
        8,                                   // corePoolSize，按任务类型和压测结果设定
        16,                                  // maximumPoolSize
        60, TimeUnit.SECONDS,                // 非核心线程空闲存活时间
        new ArrayBlockingQueue<>(1000),      // 有界队列
        new ThreadFactoryBuilder()           // Guava，也可以自己实现 ThreadFactory
                .setNameFormat("order-pool-%d").build(),
        new ThreadPoolExecutor.CallerRunsPolicy()); // 按业务选择拒绝策略
```

还要注意：
- 按业务隔离线程池，不同业务共用一个池会互相拖累。
- 配合监控和告警（活跃线程数、队列长度、拒绝次数），关键业务可以接入动态线程池。
- 应用关闭时优雅关闭；Spring 中可以使用 `ThreadPoolTaskExecutor` 交给容器管理生命周期。

### execute 和 submit 有什么区别？ | 高频
| 对比 | `execute()` | `submit()` |
| --- | --- | --- |
| 定义位置 | `Executor` 接口 | `ExecutorService` 接口 |
| 参数 | 只接受 `Runnable` | `Runnable` 或 `Callable` |
| 返回值 | 无 | `Future`，可获取结果、判断是否完成、取消任务 |
| 异常 | 从工作线程直接抛出，交给 `UncaughtExceptionHandler`（默认打印堆栈），该线程终止并被替换 | 被封装进 `Future`，调用 `get()` 时抛出 `ExecutionException`；不调用 `get()` 就感知不到 |

实现上，`submit()` 把任务包装成 `FutureTask`，再调用 `execute()`。`FutureTask.run()` 内部 catch 了所有异常并保存到结果里，所以异常不会抛到线程层面。

选择：需要结果或者需要感知异常时用 `submit()` 并且一定要处理 `Future`；只是执行无返回值的任务用 `execute()`，异常更容易暴露。

### 核心线程数和最大线程数怎么设定？
先按任务类型估一个初值，再通过压测和线上监控调整。

**经验公式**（N 为 CPU 核数，可以用 `Runtime.getRuntime().availableProcessors()` 获取）
- **CPU 密集型**（计算、加解密、压缩）：线程数 ≈ N + 1。多出的一个线程用于在某个线程偶发缺页或被暂停时补位，线程再多只会增加上下文切换。
- **I/O 密集型**（数据库、RPC、文件读写）：线程大部分时间在等待，可以多开，常见经验值为 2N。
- **通用公式**：线程数 = N × 目标 CPU 利用率 × (1 + 等待时间 / 计算时间)。例如 8 核、单个任务等待 90ms、计算 10ms，理论约为 8 × (1 + 9) = 80。

**为什么公式不能硬套**
- 一台机器上往往有多个线程池，还有 GC、Tomcat 等其他线程。
- 等待时间与下游服务的 RT、连接池大小强相关，下游连接池只有 20 个连接时开 200 个线程也没用。
- 容器环境要注意 JVM 识别的 CPU 核数（JDK 10 起支持容器感知，JDK 8u191 也已移植）。

**落地方法**
1. 按公式设置初值，`corePoolSize` 对应日常负载，`maximumPoolSize` 应对峰值。
2. 估算队列容量：可接受的排队时间 × 每秒处理能力，必须有界。
3. 压测观察 CPU 利用率、接口 RT、队列长度、拒绝次数，逐步调整。
4. 线上通过监控和动态线程池持续调优。

### 上线后会关注线程池的哪些指标？
`ThreadPoolExecutor` 本身提供了 `getPoolSize()`、`getActiveCount()`、`getQueue().size()`、`getCompletedTaskCount()`、`getTaskCount()`、`getLargestPoolSize()` 等方法，可以定时采集上报到 Prometheus 等监控系统。

**运行状态**
- 当前线程数、活跃线程数、核心 / 最大线程数、历史峰值线程数。
- 活跃度 = 活跃线程数 / 最大线程数，长期接近 100% 说明负载过高。

**队列**
- 队列当前长度、剩余容量、使用率。长期堆积说明处理能力跟不上提交速度。

**任务处理**
- 提交速率、完成速率、任务平均执行耗时、P99 耗时、任务在队列中的等待时间（可以在提交时记录时间戳，在 `beforeExecute` 中计算）。
- 完成速率长期低于提交速率就会持续堆积。

**异常**
- 拒绝次数（自定义拒绝策略中计数），任务执行异常次数（`afterExecute` 中统计），执行超时的任务数。

**资源**
- CPU 使用率、内存、线程阻塞时间。CPU 高但吞吐低，可能是锁竞争或计算过重；CPU 低但队列堆积，可能是 I/O 阻塞或下游变慢、线程数不足。

告警可以基于这些指标设阈值，例如队列使用率 > 80%、活跃度 > 80%、出现拒绝即告警。

### 什么是动态线程池？
动态线程池是指线程池的核心参数可以在运行时修改并立即生效，不需要重启应用，同时配套监控和告警。它的出发点是：线程池参数很难一次性配准，流量也会随时间变化。

**为什么能实现**：`ThreadPoolExecutor` 本身提供了 `setCorePoolSize()`、`setMaximumPoolSize()`、`setKeepAliveTime()`、`setRejectedExecutionHandler()`、`setThreadFactory()` 等方法，修改后会立即生效（例如调小核心线程数时会中断多余的空闲线程）。

**常见实现方式**
1. 参数从代码迁移到配置中心（Nacos、Apollo）。
2. 监听配置变更，调用上述 setter 刷新线程池。注意调整顺序：调大时先调 `maximumPoolSize` 再调 `corePoolSize`，调小时反过来，因为 JDK 9 起 `setCorePoolSize` 大于最大线程数会抛 `IllegalArgumentException`。
3. **队列容量**：JDK 自带队列的 `capacity` 是 `final` 的，需要自定义可调整容量的队列（如美团方案中的 `ResizableCapacityLinkedBlockingQueue`）。
4. 采集运行指标，配合告警，必要时做到根据负载自动调参。

开源方案有 Hippo4j、DynamicTp 等，思路源于美团技术团队的《Java 线程池实现原理及其在美团业务中的实践》。

## ThreadLocal
### ThreadLocal 的原理是什么？ | 高频
`ThreadLocal` 提供线程局部变量，每个线程访问自己的独立副本。它解决的是"线程隔离"，而不是"共享数据的同步"：synchronized 是时间换空间（共享一份、加锁排队），ThreadLocal 是空间换时间（每线程一份、无需加锁）。

**数据结构**：数据不存在 `ThreadLocal` 里，而是存在线程身上。
- 每个 `Thread` 有一个 `ThreadLocalMap threadLocals` 字段，懒加载创建。
- `ThreadLocalMap` 内部是 `Entry[]`（初始容量 16，负载因子 2/3）。`Entry` 继承 `WeakReference<ThreadLocal<?>>`：key 是 `ThreadLocal` 对象（弱引用），value 是存入的值（强引用）。
- 哈希冲突用**开放地址法（线性探测）**，不是链表；哈希值按 `0x61c88647`（斐波那契散列）递增，分布更均匀。

**set / get**：`set()` 取当前线程的 `ThreadLocalMap`（没有就创建），以当前 `ThreadLocal` 为 key 存值；`get()` 同样按 key 查找，没有则调用 `initialValue()`（可用 `withInitial(...)` 指定）；`remove()` 删除该 Entry。一个线程的多个 `ThreadLocal` 都存在同一个 Map 里。

**扩展**：`InheritableThreadLocal` 在创建子线程时拷贝父线程的值，但线程池复用线程不会重新拷贝，需用 `TransmittableThreadLocal`。`ScopedValue` 在 JDK 21 起预览、JDK 25 正式发布，适合在调用链中传递不可变上下文。

### ThreadLocal 的使用场景？key 和 value 分别存的是什么？ | 银行、阿里、招商银行
**使用场景**
1. **请求上下文传递**：在拦截器中把当前登录用户、租户 ID、TraceId 放入 `ThreadLocal`，Service、DAO 层直接取用，不用层层传参。SLF4J 的 `MDC` 也是基于 `ThreadLocal`。
2. **事务与连接管理**：Spring 的 `TransactionSynchronizationManager` 用 `ThreadLocal` 绑定当前线程的数据库连接，保证同一事务中的多次操作使用同一个 Connection；`RequestContextHolder`、`LocaleContextHolder` 同理。
3. **线程不安全对象的线程级复用**：如 `SimpleDateFormat`，每个线程一份，避免共享导致的并发问题，又不用每次都 new（JDK 8 起更推荐线程安全的 `DateTimeFormatter`）。
4. **分页参数等隐式传参**：PageHelper 就是把分页参数放在 `ThreadLocal` 中，由拦截器在 SQL 执行时读取。

**key 和 value**
- 存储位置：当前线程 `Thread` 对象中的 `ThreadLocalMap`。
- **key**：`ThreadLocal` 实例本身，被 `Entry` 以**弱引用**持有。
- **value**：调用 `set()` 存入的线程私有数据，被 `Entry` **强引用**持有。

可以理解为：`Thread → ThreadLocalMap → Entry(弱引用 ThreadLocal, 强引用 value)`。因为 key 是弱引用、value 是强引用，所以会有内存泄漏的风险，使用后要 `remove()`，原因见下一题。

### ThreadLocal 为什么会内存泄漏？为什么要这样设计？ | 高频
一句话：key 是弱引用会被回收，value 是强引用且从线程可达，线程长期存活（线程池）时 value 就一直留在内存里。

**泄漏过程**：引用链是 `Thread → ThreadLocalMap → Entry → key（弱引用 ThreadLocal）/ value（强引用）`。
1. 外部不再强引用 `ThreadLocal` 对象后，GC 回收它，Entry 的 key 变为 null。
2. value 仍通过 `Thread → ThreadLocalMap → Entry → value` 强引用可达，无法回收。
3. 普通线程结束后 Map 随之回收，问题不大；**线程池**中线程长期存活，key 为 null 的 value 不断积累，严重时 OOM。

即使 key 没被回收（如 `static` 的 `ThreadLocal`），线程复用且不 `remove()` 也会留下旧值，造成**脏数据**：下一个请求读到上一个请求的用户信息。

**为什么 key 设计成弱引用**：若 key 是强引用，线程存活期间整个 Entry 都无法回收，没有任何补救；弱引用让 `ThreadLocal` 能被回收，之后 `set()`、`get()`、`remove()` 会顺便清理 key 为 null 的过期 Entry（`expungeStaleEntry`、`cleanSomeSlots`）。这是"尽力而为"的保护：把泄漏范围从整个 Entry 缩小到 value，但被动清理不保证及时，最终仍要靠 `remove()`。

**为什么 value 不用弱引用**：value 通常只被 Entry 引用，弱引用会让它在业务还在用时被回收，`get()` 返回 null。

**为什么数据放在 `Thread` 里**：数据跟着线程走，线程结束时 Map 自然回收；每个线程只访问自己的 Map，无需同步。

### Java 有 GC，为什么 ThreadLocal 这里没有被回收？ | 高频
一句话：**key 是弱引用会被回收，但 value 是强引用，并且从线程出发仍然可达，所以 GC 不能回收它。**

GC 判断对象能否回收靠的是可达性分析。存活的线程是 GC Roots 之一，于是存在这样一条强引用链：

`Thread（GC Root）→ threadLocals（ThreadLocalMap）→ Entry[] → Entry → value`

- `ThreadLocal` 对象只被 Entry 弱引用，外部强引用消失后，GC 时会被回收，Entry 的 key 变为 null。
- value 被 Entry 强引用，而 Entry 又被线程强引用，整条链可达，GC 当然不会回收 value。
- 线程池中的核心线程会一直存活，这条链就一直存在。除非线程结束，或者调用 `remove()`，或者后续 `set/get/remove` 恰好触发了过期 Entry 的清理。

所以这不是 GC 的问题，而是程序还"持有"着这些对象，从 GC 的角度看它们仍在被使用。

### 使用 ThreadLocal 有什么注意事项？项目中怎么防止内存泄漏？ | 高频
核心是用完必须 `remove()`，并放在 `finally` 或请求结束的统一出口里。

**注意事项**
1. **用完必须 `remove()`**：线程池、Tomcat 线程会复用，不清理会内存泄漏并产生脏数据。
2. **不要存大对象**：value 生命周期跟线程绑定。
3. **一般声明为 `private static final`**：避免产生大量 Entry。但 `static` 让 key 一直有强引用，弱引用的自动清理不起作用，更要依赖 `remove()`。
4. **异步场景不会自动传递**：切到线程池、`CompletableFuture`、`@Async` 后拿不到值，`InheritableThreadLocal` 对线程池无效，需 `TransmittableThreadLocal` 或手动传递。
5. **不解决共享数据的并发问题**：放进去的若是同一个共享对象的引用，多个线程仍在操作同一个对象。

**项目中的做法**
- `try-finally` 中使用，`finally` 里 `remove()`：

```java
private static final ThreadLocal<UserInfo> USER_HOLDER = new ThreadLocal<>();

try {
    USER_HOLDER.set(user);
    chain.doFilter(request, response);
} finally {
    USER_HOLDER.remove();
}
```

- 拦截器中统一处理：`preHandle` 里 set，`afterCompletion` 里 remove（异常时也会调用）；不要只在 `postHandle` 清理，抛异常时它不执行。
- 封装上下文工具类（如 `UserContextHolder`）统一 `set/get/clear`；自定义线程池可重写 `afterExecute` 兜底清理。

## 并发工具与容器
### Future 和 CompletableFuture 是什么？FutureTask 有什么作用、两者有什么区别？
一句话：`Future` 只能阻塞取结果，`FutureTask` 是它最常用的实现，`CompletableFuture` 在此基础上支持回调和任务编排。

**Future**（JDK 5）：异步计算的结果，提供 `get()`、`get(timeout, unit)`、`isDone()`、`cancel()`。不足是只能阻塞或轮询、不支持回调、多任务组合要自己写。

**FutureTask**：实现 `RunnableFuture`（`Runnable` + `Future`），把 `Callable` 包装成既能交给线程执行、又能取结果的任务，`submit()` 内部就是包装成它。用 `volatile int state` 记录状态，`run()` 时 CAS 设置 `runner` 保证只执行一次。

```java
FutureTask<Integer> task = new FutureTask<>(() -> compute());
new Thread(task).start();
Integer result = task.get(); // 阻塞直到完成，异常以 ExecutionException 抛出
```

**CompletableFuture**（JDK 8）：实现 `Future` 和 `CompletionStage`。`supplyAsync()` / `runAsync()` 创建，默认用 `ForkJoinPool.commonPool()`，生产建议传自定义线程池；`thenApply` / `thenAccept` / `thenCompose` 串行，`thenCombine` / `allOf` / `anyOf` 组合，`exceptionally` / `handle` 处理异常；JDK 9 起支持 `orTimeout()`。

```java
CompletableFuture<User> userF = CompletableFuture.supplyAsync(() -> getUser(id), pool);
CompletableFuture<Order> orderF = CompletableFuture.supplyAsync(() -> getOrder(id), pool);
CompletableFuture<Result> resultF = userF
        .thenCombine(orderF, Result::new)
        .exceptionally(ex -> Result.empty());
```

| 对比 | FutureTask / Future | CompletableFuture |
| --- | --- | --- |
| 获取结果 | 只能阻塞 `get()` 或轮询 | 回调，也可 `get()` / `join()` |
| 任务编排 | 不支持 | 链式调用、多任务组合 |
| 异常处理 | `get()` 时抛 `ExecutionException` | `exceptionally` / `handle` 链式处理 |
| 手动完成 | 不支持 | `complete()` |
| 取消 | `cancel(true)` 可中断执行线程 | `cancel()` 不中断正在执行的任务 |

### FutureTask 的 get 方法内部的阻塞机制是怎样的？
JDK 7 起 `FutureTask` 不再基于 AQS，而是用 **`volatile state` + CAS + 一个 Treiber 栈（无锁单向链表）+ `LockSupport.park/unpark`** 实现阻塞。

**`get()` 流程**
1. `state` 已大于 `COMPLETING`（完成、异常或取消）时直接 `report()`。
2. 否则进入 `awaitDone()` 自旋：状态为 `COMPLETING`（结果正在写入）时 `Thread.yield()`；否则创建 `WaitNode` 并 CAS 压入 `waiters` 栈，再 `LockSupport.park(this)` 挂起（超时版用 `parkNanos`，超时抛 `TimeoutException`）；被唤醒后重新检查状态，被中断则移除节点并抛 `InterruptedException`。
3. `report()`：`NORMAL` 返回结果，`EXCEPTIONAL` 抛 `ExecutionException`，取消则抛 `CancellationException`。

**唤醒**：`run()` 结束时 `set()` / `setException()` 先 CAS 改为 `COMPLETING` 写入结果，再改为最终状态，然后 `finishCompletion()` 遍历 `waiters` 栈逐个 `unpark()`，并调用 `done()` 钩子；`cancel()` 也走这里。因此多个线程可同时 `get()` 同一个 `FutureTask`，完成时被一起唤醒。

### CountDownLatch 有什么作用？
`CountDownLatch`（倒计时门闩）让一个或多个线程等待其他线程完成一组操作后再继续执行。

**用法**
- `new CountDownLatch(n)`：初始化计数为 n。
- `countDown()`：计数减一，一般由完成任务的线程在 `finally` 中调用，防止异常时漏减导致等待方永远阻塞。
- `await()`：阻塞直到计数变为 0；`await(timeout, unit)` 可以设置超时。

**原理**：基于 AQS 共享模式，`state` 就是计数。`await()` 在 `state != 0` 时入队阻塞；`countDown()` CAS 把 `state` 减一，减到 0 时唤醒所有等待线程。

**特点**：一次性的，计数减到 0 后不能重置，需要重复使用时改用 `CyclicBarrier` 或 `Phaser`。

**场景**
- 主线程等待多个子任务完成后汇总结果（并行查询多个服务再合并）。
- 服务启动时等待多个组件初始化完成。
- 压测时用 `CountDownLatch(1)` 作为发令枪，让多个线程同时开始执行。

```java
CountDownLatch latch = new CountDownLatch(3);
for (int i = 0; i < 3; i++) {
    pool.execute(() -> {
        try {
            doTask();
        } finally {
            latch.countDown();
        }
    });
}
latch.await(5, TimeUnit.SECONDS);
```

### CountDownLatch 和 CyclicBarrier 有什么区别？ | 高频
**CyclicBarrier**（循环栅栏）：让一组线程互相等待，直到所有线程都到达屏障点，再一起继续执行。`new CyclicBarrier(n, barrierAction)`，每个线程调用 `await()`，第 n 个线程到达时，由它执行可选的 `barrierAction`，然后唤醒所有线程，屏障自动重置进入下一轮。实现基于 `ReentrantLock` + `Condition`。

| 对比 | CountDownLatch | CyclicBarrier |
| --- | --- | --- |
| 等待关系 | 一个或多个线程等待**其他线程**完成 | 一组线程**互相等待**，都到齐后一起出发 |
| 计数 | `countDown()` 的线程不会阻塞，可以由同一个线程调用多次 | 每个参与线程调用 `await()` 都会阻塞，直到人齐 |
| 是否可复用 | 一次性，不能重置 | 可以循环使用，也可以 `reset()` |
| 回调 | 无 | 支持 `barrierAction`，在每轮所有线程到达后执行 |
| 异常 | 无特殊机制 | 某个线程中断或超时，屏障被打破，其他等待线程抛 `BrokenBarrierException` |
| 底层 | AQS 共享模式 | `ReentrantLock` + `Condition` |
| 场景 | 主线程等待多个子任务完成 | 多线程分阶段计算，每阶段结束后汇总再进入下一阶段 |

可以这样记：`CountDownLatch` 是"等别人做完"，`CyclicBarrier` 是"大家一起等人齐"，比如所有运动员都就位后才一起起跑。

### Semaphore 是什么？解释一下信号量机制
**信号量机制**：信号量是 Dijkstra 提出的经典同步原语，是一个非负整数计数器加上 P（申请资源，计数减一，计数不足则阻塞）和 V（释放资源，计数加一，唤醒等待者）两个原子操作，用来控制对有限资源的访问。计数为 1 时相当于互斥锁。

**Java 中的 `Semaphore`**：表示一组许可证（permits）。
- `new Semaphore(n)` / `new Semaphore(n, true)`：n 个许可证，默认非公平，第二个参数为 true 时是公平模式。
- `acquire()` / `acquire(k)`：获取许可，不足时阻塞；`tryAcquire(timeout, unit)` 可以超时放弃。
- `release()` / `release(k)`：归还许可，唤醒等待线程。要放在 `finally` 中，并且只有成功获取后才能释放。

**原理**：基于 AQS 共享模式，`state` 是剩余许可数。`acquire` 时计算剩余许可，足够就 CAS 扣减，不足就入队阻塞；`release` 时 CAS 加一并唤醒后继。

**场景**
- 限流：限制同时访问某个接口、调用某个下游服务的并发数。
- 控制有限资源：如限制同时使用的数据库连接、文件句柄。
- 虚拟线程场景中限制并发度（虚拟线程不应该池化，用 `Semaphore` 控制并发）。

```java
Semaphore semaphore = new Semaphore(10);
if (semaphore.tryAcquire(1, TimeUnit.SECONDS)) {
    try {
        callDownstream();
    } finally {
        semaphore.release();
    }
} else {
    fallback();
}
```

注意 `Semaphore` 不记录持有者，任何线程都可以 `release()`，多次释放会让许可数超过初始值。

### CountDownLatch、CyclicBarrier、Semaphore 有什么区别？
| 对比 | CountDownLatch | CyclicBarrier | Semaphore |
| --- | --- | --- | --- |
| 作用 | 一个或多个线程等待其他线程完成 | 一组线程互相等待，到齐后一起继续 | 控制同时访问资源的线程数 |
| 核心方法 | `countDown()`、`await()` | `await()` | `acquire()`、`release()` |
| 计数变化 | 只减不增，减到 0 放行 | 每到达一个减一，到 0 放行并重置 | 获取减一、释放加一，可增可减 |
| 能否复用 | 不能 | 能 | 能（许可证循环使用） |
| 底层 | AQS 共享模式 | `ReentrantLock` + `Condition` | AQS 共享模式 |
| 典型场景 | 并行任务汇总、启动等待 | 多线程分阶段计算 | 限流、资源池 |

`Phaser`（JDK 7）可以看作更灵活的 `CyclicBarrier` + `CountDownLatch`，支持动态增减参与线程数和多阶段同步。

### Java 有哪些并发容器？ | 高频
| 类别 | 容器 | 要点 |
| --- | --- | --- |
| Map | `ConcurrentHashMap` | 高并发哈希表，最常用 |
| | `ConcurrentSkipListMap` | 基于跳表的有序 Map，可以替代并发场景下的 `TreeMap` |
| List / Set | `CopyOnWriteArrayList`、`CopyOnWriteArraySet` | 写时复制，读多写少 |
| | `ConcurrentSkipListSet` | 有序 Set |
| 非阻塞队列 | `ConcurrentLinkedQueue`、`ConcurrentLinkedDeque` | 基于 CAS 的无锁链表队列 |
| 阻塞队列 | `ArrayBlockingQueue`、`LinkedBlockingQueue`、`SynchronousQueue`、`DelayQueue` 等 | 生产者-消费者、线程池任务队列 |

**ConcurrentHashMap**（最常考）
- 为什么需要：`HashMap` 线程不安全；`Hashtable`、`Collections.synchronizedMap()` 用一把全局锁，并发度低。
- **JDK 7**：`Segment`（继承 `ReentrantLock`）分段锁，默认 16 段。**JDK 8**：`Node` 数组 + 链表 + 红黑树，空桶 CAS 插入，非空桶 `synchronized` 锁头节点；读不加锁，靠 `volatile` 保证可见性；支持多线程协助扩容。
- key、value 都不允许为 null；迭代器弱一致，不抛 `ConcurrentModificationException`。
- 复合操作用 `putIfAbsent()`、`computeIfAbsent()`、`merge()`，不要"先 get 再 put"。

**BlockingQueue**：`put()` 满时阻塞、`take()` 空时阻塞，`offer()` / `poll()` 可带超时，天然适合生产者-消费者。

### CopyOnWriteArrayList 如何保证线程安全？适用于什么场景？
**原理：写时复制（Copy-On-Write）**
- 内部持有 `volatile Object[] array`。
- **写操作**（`add`、`set`、`remove`）：先加锁（JDK 8 用 `ReentrantLock`，JDK 9 起改为 `synchronized`），把原数组复制一份新数组，在新数组上修改，最后把 `array` 引用指向新数组，再释放锁。同一时刻只有一个线程在写。
- **读操作**（`get`、遍历）：不加锁，直接读当前的 `array`。读的是一个不会再被修改的快照，所以读写之间不需要互斥。
- `volatile` 保证引用替换后，其他线程能立即看到新数组。
- 迭代器基于创建时的数组快照，遍历期间不会抛 `ConcurrentModificationException`，但看不到之后的修改，迭代器也不支持 `remove()`。

**适用场景**：读多写少、对实时一致性要求不高的场景，比如监听器 / 观察者列表、黑白名单、路由表、配置项缓存。

**缺点**
- 每次写都复制整个数组，写操作开销大，数组大或写频繁时性能很差，还会产生大量垃圾对象，增加 GC 压力。
- 写的时候内存中同时存在新旧两个数组，内存占用翻倍。
- **弱一致性**：读操作可能读到旧数据，写入后不能保证马上被正在读的线程看到。

写多的场景用 `Collections.synchronizedList()` 或其他并发结构；需要队列语义用 `ConcurrentLinkedQueue` / `BlockingQueue`。

### Java 并发中容易混淆的点有哪些？
1. `volatile` 保证可见性和有序性，**不保证** `i++` 的原子性。
2. `synchronized` 锁对象不锁代码：实例方法锁 `this`，静态方法锁 `Class`，两者不互斥。
3. `wait()` 释放锁、必须在 `synchronized` 中调用，`sleep()` 不释放锁；`wait()` 要放在 while 中检查条件。
4. `notify()` 唤醒的线程要等通知方退出同步块后重新竞争锁，不会立刻执行。
5. 等 `synchronized` 是 `BLOCKED`，等 `ReentrantLock` 是 `WAITING`，`sleep(ms)` 是 `TIMED_WAITING`。
6. 线程池核心线程满后**先入队**，队列满才建非核心线程；无界队列时最大线程数不起作用。
7. `submit()` 的异常封装在 `Future` 里，不 `get()` 就感知不到；`execute()` 的异常直接抛出。
8. `CountDownLatch` 不能重置、"等别人"，`CyclicBarrier` 可复用、"互相等"。
9. `ReentrantLock` 默认非公平，`synchronized` 只能非公平；两者都可重入。
10. CAS 高冲突时大量自旋反而耗 CPU。
11. `ConcurrentHashMap` 单个方法线程安全，"先 get 再 put"不是，要用 `computeIfAbsent`、`merge`。
12. 偏向锁 JDK 15 起默认关闭并废弃，讲 JDK 17 / 21 的锁升级时不要默认它存在。
13. `ThreadLocal` 是线程隔离，不是加锁；直接调 `run()` 不会启动新线程，`start()` 不能调用两次。

### 两个线程 a 打印 ABCDE、b 打印 12345，同时启动，如何让它们交替输出？
目标输出 `A1B2C3D4E5`。核心是用一个共享状态表示"轮到谁"，配合等待/通知让两个线程轮流执行。常见写法有三种。

**方式一：`synchronized` + `wait/notify`**

```java
private static final Object LOCK = new Object();
private static boolean letterTurn = true;   // true 轮到 a 打印字母

// 线程 a（线程 b 对称：打印 '1'~'5'，条件取反，打印后 letterTurn = true）
new Thread(() -> {
    for (char c = 'A'; c <= 'E'; c++) {
        synchronized (LOCK) {
            while (!letterTurn) {            // while 防止虚假唤醒
                try { LOCK.wait(); } catch (InterruptedException e) { return; }
            }
            System.out.print(c);
            letterTurn = false;
            LOCK.notifyAll();
        }
    }
}).start();
```

无论哪个线程先拿到锁，都由 `letterTurn` 决定谁先打印，所以一定从 A 开始。

**方式二：`ReentrantLock` + 两个 `Condition`**，可以精确唤醒对方，扩展到三个及以上线程轮流打印时更清晰：a 打印后 `condB.signal()`，然后在 `condA` 上 `await()`，b 同理。

**方式三：`Semaphore`**，最简洁：

```java
Semaphore semA = new Semaphore(1), semB = new Semaphore(0);
// 线程 a：semA.acquire(); print(letter); semB.release();
// 线程 b：semB.acquire(); print(digit);  semA.release();
```

也可以用 `LockSupport.park/unpark` 互相唤醒，或者用 `volatile` 变量 + 自旋（会空耗 CPU，不推荐）。

### a、b、c 三个线程调用 RPC，c 依赖 a 和 b 的结果，如何实现？
本质是"等待两个并行任务都完成后再执行第三个任务"。推荐用 **`CompletableFuture`**，它既能并行，又能直接拿到结果，还方便处理超时和异常。

```java
ExecutorService pool = ...; // 自定义 I/O 线程池，不要用 commonPool

CompletableFuture<A> fa = CompletableFuture.supplyAsync(() -> rpcA(), pool);
CompletableFuture<B> fb = CompletableFuture.supplyAsync(() -> rpcB(), pool);

CompletableFuture<C> fc = fa.thenCombine(fb, (a, b) -> rpcC(a, b))   // a、b 都完成后执行 c
        .orTimeout(3, TimeUnit.SECONDS)                              // JDK 9+
        .exceptionally(ex -> fallbackC());

C result = fc.join();
```

依赖更多任务时用 `CompletableFuture.allOf(fa, fb, ...).thenApply(v -> ...)`，在回调里用 `join()` 取各自结果。

其他可选方案：
- **`CountDownLatch(2)`**：a、b 执行完后在 `finally` 中 `countDown()`，c 先 `await(timeout)` 再执行。结果需要通过共享变量（如 `AtomicReference` 或 `volatile` 字段）传递，或者配合 `Future` 获取。
- **`Future` + `get()`**：a、b 提交到线程池得到 `Future`，c 中依次调用 `fa.get(timeout)`、`fb.get(timeout)`。总耗时取决于较慢的那个，与并行一致，但写法偏阻塞。
- **`Thread.join()`**：c 中先 `ta.join()`、`tb.join()`，最原始，不便于处理结果和超时。

注意点：RPC 一定要设置超时，否则某个下游卡住会导致 c 一直等待；处理好某个依赖失败时的降级；线程池与业务隔离，避免 `commonPool` 被 I/O 任务占满。

## 死锁与排查
### 死锁产生需要满足哪些必要条件？如何检测死锁？ | 高频 | 邮政储蓄银行、滴滴
死锁是指两个或多个线程互相持有对方需要的资源，又都在等待对方释放，导致所有线程永远阻塞。

**四个必要条件**（同时满足才会死锁）
1. **互斥**：资源同一时刻只能被一个线程占用。
2. **请求与保持**：线程已持有至少一个资源，又去请求被别人占用的资源，且不释放自己已持有的。
3. **不可剥夺**：线程已获得的资源在用完之前，不能被其他线程强行抢走。
4. **循环等待**：存在一个线程-资源的环形等待链，如 T1 等 T2 的锁，T2 等 T1 的锁。

只要破坏任意一个条件就能避免死锁。

**典型代码**：两个线程以相反顺序获取两把锁。

```java
// 线程 1
synchronized (lockA) { synchronized (lockB) { ... } }
// 线程 2
synchronized (lockB) { synchronized (lockA) { ... } }
```

**检测方法**
- **`jstack <pid>`**：导出线程栈，JVM 会自动检测 Java 层面的死锁，输出末尾出现 `Found one Java-level deadlock`，并列出相关线程各自持有和等待的锁。
- **图形化工具**：JConsole 的"检测死锁"按钮、VisualVM、JDK Mission Control、Arthas 的 `thread -b`。
- **代码中检测**：`ThreadMXBean.findDeadlockedThreads()` 可以发现 `synchronized` 和 `ReentrantLock` 等 `Ownable` 锁的死锁，可以做成定时巡检并告警。
- **原理层面**：操作系统和数据库常用资源分配图（等待图）检测环路，有环即死锁。MySQL InnoDB 就会主动检测死锁并回滚其中一个事务。

### 如何避免死锁？ | 高频
从破坏四个必要条件出发，互斥一般无法破坏，常用手段针对后三个：

1. **固定加锁顺序**（破坏循环等待）：所有线程按同样的顺序获取多把锁，比如按账户 ID 从小到大加锁。这是最常用、最有效的方法。

```java
// 转账：按 id 排序后加锁，避免 A→B 和 B→A 同时发生时死锁
Account first = from.id < to.id ? from : to;
Account second = from.id < to.id ? to : from;
synchronized (first) {
    synchronized (second) {
        transfer(from, to, amount);
    }
}
```

2. **超时放弃**（破坏不可剥夺）：用 `ReentrantLock.tryLock(timeout, unit)`，获取不到就释放已持有的锁，稍后（加随机退避）重试。
3. **一次性申请所有资源**（破坏请求与保持）：要么同时拿到所有锁，要么一个都不拿，比如由一个统一的分配者负责分配。
4. **减少锁的嵌套和持有时间**：尽量不要在持有一把锁时再去获取另一把锁；不要在持锁时调用外部方法（回调、RPC），因为不知道里面会加什么锁；缩小锁的粒度。
5. **使用更高层的并发工具**：`ConcurrentHashMap`、原子类、`BlockingQueue` 等，代替手写复杂的加锁逻辑。
6. **可响应中断**：用 `lockInterruptibly()`，必要时可以中断等待的线程来打破死锁。
7. 线上配合 `jstack`、`ThreadMXBean` 定期检测，及时发现。

### 如何排查死锁？
**步骤**
1. **找到进程**：`jps -l` 或 `ps -ef | grep java` 找到 Java 进程 PID。
2. **导出线程栈**：`jstack -l <pid> > stack.txt`（`-l` 会额外打印 `ReentrantLock` 等可拥有同步器的信息），建议间隔几秒多导几次对比。也可以用 `jcmd <pid> Thread.print`。
3. **看死锁报告**：搜索 `Found one Java-level deadlock`，JVM 会列出死锁的线程以及每个线程 `waiting to lock <0x...>` 和 `locked <0x...>` 的锁地址。没有自动报告时，查看处于 `BLOCKED` / `WAITING` 状态的线程，比对它们持有和等待的锁，找出环形依赖。
4. **定位代码**：根据线程栈中的类名和行号找到加锁的业务代码。
5. **修复**：统一加锁顺序、改用 `tryLock` 超时、减少锁嵌套。

**其他工具**
- Arthas：`thread -b` 直接找出当前阻塞其他线程的线程，`thread <id>` 查看具体线程栈。
- JConsole / VisualVM：线程页签中的"检测死锁"。
- `ThreadMXBean.findDeadlockedThreads()`：在程序中做定时检测并告警。

注意：死锁时 CPU 通常不高，表现是相关接口卡住、线程数或请求堆积，这一点可以与死循环导致的 CPU 飙高区分开。数据库层面的死锁则要看 `SHOW ENGINE INNODB STATUS` 中的 `LATEST DETECTED DEADLOCK`。

### 如何排查 CPU 飙高？
**定位步骤**
1. `top` 找到 CPU 占用最高的 Java 进程 PID。
2. `top -Hp <pid>` 找到该进程中 CPU 占用最高的线程 ID（TID，十进制）。
3. 把线程 ID 转成十六进制：`printf '%x\n' <tid>`。
4. `jstack <pid> | grep -A 30 'nid=0x<十六进制tid>'` 查看该线程的栈，`nid` 就是操作系统线程 ID。
5. 根据栈定位具体代码。建议间隔几秒多抓几次，确认是否一直停留在同一段代码上。

也可以用 Arthas 一步完成：`thread -n 3` 直接列出 CPU 占用最高的 3 个线程及其堆栈。

**常见原因及判断**
- **死循环 / 大量计算**：栈一直停在业务代码的某个循环里，如 JDK 7 中 `HashMap` 并发扩容形成环形链表导致的死循环、正则回溯过深。
- **CAS 自旋过多**：高并发下原子类、自旋锁不断失败重试。
- **频繁 GC**：占用 CPU 的是 `GC task thread` / `VM Thread`，用 `jstat -gcutil <pid> 1000` 观察 GC 次数和耗时，通常是内存泄漏或堆太小，需要进一步 `jmap` dump 堆分析。
- **线程过多、锁竞争严重**：大量上下文切换，`vmstat` 中 `cs` 和 `sy` 偏高。
- **JIT 编译**：应用刚启动时 `C2 CompilerThread` 占用高属于正常现象。

**处理**：先通过限流、扩容、重启等手段止血并保留现场（线程栈、堆 dump、GC 日志），再根据定位结果修复代码或调整 JVM 参数。
