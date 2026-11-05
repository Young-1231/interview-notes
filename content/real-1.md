## 1–10
### 1. List、Set、Map的区别
List 和 Set 都继承 `Collection`,存单个元素;Map 存键值对,不继承 `Collection`。

| | List | Set | Map |
|---|---|---|---|
| 存储 | 单个元素 | 单个元素 | key-value |
| 有序 | 按插入顺序,可按下标访问 | 一般无序(LinkedHashSet 保持插入序,TreeSet 排序) | 一般无序(LinkedHashMap / TreeMap 有序) |
| 重复 | 允许重复 | 不允许重复(依赖 `equals`/`hashCode` 或比较器) | key 不重复,value 可重复 |
| null | 允许多个 | HashSet 允许一个 null,TreeSet 不允许 | HashMap 允许一个 null key;TreeMap、ConcurrentHashMap 不允许 null key |
| 常用实现 | ArrayList、LinkedList | HashSet、LinkedHashSet、TreeSet | HashMap、LinkedHashMap、TreeMap、ConcurrentHashMap |

选型:需要按位置访问、允许重复用 List;需要去重用 Set;需要按 key 查找用 Map。HashSet 底层就是 HashMap,元素存为 key,value 是一个固定的占位对象。

### 2. wait和sleep的区别
核心区别:`wait` 会释放锁,`sleep` 不会释放锁。

| | wait | sleep |
|---|---|---|
| 所属 | `Object` 的实例方法 | `Thread` 的静态方法 |
| 锁 | 释放持有的对象锁 | 不释放锁 |
| 使用前提 | 必须在 `synchronized` 块中调用,否则抛 `IllegalMonitorStateException` | 任意位置 |
| 唤醒 | `notify`/`notifyAll`、超时、中断 | 时间到或被中断 |
| 线程状态 | `wait()` 进入 WAITING,`wait(ms)` 进入 TIMED_WAITING | TIMED_WAITING |
| 用途 | 线程间协作(生产者-消费者) | 暂停执行一段时间 |

两者都会响应中断并抛出 `InterruptedException`。`wait` 被唤醒后要重新竞争锁,拿到锁才能继续执行,所以通常放在 `while` 循环里判断条件,防止虚假唤醒。

### 3. JVM的堆分为哪几部分
堆分为新生代和老年代,新生代又分为 Eden 区和两个 Survivor 区(S0/S1)。

- **新生代**:默认占堆的 1/3(`-XX:NewRatio=2`,老年代:新生代 = 2:1)。Eden:S0:S1 默认 8:1:1(`-XX:SurvivorRatio=8`)。新对象在 Eden 分配,Minor GC 时存活对象复制到一个 Survivor 区,两个 Survivor 轮流使用,每次只用一个。
- **老年代**:对象年龄达到阈值(`-XX:MaxTenuringThreshold`,默认 15)、大对象、Survivor 放不下的对象进入老年代,满了触发 Major/Full GC。
- **方法区**:JDK 7 及之前用永久代实现,属于堆的一部分;JDK 8 移除永久代,改为元空间(Metaspace),使用本地内存,不在堆里。字符串常量池和静态变量在 JDK 7 已移到堆中。

补充:G1(JDK 9 起默认收集器)把堆划分为大小相等的 Region,新生代/老年代只是逻辑概念,还有专门存大对象的 Humongous Region。

### 4. 消息中间件有什么作用，哪些场景下需要用到异步？
消息中间件的三大作用是**解耦、异步、削峰**。

- **解耦**:生产者只管发消息,新增下游系统只需订阅,不用改上游代码。
- **异步**:非核心步骤放到 MQ 后台处理,主流程快速返回,降低响应时间。
- **削峰**:突发流量先进队列,消费者按自身能力拉取,保护数据库等下游。
- 此外还能做广播通知、基于可靠消息实现最终一致性、延迟任务(如订单超时取消)。

**适合异步的场景**:主流程不依赖其结果、允许短暂延迟的操作。例如:用户注册后发邮件/短信;下单后加积分、发优惠券、通知物流;秒杀下单先扣 Redis 库存再异步落库;日志、埋点采集;搜索索引同步。

引入 MQ 的代价:系统复杂度和可用性风险上升,需要处理消息丢失、重复消费、顺序性和一致性问题。需要强实时、强一致返回结果的步骤(如支付扣款结果)不适合异步。

### 5. 如何对当日产生的上百万条数据的日志信息做删除？
不要一条 `DELETE` 删完,应该**分批删除**,或者从设计上用**分区表 / 按天分表直接删整块**。

- **问题**:一次删上百万行会形成大事务,长时间持有锁、产生大量 undo/binlog,导致主从延迟,失败回滚也很慢。
- **分批删除**:按主键范围或 `LIMIT` 分批,每批几千行,批次间短暂停顿:
```sql
DELETE FROM log WHERE create_time >= '2026-11-06' AND create_time < '2026-11-07' LIMIT 5000;
```
循环执行直到影响行数为 0,`create_time` 上要有索引。
- **分区表(推荐)**:按天做 RANGE 分区,删除当天数据直接 `ALTER TABLE log DROP PARTITION p20261106;`(或 `TRUNCATE PARTITION`),几乎瞬间完成,不逐行写日志。
- **按天分表**:日志写入 `log_20261106`,删除时 `DROP TABLE` 或 `TRUNCATE`。
- **保留少量删大量**:可以把要保留的数据导到新表,再 `RENAME` 互换,然后删除旧表。

删除放在业务低峰期执行;`DELETE` 后表空间不会自动收缩,需要时用 `OPTIMIZE TABLE` 回收。

### 6. IO多路复用机制是什么
IO 多路复用是指**一个线程通过一个系统调用同时监听多个文件描述符(socket)**,哪个 fd 就绪就处理哪个,避免为每个连接开一个线程阻塞等待。Linux 上有 select、poll、epoll 三种实现。

| | select | poll | epoll |
|---|---|---|---|
| 存储 fd | 位图 `fd_set` | 链表/数组 `pollfd` | 内核红黑树 + 就绪链表 |
| 连接上限 | 默认 1024 | 无硬限制 | 无硬限制 |
| 每次调用 | 把整个 fd 集合拷贝到内核 | 同样全量拷贝 | `epoll_ctl` 注册一次,不用重复拷贝 |
| 找就绪 fd | 遍历 O(n) | 遍历 O(n) | 回调放入就绪链表,`epoll_wait` 直接返回就绪 fd |
| 触发方式 | 水平触发 | 水平触发 | 支持水平触发 LT 和边缘触发 ET |

epoll 适合大量连接但活跃连接少的场景。Redis、Nginx、Netty 底层都用 epoll;Java NIO 的 `Selector` 在 Linux 上也基于 epoll。

### 7. 事务的四大特性（ACID）
ACID 指原子性、一致性、隔离性、持久性。在 InnoDB 中,A、I、D 是手段,C 是目的。

- **原子性(Atomicity)**:事务中的操作要么全部成功,要么全部回滚。靠 **undo log** 实现,回滚时按 undo log 做反向操作。
- **一致性(Consistency)**:事务前后数据满足完整性约束和业务规则,比如转账前后总金额不变。由其他三个特性加上应用逻辑共同保证。
- **隔离性(Isolation)**:并发事务之间互不干扰。靠**锁**(写写冲突)和 **MVCC**(读写并发)实现,隔离程度由隔离级别决定。
- **持久性(Durability)**:事务提交后修改永久保存,宕机也不丢。靠 **redo log** 实现:采用 WAL,先写 redo log 再刷数据页,崩溃后用 redo log 恢复。`innodb_flush_log_at_trx_commit=1` 时每次提交都刷盘。

### 8. Spring依赖注入的三种方式
三种方式是**构造器注入、Setter 注入、字段注入**,Spring 官方推荐构造器注入。

```java
// 1. 构造器注入:只有一个构造器时可省略 @Autowired(Spring 4.3+)
@Service
public class OrderService {
    private final UserService userService;
    public OrderService(UserService userService) { this.userService = userService; }
}
// 2. Setter 注入
@Autowired
public void setUserService(UserService userService) { this.userService = userService; }
// 3. 字段注入
@Autowired
private UserService userService;
```

| 方式 | 优点 | 缺点 |
|---|---|---|
| 构造器 | 依赖可设为 `final`、不可变;对象创建即完整;便于单元测试;能暴露循环依赖 | 依赖多时构造器参数长 |
| Setter | 适合可选依赖,可重新注入 | 对象可能处于依赖未注入的状态 |
| 字段 | 代码最简洁 | 不能用 `final`;脱离容器难以测试;隐藏依赖关系 |

注意:构造器注入的循环依赖无法靠三级缓存解决,启动直接报错;Spring Boot 2.6 起默认也禁止了字段/Setter 的循环依赖。

### 9. springAOP中before和after是干什么的，切点的注解？
`@Before` 是前置通知,在目标方法执行前运行;`@After` 是后置(最终)通知,在目标方法执行后运行,**无论正常返回还是抛异常都会执行**,类似 `finally`。切点用 `@Pointcut` 定义。

```java
@Aspect
@Component
public class LogAspect {
    @Pointcut("execution(* com.example.service..*.*(..))")
    public void servicePointcut() {}

    @Before("servicePointcut()")
    public void before(JoinPoint jp) { /* 参数校验、记录入参 */ }

    @After("servicePointcut()")
    public void after(JoinPoint jp) { /* 释放资源、记录结束 */ }
}
```

- 五种通知:`@Before`、`@After`、`@AfterReturning`(正常返回后,可拿返回值)、`@AfterThrowing`(抛异常后)、`@Around`(环绕,可控制是否执行目标方法)。
- 常用切点表达式:`execution(...)` 按方法签名匹配;`@annotation(com.xx.Log)` 匹配带指定注解的方法;`within(...)` 按类型匹配。
- 切面类需要 `@Aspect` 加上 `@Component` 注册为 Bean。
- 执行顺序(Spring 5.2.7+):Around 前 → Before → 目标方法 → AfterReturning/AfterThrowing → After → Around 后。

### 10. springboot怎么加载类？
可以从两个层面回答:**Bean 是怎么被扫描和自动配置进容器的**,以及 **jar 包里的类是怎么被类加载器加载的**。

