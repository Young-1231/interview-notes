## 线程基础
### 什么是 JUC？包含哪些主要组件？
JUC 是 `java.util.concurrent` 包（含 `atomic`、`locks` 子包）的简称，是 JDK 5 引入、由 Doug Lea 主导设计的并发工具包。

| 类别 | 代表类 | 作用 |
| --- | --- | --- |
| 原子类 | `AtomicInteger`、`AtomicLong`、`AtomicReference`、`LongAdder` | 基于 CAS 的无锁原子操作 |
| 锁 | `ReentrantLock`、`ReentrantReadWriteLock`、`StampedLock`、`Condition` | 比 `synchronized` 更灵活的显式锁 |
| 同步器基础 | `AbstractQueuedSynchronizer`（AQS） | 大部分锁和同步工具的底层框架 |
| 并发容器 | `ConcurrentHashMap`、`CopyOnWriteArrayList`、`BlockingQueue` 系列 | 线程安全且高并发的集合 |
| 线程池 | `ThreadPoolExecutor`、`ScheduledThreadPoolExecutor`、`Executors` | 线程复用与任务调度 |
| 同步工具 | `CountDownLatch`、`CyclicBarrier`、`Semaphore`、`Phaser`、`Exchanger` | 协调多个线程的执行节奏 |
| 异步与并行 | `Future`、`FutureTask`、`CompletableFuture`、`ForkJoinPool` | 异步结果获取、任务编排、分治并行 |

### 进程和线程有什么区别？为什么要使用多线程？ | 邮政储蓄银行、滴滴、华为
一句话：进程是操作系统资源分配的基本单位，线程是 CPU 调度的基本单位，一个进程内的多个线程共享进程资源。

| 对比 | 进程 | 线程 |
| --- | --- | --- |
| 资源 | 独立地址空间、文件句柄等 | 共享所属进程的堆、方法区、文件句柄；私有程序计数器、虚拟机栈、本地方法栈 |
| 开销 | 创建、切换开销大 | 创建、切换开销小 |
| 通信 | 需要 IPC：管道、消息队列、共享内存、Socket 等 | 直接读写共享内存，但需要同步 |
| 隔离性 | 一个进程崩溃一般不影响其他进程 | 一个线程导致进程崩溃会影响所有线程 |

为什么用多线程：
- 利用多核 CPU，把计算任务并行化，提升吞吐。
- 在 I/O 等待期间让其他线程继续工作，提高 CPU 利用率。
- 把耗时操作异步化，提升响应速度（如 Web 请求处理、后台任务）。
- 线程比进程轻量，共享数据更方便。

代价是要处理线程安全、死锁、上下文切换等问题。

### 怎么理解并行和并发？ | 银行、淘天、招商银行
- **并发（Concurrency）**：多个任务在同一时间段内交替推进，宏观上同时进行，微观上可能在单核 CPU 上分时切换执行。
- **并行（Parallelism）**：多个任务在同一时刻真正同时执行，需要多核 CPU 或多台机器。

并发强调"能同时处理多件事"的结构，并行强调"同时执行"的能力。多核机器上的多线程程序通常两者兼有：线程数超过核数时既有并行也有交替执行。

### Java 中创建线程有哪几种方式？ | 高频 | 工商银行、农业银行、交通银行
真正创建线程的只有 `new Thread(...).start()`。常说的几种方式，区别在于怎么提供任务、怎么拿结果：

1. **继承 `Thread`**，重写 `run()`。简单，但占用了唯一的继承位，任务和线程耦合在一起。
2. **实现 `Runnable`**，传给 `Thread`。任务和线程解耦，可以继承其他类，也可以用 Lambda。
3. **实现 `Callable`**，用 `FutureTask` 包装后交给 `Thread`，或提交给线程池。可以有返回值、可以抛受检异常。
4. **使用线程池**（`ExecutorService` / `ThreadPoolExecutor`），提交 `Runnable` 或 `Callable`，由线程池创建和复用线程。生产环境首选。
5. 补充：`CompletableFuture.supplyAsync()` 异步执行，JDK 21 起还可以用 `Thread.ofVirtual().start(...)` 创建虚拟线程。

```java
// Runnable + Lambda
new Thread(() -> System.out.println("run")).start();

// Callable + FutureTask
FutureTask<String> task = new FutureTask<>(() -> "done");
new Thread(task).start();
String result = task.get(); // 阻塞直到拿到结果

// 线程池
ExecutorService pool = new ThreadPoolExecutor(4, 8, 60, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(100));
Future<String> f = pool.submit(() -> "done");
```

### Runnable 和 Callable 有什么区别？ | 高频
| 对比 | Runnable | Callable |
| --- | --- | --- |
| 方法 | `void run()` | `V call() throws Exception` |
| 返回值 | 无 | 有，通过 `Future` 获取 |
| 受检异常 | 不能抛出，只能在内部 try-catch | 可以抛出，`Future.get()` 时以 `ExecutionException` 包装 |
| 使用方式 | 可直接交给 `Thread`，也可提交线程池 | 不能直接交给 `Thread`，需 `FutureTask` 包装或用 `submit()` 提交 |
| 出现版本 | JDK 1.0 | JDK 5 |

需要拿异步结果或感知任务异常时用 `Callable`；只是执行一段逻辑用 `Runnable`。`FutureTask` 同时实现了 `Runnable` 和 `Future`，是两者之间的桥梁。

### 开启线程应该调用什么方法？为什么不直接调 run()？
应该调用 `start()`。

- `start()` 会调用 native 方法 `start0()`，由 JVM 向操作系统申请创建新线程，线程就绪后被调度时在新线程里执行 `run()`。调用后线程从 `NEW` 进入 `RUNNABLE`。
- 直接调用 `run()` 只是在当前线程里做一次普通方法调用，不会创建新线程，没有并发效果。
- 同一个 `Thread` 对象只能 `start()` 一次，再次调用会抛 `IllegalThreadStateException`，因为 `start()` 会检查线程状态是否为 `NEW`。