**Bean 层面**:
- `@SpringBootApplication` = `@SpringBootConfiguration` + `@EnableAutoConfiguration` + `@ComponentScan`。
- `@ComponentScan` 默认扫描启动类所在包及其子包,把 `@Component`/`@Service`/`@Controller` 等注解的类注册为 BeanDefinition。
- `@EnableAutoConfiguration` 通过 `AutoConfigurationImportSelector` 读取候选自动配置类:Boot 2.x 读 `META-INF/spring.factories`;2.7 起改为 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`,3.x 只支持后者。再用 `@ConditionalOnClass`、`@ConditionalOnMissingBean` 等条件注解筛选,满足条件才生效。
- 之后 `refresh()` 实例化单例 Bean。

**类加载层面**:
- 底层仍是 JVM 的双亲委派模型。
- 可执行 fat jar 的入口是 `JarLauncher`(MANIFEST 中的 `Main-Class`),它创建 `LaunchedURLClassLoader`,加载 `BOOT-INF/classes` 和 `BOOT-INF/lib/*.jar`,再反射调用 `Start-Class` 指定的启动类的 `main` 方法。

## 11–20
### 11. 脏读是什么，脏读发生在哪种隔离级别下
脏读是指**一个事务读到了另一个事务还未提交的数据**,如果对方回滚,读到的就是从没真正存在过的数据。只有在 **READ UNCOMMITTED(读未提交)** 级别下会发生。

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
|---|---|---|---|
| READ UNCOMMITTED | 可能 | 可能 | 可能 |
| READ COMMITTED | 不会 | 可能 | 可能 |
| REPEATABLE READ(MySQL 默认) | 不会 | 不会 | 可能(InnoDB 大部分避免) |
| SERIALIZABLE | 不会 | 不会 | 不会 |

- **不可重复读**:同一事务内两次读同一行,结果不同,因为中间有其他事务提交了修改。
- **幻读**:同一事务内两次范围查询,行数不同,因为中间有其他事务插入了数据。
- InnoDB 在 RR 下,快照读通过 MVCC 的 ReadView 避免幻读,当前读(`SELECT ... FOR UPDATE`)通过 Next-Key Lock 避免幻读;但快照读和当前读混用时仍可能出现幻读。
- RC 及以上不会脏读,是因为 MVCC 只读取已提交版本。

### 12. Java的锁的优化
JDK 6 对 `synchronized` 做了大量优化,核心是**锁升级**:无锁 → 偏向锁 → 轻量级锁 → 重量级锁,升级不可逆。

- **偏向锁**:锁总被同一个线程获取时,在对象头 Mark Word 记录线程 ID,之后该线程进入同步块无需 CAS。注意 JDK 15 起默认禁用偏向锁,JDK 18 移除了相关代码。
- **轻量级锁**:有少量线程交替竞争时,线程在栈帧中创建 Lock Record,用 CAS 把 Mark Word 替换为指向它的指针,失败则自旋重试。
- **重量级锁**:自旋失败或竞争激烈时膨胀为重量级锁,依赖 ObjectMonitor 和操作系统互斥量,线程阻塞需要切换到内核态。
- **自适应自旋**:根据上次自旋是否成功动态调整自旋次数。
- **锁消除**:JIT 通过逃逸分析发现锁对象不会被其他线程访问,直接去掉锁。
- **锁粗化**:连续对同一对象反复加锁解锁时,合并成一次范围更大的锁。

代码层面的优化:减小锁粒度、缩短持锁时间、读写分离用 `ReentrantReadWriteLock`、用 CAS 或原子类代替锁、使用 `ConcurrentHashMap` 等并发容器。

### 13. 线程的状态
Java 线程在 `Thread.State` 中定义了 **6 种状态**:NEW、RUNNABLE、BLOCKED、WAITING、TIMED_WAITING、TERMINATED。

| 状态 | 含义 | 进入方式 |
|---|---|---|
| NEW | 已创建未启动 | `new Thread()` |
| RUNNABLE | 可运行,包含操作系统层面的就绪和运行中 | `start()` |
| BLOCKED | 等待获取 `synchronized` 监视器锁 | 竞争锁失败 |
| WAITING | 无限期等待其他线程唤醒 | `wait()`、`join()`、`LockSupport.park()` |
| TIMED_WAITING | 限时等待 | `sleep(ms)`、`wait(ms)`、`join(ms)`、`parkNanos` |
| TERMINATED | 执行结束 | `run()` 正常结束或抛出异常 |

注意点:
- Java 没有单独的 RUNNING 状态,线程阻塞在 IO 上时也显示 RUNNABLE。
- 用 `ReentrantLock` 等 AQS 锁阻塞时,线程状态是 WAITING / TIMED_WAITING,不是 BLOCKED,因为底层用的是 `park`。
- 一个线程只能 `start()` 一次,再次调用会抛 `IllegalThreadStateException`。

### 14. @RequestMapping注解作用，提交方式除了get和post还有哪些
`@RequestMapping` 用来**把 HTTP 请求映射到 Controller 的类或方法上**,可以按 URL、请求方法、参数、请求头、Content-Type 等条件匹配。

```java
@RestController
@RequestMapping("/users")              // 类上:公共前缀
public class UserController {
    @RequestMapping(value = "/{id}", method = RequestMethod.GET, produces = "application/json")
    public User get(@PathVariable Long id) { ... }

    @PostMapping                       // 等价于 @RequestMapping(method = POST)
    public void create(@RequestBody User u) { ... }
}
```

- 常用属性:`value/path`、`method`、`params`、`headers`、`consumes`(请求 Content-Type)、`produces`(响应类型)。
- 简化注解:`@GetMapping`、`@PostMapping`、`@PutMapping`、`@DeleteMapping`、`@PatchMapping`。

HTTP/1.1 请求方法共 8 种:GET、POST、**PUT**(整体更新/替换)、**DELETE**(删除)、**PATCH**(局部更新)、**HEAD**(只要响应头)、**OPTIONS**(查询支持的方法,CORS 预检请求用它)、**TRACE**(回显请求,用于诊断,一般禁用)。另有 CONNECT,用于代理建立隧道。GET、HEAD、PUT、DELETE、OPTIONS、TRACE 是幂等的,POST 不幂等,PATCH 不保证幂等。

### 15. MVC的流程
Spring MVC 的核心是前端控制器 **DispatcherServlet**,处理流程如下:

1. 用户请求到达 `DispatcherServlet`。
2. `DispatcherServlet` 调用 **HandlerMapping**,根据 URL 找到对应的 Handler(Controller 方法),返回 `HandlerExecutionChain`(Handler 加上拦截器)。
3. 通过 **HandlerAdapter** 适配并调用 Handler,调用前执行拦截器的 `preHandle`;参数解析器完成参数绑定。
4. Controller 执行业务逻辑,返回 `ModelAndView`,之后执行拦截器的 `postHandle`。
5. **ViewResolver** 把逻辑视图名解析为具体 View。
6. View 用 Model 数据渲染(JSP、Thymeleaf 等),写入响应,最后执行拦截器的 `afterCompletion`。

前后端分离时用 `@RestController` / `@ResponseBody`,不走视图解析和渲染,而是由 `HttpMessageConverter`(如 Jackson)把返回对象序列化为 JSON 直接写入响应体。异常由 `HandlerExceptionResolver` 处理,常配合 `@RestControllerAdvice` + `@ExceptionHandler` 做全局异常处理。

### 16. Redis数据结构用过哪些
Redis 有 5 种基本类型:**String、List、Hash、Set、ZSet**;还有 Bitmap、HyperLogLog、GEO、Stream 等特殊类型。

| 类型 | 底层实现 | 典型场景 |
|---|---|---|
| String | SDS | 缓存对象 JSON、计数器 `INCR`、分布式锁 `SET NX EX` |
| Hash | listpack / 哈希表 | 存对象字段、购物车 |
| List | quicklist | 消息队列、最新列表 |
| Set | intset / 哈希表 | 去重、共同关注(交集)、抽奖 |
| ZSet | listpack / 跳表 + 哈希表 | 排行榜、延时队列、按时间排序的 Feed |
| Bitmap | String | 签到、在线状态 |
| HyperLogLog | 稀疏/稠密结构 | UV 统计,约 0.81% 误差,每个 key 最多 12KB |
| GEO | ZSet | 附近的人、附近店铺 |
| Stream | 基数树 + listpack | 支持消费组的消息队列(Redis 5.0+) |

版本说明:Redis 7.0 起用 listpack 全面取代 ziplist。回答时最好结合项目举例,比如用 String 缓存商户信息、用 ZSet 做点赞排行、用 GEO 查附近商户、用 Bitmap 做签到。

### 17. spring的Bean生命周期
可以概括为:**实例化 → 属性填充 → 初始化 → 使用 → 销毁**,其中初始化阶段有多个扩展点。

1. **实例化**:根据 BeanDefinition 通过反射调用构造器创建对象。
2. **属性填充**:依赖注入,处理 `@Autowired`、`@Value` 等。
3. **Aware 回调**:`BeanNameAware`、`BeanFactoryAware`、`ApplicationContextAware` 等,注入容器相关对象。
4. **BeanPostProcessor 前置处理**:`postProcessBeforeInitialization`,`@PostConstruct` 在这一步执行。
5. **初始化方法**:`InitializingBean.afterPropertiesSet()`,然后是自定义的 `init-method` / `@Bean(initMethod=...)`。
6. **BeanPostProcessor 后置处理**:`postProcessAfterInitialization`,**AOP 代理对象就在这里生成**。
7. **使用**:Bean 放入单例池,供应用使用。
8. **销毁**:容器关闭时依次执行 `@PreDestroy`、`DisposableBean.destroy()`、自定义 `destroy-method`。

补充:只有单例 Bean 由容器管理完整生命周期;prototype Bean 容器只负责创建,不调用销毁方法。循环依赖靠三级缓存在实例化后提前暴露早期引用来解决。

### 18. 讲讲csrf原理
CSRF(跨站请求伪造)是指攻击者诱导已登录用户访问恶意页面,**利用浏览器访问目标站点时自动携带 Cookie 的特性**,以用户身份发起非本意的请求,比如转账、改密码。

**攻击条件**:
- 用户已登录目标站点,身份凭证存在 Cookie 中且未过期。
- 目标站点仅凭 Cookie 识别身份,且请求参数可以被预测。
- 用户访问了攻击者的页面,页面里有自动提交的表单,或 `<img src="https://bank.com/transfer?to=x&amount=1000">`。

攻击者**拿不到 Cookie,也读不到响应**(受同源策略限制),只是借用户的浏览器发出请求。

**防御**:
- **CSRF Token**:服务端生成随机 Token,放在表单隐藏字段或请求头中,提交时校验。攻击者无法跨域读取页面,因此拿不到 Token。这是最主要的手段。
- **SameSite Cookie**:设为 `Strict` 或 `Lax`,跨站请求时不携带 Cookie。Chrome 从 2020 年起对未声明的 Cookie 默认按 `Lax` 处理,`Lax` 仍允许顶级导航的 GET 请求带 Cookie。
- **校验 Origin / Referer** 请求头是否来自本站。
- **关键操作二次验证**:短信验证码、输入密码。
- 用 `Authorization: Bearer <token>` 请求头传 JWT 而不是 Cookie,天然不受 CSRF 影响。
- GET 请求不做修改操作。

与 XSS 的区别:XSS 是在目标站点注入并执行脚本;CSRF 是借用用户身份,不需要注入脚本。存在 XSS 时 CSRF Token 可能被窃取,防御会失效。

### 19. 用过linux吗，查看环境变量的指令、查看当前用户的指令、755表示什么权限、改变路径的指令？
用过,常用于部署服务和排查问题。

- **查看环境变量**:`env` 或 `printenv` 列出所有环境变量;`echo $PATH` 或 `printenv PATH` 查看单个变量;`export JAVA_HOME=/usr/local/jdk` 设置变量(仅当前会话有效,永久生效写入 `~/.bashrc` 或 `/etc/profile`)。`set` 会额外显示 shell 局部变量和函数。
- **查看当前用户**:`whoami`;`id` 查看 uid、gid 和所属组;`who` 或 `w` 查看所有登录的用户。
- **755 权限**:三位数字依次对应 **所有者 / 所属组 / 其他用户**,r=4、w=2、x=1。7 = 4+2+1 = rwx,5 = 4+1 = r-x,所以 755 = `rwxr-xr-x`:所有者可读写执行,组用户和其他用户可读和执行,不可写。常用于脚本和目录,设置命令为 `chmod 755 file`。对比:644 = `rw-r--r--`,常用于普通文件。
- **改变路径**:`cd /path` 进入目录;`cd ..` 返回上级;`cd ~` 或直接 `cd` 回到家目录;`cd -` 回到上一次所在目录;`pwd` 显示当前路径。

### 20. 介绍一下MVC机制
MVC 是一种把应用分成 **Model(模型)、View(视图)、Controller(控制器)** 三层的设计模式,目的是让数据、展示和控制逻辑解耦。

- **Model**:数据和业务逻辑,包括实体类、Service、DAO。
- **View**:展示数据,如 JSP、Thymeleaf 页面;前后端分离时 View 由前端负责,后端返回 JSON。
- **Controller**:接收请求、调用 Model 处理、选择视图或返回数据,是两者之间的协调者。

**好处**:职责分离,前后端可以并行开发;同一个 Model 可以对应多个 View;便于维护和测试。

**在 Spring MVC 中的实现**:`DispatcherServlet` 作为前端控制器统一接收请求,经 HandlerMapping 找到 `@Controller` 方法,Controller 调用 Service 得到数据放入 Model,再由 ViewResolver 解析视图并渲染;如果是 `@RestController`,则由 `HttpMessageConverter` 直接把对象转成 JSON 返回。

注意:MVC 和后端分层架构(Controller / Service / DAO)不是一回事。在分层架构里,Service 和 DAO 都属于 MVC 中 Model 的范畴。

## 21–30
### 21. 了解国密吗，对称和非对称常见有哪些打过ctf吗，主要做哪个方向（web）
国密是国家密码管理局发布的商用密码算法标准,常用的有 **SM2、SM3、SM4**。

| 算法 | 类型 | 要点 | 对标 |
|---|---|---|---|
| SM2 | 非对称(椭圆曲线) | 256 位素数域曲线;支持数字签名、密钥交换、公钥加密 | RSA / ECDSA |
| SM3 | 密码杂凑(哈希) | 输出 256 位摘要 | SHA-256 |
| SM4 | 对称分组密码 | 分组长度 128 位,密钥 128 位,32 轮迭代 | AES-128 |

另外还有 SM1(对称算法,不公开,只在硬件芯片中实现)、SM9(基于标识的非对称算法)、ZUC 祖冲之算法(序列密码,用于 4G/5G)。

**常见对称算法**:AES(主流,128/192/256 位密钥)、SM4、DES(56 位有效密钥,已不安全)、3DES、ChaCha20。
**常见非对称算法**:RSA、ECC 系列(ECDSA、ECDH、Ed25519)、SM2、DH 密钥交换。
**对比**:对称加密快,适合加密大量数据,但密钥分发困难;非对称加密慢,适合密钥交换和数字签名。实际中通常组合使用,比如 HTTPS 用非对称协商密钥,再用对称密钥加密数据。哈希(SHA-256、SM3、MD5)不是加密,不可逆。

**CTF 部分**按真实情况回答。如果做过 Web 方向,可以说出常见题型:SQL 注入、XSS、SSRF、文件上传、文件包含、反序列化、命令执行等,再挑一个印象深的题讲思路。没打过就如实说,并说明了解哪些常见 Web 漏洞及其防御方式。

### 22. 实习项目中最困难的事？
这类题考察的是解决问题的能力和复盘能力,推荐用 **STAR** 结构组织,控制在 2 分钟左右。

- **S(情境)**:项目背景、你的角色,一两句话说清楚。
- **T(任务)**:具体遇到了什么困难,最好是技术难题,并用数据说明严重性。例如:"某接口高峰期 RT 从 100ms 涨到 2s"、"秒杀活动出现超卖"、"缓存与数据库数据不一致"。
- **A(行动)**:重点讲这一部分,占一半以上的篇幅。说清楚怎么定位问题(看日志、Arthas、慢查询日志、压测)、考虑过哪些方案、为什么选当前方案、怎么落地。
- **R(结果)**:量化结果(QPS、RT、错误率的变化),以及沉淀了什么经验,比如形成文档、推广到其他模块。

**注意点**:
- 选自己真正主导或深度参与的事,面试官会顺着细节追问。
- 困难要有技术含量,避免"需求变来变去"、"跟同事沟通困难"这类纯抱怨。如果讲协作类困难,重点放在自己怎么推动解决。
- 体现思考过程和权衡,而不仅仅是结果。
- 提前准备好被追问的点:为什么不用另一种方案、如果流量再大十倍怎么办。

### 23. 代码量
面试官问代码量,是想判断**编码熟练度和项目经验是否真实**。回答要给出一个合理的数字,并用具体项目支撑。

**回答框架**:
- **总量**:给一个诚实的估算范围。在校生和实习生一般在几万行级别,例如"Java 累计 3–5 万行左右"。
- **构成**:按项目拆分,比如"实习期间负责 X 模块,大约写了 8000 行业务代码,包括接口、SQL 和单元测试;个人项目约 1 万行;另外刷了 300 多道算法题"。
- **质量**:补充代码规范、Code Review、单测覆盖率等,说明不只是堆行数。

**注意点**:
- 数字不要夸大,面试官很容易通过追问项目细节判断真假。
- 可以说明统计方式,比如"按 Git 提交统计"。
- 引导到自己最熟悉的项目上,方便面试官接着追问。
- 可以补一句"更关注代码质量,比如重构时把重复逻辑抽成公共组件,减少了代码量"。

### 24. 内存溢出
内存溢出(OOM,`OutOfMemoryError`)是指 JVM 内存不够分配新对象,GC 之后仍无法回收出足够空间。除了程序计数器,其他运行时数据区都可能发生 OOM。

| 区域 | 报错信息 | 常见原因 |
|---|---|---|
| 堆 | `Java heap space` | 内存泄漏(静态集合不断增长、ThreadLocal 未 remove)、一次性加载大量数据、`-Xmx` 设置过小 |
| 堆 / GC | `GC overhead limit exceeded` | 98% 以上的时间在做 GC,但回收不到 2% 的堆 |
| 元空间(JDK 8+) | `Metaspace` | 动态生成大量类(CGLIB、反射)、类加载器泄漏 |
| 虚拟机栈 | 通常是 `StackOverflowError`;无法创建线程时为 `unable to create new native thread` | 递归过深;线程过多 |
| 直接内存 | `Direct buffer memory` | NIO/Netty 的 DirectByteBuffer 未释放 |

**排查思路**:
1. 添加启动参数 `-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=...`,OOM 时自动导出堆转储;也可以用 `jmap -dump:live,format=b,file=heap.hprof <pid>` 手动导出。
2. 用 MAT 或 VisualVM 分析,找出占用最大的对象和 GC Roots 引用链。
3. 判断是内存泄漏(修改代码)还是内存溢出(堆确实不够,调大 `-Xmx` 或优化数据结构)。
4. 用 `jstat -gcutil` 观察 GC 情况。

注意区分:内存泄漏是对象不再使用却无法被回收,泄漏积累下去最终会导致内存溢出。

### 25. java项目几个人做的？前后端传值需要接口，接口规范如何制定？
**人数和分工**按真实情况回答,并讲清楚自己负责的部分,例如"4 人团队:2 个后端、1 个前端、1 个测试,我负责用户和订单模块的后端开发"。

**接口规范可以从这几方面制定**:
- **RESTful 风格**:URL 用名词表示资源,用 HTTP 方法表达操作:`GET /users/{id}` 查询、`POST /users` 新增、`PUT /users/{id}` 修改、`DELETE /users/{id}` 删除。路径统一小写,带版本号如 `/api/v1/`。
- **统一响应结构**:
```json
{ "code": 0, "message": "success", "data": {} }
```
定义统一的业务错误码表,配合全局异常处理器 `@RestControllerAdvice` 返回。
- **参数规范**:字段统一驼峰命名;时间统一格式(如 `yyyy-MM-dd HH:mm:ss` 或时间戳);`Long` 类型 ID 转成字符串传给前端,避免 JS 精度丢失;分页参数统一用 `pageNo`/`pageSize`;用 `@Valid` 做参数校验。
- **文档化**:用 Swagger/Knife4j 或 Apifox 维护接口文档,先定义接口再开发,前端用 Mock 数据并行开发。
- **安全与可靠性**:统一的鉴权方式(请求头带 Token);写操作接口保证幂等;敏感数据脱敏;接口限流。
- **变更管理**:接口改动要通知对方并更新文档,不兼容的改动需要升级版本号。

### 26. 前端框架使用哪个，实习期间遇到vue的问题有哪些，如何解决？
先如实说明用的框架和熟练程度,例如"主要用 Vue 3 + Element Plus,后端岗位,前端以联调和简单页面为主"。再挑 1–2 个真实遇到的问题,按"现象 → 原因 → 解决"讲。常见的真实问题可以参考:

- **跨域**:本地开发调用后端接口报 CORS 错误。解决:开发环境配置 Vite/webpack 的 `devServer.proxy` 代理;后端配置 CORS(`@CrossOrigin` 或全局 `CorsFilter`);生产环境用 Nginx 反向代理。
- **Long 型 ID 精度丢失**:雪花 ID 超过 JS 的 `Number.MAX_SAFE_INTEGER`(2^53−1),后几位变成 0。解决:后端序列化时把 Long 转为 String(Jackson `ToStringSerializer`)。
- **响应式失效**:Vue 2 中直接给对象新增属性、通过下标修改数组不会触发更新。解决:使用 `this.$set` 或数组的变异方法;Vue 3 改用 Proxy 实现响应式,这类问题基本消失。但 Vue 3 中解构 `reactive` 对象会丢失响应式,需要用 `toRefs`。
- **DOM 未更新就操作**:修改数据后立刻获取 DOM 拿到的是旧值。解决:放在 `nextTick` 回调里执行。
- **组件通信混乱**:多层组件之间传值困难。解决:父子组件用 props/emit,跨层级用 provide/inject,全局状态用 Pinia(Vue 2 时代用 Vuex)。
- **路由刷新 404**:history 模式部署后刷新页面 404。解决:Nginx 配置 `try_files $uri $uri/ /index.html;`。

回答重点是体现定位问题的思路(看控制台、Network 面板、Vue Devtools),不需要罗列太多。

### 27. synchronize
`synchronized` 是 JVM 层面的**可重入、非公平、独占的互斥锁**,保证原子性、可见性和有序性。

**用法**:
- 修饰实例方法:锁当前对象 `this`。
- 修饰静态方法:锁当前类的 `Class` 对象。
- 修饰代码块:锁括号中指定的对象。

**底层原理**:
- 同步代码块编译后生成 `monitorenter` 和 `monitorexit` 字节码指令(通常有两个 `monitorexit`,第二个用于异常时释放锁);同步方法通过方法的 `ACC_SYNCHRONIZED` 标志实现。
- 每个对象关联一个 Monitor,HotSpot 中的实现是 `ObjectMonitor`,包含 `_owner`(持有锁的线程)、`_recursions`(重入次数)、`_EntryList`(等待锁的线程)、`_WaitSet`(调用了 `wait` 的线程)。
- 锁状态记录在对象头的 Mark Word 中。

**锁升级**(JDK 6 引入):无锁 → 偏向锁 → 轻量级锁(CAS + 自旋) → 重量级锁(ObjectMonitor,线程阻塞)。JDK 15 起偏向锁默认关闭。

**与 ReentrantLock 对比**:`synchronized` 自动加锁和释放锁,不能中断等待,只能是非公平锁,只有一个等待队列;`ReentrantLock` 需要手动 `unlock`,支持 `lockInterruptibly`、`tryLock` 超时、公平锁和多个 `Condition`。

### 28. 分布式事务如何实现？
分布式事务没有完美方案,要在**强一致性和性能/可用性之间权衡**。基于 CAP 和 BASE 理论,大多数互联网业务选择最终一致性。

| 方案 | 原理 | 一致性 | 优缺点 |
|---|---|---|---|
| 2PC / XA | 协调者先让各参与者准备(Prepare),全部成功再提交(Commit) | 强一致 | 同步阻塞、性能差;协调者单点问题 |
| 3PC | 在 2PC 基础上增加 CanCommit 阶段和超时机制 | 强一致 | 减少了阻塞,但仍可能不一致,实际很少使用 |
| TCC | Try 预留资源 → Confirm 确认 → Cancel 取消 | 最终一致 | 性能好,但业务侵入大;需要处理空回滚、悬挂和幂等 |
| Seata AT | 一阶段直接提交本地事务,同时记录 undo_log;二阶段异步删除日志或根据 undo_log 回滚 | 最终一致 | 对业务无侵入,依赖全局锁 |
| Saga | 长事务拆成多个本地事务,失败时按反向顺序执行补偿操作 | 最终一致 | 适合长流程;没有隔离性 |
| 本地消息表 | 业务操作和写消息表放在同一个本地事务中,定时任务扫描消息表并投递 MQ | 最终一致 | 实现简单,但与业务库耦合 |
| RocketMQ 事务消息 | 先发半消息 → 执行本地事务 → 提交或回滚消息;状态未知时 Broker 回查 | 最终一致 | 可靠,下游消费要保证幂等 |
| 最大努力通知 | 多次重试通知,并提供对账查询接口 | 弱一致 | 适合支付回调等场景 |

**选型**:金融等需要强一致的场景用 XA 或 TCC;一般业务优先选 MQ 可靠消息或 Seata AT。最好的方案是通过业务设计尽量避免分布式事务。

### 29. Java多态的原理？怎么实现的？
多态是指**同一个方法调用,根据对象的实际类型执行不同的实现**。Java 运行时多态依靠**动态绑定**实现,底层是**虚方法表(vtable)**。

**三个必要条件**:继承或实现接口、子类重写方法、父类引用指向子类对象。

```java
Animal a = new Dog();
a.speak();   // 编译期按 Animal 检查方法是否存在,运行时调用 Dog.speak()
```

**底层实现**:
- 编译期:编译器只知道静态类型 `Animal`,生成 `invokevirtual Animal.speak` 指令(接口方法用 `invokeinterface`)。
- 类加载的链接阶段:JVM 为每个类建立虚方法表,表中存放各方法实际入口地址。子类重写的方法会覆盖对应的表项,没有重写的指向父类实现;同一个方法在父子类表中的索引相同。
- 运行期:执行 `invokevirtual` 时,根据栈上对象的实际类型(通过对象头中的类型指针找到 Klass),在该类的 vtable 中按索引找到方法并调用。
- 接口方法使用接口方法表(itable)查找。JIT 还会通过内联缓存、类层次分析做去虚拟化优化。

**补充**:方法重载是编译期确定的(静态分派);`static`、`private`、`final` 方法和构造器不参与多态(用 `invokestatic`/`invokespecial` 调用,在编译期或类加载时就确定了目标)。字段也没有多态,访问字段看的是引用的静态类型。

### 30. C++三特性
C++ 面向对象的三大特性是**封装、继承、多态**,与 Java 相同,但实现细节有差异。

- **封装**:把数据和操作数据的方法封装在类中,用 `public`/`protected`/`private` 控制访问。C++ 的 `class` 默认是 `private`,`struct` 默认是 `public`;还可以用 `friend` 友元突破访问限制。
- **继承**:子类复用父类的成员。C++ 支持**多继承**,会带来菱形继承问题,用**虚继承**(`virtual` 继承)解决;继承方式分为 public/protected/private 三种。Java 只支持类的单继承,可以实现多个接口。
- **多态**:
  - 静态多态:函数重载、运算符重载、模板,在编译期确定。
  - 动态多态:基类函数声明为 `virtual`,子类重写,通过基类指针或引用调用时,运行期根据虚函数表(vtable)和对象中的虚表指针(vptr)找到实际函数。

**与 Java 的区别**:Java 中非 `static`、`private`、`final` 的实例方法默认就是虚方法;C++ 必须显式写 `virtual` 才有动态多态。C++ 中有虚函数的基类,析构函数应该声明为 `virtual`,否则通过基类指针 `delete` 子类对象时不会调用子类析构函数,导致资源泄漏。纯虚函数(`= 0`)相当于 Java 的抽象方法。

## 31–40
### 31. 如何保证线程安全
线程安全问题来自**多个线程同时读写共享的可变数据**。解决思路是围绕原子性、可见性、有序性,从"不共享、不可变、加同步"三个方向入手。

- **互斥同步(加锁)**:`synchronized`、`ReentrantLock`;读多写少的场景用 `ReentrantReadWriteLock` 或 `StampedLock`。
- **非阻塞同步(CAS)**:`AtomicInteger`、`AtomicReference`;高并发计数用 `LongAdder`,它把热点分散到多个 Cell 上,减少 CAS 冲突。
- **volatile**:保证可见性和有序性(禁止指令重排),但**不保证复合操作的原子性**,`count++` 仍然不安全。适合状态标志位和 DCL 单例。
- **不共享数据**:用局部变量(线程栈私有);用 `ThreadLocal` 为每个线程保存一份副本,用完要 `remove`,防止线程池场景下的内存泄漏。
- **不可变对象**:`final` 字段、`String`、不可变集合,一经创建就无法修改,天然线程安全。
- **并发容器**:`ConcurrentHashMap`、`CopyOnWriteArrayList`、`BlockingQueue`,替代 `HashMap`、`ArrayList`。
- **并发工具类**:`CountDownLatch`、`Semaphore`、`CyclicBarrier` 协调多个线程。
- **分布式场景**:单机锁失效,需要用 Redis/Redisson 或 ZooKeeper 实现分布式锁,或用数据库的乐观锁(版本号)。

### 32. 索引，什么情况下失效？
索引失效的本质是**查询无法利用 B+ 树的有序性**,或者优化器判断全表扫描的成本更低。常见情况:

- **违反最左前缀原则**:联合索引 `(a,b,c)`,查询条件只有 `b`、`c` 时用不上索引。另外,范围查询(`>`、`<`)右边的列无法继续用于索引过滤(MySQL 8.0.13+ 的 Skip Scan 在部分场景可以跳过最左列)。
- **对索引列做运算或使用函数**:`WHERE YEAR(create_time) = 2026`、`WHERE id + 1 = 10`。
- **隐式类型转换**:字符串类型的列用数字比较,如 `phone = 13800000000`,MySQL 会对列做类型转换,导致索引失效;反过来,数字列和字符串比较不会失效。
- **左模糊或全模糊**:`LIKE '%abc'`、`LIKE '%abc%'` 用不上索引;`LIKE 'abc%'` 可以用。
- **OR 连接的条件中有一个列没有索引**:整个查询会退化为全表扫描。
- **`!=`、`<>`、`NOT IN`、`IS NOT NULL`**:不一定失效,优化器会根据成本决定,当需要回表的行数太多时会选择全表扫描。
- **优化器估算全表扫描更快**:例如区分度低的列(性别),或者扫描范围超过表中很大比例的数据。
- **字符集或排序规则不一致**:关联查询时两个表的字段字符集不同,会导致索引失效。

排查方法:用 `EXPLAIN` 查看 `type`(是否为 ALL)、`key`(实际使用的索引)、`rows`(预估扫描行数)、`Extra`(Using filesort、Using temporary 等)。

### 33. JMM内存模型
JMM(Java 内存模型)是一套**规范**,定义了多线程环境下共享变量的读写规则,用来屏蔽不同硬件和操作系统的差异,解决**可见性、原子性、有序性**问题。注意它和 JVM 运行时数据区(堆、栈)不是一个概念。

**抽象结构**:所有共享变量存放在主内存中;每个线程有自己的工作内存(对应 CPU 缓存和寄存器的抽象),保存共享变量的副本。线程只能操作工作内存,不能直接读写主内存,线程之间也不能直接访问对方的工作内存,必须通过主内存传递数据。

**三大特性及其保证方式**:
- **原子性**:`synchronized`、`Lock`、原子类。
- **可见性**:`volatile`(写操作立即刷新到主内存,读操作从主内存读取)、`synchronized`(解锁前把数据刷回主内存)、`final`。
- **有序性**:`volatile` 通过插入内存屏障禁止指令重排序;`synchronized` 保证同一时刻只有一个线程执行同步块。

**happens-before 原则**(前一个操作的结果对后一个操作可见):
- 程序顺序规则:单线程中,前面的操作 happens-before 后面的操作。
- 监视器锁规则:解锁 happens-before 之后对同一把锁的加锁。
- volatile 规则:对 volatile 变量的写 happens-before 之后对它的读。
- 线程启动规则:`start()` happens-before 线程中的所有操作。
- 线程终止规则:线程中的所有操作 happens-before 其他线程检测到它结束(`join()` 返回)。
- 传递性:A hb B,B hb C,则 A hb C。

### 34. MQ消息可靠性
要保证消息不丢,需要在**生产端、Broker、消费端**三个环节都做保障。以 RabbitMQ 为例:

- **生产端**:
  - 开启 **Publisher Confirm**:Broker 收到消息后返回 ack,收到 nack 或超时就重试。
  - 开启 **Publisher Return**:消息路由到队列失败时回调通知生产者。
  - 发送前把消息记录到数据库,定时任务扫描未确认的消息进行补偿重发。
- **Broker 端**:
  - 交换机、队列声明为持久化(`durable`),消息设置为持久化(`deliveryMode=2`)。
  - 用仲裁队列(Quorum Queue)或镜像集群做高可用。
  - 惰性队列(Lazy Queue)把消息直接写入磁盘,防止消息堆积导致内存溢出。
- **消费端**:
  - 改为**手动 ack**,业务处理成功后再确认;处理失败时 nack 并重新入队。
  - 配置有限次数的本地重试,超过次数后投递到**死信队列**,由人工处理。

**Kafka 的对应做法**:生产端设置 `acks=all`、`retries`、开启幂等;Broker 端设置副本数 `replication.factor>=3`、`min.insync.replicas>=2`、`unclean.leader.election.enable=false`;消费端关闭自动提交 offset,业务处理完成后再手动提交。

可靠性措施会带来**重复消息**,所以消费端必须保证**幂等**:可以用唯一消息 ID 去重(Redis 或数据库唯一索引)、业务状态机判断、数据库乐观锁。

### 35. 浏览器中输入一个web页面的url以后会有哪些流程
整体流程:**URL 解析 → DNS 解析 → 建立 TCP 连接 → TLS 握手 → 发送 HTTP 请求 → 服务器处理 → 返回响应 → 浏览器渲染 → 断开连接**。

1. **URL 解析**:判断是 URL 还是搜索词,补全协议;命中 HSTS 则强制 HTTPS;命中强缓存(`Cache-Control`/`Expires`)直接用本地资源。
2. **DNS 解析**:浏览器缓存 → 系统缓存和 hosts → 本地 DNS 服务器,后者向根 → 顶级 → 权威域名服务器迭代查询得到 IP;用 CDN 时返回最近节点 IP。
3. **TCP 三次握手**:SYN → SYN+ACK → ACK。
4. **TLS 握手**(HTTPS):协商版本和加密套件、验证证书、ECDHE 协商会话密钥;TLS 1.2 需 2-RTT,TLS 1.3 只需 1-RTT。
5. **发送请求**:请求行、请求头(Cookie、`If-None-Match` 等)、请求体。
6. **服务器处理**:Nginx / 负载均衡 → 应用服务器 → 读写缓存和数据库。
7. **返回响应**:200、301/302、304(协商缓存命中)、404、500 等。
8. **浏览器渲染**:DOM 树 + CSSOM 树 → 渲染树 → 布局、绘制、合成;没有 `defer`/`async` 的 `<script>` 会阻塞解析。
9. **断开连接**:HTTP/1.1 默认 keep-alive 复用,空闲后四次挥手。

涉及协议:DNS(一般走 UDP)、HTTP、TLS、TCP、IP,局域网内用 ARP 获取下一跳 MAC 地址。

### 36. 线程池参数
`ThreadPoolExecutor` 有 **7 个参数**:

| 参数 | 含义 |
|---|---|
| `corePoolSize` | 核心线程数,默认空闲也不回收 |
| `maximumPoolSize` | 最大线程数 |
| `keepAliveTime` / `unit` | 非核心线程空闲存活时间及单位 |
| `workQueue` | `ArrayBlockingQueue`(有界)、`LinkedBlockingQueue`(默认容量 `Integer.MAX_VALUE`)、`SynchronousQueue`(不存储)、`PriorityBlockingQueue`、`DelayQueue` |
| `threadFactory` | 线程工厂,一般用来给线程命名 |
| `handler` | 拒绝策略 |

**提交流程**:线程数 < 核心数则建核心线程 → 否则入队 → 队列满且 < 最大数则建非核心线程 → 否则拒绝。

**拒绝策略**:`AbortPolicy`(默认,抛 `RejectedExecutionException`)、`CallerRunsPolicy`(提交线程自己执行)、`DiscardPolicy`(丢弃)、`DiscardOldestPolicy`(丢弃最老任务再提交)。

**设置经验**:CPU 密集型设为核数 + 1;IO 密集型约核数 × 2,或按 `核数 × (1 + 等待时间/计算时间)` 估算,以压测为准。

**易错点**:不要用 `Executors` 创建。`newFixedThreadPool`、`newSingleThreadExecutor` 队列无界,`newCachedThreadPool` 最大线程数是 `Integer.MAX_VALUE`,都有 OOM 风险。`allowCoreThreadTimeOut(true)` 可让核心线程也被回收。

### 37. 设计高并发系统
设计思路:**分层削减流量,让绝大部分请求在到达数据库之前就被处理掉**,同时保证系统可扩展、可降级。

- **前端和接入层**:静态资源放 CDN;页面静态化;按钮防重复点击;Nginx 做负载均衡和限流。
- **网关层**:统一鉴权;用令牌桶算法限流(Sentinel、Gateway + Redis);黑名单拦截恶意请求。
- **服务层**:
  - 服务无状态化,方便水平扩容;按业务拆分微服务。
  - 用**多级缓存**:本地缓存 Caffeine + 分布式缓存 Redis;处理好缓存穿透、击穿、雪崩问题。
  - **异步化**:非核心流程通过 MQ 异步执行,同时起到削峰作用。
  - 用线程池并行调用多个下游服务;接口保证幂等。
- **数据层**:
  - MySQL 读写分离、主从复制。
  - 数据量大时分库分表(ShardingSphere)。
  - SQL 和索引优化;热点数据(如库存)预加载到 Redis,用 Lua 脚本保证原子扣减。
- **高可用**:
  - 用 Sentinel 做熔断降级,防止下游故障导致雪崩。
  - 集群部署、多机房容灾;设置合理的超时时间和重试次数。
- **可观测与验证**:用 Prometheus + Grafana 监控、链路追踪(SkyWalking)、告警;上线前做全链路压测,评估系统容量。

回答时可以结合具体场景展开,比如秒杀:Redis 预扣库存 → MQ 异步创建订单 → 数据库乐观锁兜底防超卖。

### 38. Spring和SpringBoot有什么区别?
Spring 是一个提供 IoC 和 AOP 的基础框架;Spring Boot 是**基于 Spring 的快速开发脚手架**,核心是"约定优于配置",用来简化 Spring 应用的搭建和部署。两者不是替代关系。

| | Spring | Spring Boot |
|---|---|---|
| 定位 | 基础框架(IoC、AOP、事务、MVC) | 在 Spring 之上做自动配置和整合 |
| 配置 | 需要大量 XML 或 Java 配置 | 自动配置,`application.yml` 里少量配置即可 |
| 依赖管理 | 手动引入各个依赖并处理版本冲突 | starter 依赖(如 `spring-boot-starter-web`)一次引入,版本由 parent 统一管理 |
| 部署 | 打成 war 包,部署到外部 Tomcat | 内嵌 Tomcat/Jetty/Undertow,打成 jar 包后 `java -jar` 直接运行 |
| 运维 | 需要自己集成 | 提供 Actuator,支持健康检查和指标监控 |

**Spring Boot 的核心能力**:
- **自动配置**:`@EnableAutoConfiguration` 加上条件注解,根据 classpath 中有哪些类、容器中有哪些 Bean,决定是否生效对应的配置。
- **starter**:按场景组合依赖。
- **外部化配置**:支持多环境 profile。

**版本说明**:Spring Boot 3.x 基于 Spring 6,要求 JDK 17+,包名从 `javax.*` 迁移到 `jakarta.*`。

### 39. Redis雪崩、击穿、穿透
三者都会导致大量请求绕过缓存直接打到数据库,区别在于原因不同:

| | 缓存穿透 | 缓存击穿 | 缓存雪崩 |
|---|---|---|---|
| 现象 | 查询**根本不存在**的数据,缓存和数据库中都没有 | 某个**热点 key 过期**的瞬间,大量请求同时打到数据库 | **大量 key 同时过期**,或 Redis 宕机 |
| 常见原因 | 恶意攻击、构造不存在的 ID | 热点数据的过期时间到了 | 批量设置了相同的过期时间;Redis 故障 |
| 解决方案 | 1. 缓存空值,并设置较短的过期时间;2. 布隆过滤器提前拦截;3. 参数校验、对恶意 IP 限流 | 1. 互斥锁:只让一个线程查询数据库并重建缓存,其他线程等待或重试;2. 逻辑过期:key 不设置 TTL,在 value 中存过期时间,发现过期后异步重建,期间先返回旧数据;3. 热点数据永不过期 | 1. 过期时间加随机值,把过期时间打散;2. Redis 高可用(哨兵、集群);3. 限流降级、熔断;4. 多级缓存;5. 缓存预热 |

**取舍**:
- 互斥锁保证数据一致性,但性能有损失,线程需要等待。
- 逻辑过期性能好,但会短暂返回旧数据。
- 布隆过滤器存在误判:判断"不存在"的一定不存在,判断"存在"的可能不存在;而且不支持删除元素。

### 40. 一张订单表order，两个字段user_id和create_time用户查看某一段时间内所有订单，写sql
```sql
SELECT id, user_id, amount, status, create_time
FROM `order`
WHERE user_id = ?
  AND create_time >= '2026-10-01 00:00:00'
  AND create_time <  '2026-11-01 00:00:00'
ORDER BY create_time DESC
LIMIT 0, 20;

-- 建立联合索引:等值查询的列放前面,范围查询的列放后面
CREATE INDEX idx_user_time ON `order`(user_id, create_time);
```

**要点**:
- `order` 是 MySQL 关键字,表名需要用反引号括起来,实际开发中建议命名为 `t_order`。
- 建立联合索引 `(user_id, create_time)`:`user_id` 等值匹配定位到该用户,`create_time` 在索引中有序,范围扫描时可以直接利用,`ORDER BY create_time` 也不需要额外排序(不会出现 filesort)。
- 时间范围使用左闭右开区间,不要写 `DATE(create_time) = ...`,对索引列使用函数会导致索引失效。
- 用户输入的参数要通过预编译(`?` 占位符或 MyBatis 的 `#{}`)传入,防止 SQL 注入。
- 避免 `SELECT *`,只查询需要的列;如果查询列都在索引中,可以形成覆盖索引,避免回表。
- 数据量大时进行分页;深分页可以改用游标方式:`WHERE user_id = ? AND create_time < 上一页最后一条的时间 ORDER BY create_time DESC LIMIT 20`。

## 41–50
### 41. Spring的两个核心思想
Spring 的两个核心思想是 **IoC(控制反转)** 和 **AOP(面向切面编程)**。

**IoC**:
- 对象的创建和依赖关系由 Spring 容器管理,而不是由代码自己 `new`。控制权从程序转移到了容器,所以叫控制反转。
- **DI(依赖注入)** 是 IoC 的实现方式:容器在创建 Bean 时,把它依赖的对象注入进来。注入方式有构造器注入、Setter 注入、字段注入。
- 好处是降低耦合:面向接口编程,替换实现类不需要修改调用方;Bean 默认是单例,由容器统一管理生命周期;方便单元测试时注入 Mock 对象。
- 容器的核心接口是 `BeanFactory`,常用的是它的子接口 `ApplicationContext`。

**AOP**:
- 把与业务无关、但多个模块都需要的**横切逻辑**(日志、事务、权限校验、监控)抽取成切面,在不修改业务代码的情况下织入目标方法。
- 核心概念:切面(Aspect)、切点(Pointcut)、通知(Advice)、连接点(JoinPoint)、织入(Weaving)。
- 实现方式是**动态代理**:目标类实现了接口时可以用 JDK 动态代理,否则用 CGLIB 生成子类。注意 Spring Boot 2.x 起默认 `proxyTargetClass=true`,统一使用 CGLIB。
- 典型应用:`@Transactional` 声明式事务就是基于 AOP 实现的。

两者的关系:AOP 依赖 IoC。代理对象是在 Bean 初始化之后,由 `BeanPostProcessor` 生成并替换原始 Bean,放入容器中的。

### 42. 如果数据在亿级，然后userid区分度不高，服务器配置不好，如何优化
`user_id` 区分度不高,说明单个 user_id 对应的数据很多,只靠 `user_id` 单列索引过滤效果差。思路是:**用联合索引提高过滤效率 → 冷热数据分离减少数据量 → 分区/分表 → 把查询转移到其他存储**,在硬件有限的情况下优先做低成本的优化。

1. **SQL 和索引优化**(成本最低):
   - 分析高频查询条件,建立联合索引,把 `user_id` 和区分度高的列组合起来,例如 `(user_id, create_time)`。
   - 尽量使用覆盖索引,避免回表。
   - 禁止 `SELECT *`;深分页改用游标方式(基于上一页最后一条记录的 ID 或时间查询)。
   - 用 `EXPLAIN` 和慢查询日志定位问题 SQL。
2. **冷热数据分离、归档**:亿级数据中大部分通常是历史数据。把 3 个月或 1 年前的数据迁移到归档表或其他存储,线上表只保留热数据,数据量可以降低一个数量级。
3. **分区表**:按时间做 RANGE 分区,查询时只扫描相关分区;清理历史数据时直接删除分区。
4. **分库分表**:单表数据仍然很大时,用 ShardingSphere 分表。分片键选择查询最常用的条件:按 user_id 哈希分片可以让同一用户的数据落在同一张表;按时间分片适合按时间范围查询。
5. **缓存和异构存储**:
   - 热点查询结果放入 Redis。
   - 复杂条件查询、统计分析同步到 Elasticsearch 或 ClickHouse,通过 Canal 订阅 binlog 实现数据同步。
6. **服务器配置有限时的参数调优**:合理设置 `innodb_buffer_pool_size`(专用数据库服务器一般设为物理内存的 50%–70%);读写分离,把读请求分散到从库;统计类查询改为离线预计算,结果存入汇总表。

### 43. 说一说ArrayList的初始大小，扩容机制
ArrayList 底层是 `Object[]` 数组。**使用无参构造时,初始容量是 0(懒加载),第一次 `add` 时扩容为 10;之后每次扩容为原来的 1.5 倍**。

- **初始化**(JDK 8):无参构造函数把 `elementData` 指向一个共享的空数组 `DEFAULTCAPACITY_EMPTY_ELEMENTDATA`,第一次添加元素时才分配容量为 10 的数组。指定初始容量的构造函数会直接创建对应大小的数组;传入 0 时使用另一个空数组 `EMPTY_ELEMENTDATA`,第一次扩容到 1,不是 10。
- **扩容时机**:添加元素时,如果所需的最小容量 `size + 1` 大于数组长度,就调用 `grow()` 扩容。
- **扩容大小**:`newCapacity = oldCapacity + (oldCapacity >> 1)`,即 1.5 倍。如果 1.5 倍仍然不够(例如 `addAll` 一次添加大量元素),直接使用所需的最小容量。容量上限约为 `Integer.MAX_VALUE - 8`。
- **扩容方式**:调用 `Arrays.copyOf` 创建新数组并复制原数据,时间复杂度为 O(n)。

**优化建议**:能预估数据量时,在构造函数中指定初始容量,或者调用 `ensureCapacity`,避免频繁扩容和数组拷贝。另外,ArrayList 不会自动缩容,需要时可以调用 `trimToSize()`。

**补充**:ArrayList 线程不安全。并发场景下可以使用 `CopyOnWriteArrayList`,或者用 `Collections.synchronizedList` 包装。Vector 每次扩容为原来的 2 倍。

### 44. jre和jdk区别
**JDK = JRE + 开发工具,JRE = JVM + 核心类库**。JRE 用于运行 Java 程序,JDK 用于开发 Java 程序。

| | JVM | JRE | JDK |
|---|---|---|---|
| 全称 | Java Virtual Machine | Java Runtime Environment | Java Development Kit |
| 组成 | 执行字节码:类加载器、执行引擎(解释器 + JIT)、GC | JVM + Java 核心类库(`java.lang`、`java.util` 等) | JRE + `javac`、`java`、`jar`、`javadoc`、`jdb`、`jps`、`jstack`、`jmap` 等工具 |
| 用途 | 让 Java 程序跨平台运行 | 运行 Java 程序 | 编译、调试、打包、诊断 Java 程序 |

**版本说明**:JDK 9 引入模块化系统之后,JDK 安装目录中不再有单独的 `jre` 目录;从 JDK 11 开始,Oracle 不再单独提供 JRE 下载。现在需要精简的运行环境时,可以用 `jlink` 按需裁剪出一个只包含必要模块的运行时镜像。

**跨平台原理**:Java 源代码由 `javac` 编译成平台无关的字节码(`.class` 文件),再由各个平台上的 JVM 解释执行或通过 JIT 编译成本地机器码执行,实现"一次编译,到处运行"。JVM 本身与平台相关。

### 45. 如何防止超卖？
超卖的根本原因是**"查询库存 → 判断 → 扣减库存"这三步不是原子操作**,并发时多个线程同时读到库存充足,导致都扣减成功。解决思路是让"判断加扣减"变成原子操作,并且按流量大小分层处理。

- **数据库乐观锁**(最简单可靠):
```sql
UPDATE stock SET count = count - 1 WHERE id = ? AND count > 0;
```
根据影响行数判断是否扣减成功,影响行数为 0 表示库存不足。`count > 0` 的写法比版本号方式失败率更低。行锁保证了这条语句是原子的,但高并发时会有大量请求竞争同一行的锁,数据库压力大。
- **悲观锁**:`SELECT ... FOR UPDATE` 锁住库存行,性能较差。
- **Redis 预扣库存**(高并发场景):活动开始前把库存加载到 Redis,用 **Lua 脚本**原子地完成"判断库存、判断用户是否已经下过单、扣减库存、记录用户"。扣减成功后发送 MQ 消息,异步创建订单并扣减数据库库存,数据库层用乐观锁兜底。
- **分布式锁**:用 Redisson 对商品 ID 加锁,性能低于 Lua 脚本方案,适合处理"一人一单"这类需要加锁判断的逻辑。
- **一人一单**:在订单表上建立 `(user_id, voucher_id)` 唯一索引兜底,防止同一用户重复下单。
- **配套措施**:前端按钮防重复点击;网关限流;库存售罄后在本地内存中标记,后续请求直接返回;订单超时未支付时,通过延迟消息回补库存。

注意:单机的 `synchronized` 在集群部署时无效,不能防止超卖。

### 46. ES6新增
ES6(ES2015)是 JavaScript 的一次大版本更新,常用的新特性有:

- **`let` / `const`**:块级作用域;存在暂时性死区,声明前不能访问;不能重复声明。`const` 声明的变量不能重新赋值,但如果它指向对象,对象的属性仍然可以修改。
- **箭头函数**:`(a, b) => a + b`。没有自己的 `this`(继承外层作用域的 `this`),没有 `arguments`,不能作为构造函数使用。
- **模板字符串**:`` `Hello ${name}` ``,支持多行字符串。
- **解构赋值**:`const { id, name } = user;`、`const [a, b] = arr;`。
- **默认参数、剩余参数和展开运算符**:`function f(a = 1, ...rest)`、`[...arr]`、`{ ...obj }`。注意对象的展开运算符是 ES2018 才加入的。
- **Promise**:解决回调地狱问题,支持 `then` / `catch` 链式调用,有 `Promise.all`、`Promise.race`。`async/await` 是 ES2017 引入的。
- **class 类**:`class`、`extends`、`super`,本质上是基于原型继承的语法糖。
- **模块化**:`import` / `export`。
- **新的数据结构**:`Set`、`Map`、`WeakMap`、`WeakSet`,以及新的基本类型 `Symbol`。
- **其他**:`for...of` 和迭代器、生成器 `function*`、`Proxy` / `Reflect`(Vue 3 的响应式系统就是基于 Proxy 实现的)、对象属性简写、`Array.from`、数组的 `find` / `includes` 方法(`includes` 是 ES2016 加入的)。

### 47. Kafka防止消息丢失的办法
需要在 **Producer、Broker、Consumer** 三个环节都做保障。

**Producer 端**:
- 设置 `acks=all`(等价于 `-1`):消息被 ISR 中所有副本写入后才算发送成功。注意 Kafka 3.0 起默认值已经是 `acks=all`,并且默认开启幂等(`enable.idempotence=true`)。
- 设置 `retries`(默认值很大)和 `delivery.timeout.ms`,在可重试的错误下自动重试。
- 使用带回调的发送方法 `send(record, callback)`,在回调中处理发送失败的情况(记录日志、落库后补偿重发)。不要只调用 `send()` 而不检查结果。

**Broker 端**:
- `replication.factor >= 3`:每个分区至少 3 个副本。
- `min.insync.replicas >= 2`:配合 `acks=all` 使用,ISR 中至少有 2 个副本时才允许写入,不满足时生产者会收到异常。
- `unclean.leader.election.enable=false`(默认值):禁止落后太多、不在 ISR 中的副本被选为 Leader,否则会丢失数据。
- Kafka 写入消息后先放在操作系统的页缓存中,依赖多副本机制保证可靠性,而不是每条消息都同步刷盘。

**Consumer 端**:
- 关闭自动提交 `enable.auto.commit=false`,**在业务处理完成后再手动提交 offset**(`commitSync` / `commitAsync`)。
- 如果先提交 offset 再处理业务,处理失败时消息就丢失了;先处理业务再提交 offset,可能导致重复消费,所以消费逻辑需要保证幂等。

### 48. Kafka防止重复消费
重复消费不可能完全避免:Consumer 处理完消息但还没提交 offset 时宕机,或者发生 Rebalance,都会导致消息被重新投递;Producer 重试也可能导致消息重复写入。所以核心思路是**消费端做幂等**,再配合减少重复的手段。

**消费端幂等(根本方案)**:
- **唯一键去重**:每条消息携带唯一的业务 ID(如订单号),消费时把它写入有唯一索引的去重表,或用 Redis 的 `SET key NX`。写入失败说明已经处理过,直接跳过。
- **数据库唯一约束**:插入数据时依靠唯一索引拦截重复数据。
- **状态机判断**:更新时带上状态条件,例如 `UPDATE order SET status='PAID' WHERE id=? AND status='UNPAID'`,重复执行时不会产生影响。
- **乐观锁版本号**:更新时校验版本号。

**减少重复的手段**:
- Producer 开启幂等:`enable.idempotence=true`,Broker 通过 ProducerID + 序列号对单分区、单会话内的重复消息去重。
- 跨分区需要 Exactly-Once 时使用 Kafka 事务(`transactional.id`),配合 Consumer 的 `isolation.level=read_committed`。Kafka 事务只保证 Kafka 内部"消费 → 处理 → 生产"链路的精确一次,写外部数据库时仍需要幂等处理。
- 合理设置 `max.poll.interval.ms` 和 `max.poll.records`,避免单批处理时间过长被判定为消费者下线,从而触发 Rebalance 导致重复消费。
- 业务处理完成后及时提交 offset。

### 49. 如果要实现用户权限管理要怎么办
主流方案是 **RBAC(基于角色的访问控制)**:用户关联角色,角色关联权限,不直接给用户分配权限,方便批量管理。

**数据库设计(5 张表)**:用户表、角色表、权限表(菜单、按钮、接口,通常是树形结构),以及用户-角色关联表、角色-权限关联表。用户和角色、角色和权限都是多对多关系。

**实现流程**:
1. **认证**:用户登录后,服务端生成 Token(JWT,或者生成随机 Token 存入 Redis),同时查询该用户的角色和权限标识(如 `order:delete`)缓存到 Redis。
2. **鉴权**:拦截器或 Spring Security 的过滤器解析 Token,得到用户身份;通过注解 `@PreAuthorize("hasAuthority('order:delete')")` 或自定义注解加 AOP,校验当前用户是否拥有接口所需的权限,没有权限时返回 403。
3. **前端**:后端根据用户权限返回菜单和按钮权限,前端动态生成路由、控制按钮显示。**前端控制只是体验优化,必须以后端校验为准**。

**进阶需求**:
- **数据权限**:例如只能查看本部门的数据。可以通过 MyBatis 拦截器动态拼接 SQL 条件实现。
- **权限变更实时生效**:修改用户权限后清除对应的 Redis 缓存。
- **安全措施**:密码用 BCrypt 加盐哈希存储;敏感操作记录审计日志;遵循最小权限原则。
- **成熟框架**:Spring Security、Sa-Token、Apache Shiro。

### 50. redis在项目中的作用
Redis 是基于内存的键值数据库,读写性能很高(单机可达 10 万级 QPS)。项目中常用来做缓存,以及利用它的数据结构和原子操作解决并发问题。回答时要结合项目中的具体场景:

| 作用 | 实现方式 |
|---|---|
| 缓存热点数据 | 用 String 或 Hash 缓存商户、商品信息,减轻数据库压力;处理缓存穿透、击穿、雪崩问题;采用 Cache Aside 模式,先更新数据库再删除缓存 |
| 分布式 Session / 登录 Token | 登录后把 Token → 用户信息存入 Redis,并设置有效期,解决集群部署时 Session 不共享的问题 |
| 分布式锁 | `SET key value NX EX`,释放锁时用 Lua 脚本先校验 value 再删除;或者直接用 Redisson(支持可重入,看门狗机制自动续期) |
| 秒杀和库存扣减 | 库存预加载到 Redis,用 Lua 脚本原子地判断和扣减库存,再通过 MQ 异步下单 |
| 计数器和限流 | `INCR` 统计浏览量;固定窗口限流;用 ZSet 实现滑动窗口限流 |
| 排行榜和点赞 | ZSet,以时间戳或分数作为 score |
| 签到和 UV 统计 | Bitmap 记录签到;HyperLogLog 统计 UV |
| 附近的人 / 商户 | GEO,`GEOSEARCH` 命令(Redis 6.2+) |
| 全局唯一 ID | `INCR` 自增,结合时间戳生成 ID |
| 轻量级消息队列 | Stream 消费组 |

回答时选 3–4 个自己真正实现过的场景深入讲,比如"为什么用 Lua 脚本"、"如何保证缓存与数据库的一致性",准备好面试官的追问。

## 51–57
### 51. 虚拟内存和物理内存区别
物理内存是实际的内存条(RAM);虚拟内存是**操作系统为每个进程提供的一个独立、连续的地址空间**。进程使用的都是虚拟地址,由 MMU 通过页表把虚拟地址映射到物理地址。

| | 虚拟内存 | 物理内存 |
|---|---|---|
| 本质 | 逻辑地址空间,由操作系统抽象出来 | 真实的硬件存储 |
| 大小 | 由地址位数决定(64 位 Linux 用户空间通常为 128TB),可以大于物理内存 | 受实际安装的内存条限制 |
| 隔离 | 每个进程独立,互不可见 | 所有进程共享 |
| 连续性 | 对进程来说是连续的 | 实际分配的物理页可以不连续 |

**虚拟内存的作用**:
- **进程隔离**:一个进程无法访问另一个进程的内存,安全性更高。
- **按需加载**:程序只需加载正在使用的页。访问的页不在物理内存中时触发**缺页中断**,操作系统再从磁盘把这一页调入内存;内存不足时,通过页面置换算法(LRU、Clock)把不常用的页换出到磁盘的 swap 分区。
- **简化编程**:每个程序都可以使用相同的地址布局(代码段、数据段、堆、栈)。
- **共享内存**:多个进程的虚拟页可以映射到同一个物理页,例如共享库、`mmap`、`fork` 之后的写时复制(Copy-On-Write)。

**地址转换**:通常采用多级页表(x86-64 为 4 级页表)减少页表占用的空间,并用 **TLB**(快表)缓存最近使用的地址映射,加快地址转换速度。

### 52. OOM的情况
OOM(`java.lang.OutOfMemoryError`)是指 JVM 无法为对象分配足够内存,GC 之后仍然无法释放出足够空间时抛出的错误。**除了程序计数器,其他运行时数据区都可能发生 OOM**:

| 类型 | 常见原因 |
|---|---|
| `Java heap space`(最常见) | 内存泄漏(静态集合只增不删、ThreadLocal 未 remove、连接未关闭、缓存无上限);一次加载大量数据(不分页查询、大文件入内存);`-Xmx` 过小 |
| `GC overhead limit exceeded` | 超过 98% 时间在 GC 却回收不到 2% 堆内存,接近堆溢出的信号 |
| `Metaspace`(JDK 7 及以前是 `PermGen space`) | 动态代理 / CGLIB 生成大量类;热部署导致类加载器泄漏 |
| `Direct buffer memory` | NIO / Netty 堆外内存未释放或超过 `-XX:MaxDirectMemorySize` |
| `unable to create new native thread` | 线程过多,超过 `ulimit -u` 或可用内存 |
| `Requested array size exceeds VM limit` | 数组长度超过 JVM 上限 |

易错点:递归过深抛的是 `StackOverflowError`,不属于 OOM;只有栈动态扩展申请不到内存时才抛 OOM。

**排查**:加 `-XX:+HeapDumpOnOutOfMemoryError` 自动导出堆转储,用 MAT 分析大对象及其到 GC Roots 的引用链。

### 53. 进程调度的算法
进程调度算法决定**就绪队列中的哪个进程获得 CPU**。常见算法有:

| 算法 | 原理 | 特点 |
|---|---|---|
| 先来先服务 FCFS | 按到达顺序执行 | 非抢占,实现简单;长作业在前时短作业等待时间长(护航效应) |
| 短作业优先 SJF | 优先执行预计运行时间最短的作业 | 平均等待时间最短;长作业可能饥饿;需要预估运行时间 |
| 最短剩余时间优先 SRTF | SJF 的抢占式版本 | 新到达的进程剩余时间更短时抢占 CPU |
| 高响应比优先 HRRN | 响应比 = (等待时间 + 要求服务时间) / 要求服务时间,选最高者 | 兼顾短作业和等待时间长的作业,避免饥饿 |
| 时间片轮转 RR | 每个进程轮流执行一个时间片,用完放到队尾 | 抢占式,公平,响应快;时间片太小时切换开销大,太大时退化为 FCFS |
| 优先级调度 | 优先级高的进程先执行 | 可以是抢占式或非抢占式;低优先级进程可能饥饿,通过"老化"(随等待时间提升优先级)解决 |
| 多级反馈队列 MLFQ | 设置多个优先级不同的队列,优先级越高时间片越短;新进程进入最高优先级队列,时间片用完还没结束就降级到下一级队列 | 综合了以上算法的优点,短作业响应快,长作业也能执行完成 |

**补充**:Linux 2.6.23 起普通进程使用 CFS(完全公平调度器),用红黑树按虚拟运行时间 `vruntime` 排序,每次选择 `vruntime` 最小的进程运行;Linux 6.6 起被 EEVDF 调度器取代。实时进程使用 `SCHED_FIFO` 和 `SCHED_RR` 策略。

### 54. hashmap和concurrenthashmap区别
核心区别:**HashMap 线程不安全,ConcurrentHashMap 线程安全并且并发性能高**。

| | HashMap | ConcurrentHashMap |
|---|---|---|
| 线程安全 | 否。并发 put 丢数据;JDK 7 并发扩容头插法可能成环死循环 | 是 |
| 加锁方式 | 无 | JDK 7:Segment 分段锁(继承 ReentrantLock,默认 16 段);JDK 8:**CAS + synchronized** 只锁桶头节点 |
| null | key、value 都允许 null | 都**不允许**,避免并发下分不清"值为 null"和"key 不存在" |
| 扩容 | 单线程 | 多线程协助迁移,迁完的桶放 `ForwardingNode` |
| 迭代器 | fail-fast,抛 `ConcurrentModificationException` | 弱一致性 |
| size | 直接返回字段 | `baseCount` + `CounterCell[]` 分散计数,近似值 |

两者 JDK 8 底层都是数组 + 链表 + 红黑树。

**JDK 8 put 流程**:算 hash → 未初始化则初始化 → 桶空则 CAS 放入 → 头节点 hash 为 `MOVED`(-1)则协助扩容 → 否则 `synchronized` 锁头节点插入 → 链表长度达 8 且数组长度 ≥ 64 时树化。

`get` 不加锁,靠 `val`、`next` 的 `volatile` 保证可见性。`Hashtable` 锁整个对象,已不推荐。

### 55. 基本的集合类
Java 集合分为两大体系:**`Collection`(存放单个元素)和 `Map`(存放键值对)**。`Collection` 又分为 List、Set、Queue 三类。

| 类别 | 常用实现 |
|---|---|
| List(有序可重复) | `ArrayList`(动态数组,随机访问 O(1),最常用)、`LinkedList`(双向链表,也实现 `Deque`)、`Vector`(线程安全,少用)、`CopyOnWriteArrayList`(写时复制,读多写少) |
| Set(不重复) | `HashSet`(基于 HashMap,无序)、`LinkedHashSet`(插入顺序)、`TreeSet`(红黑树,有序) |
| Queue / Deque | `ArrayDeque`(做栈或队列比 `Stack`、`LinkedList` 快)、`PriorityQueue`(小顶堆)、`ArrayBlockingQueue` / `LinkedBlockingQueue`(生产者消费者、线程池) |
| Map | `HashMap`(JDK 8 起数组 + 链表 + 红黑树)、`LinkedHashMap`(插入或访问顺序,可实现 LRU)、`TreeMap`(按 key 排序)、`Hashtable`(不推荐)、`ConcurrentHashMap`(高并发) |

**工具类**:`Collections`、`Arrays`。易错点:`Arrays.asList` 返回的列表长度固定,`add` / `remove` 抛 `UnsupportedOperationException`。JDK 9 起可用 `List.of()`、`Map.of()` 创建不可变集合。

### 56. springboot常用的注解；
按用途分类回答:

| 用途 | 注解 |
|---|---|
| 启动和配置 | `@SpringBootApplication`(= `@SpringBootConfiguration` + `@EnableAutoConfiguration` + `@ComponentScan`)、`@Configuration` + `@Bean`、`@Value("${key}")`、`@ConfigurationProperties(prefix = "xx")`、`@Profile`、`@Import` |
| 声明 Bean | `@Component`、`@Service`、`@Repository`(持久层异常转为 `DataAccessException`)、`@Controller`、`@RestController` |
| 依赖注入 | `@Autowired`(按类型)、`@Qualifier`(按名称指定)、`@Resource`(JSR-250,先按名称再按类型)、`@Primary`、`@Scope`、`@Lazy` |
| Web | `@GetMapping` 等;`@PathVariable`、`@RequestParam`、`@RequestBody`、`@RequestHeader`;`@RestControllerAdvice` + `@ExceptionHandler`;`@Valid` / `@Validated`;`@CrossOrigin` |
| 事务、AOP、异步 | `@Transactional`、`@Aspect` / `@Around`、`@EnableAsync` + `@Async`、`@EnableScheduling` + `@Scheduled` |
| 条件装配 | `@ConditionalOnClass`、`@ConditionalOnMissingBean`、`@ConditionalOnProperty`,自动配置的核心 |
| 测试 | `@SpringBootTest`、`@MockBean`(Spring Boot 3.4 起废弃,改用 `@MockitoBean`) |

易错点:`@Transactional` 默认只回滚 `RuntimeException` 和 `Error`,受检异常要设 `rollbackFor = Exception.class`;同类方法互调不经过代理,事务不生效。

### 57. Http和Https的区别
**HTTPS = HTTP + TLS/SSL**。HTTPS 在 HTTP 和 TCP 之间加了一层 TLS,提供**加密、身份认证、完整性校验**,解决了 HTTP 明文传输带来的被窃听、被篡改、被冒充的问题。

| | HTTP | HTTPS |
|---|---|---|
| 安全性 | 明文传输 | 经过 TLS 加密传输 |
| 默认端口 | 80 | 443 |
| 证书 | 不需要 | 需要 CA 签发的数字证书 |
| 建立连接 | TCP 三次握手后即可传输数据 | TCP 握手之后还要进行 TLS 握手:TLS 1.2 需要 2-RTT,TLS 1.3 只需要 1-RTT |
| 性能 | 开销小 | 握手和加解密有额外开销,但现代硬件和 TLS 1.3 下影响很小 |
| URL | `http://` | `https://` |

**HTTPS 的原理**:
- **非对称加密协商密钥,对称加密传输数据**:TLS 握手期间,客户端和服务器通过 ECDHE(TLS 1.3 只允许使用具有前向安全性的密钥交换算法)协商出会话密钥,之后用 AES-GCM、ChaCha20 等对称算法加密实际传输的数据。
- **数字证书防止中间人攻击**:服务器发送自己的证书,浏览器用内置的 CA 根证书沿证书链验证签名,并检查证书中的域名和有效期,确认服务器身份。
- **完整性校验**:使用 AEAD 加密模式或 MAC,防止数据在传输过程中被篡改。

**补充**:HTTP/2 在浏览器中实际上要求使用 HTTPS;HTTP/3 基于 QUIC 协议(运行在 UDP 之上),内置了 TLS 1.3。