### 线程有哪些状态？ | 高频 | 农业银行、招商银行
`Thread.State` 枚举定义了 6 种状态：

| 状态 | 含义 | 典型进入方式 |
| --- | --- | --- |
| `NEW` | 已创建，未调用 `start()` | `new Thread()` |
| `RUNNABLE` | 可运行，包含操作系统层面的就绪和运行 | `start()`；阻塞在 BIO 读写时 Java 层面也显示为 `RUNNABLE` |
| `BLOCKED` | 等待进入 `synchronized` 的 Monitor | 竞争 `synchronized` 锁失败 |
| `WAITING` | 无限期等待其他线程的动作 | `Object.wait()`、`Thread.join()`、`LockSupport.park()` |
| `TIMED_WAITING` | 带超时的等待 | `Thread.sleep(ms)`、`wait(ms)`、`join(ms)`、`parkNanos()` |
| `TERMINATED` | 执行结束或异常退出 | `run()` 返回 |

注意点：
- `sleep` 只有带时长的版本，所以它进入的是 `TIMED_WAITING`，不是 `WAITING`。
- 等待 `ReentrantLock` 的线程底层用的是 `LockSupport.park()`，状态是 `WAITING` / `TIMED_WAITING`，不是 `BLOCKED`。`BLOCKED` 只对应 `synchronized`。
- `wait()` 被唤醒后要重新抢 Monitor，抢不到会进入 `BLOCKED`。

### wait 和 sleep 有什么区别？ | 高频 | 农业银行、招商银行
核心区别：`wait()` 会释放锁，`sleep()` 不会。

| 对比 | `wait()` | `sleep()` |
| --- | --- | --- |
| 所属 | `Object` 的实例方法 | `Thread` 的静态方法 |
| 调用前提 | 必须持有该对象的 Monitor（在 `synchronized` 内），否则抛 `IllegalMonitorStateException` | 任何地方都能调用 |
| 锁 | 释放锁，进入该对象的 WaitSet | 不释放锁，只让出 CPU |
| 唤醒 | `notify()` / `notifyAll()`、超时、中断 | 时间到自动恢复、中断 |
| 用途 | 线程间通信、条件等待 | 暂停执行一段时间 |
| 状态 | `WAITING` 或 `TIMED_WAITING` | `TIMED_WAITING` |

两者都会响应中断，抛出 `InterruptedException` 并清除中断标志。`wait()` 被唤醒后要重新竞争锁才能继续执行。

### notify 和 notifyAll 有什么区别？
- `notify()`：从对象的 WaitSet 中唤醒一个等待线程（HotSpot 实现大致按 FIFO，但规范不保证是哪一个）。
- `notifyAll()`：唤醒 WaitSet 中所有等待线程。

被唤醒的线程不会立即执行，要等调用 `notify` 的线程退出同步块释放锁后，再去重新竞争锁。

一般推荐 `notifyAll()`：多个线程等待不同条件时（如生产者和消费者共用一个锁），`notify()` 可能唤醒一个条件不满足的线程，而真正该醒的线程一直在等，导致程序卡住。需要精确唤醒时，可以用 `ReentrantLock` 配多个 `Condition`。

`wait()` 要放在 while 循环里判断条件，防止虚假唤醒或被唤醒后条件已被别的线程改掉：

```java
synchronized (lock) {
    while (!condition) {
        lock.wait();
    }
    // 条件满足，执行业务
}
```

### 如何打断正在运行的线程？
Java 没有安全的强制终止方式（`Thread.stop()` 早已废弃，会导致锁突然释放、数据不一致，JDK 20 起调用直接抛 `UnsupportedOperationException`），标准做法是**协作式中断**：调用 `thread.interrupt()` 设置中断标志，由线程自己决定何时退出。

- 线程阻塞在 `sleep()`、`wait()`、`join()` 等方法上时，会抛出 `InterruptedException`，同时清除中断标志。
- 线程在执行普通代码时，需要自己检查 `Thread.currentThread().isInterrupted()`；静态方法 `Thread.interrupted()` 会返回并清除标志。
- 阻塞在 `synchronized` 上的线程不响应中断；`ReentrantLock.lockInterruptibly()` 可以响应。

```java
Thread t = new Thread(() -> {
    while (!Thread.currentThread().isInterrupted()) {
        try {
            doWork();
            Thread.sleep(1000);
        } catch (InterruptedException e) {
            // 标志已被清除，恢复中断状态后退出
            Thread.currentThread().interrupt();
        }
    }
});
t.start();
t.interrupt();
```

捕获 `InterruptedException` 后不要直接吞掉，要么向上抛，要么恢复中断标志。也可以用 `volatile boolean` 标志位控制退出，但它无法唤醒阻塞中的线程。线程池中用 `Future.cancel(true)` 或 `shutdownNow()`，底层同样是 `interrupt()`。

### 主线程能感知到子线程抛出的异常吗？
直接用 `try-catch` 包住 `thread.start()` 是捕获不到的。异常发生在另一个线程的栈上，未捕获的异常只会让子线程终止，默认由 `ThreadGroup.uncaughtException` 打印堆栈，主线程不受影响也不知道。

想感知子线程异常，有几种方式：
- **子线程内部 try-catch**，把异常记下来，或者通过共享变量、回调通知主线程。
- **`UncaughtExceptionHandler`**：`thread.setUncaughtExceptionHandler(...)`，或用 `Thread.setDefaultUncaughtExceptionHandler(...)` 全局设置。线程池中可以在 `ThreadFactory` 里设置。
- **`Callable` + `Future`**：任务异常被封装在 `Future` 中，主线程调用 `get()` 时抛出 `ExecutionException`，`getCause()` 就是原始异常。
- **`CompletableFuture`**：用 `exceptionally()`、`handle()`、`whenComplete()` 处理异常。

线程池里有个坑：`execute()` 提交的任务抛异常会走 `UncaughtExceptionHandler` 并打印堆栈，而 `submit()` 提交的任务异常被吞进 `Future`，不调用 `get()` 就完全看不到。

### 什么是线程上下文切换？
CPU 从执行一个线程切到执行另一个线程的过程。切换时要保存当前线程的上下文（程序计数器、寄存器、栈指针等），再恢复下一个线程的上下文。

**触发时机**：
- 时间片用完，被操作系统调度走。
- 线程主动阻塞或让出：`sleep`、`wait`、I/O、竞争锁失败被挂起。
- 被更高优先级的线程抢占。

**开销**：每次切换本身要几微秒，涉及用户态与内核态切换；切换后 CPU 缓存、TLB 失效，新线程要重新预热缓存。线程数过多、锁竞争激烈、频繁阻塞唤醒时，切换开销会显著拖慢系统。可以用 `vmstat` 的 `cs` 列或 `pidstat -w` 观察。

**减少方法**：
- 线程池大小合理，不要开远超核数的 CPU 密集线程。
- 减少锁竞争：缩小锁粒度、缩短持锁时间、读写分离锁、分段锁。
- 低冲突场景用 CAS 等无锁方案。
- 避免频繁创建销毁线程；I/O 密集的高并发场景可以考虑 JDK 21 的虚拟线程。

### 什么是虚拟线程（Java 21 新特性）？
虚拟线程（Virtual Thread）是由 JVM 调度的轻量级线程，JDK 19、20 为预览特性，JDK 21（JEP 444）正式发布。

**原理**：传统的平台线程与操作系统线程 1:1 对应，创建成本高（栈默认约 1MB），数量通常只能到几千。虚拟线程是 M:N 模型，大量虚拟线程挂载（mount）在少量载体线程（carrier thread，默认是一个 `ForkJoinPool`，大小约等于 CPU 核数）上运行。虚拟线程执行阻塞 I/O 时，JVM 把它的栈帧保存到堆上并卸载，载体线程去执行别的虚拟线程；I/O 就绪后再挂回某个载体线程继续执行。

**特点**：
- 创建成本极低，栈按需增长，可以轻松创建百万级。
- 仍然是 `java.lang.Thread`，同步阻塞的写法不变，不需要像响应式编程那样改造代码。
- 适合 I/O 密集、高并发的场景（HTTP 请求、RPC、数据库访问）；对 CPU 密集任务没有提升。

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(() -> callRemote());
}
Thread.ofVirtual().start(() -> doWork());
```

**注意点**：
- 不要池化虚拟线程，每个任务新建一个即可；需要限制并发时用 `Semaphore`。
- **Pinning（钉住）**：JDK 21 中在 `synchronized` 块内阻塞，或在 native 方法中阻塞时，虚拟线程无法卸载，会占住载体线程。JDK 21 建议把这类代码改用 `ReentrantLock`；JDK 24（JEP 491）基本解决了 `synchronized` 导致的 Pinning。
- 虚拟线程数量可能极多，大量使用 `ThreadLocal` 会占用不少内存。
- Spring Boot 3.2+ 可以通过 `spring.threads.virtual.enabled=true` 开启。

## JMM 与 volatile
### 为什么会出现线程安全问题？
线程安全问题出现的条件是：**多个线程同时访问共享的可变数据，且至少有一个线程在写，又没有正确同步**。具体落在并发三大特性的破坏上：

- **原子性被破坏（竞态条件）**：`count++` 是"读-改-写"三步，线程切换发生在中间会导致更新丢失；"先检查后执行"（check-then-act，如懒汉单例、`if (!map.containsKey(k)) map.put(k, v)`）也会出问题。
- **可见性问题**：CPU 缓存、寄存器、编译器优化让一个线程的修改没有及时被其他线程看到。
- **有序性问题**：编译器和 CPU 重排序，在多线程下观察到"不可能"的执行顺序，例如 DCL 单例未加 `volatile` 可能拿到未初始化完成的对象。

解决思路：不共享（局部变量、`ThreadLocal`）、不可变（`final`、不可变对象）、正确同步（`synchronized`、`Lock`、`volatile`、原子类、并发容器）。

### 并发编程的三大特性是什么？ | 高频
原子性、可见性、有序性。

| 特性 | 含义 | 典型问题 | 保证手段 |
| --- | --- | --- | --- |
| 原子性 | 一个或一组操作不可分割，要么全部执行要么都不执行，中间不会被其他线程干扰 | `i++` 实际是读取、加一、写回三步，并发时更新丢失 | `synchronized`、`Lock`、原子类 |
| 可见性 | 一个线程修改共享变量后，其他线程能立即看到新值 | 修改停留在 CPU 缓存/工作内存中，其他线程读到旧值，比如循环标志位停不下来 | `volatile`、`synchronized`、`Lock`、`final` |
| 有序性 | 程序执行顺序符合代码逻辑顺序 | 编译器和 CPU 指令重排序，单线程无影响，多线程下出错（如 DCL 单例） | `volatile`、`synchronized`、`Lock` |

`volatile` 只保证可见性和有序性，不保证复合操作的原子性；`synchronized` 三者都能保证。

### 什么是 Java 内存模型（JMM）？ | 高频
JMM（Java Memory Model）是 Java 语言规范（JLS 第 17 章）定义的一套规则，规定多线程程序中共享变量的读写何时对其他线程可见、哪些重排序是允许的。它屏蔽不同硬件和操作系统内存模型的差异，让 Java 并发程序在各平台上行为一致。JDK 5（JSR-133）对 JMM 做了修订，现在的 `volatile`、`final` 语义就是那时确定的。

**抽象模型**：
- **主内存**：所有线程共享，存放共享变量（实例字段、静态字段、数组元素；局部变量是线程私有的，不涉及）。
- **工作内存**：每个线程私有，保存用到的共享变量副本。线程只能操作工作内存，不能直接读写主内存，线程之间也不能直接访问对方的工作内存。

工作内存是对 CPU 缓存、寄存器、写缓冲区和编译器优化的抽象，并不是真实的一块内存。正因为有这层副本，才会出现可见性和有序性问题。

**JMM 提供的保证**：
- 通过 `volatile`、`synchronized`、`final`、`Lock` 等提供可见性和有序性保证。
- 用 **happens-before** 规则描述操作间的可见性：程序员只需按规则写代码，就能得到正确的可见性，而不用关心底层用了什么内存屏障。

注意不要与 JVM 运行时数据区（堆、栈、方法区）混淆，JMM 讲的是并发访问规则，不是内存划分。

### JMM 如何保证原子性、可见性、有序性？
**原子性**
- JMM 保证基本类型的读写是原子的（`long`、`double` 非 `volatile` 时规范允许拆成两次 32 位操作，但 64 位 HotSpot 上实际是原子的）。
- 复合操作需要 `synchronized`（`monitorenter`/`monitorexit` 保证同一时刻只有一个线程执行临界区）、`Lock`，或基于 CAS 的原子类。

**可见性**
- `volatile`：写操作立即刷新到主内存，并使其他 CPU 中对应缓存行失效；读操作直接从主内存取最新值。
- `synchronized` / `Lock`：解锁前必须把修改刷回主内存，加锁时会清空工作内存中的副本、从主内存重新读取。
- `final`：构造函数中正确初始化的 `final` 字段，在对象引用未逸出的前提下，其他线程看到对象时一定能看到 `final` 字段的初始化值。

**有序性**
- `volatile`：通过内存屏障禁止特定的指令重排序。
- `synchronized` / `Lock`：同一时刻只有一个线程执行临界区，相当于临界区串行执行（临界区内部仍可重排序，但不影响其他线程的观察结果）。
- happens-before 规则：从语言层面规定哪些操作之间必须保证可见和有序。

### 什么是 happens-before？
happens-before 是 JMM 定义的可见性规则：**如果操作 A happens-before 操作 B，那么 A 的结果对 B 可见，且 A 的执行顺序排在 B 之前**。它描述的是可见性保证，不要求物理执行上一定先后——只要结果一致，JVM 仍可以重排序。

常用规则（JSR-133）：
1. **程序顺序规则**：同一个线程内，前面的操作 happens-before 后面的操作。
2. **监视器锁规则**：对一个锁的解锁 happens-before 随后对同一个锁的加锁。
3. **volatile 变量规则**：对一个 `volatile` 变量的写 happens-before 随后对它的读。
4. **线程启动规则**：`Thread.start()` happens-before 该线程中的任何操作。
5. **线程终止规则**：线程中的所有操作 happens-before 其他线程检测到它已终止（`join()` 返回、`isAlive()` 为 false）。
6. **线程中断规则**：对线程调用 `interrupt()` happens-before 被中断线程检测到中断。
7. **对象终结规则**：对象构造函数结束 happens-before 它的 `finalize()` 开始。
8. **传递性**：A hb B，B hb C，则 A hb C。

典型应用：线程 1 写普通变量 `x = 1` 后写 `volatile flag = true`；线程 2 读到 `flag == true` 后读 `x`，由程序顺序规则 + volatile 规则 + 传递性，一定能读到 `x == 1`。

### volatile 关键字有什么作用？原理是什么？ | 高频
`volatile` 是轻量级的同步机制，有两个作用：**保证可见性、禁止指令重排序**，但**不保证原子性**。

**作用**
- **可见性**：一个线程写了 `volatile` 变量，其他线程随后读取一定能看到最新值。
- **有序性**：禁止 `volatile` 读写与其前后的普通读写发生会破坏语义的重排序。经典应用是 DCL 单例中的 `instance` 必须用 `volatile`：`new` 对象分为分配内存、初始化、赋值引用三步，后两步重排序后，其他线程可能拿到一个未初始化完成的对象。

**原理**
- **编译层面**：字段的 access flags 带 `ACC_VOLATILE`，JIT 据此插入内存屏障。
- **内存屏障**：`volatile` 写前插入 StoreStore、写后插入 StoreLoad；读后插入 LoadLoad 和 LoadStore，限制重排序。
- **硬件层面**：在 x86 上，`volatile` 写会生成带 `lock` 前缀的指令（如 `lock addl $0x0,(%rsp)`）。它会把当前处理器的写缓冲刷到缓存/内存，并借助缓存一致性协议（如 MESI）让其他 CPU 中该变量所在的缓存行失效，其他线程下次读取时必须重新加载。

**不保证原子性**

```java
public static volatile int i = 0;
public static void increase() {
    i++; // 读取、加一、写回三步，仍然线程不安全
}
```

复合操作要用 `AtomicInteger`、`synchronized` 或 `Lock`。

### volatile 是为了解决什么问题？能保证原子性吗，为什么？ | 农业银行、滴滴
**解决的问题**：多线程下共享变量的**可见性**和**有序性**问题。
- 可见性：没有 `volatile` 时，线程可能一直读取自己缓存/寄存器中的旧值。典型现象是 `while (!stop) {}` 循环，另一个线程把 `stop` 改为 true 后，JIT 可能把读取提出到循环外，导致循环永远停不下来。
- 有序性：防止重排序让其他线程看到不完整的状态，例如 DCL 单例拿到半初始化对象。

**不能保证原子性**。原因是 `volatile` 只保证"每一次读都读到最新值、每一次写都立即可见"，但无法把多个步骤绑成一个整体。以 `count++` 为例：
1. 线程 A 读到 `count = 5`。
2. 线程 B 也读到 `count = 5`（此时 A 还没写回，B 读到的确实是最新值）。
3. A 计算并写回 6，B 计算并写回 6。

两次自增只加了 1。`volatile` 的可见性在这里无能为力，因为问题出在"读和写之间被插入了其他线程的操作"。需要用 `synchronized`、`Lock` 或 `AtomicInteger`（CAS 循环）保证原子性。单次读或单次写（包括 `long`/`double`）在 `volatile` 修饰下是原子的。

### volatile 适合什么场景？ | 高频
适用条件：**写操作不依赖当前值（或者只有一个线程写），且该变量不与其他变量构成不变式**。典型场景：

1. **状态标志位**：一个线程修改，多个线程读取。

```java
private volatile boolean running = true;

public void stop() { running = false; }

public void run() {
    while (running) { doWork(); }
}
```

2. **DCL 双重检查单例**：防止拿到未初始化完成的对象。

```java
private static volatile Singleton instance;

public static Singleton getInstance() {
    if (instance == null) {
        synchronized (Singleton.class) {
            if (instance == null) {
                instance = new Singleton();
            }
        }
    }
    return instance;
}
```

3. **一次性安全发布**：一个线程初始化好配置对象后赋值给 `volatile` 引用，其他线程读取。
4. **读多写少的"开销较低的读写锁"**：写用 `synchronized` 保证原子性，读直接读 `volatile` 变量。
5. 作为并发组件的基础：AQS 的 `state`、原子类的 `value` 都是 `volatile` + CAS。

不适用：`count++`、"先检查后更新"等复合操作，应该用原子类或加锁。

### volatile 的内存屏障是怎么回事？
内存屏障（Memory Barrier）是一类 CPU 指令，用来限制屏障前后内存操作的重排序，并控制缓存/写缓冲的刷新。JMM 把它抽象成四种：

| 屏障 | 示例 | 作用 |
| --- | --- | --- |
| LoadLoad | Load1; LoadLoad; Load2 | Load1 的读取先于 Load2 及后续读 |
| StoreStore | Store1; StoreStore; Store2 | Store1 的写入先于 Store2 对其他处理器可见 |
| LoadStore | Load1; LoadStore; Store2 | Load1 的读取先于 Store2 及后续写 |
| StoreLoad | Store1; StoreLoad; Load2 | Store1 的写入对所有处理器可见后，才执行 Load2，开销最大 |

JMM 对 `volatile` 的保守插入策略：
- `volatile` 写之前插入 **StoreStore**：前面的普通写必须先于 volatile 写可见。
- `volatile` 写之后插入 **StoreLoad**：防止 volatile 写与后续的 volatile 读写重排序。
- `volatile` 读之后插入 **LoadLoad** 和 **LoadStore**：后续的普通读写不能重排到 volatile 读之前。

效果可以总结为：volatile 写之前的操作不会被重排到写之后；volatile 读之后的操作不会被重排到读之前。

实际 JIT 会按 CPU 内存模型省略不必要的屏障。x86 是 TSO 模型，只会发生 Store-Load 重排序，所以只需要在 volatile 写后实现 StoreLoad，用 `lock` 前缀指令完成，其余屏障是空操作。

### MESI 协议和 volatile 有什么关系？
MESI 是 CPU 层面的缓存一致性协议，每个缓存行有四种状态：
- **M（Modified）**：本核独占且已修改，与主存不一致。
- **E（Exclusive）**：本核独占且未修改。
- **S（Shared）**：多个核共享，与主存一致。
- **I（Invalid）**：缓存行失效。

某个核写共享缓存行时，会通过总线广播让其他核中对应缓存行变为 I，其他核再次读取时只能重新从内存或修改方的缓存加载。

**与 volatile 的关系**：
- MESI 是硬件机制，与 `volatile` 无关时也一直在工作。但 CPU 为了性能引入了**写缓冲区（Store Buffer）**和**失效队列（Invalidate Queue）**，写操作可能暂存在写缓冲中，失效消息可能排队未处理，所以仅靠 MESI 仍会出现短暂的可见性问题和重排序。
- `volatile` 写会触发 `lock` 前缀指令（内存屏障），强制刷新写缓冲、等待失效确认，让写入立刻通过 MESI 机制传播给其他核。

所以可以这样理解：`volatile` 是语言层面的语义，JVM 用内存屏障来实现它，内存屏障再借助 MESI 等缓存一致性协议达到可见性效果。不同 CPU 架构的一致性协议不同（如 MESIF、MOESI），JMM 屏蔽了这些差异。

## synchronized 与锁升级
### Java 的线程同步机制有哪些？
| 机制 | 说明 |
| --- | --- |
| `synchronized` | 内置锁，修饰方法或代码块，基于 Monitor，自动加锁释放锁，保证原子性、可见性、有序性 |
| `Lock`（`ReentrantLock`） | 显式锁，基于 AQS，支持公平锁、可中断、超时获取、多个 `Condition` |
| `ReadWriteLock`（`ReentrantReadWriteLock`） | 读读共享、读写和写写互斥，适合读多写少 |
| `StampedLock`（JDK 8） | 增加乐观读模式，读性能更高，不可重入 |
| `volatile` | 保证可见性和有序性，不保证原子性，适合状态标志 |
| 原子类（`AtomicInteger`、`LongAdder`） | 基于 CAS 的无锁原子更新 |
| `wait/notify`、`Condition` | 线程间的等待与通知 |
| 同步工具 | `CountDownLatch`、`CyclicBarrier`、`Semaphore` 协调线程执行节奏、控制并发数 |
| 线程隔离 | `ThreadLocal` 让每个线程持有自己的副本，从根本上避免共享 |
| 并发容器 | `ConcurrentHashMap`、`CopyOnWriteArrayList`、`BlockingQueue` |

### synchronized 的底层原理是什么？ | 高频 | 农业银行、华为
`synchronized` 基于对象关联的 **Monitor（监视器锁）** 实现，可以同时保证原子性、可见性和有序性，并且是可重入锁。

**字节码层面**
- 修饰代码块：编译生成 `monitorenter` 和 `monitorexit` 指令。通常有两个 `monitorexit`，一个在正常退出路径，一个在异常处理路径，保证异常时也能释放锁。
- 修饰方法：不生成这两条指令，而是在方法的 access flags 上设置 `ACC_SYNCHRONIZED`，JVM 调用方法时据此隐式获取和释放 Monitor。

**Monitor 层面**（HotSpot 中是 C++ 的 `ObjectMonitor`）
- `_owner`：持有锁的线程。
- `_recursions`：重入次数。
- `_EntryList` / `_cxq`：竞争锁失败而阻塞的线程（`BLOCKED` 状态）。
- `_WaitSet`：调用 `wait()` 后等待的线程。

线程执行 `monitorenter` 时尝试把 `_owner` 设为自己，成功则持有锁；同一线程再进入时 `_recursions` 加一；失败则进入阻塞队列。`monitorexit` 时计数减一，减到 0 释放锁并唤醒等待线程。重量级锁的阻塞唤醒底层依赖操作系统的 mutex（Linux 上通过 pthread / futex），涉及用户态和内核态切换。

**对象头**：每个对象头中的 Mark Word 存放锁状态标志。JDK 6 起引入了偏向锁、轻量级锁等优化，不再一上来就使用 Monitor，Mark Word 的内容会随锁状态变化（详见锁升级）。

**可见性**：解锁时把工作内存中的修改刷回主内存，加锁时让本地副本失效、重新从主内存读取。

### synchronized 的锁粒度（对象/类）？加在方法上呢？ | 高频
`synchronized` 锁的永远是一个**对象**，按锁的对象可分为对象锁和类锁：

| 用法 | 锁对象 | 类型 |
| --- | --- | --- |
| `synchronized` 修饰实例方法 | 当前实例 `this` | 对象锁 |
| `synchronized (this) { }` | 当前实例 `this` | 对象锁 |
| `synchronized (lockObj) { }` | 指定的对象 | 对象锁 |
| `synchronized` 修饰静态方法 | 当前类的 `Class` 对象 | 类锁 |
| `synchronized (Demo.class) { }` | `Demo` 的 `Class` 对象 | 类锁 |

```java
public synchronized void a() { }          // 锁 this
public static synchronized void b() { }   // 锁 Demo.class
public void c() {
    synchronized (lock) { /* 只锁关键代码 */ }
}
```

要点：
- 对象锁只对同一个实例互斥，不同实例互不影响；类锁对这个类的所有实例互斥。
- 对象锁和类锁是两把不同的锁，一个线程调用实例同步方法、另一个线程调用静态同步方法，不会互斥。
- 同步代码块比同步方法粒度更细，只锁真正需要保护的代码，并发性更好。
- 不要用 `String` 常量、`Integer` 等可能被缓存共享的对象作为锁，也不要锁会被重新赋值的引用。

### synchronized 为什么是可重入锁？
可重入指同一线程已持有某把锁时，可以再次获取它而不被自己阻塞。如果不可重入，一个同步方法调用同一对象的另一个同步方法，或子类同步方法调用 `super` 的同步方法、递归调用同步方法时，线程会自己把自己锁死。

`synchronized` 的实现方式：
- **重量级锁**：`ObjectMonitor` 记录 `_owner`（持有线程）和 `_recursions`（重入计数）。进入时如果 `_owner` 是当前线程，计数加一直接进入；每次退出减一，减到 0 才真正释放锁。
- **轻量级锁**：每次重入都会在当前线程栈帧中再压入一条 Lock Record，其中 Displaced Mark Word 为 null，用 Lock Record 的数量代表重入次数，退出时逐条弹出。
- **偏向锁**（仅在启用偏向锁的版本中）：Mark Word 中的线程 ID 就是当前线程，直接进入。

### synchronized 为什么需要锁升级？
因为重量级锁的成本很高，而大多数同步代码实际上竞争很少。

JDK 6 之前 `synchronized` 直接使用 Monitor，每次加锁失败都要阻塞线程。阻塞和唤醒依赖操作系统 mutex，涉及用户态与内核态切换和线程上下文切换，即使根本没有竞争也要付出不小的代价，所以当时 `synchronized` 被称为"重量级锁"，性能明显不如 `ReentrantLock`。

JDK 6 引入锁升级，按竞争强度选择不同成本的实现：
- **没有竞争**（只有一个线程反复进入）：偏向锁，几乎零开销。
- **轻度竞争**（多个线程交替进入，很少同时争抢）：轻量级锁，用 CAS 在用户态完成，不阻塞线程。
- **激烈竞争**：重量级锁，竞争失败的线程挂起，不再空转消耗 CPU。

核心思想：在保证正确性的前提下，让低竞争场景尽量少付出代价，高竞争场景避免 CPU 空转。

版本变化：偏向锁在现代应用中收益变小、撤销成本高、实现复杂，JDK 15（JEP 374）起**默认关闭并标记废弃**，JDK 18 起 `-XX:+UseBiasedLocking` 选项失效。所以在 JDK 17、21 上，默认路径是无锁 → 轻量级锁 → 重量级锁。

### synchronized 的锁升级过程是怎样的？ | 高频
升级路径是 **无锁 → 偏向锁 → 轻量级锁 → 重量级锁**，锁状态记录在对象头的 Mark Word 中（锁标志位：无锁 `01`、偏向锁 `101`、轻量级锁 `00`、重量级锁 `10`）。偏向锁仅在 JDK 15 之前默认开启。

1. **偏向锁**：线程第一次进入同步块时，用 CAS 把线程 ID 写入 Mark Word，之后同一线程再进入只需比较线程 ID。对象已计算过 identity hashCode 时无法偏向（Mark Word 放不下线程 ID 和哈希码）。
2. **偏向撤销**：其他线程来竞争时，在安全点撤销偏向。原线程已退出同步块则恢复无锁或重偏向，仍在同步块内则升级为轻量级锁。
3. **轻量级锁**：线程在栈帧中建 Lock Record，复制 Mark Word（Displaced Mark Word），再 CAS 把 Mark Word 替换为指向 Lock Record 的指针。失败说明有竞争，先**自适应自旋**重试。
4. **重量级锁**：自旋仍失败或竞争激烈时**膨胀**，Mark Word 指向 `ObjectMonitor`，竞争失败的线程进入阻塞队列等待唤醒。

易错点：
- 锁升级一般是单向的，不会降级为轻量级锁或偏向锁；但空闲 Monitor 会被回收（deflation，JDK 15 起异步执行），对象回到无锁状态。
- 调用 `wait()` / `notify()` 需要 Monitor，会直接膨胀为重量级锁。
- JDK 21 引入新的轻量级锁实现（`-XX:LockingMode=2`，用线程私有的 lock-stack 代替复制 Mark Word），JDK 23 起成为默认，原理仍是 CAS 抢锁、竞争时膨胀。

### 什么是偏向锁、轻量级锁、重量级锁？ | 高频
| 锁 | 适用场景 | 实现 | 优点 | 缺点 |
| --- | --- | --- | --- | --- |
| 偏向锁 | 只有一个线程反复获取同一把锁 | Mark Word 记录线程 ID，再次进入只比较 ID | 加锁解锁几乎无开销 | 出现竞争时撤销需要等安全点，成本高；JDK 15 起默认关闭并废弃 |
| 轻量级锁 | 多个线程交替获取，几乎不同时争抢 | 栈帧中的 Lock Record + CAS 修改 Mark Word，失败自旋 | 不阻塞线程，在用户态完成，响应快 | 竞争激烈时自旋空耗 CPU |
| 重量级锁 | 竞争激烈、临界区执行时间长 | `ObjectMonitor` + 操作系统 mutex，失败的线程阻塞 | 不消耗 CPU 空转，吞吐稳定 | 阻塞唤醒涉及内核态切换和上下文切换，延迟高 |

一句话：偏向锁解决"没有竞争还要加锁"的开销，轻量级锁解决"短暂竞争就阻塞"的开销，重量级锁兜底处理真正的激烈竞争。

### 锁自旋时，是乐观锁发生可能性大还是悲观锁大？
**乐观锁更常见自旋**，而且自旋是乐观锁的核心工作方式。

- **乐观锁（CAS）**：不加锁，更新时比较并交换，失败就循环重试，这个"失败-重试"循环本身就是自旋。例如 `AtomicInteger.getAndIncrement()` 底层的 `getAndAddInt` 就是 do-while 循环 CAS。它基于"冲突少"的假设，认为自旋几次的成本小于线程挂起和唤醒。
- **悲观锁**：自旋只是优化手段，不是本质。`synchronized` 在轻量级锁阶段和膨胀前会自适应自旋，AQS 入队前也会尝试几次 CAS，但自旋失败后最终都会阻塞线程。

**自旋与单核 CPU**：自旋锁不适合单核 CPU。单核下持锁线程只有被调度上来才能释放锁，等待线程在 CPU 上空转只会浪费时间片，持锁线程反而无法运行。HotSpot 在单处理器上不进行自旋，JDK 6 起的自适应自旋也会根据上一次在同一把锁上的自旋成功率动态调整自旋次数，甚至直接跳过自旋。

## 乐观锁、CAS 与原子类
### 乐观锁和悲观锁有什么区别？各自适用场景？ | 高频
**悲观锁**假设冲突一定会发生，访问共享资源前先加锁，其他线程只能阻塞等待，核心思想是"防止并发"。
**乐观锁**假设冲突很少，访问时不加锁，在提交更新时检测数据是否被别人改过，冲突了就重试或报错，核心思想是"允许并发，检测冲突"。

| 对比 | 悲观锁 | 乐观锁 |
| --- | --- | --- |
| Java 实现 | `synchronized`、`ReentrantLock`、`ReentrantReadWriteLock` | CAS、原子类、`StampedLock` 乐观读 |
| 数据库实现 | `SELECT ... FOR UPDATE` 行锁 | 版本号 / 时间戳字段 |
| 冲突处理 | 拿不到锁就阻塞 | 更新失败后自旋重试或返回失败 |
| 开销 | 加锁解锁、阻塞唤醒、上下文切换，还可能死锁 | 无阻塞，但冲突多时大量重试浪费 CPU |
| 适用场景 | 写多读少、冲突概率高、临界区执行时间长、对一致性要求高 | 读多写少、冲突概率低、临界区很短 |

例子：库存扣减在并发不高时可以用版本号乐观锁；秒杀等热点写入场景冲突严重，乐观锁重试率很高，通常改用悲观锁、Redis 预扣减或队列串行化。

### 乐观锁一般怎么实现？ | 高频
两种常见方式：**版本号机制**和 **CAS**。

**版本号机制**（常用于数据库）
给数据加一个 `version` 字段，读取时把版本号一起读出来；更新时带上旧版本号作为条件，同时把版本号加一。

```sql
UPDATE product
SET stock = stock - 1, version = version + 1
WHERE id = 1 AND version = #{oldVersion};
```

影响行数为 0 说明期间被其他事务修改过，本次更新失败，由业务决定重试或提示失败。时间戳机制同理，用更新时间代替版本号。MyBatis-Plus 的 `@Version` 注解、JPA 的 `@Version` 都是这种做法。

**CAS**（常用于 Java 内存中的变量）
比较内存中的当前值和期望值，相等才更新为新值，整个"比较+更新"由 CPU 指令保证原子性，失败则自旋重试。JUC 的原子类、AQS、`ConcurrentHashMap` 都基于 CAS。

两者本质相同：都是"更新时检查是否被改过"，版本号机制可以看作在数据库层面的 CAS，并且天然没有 ABA 问题。

### CAS 是什么？ | 高频
CAS（Compare-And-Swap，比较并交换）是一种由 CPU 指令保证的原子操作，是乐观锁和无锁并发的基础。

它有三个操作数：
- **V**：要更新的内存位置（变量）。
- **E**：期望的旧值。
- **N**：要写入的新值。

当且仅当 V 的当前值等于 E 时，才把 V 更新为 N 并返回成功；否则什么也不做，返回失败（说明已被其他线程修改）。失败后通常重新读取最新值、重新计算，再次 CAS，这就是自旋。

```java
// AtomicInteger.incrementAndGet 的思路
int prev, next;
do {
    prev = value;          // 读取当前值（value 是 volatile）
    next = prev + 1;
} while (!compareAndSet(prev, next));
```

在 Java 中，CAS 由 `Unsafe` 的 native 方法（`compareAndSwapInt` 等，JDK 9 起内部改为 `jdk.internal.misc.Unsafe` 的 `compareAndSetInt`）或 JDK 9 引入的 `VarHandle` 提供。业务代码一般直接使用原子类。

### CAS 的底层原理是什么？ | 高频
CAS 的原子性最终由 **CPU 指令**保证，Java 层面只是调用。

调用链（以 `AtomicInteger` 为例）：
1. `AtomicInteger.compareAndSet()` 调用 `Unsafe.compareAndSetInt(this, valueOffset, expect, update)`，`valueOffset` 是 `value` 字段在对象中的内存偏移量。
2. `Unsafe` 的方法是 native 的，HotSpot 会把它作为 intrinsic 直接编译成对应的 CPU 指令。
3. **x86** 上是 `lock cmpxchg` 指令。`cmpxchg` 完成比较和交换，`lock` 前缀保证执行期间对该缓存行的独占访问（现代 CPU 一般锁缓存行而不是锁总线），同时具有内存屏障效果，所以 CAS 也带有 `volatile` 读写的内存语义。
4. **ARM** 上早期用 LL/SC（`ldxr` / `stxr`）实现，ARMv8.1 起有 `cas` 指令。

正因为 CAS 是一条不可中断的硬件指令，"比较"和"交换"之间不会被其他线程插入，所以不需要加锁就能保证原子性。

JUC 中的原子类、AQS 的 `state` 修改和入队、`ConcurrentHashMap` 的空桶插入和扩容、`FutureTask` 的状态流转，底层都是 CAS。

### CAS 会有什么问题？怎么解决？ | 高频
**1. ABA 问题**
变量从 A 改成 B 又改回 A，另一个线程 CAS 时看到还是 A，误认为没被修改过。对单纯的数值计数影响不大，但在链表、栈等依赖引用身份的无锁数据结构中会出错（比如节点被弹出又压回，`next` 指针已经变了）。
- 解决：加版本号或时间戳，每次修改版本号递增，比较时同时比较值和版本号。
- Java 提供 `AtomicStampedReference`（带 int 版本号）和 `AtomicMarkableReference`（带 boolean 标记，只关心是否被改过）。
- 数据库乐观锁用自增的 `version` 字段，天然避免 ABA。

**2. 自旋开销大**
竞争激烈时 CAS 不断失败，线程一直循环重试，空耗 CPU。
- 解决：冲突高的场景换用锁；限制自旋次数后退化为阻塞（`synchronized` 的自适应自旋、AQS 都是这种思路）；计数类场景用 `LongAdder` 分散热点；在自旋循环中调用 `Thread.onSpinWait()`（JDK 9）给 CPU 提示。

**3. 只能保证一个共享变量的原子操作**
一次 CAS 只能操作一个内存位置，多个变量之间的一致性无法直接保证。
- 解决：把多个变量封装成一个不可变对象，用 `AtomicReference` 整体 CAS 替换；或者直接加锁。

### Java 原子类有哪些？为什么线程安全、如何保证原子性？
**原子类分类**（`java.util.concurrent.atomic`）

| 类别 | 代表类 |
| --- | --- |
| 基本类型 | `AtomicInteger`、`AtomicLong`、`AtomicBoolean` |
| 引用类型 | `AtomicReference`、`AtomicStampedReference`（解决 ABA）、`AtomicMarkableReference` |
| 数组 | `AtomicIntegerArray`、`AtomicLongArray`、`AtomicReferenceArray` |
| 字段更新器 | `AtomicIntegerFieldUpdater`、`AtomicLongFieldUpdater`、`AtomicReferenceFieldUpdater`，原子更新某个类的 `volatile` 字段 |
| 累加器（JDK 8） | `LongAdder`、`DoubleAdder`、`LongAccumulator`、`DoubleAccumulator` |

**为什么线程安全：volatile + CAS**
- 内部的 `value` 字段用 `volatile` 修饰，保证可见性，每次读取都是最新值。
- 更新通过 CAS 完成，保证"比较并更新"这一步的原子性。
- 复合操作（如 `getAndIncrement()`）在一个循环里读取当前值、计算新值、CAS 写回，失败说明被其他线程改过，重新读取再试，直到成功。

```java
// JDK 8 中 Unsafe.getAndAddInt 的逻辑
public final int getAndAddInt(Object o, long offset, int delta) {
    int v;
    do {
        v = getIntVolatile(o, offset);
    } while (!compareAndSwapInt(o, offset, v, v + delta));
    return v;
}
```

（JDK 8 起在 x86 上，`getAndAdd` 会被 JIT 直接编译为 `lock xadd` 指令，不再需要循环。）

**适用范围**：单个变量的原子操作，比加锁更轻量，不会阻塞线程。多个变量之间需要保持一致时，单个原子类不够，要用 `AtomicReference` 封装对象或者加锁。高并发计数优先用 `LongAdder`。

### LongAdder 和 AtomicLong 有什么区别？
核心区别：`AtomicLong` 所有线程 CAS 同一个变量，`LongAdder`（JDK 8）把热点分散到多个变量上，用空间换时间。

**AtomicLong** 高并发时大量线程竞争同一变量，CAS 失败率高、不断自旋，缓存行还在各核间来回失效，性能急剧下降。

**LongAdder** 继承 `Striped64`，内部是 `base` + `Cell[]`：无竞争时 CAS 更新 `base`；失败后按线程探针哈希（probe）映射到某个 `Cell` 上 CAS 累加；竞争加剧时 `Cell[]` 翻倍扩容（最大不超过 CPU 核数对应的 2 的幂）；`Cell` 用 `@Contended` 填充缓存行避免伪共享；`sum()` 累加 `base` 和所有 `Cell`。

| 对比 | AtomicLong | LongAdder |
| --- | --- | --- |
| 高并发写性能 | 差，CAS 冲突严重 | 好，冲突被分散 |
| 读取 | `get()` 是精确的当前值 | `sum()` 不加锁，并发更新时不是精确快照，最终一致 |
| 内存 | 小 | 较大 |
| 功能 | 支持 `compareAndSet`、`getAndIncrement` 等丰富操作 | 只有 `add`、`increment`、`sum`、`reset` 等，不支持 CAS |

选择：需要精确值、CAS 操作或序号生成时用 `AtomicLong`；高并发下的统计计数（QPS、调用次数、监控指标）用 `LongAdder`。`ConcurrentHashMap` 的 `size` 计数（`baseCount` + `CounterCell[]`）也用了同样的思路。
