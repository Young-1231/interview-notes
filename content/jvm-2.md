## 垃圾回收算法与收集器
### 垃圾回收算法有哪些？各有什么优缺点？ | 高频
基础算法有三种：标记-清除、标记-复制、标记-整理；分代收集是在此基础上按区域组合使用的策略。

| 算法 | 过程 | 优点 | 缺点 | 典型使用 |
| --- | --- | --- | --- | --- |
| 标记-清除（Mark-Sweep） | 标记需要回收的对象（或存活对象），然后统一清除垃圾 | 实现简单，不移动对象 | 产生内存碎片，大对象可能找不到连续空间而提前触发 GC；对象多时标记和清除效率都会下降 | CMS 老年代 |
| 标记-复制（Copying） | 内存分两块，只用一块；把存活对象复制到另一块，再整块清空 | 无碎片，分配可用指针碰撞，存活率低时效率很高 | 要预留空闲空间；存活率高时复制开销大 | 年轻代（Serial、ParNew、Parallel Scavenge），G1 的 Region 间复制 |
| 标记-整理（Mark-Compact） | 标记存活对象，把它们移向内存一端，清理边界以外的内存 | 无碎片，内存利用率高 | 移动对象并更新引用，开销大、停顿长 | Serial Old、Parallel Old，G1 的 Full GC |

**复制算法的空间浪费**：朴素的半区复制浪费 50%。HotSpot 年轻代用 Eden + 两个 Survivor（8:1:1），每次只浪费一个 Survivor，也就是 10%，Survivor 放不下时由老年代做分配担保。

**分代收集**：根据对象存活周期把堆分为年轻代和老年代，年轻代用复制算法，老年代用标记-清除或标记-整理，是当前商用 JVM 的主流做法。

**移动还是不移动**：移动对象（整理）让内存分配更简单、无碎片，但回收时停顿更长；不移动（清除）回收快，但分配时更复杂。关注吞吐量的 Parallel 选择整理，关注延迟的 CMS 选择清除，碎片多了再用一次整理的 Full GC 兜底。

### 垃圾收集器有哪些？ | 高频 | 邮政储蓄银行、拼多多
HotSpot 的收集器可以分为三代：经典分代收集器、G1，以及低延迟收集器 ZGC / Shenandoah。

| 收集器 | 作用区域 | 算法 | 线程 | 目标 / 特点 |
| --- | --- | --- | --- | --- |
| Serial | 年轻代 | 复制 | 单线程，全程 STW | 简单、内存开销小，适合客户端、小内存 |
| ParNew | 年轻代 | 复制 | 多线程并行 | Serial 的多线程版，JDK 8 时主要与 CMS 搭配 |
| Parallel Scavenge | 年轻代 | 复制 | 多线程并行 | 吞吐量优先，支持自适应调节（`-XX:+UseAdaptiveSizePolicy`） |
| Serial Old | 老年代 | 标记-整理 | 单线程 | 客户端模式，以及 CMS 失败时的后备 |
| Parallel Old | 老年代 | 标记-整理 | 多线程并行 | 与 Parallel Scavenge 搭配，JDK 8 默认组合 |
| CMS | 老年代 | 标记-清除 | 并发 | 低停顿；JDK 9 废弃，JDK 14 移除 |
| G1 | 整堆 | Region 间复制，整体标记-整理 | 并发 + 并行 | 停顿可预测，JDK 9 起默认 |
| ZGC | 整堆 | 并发标记-整理（染色指针 + 读屏障） | 并发 | 亚毫秒级停顿，支持 TB 级堆 |
| Shenandoah | 整堆 | 并发整理（转发指针 + 屏障） | 并发 | 低停顿，Red Hat 主导，OpenJDK 12 引入、JDK 15 转正（Oracle JDK 不包含） |

**常用参数**：`-XX:+UseSerialGC`、`-XX:+UseParallelGC`、`-XX:+UseConcMarkSweepGC`（ParNew + CMS，Serial Old 兜底）、`-XX:+UseG1GC`、`-XX:+UseZGC`。ZGC 在 JDK 11 实验性引入、JDK 15 转正；JDK 21 用 `-XX:+ZGenerational` 开启分代，JDK 23 起默认分代，JDK 24 移除非分代模式。

**吞吐量与停顿**：吞吐量 = 用户代码时间 /（用户代码时间 + GC 时间）。Parallel 追求吞吐量，适合批处理；CMS、G1、ZGC 追求低停顿，适合在线服务。

### CMS 和 G1 有什么特点和区别？G1 相比 CMS 好在哪？ | 高频 | 邮政储蓄银行、拼多多、滴滴
一句话：CMS 是只管老年代、基于标记-清除的低停顿收集器；G1 把整堆切成 Region，停顿可预测且基本无碎片。

**CMS 四个阶段**：初始标记（STW）→ 并发标记（最耗时）→ 重新标记（STW，增量更新修正）→ 并发清除。

CMS 的问题：内存碎片（不整理）；浮动垃圾（所以要按 `CMSInitiatingOccupancyFraction` 提前触发）；Concurrent Mode Failure 时退化为 Serial Old 单线程 Full GC；并发阶段占用 (核数 + 3) / 4 个线程。

**G1**：堆划分为约 2048 个等大 Region（1MB~32MB），每个可充当 Eden、Survivor、Old；超过半个 Region 的大对象放进 Humongous Region。
- **停顿可预测**：跟踪每个 Region 的回收价值，在 `-XX:MaxGCPauseMillis`（默认 200ms）内优先回收价值最大的，即 Garbage First。
- **记忆集**：每个 Region 用 RSet 记录外部指向自己的引用，避免全堆扫描。
- **回收类型**：Young GC、Mixed GC（年轻代 + 部分老年代）、Full GC 兜底（JDK 10 起并行）。
- **标记周期**：初始标记 → 并发标记 → 最终标记（处理 SATB）→ 筛选回收（复制存活对象后整块释放 Region）。

| 对比 | CMS | G1 |
| --- | --- | --- |
| 回收范围 | 只有老年代，配合 ParNew | 整堆 |
| 内存布局 | 物理分代 | 等大 Region，逻辑分代 |
| 算法 | 标记-清除，有碎片 | 整体标记-整理，基本无碎片 |
| 停顿控制 | 不可预测 | 可设目标停顿时间 |
| 漏标处理 | 增量更新 | SATB |
| 内存开销 | 较小 | 记忆集、卡表等额外约 10%~20% |
| 适用 | 中小堆、JDK 8 及之前 | 大堆（6GB 以上优势明显），JDK 9 起默认 |

**G1 好在哪**：不会因碎片频繁 Full GC；停顿可预测；年轻代按停顿目标自适应。易错点：小堆下 G1 的额外开销让它未必比 CMS 或 Parallel 更好。

### 什么是三色标记法？ | 高频
三色标记法是并发标记阶段遍历对象图的算法，用三种颜色记录每个对象的扫描进度，使标记过程可以和用户线程并发执行，CMS、G1、ZGC、Shenandoah 都基于它。

**三种颜色**：
- **白色**：还没有被访问过。标记开始时所有对象都是白色，标记结束后仍为白色的对象不可达，会被回收。
- **灰色**：已经被访问，但它引用的对象还没有全部扫描完。
- **黑色**：已经被访问，且它引用的所有对象都已扫描。黑色对象一定存活，不会再被重新扫描。

**标记过程**：
1. 初始时全部为白色，把 GC Roots 直接引用的对象标为灰色（初始标记，STW）。
2. 从灰色集合中取出对象，把它引用的白色对象标为灰色，再把它自己标为黑色。
3. 重复第 2 步，直到灰色集合为空（并发标记）。
4. 修正并发期间的引用变化（重新标记 / 最终标记，STW），剩下的白色对象就是垃圾。

**并发带来的问题**：用户线程和 GC 线程同时运行，引用关系会变化，可能出现两类错误：
- **多标**：本该回收的对象被标成存活，产生浮动垃圾，可以容忍。
- **漏标**：本该存活的对象最终还是白色，被误回收，必须解决。

为此需要借助写屏障记录并发期间的引用变化，CMS 用增量更新，G1 用 SATB。

### 三色标记的漏标问题是什么？ | 高频
漏标是指并发标记期间，一个本来存活的对象因为引用关系变化，标记结束时仍是白色，被当成垃圾回收。这会导致程序访问到已释放的对象，后果严重，必须解决。

**发生条件**（Wilson 1994 证明，两个条件同时满足才会漏标）：
1. 用户线程让一个**黑色对象**新增了指向**白色对象**的引用；
2. 用户线程删除了**所有灰色对象**到该白色对象的直接或间接引用。

例子：灰色 B 引用白色 C。用户线程执行 `A.c = B.c; B.c = null;`，A 已是黑色不会再扫描，B 再也到不了 C，C 就被漏掉了。

**解决方案**：破坏两个条件之一即可，都靠写屏障实现。

| 方案 | 破坏的条件 | 做法 | 使用者 |
| --- | --- | --- | --- |
| 增量更新（Incremental Update） | 条件 1 | 黑色对象新增指向白色对象的引用时，把这个黑色对象记录下来（相当于重新变灰），重新标记阶段再以它为根扫描一遍 | CMS |
| 原始快照（SATB，Snapshot At The Beginning） | 条件 2 | 删除引用时，把被删除的旧引用指向的对象记录下来，最终标记时以它为根扫描，按照标记开始那一刻的快照进行标记 | G1、Shenandoah |

**对比**：
- 增量更新精确，但重新标记时要重新扫描被记录的黑色对象及其引用链，CMS 的重新标记可能较长。
- SATB 只需处理被删除的引用，最终标记更快，代价是会产生更多浮动垃圾（标记开始后才死掉的对象也被当成存活）。
- 标记开始后新分配的对象，G1 通过 TAMS 指针一律视为存活。
- ZGC 借助染色指针和读屏障处理并发标记和并发转移。

### 三色标记的多标问题是什么？ | 高频
多标是指一个已经被标成灰色或黑色的对象，在并发标记期间失去了所有引用，变成了真正的垃圾，但本轮 GC 不会再把它改回白色，于是它被当作存活对象保留下来，这类对象叫浮动垃圾（Floating Garbage）。

- **产生原因**：例如方法执行结束，局部变量引用的对象已经被标记过；或者对象引用被置为 null 时它已经是灰色、黑色。并发标记期间新创建的对象一般也直接视为存活。SATB 方案下浮动垃圾更多。
- **影响**：不影响程序正确性，只是让这部分内存晚一轮才释放。
- **处理**：不需要特殊处理，等下一次 GC 回收即可。但因为并发阶段会持续产生浮动垃圾和新分配的对象，CMS、G1 都不能等老年代满了才开始回收，需要预留空间（CMS 的 `CMSInitiatingOccupancyFraction`、G1 的 `InitiatingHeapOccupancyPercent`）。

**和漏标的对比**：多标是"该回收的没回收"，只是延迟回收；漏标是"不该回收的被回收了"，会破坏程序正确性。所以 GC 设计上宁可多标，也绝不能漏标。

### 如何选择垃圾回收器？ | 高频
主要看 JDK 版本、堆大小、CPU 核数，以及业务更关心吞吐量还是停顿时间。没有特殊需求时，先用当前 JDK 的默认收集器，再根据监控和压测结果调整。

**各版本默认收集器**：JDK 8 默认 Parallel（Parallel Scavenge + Parallel Old）；JDK 9 起默认 G1。在 CPU 少于 2 核或内存小于约 1792MB 的非服务器级机器上，JVM 会自动选择 Serial。

| 场景 | 推荐 | 理由 |
| --- | --- | --- |
| 单核、小内存（几百 MB）、客户端或小工具 | Serial | 开销最小，堆小停顿也短 |
| 批处理、离线计算、后台任务，关注吞吐量 | Parallel | 吞吐量最高，不在意偶尔较长的停顿 |
| 在线服务，堆约 4GB~几十 GB，希望停顿可控 | G1 | 默认选择，平衡吞吐和延迟，用 `MaxGCPauseMillis` 设定目标 |
| 超大堆（几十 GB 到 TB）、延迟敏感（金融交易、实时推荐） | ZGC（JDK 21+ 用分代 ZGC）或 Shenandoah | 停顿通常在 1ms 以内且不随堆增大，代价是 CPU 占用更高、吞吐量略低 |
| 还在 JDK 8 上的低延迟服务 | CMS 或 G1 | CMS 在 JDK 14 已移除，长期应迁移到 G1 |

**ZGC 演进**：JDK 11 实验性引入，JDK 15 转正，JDK 21 增加分代模式（`-XX:+UseZGC -XX:+ZGenerational`），JDK 23 起默认使用分代模式，JDK 24 移除了非分代模式。

**选择原则**：小堆看简单和吞吐量，大堆看停顿；先用默认值，用 GC 日志和压测数据说话，而不是凭感觉切换收集器。容器环境下注意 JVM 能否正确识别 CPU 和内存限制（JDK 8u191+ / JDK 10+ 默认支持容器感知）。

## 类加载
### 类加载的过程是怎样的？ | 高频
类加载过程分为加载、链接、初始化三个阶段，其中链接又分为验证、准备、解析，完整流程是：加载 → 验证 → 准备 → 解析 → 初始化。

1. **加载**：按全限定名获取字节流（jar、网络、动态生成等），转成元空间中的运行时数据结构，并在堆中生成 `java.lang.Class` 对象作为访问入口。
2. **验证**：确保字节流符合规范、不危害虚拟机，包括文件格式（魔数 `0xCAFEBABE`、版本号）、元数据、字节码、符号引用验证。
3. **准备**：为 static 变量分配内存并设零值。`static int a = 10;` 此时 a 为 0，初始化时才赋 10；`static final int B = 10;` 这类编译期常量在准备阶段就是 10。实例变量不在这里分配。
4. **解析**：把常量池中的符号引用替换为直接引用，HotSpot 通常在第一次使用时才解析。
5. **初始化**：执行编译器生成的 `<clinit>()`，按源码顺序执行静态赋值和 static 块；父类先于子类；JVM 保证多线程下只执行一次，静态内部类单例正是利用这一点。

各阶段开始顺序固定，但可以交叉进行，解析也可能在初始化之后。

### 类的生命周期是怎样的？
类的生命周期是从被加载到内存到被卸载的全过程，共七个阶段：加载 → 验证 → 准备 → 解析 → 初始化 → 使用 → 卸载。其中验证、准备、解析合称链接，前五个阶段合称类加载。

- **加载**：读取字节码，在元空间生成类元数据，在堆中生成 Class 对象。
- **验证**：校验字节码合法、安全。
- **准备**：为静态变量分配内存并赋零值。
- **解析**：把符号引用替换为直接引用。
- **初始化**：执行 `<clinit>()`，完成静态变量赋值和静态代码块。
- **使用**：创建实例、调用方法、访问字段等。
- **卸载**：类的 Class 对象、所有实例和加载它的类加载器都被回收后，类元数据从方法区中卸载。

顺序上，加载、验证、准备、初始化、卸载的开始顺序是固定的；解析为了支持动态绑定，可以在初始化之后再进行。

### 有哪些类加载器？怎么自定义类加载器？ | 高频 | 工商银行、美团、蚂蚁、农业银行、交通银行
类加载器负责根据全限定名获取类的字节流并生成 Class 对象。JVM 判断两个类是否相同，要求全限定名相同且由同一个类加载器加载。

**JDK 8 的三层类加载器**：
- **启动类加载器（Bootstrap）**：C++ 实现，Java 中获取到的是 `null`，加载 `jre/lib` 下的核心类库如 `rt.jar`。
- **扩展类加载器（Extension）**：加载 `jre/lib/ext` 或 `java.ext.dirs` 下的类库。
- **应用程序类加载器（Application）**：加载 classpath 下的类，业务代码默认由它加载。

**JDK 9 起**：模块化后 `rt.jar` 和 `ext` 机制移除，扩展类加载器被**平台类加载器（Platform ClassLoader）**取代。

父子关系：Bootstrap ← Extension / Platform ← Application ← 自定义。易错点：这里的"父"是 `parent` 字段组合，不是继承。

**自定义类加载器**：继承 `ClassLoader`，重写 `findClass()`，读取字节码后调用 `defineClass()`。这样仍保持双亲委派：`loadClass()` 先委派父加载器，找不到才调 `findClass()`。

```java
public class MyClassLoader extends ClassLoader {
    private final Path baseDir;

    public MyClassLoader(Path baseDir, ClassLoader parent) {
        super(parent);
        this.baseDir = baseDir;
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        Path file = baseDir.resolve(name.replace('.', '/') + ".class");
        try {
            byte[] bytes = Files.readAllBytes(file); // 可以在这里解密、校验
            return defineClass(name, bytes, 0, bytes.length);
        } catch (IOException e) {
            throw new ClassNotFoundException(name, e);
        }
    }
}
```

**常见用途**：加载非 classpath 来源的类、字节码加解密、热部署与插件化、应用隔离（Tomcat、OSGi）。要打破双亲委派则重写 `loadClass()`。

### 哪些情况会触发类的初始化？
JVM 规范严格规定了有且只有以下六种"主动使用"会触发类初始化（前提是还没初始化过）：

1. 遇到 `new`、`getstatic`、`putstatic`、`invokestatic` 字节码：`new` 对象、读写静态字段（编译期常量除外）、调用静态方法。
2. 通过 `java.lang.reflect` 对类进行反射调用，如 `Class.forName("X")`（默认初始化）。
3. 初始化一个类时，如果父类还没初始化，先初始化父类（接口例外，初始化子接口不要求父接口初始化）。
4. JVM 启动时，包含 `main()` 方法的主类。
5. `MethodHandle` 解析结果为 `REF_getStatic`、`REF_putStatic`、`REF_invokeStatic`、`REF_newInvokeSpecial` 的方法句柄时。
6. 接口中定义了 `default` 方法（JDK 8+），其实现类初始化时，该接口要先初始化。

**不会触发初始化的被动引用**：
- 通过子类访问父类的静态字段：只初始化父类，不初始化子类。
- 创建该类的数组：`new User[10]` 不会初始化 User（只会初始化 JVM 自动生成的数组类）。
- 访问编译期常量：`static final int A = 1;` 在编译时已经内联到调用方的常量池，不会触发定义它的类初始化。注意 `static final Integer` 或 `static final int A = random()` 这种非编译期常量会触发。
- `ClassLoader.loadClass()` 只加载、不初始化；`Class.forName(name, false, loader)` 也不初始化。
- 访问 `User.class` 不会触发初始化。

### 类什么时候会被卸载？
类卸载需要同时满足三个条件，因此由 JVM 内置类加载器加载的类基本不会被卸载，只有自定义类加载器加载的类才可能卸载。

**卸载条件**：
1. 该类的所有实例都已被回收，堆中不存在该类及其子类的实例。
2. 加载该类的类加载器已经被回收。
3. 该类对应的 `java.lang.Class` 对象没有在任何地方被引用，无法通过反射访问。

满足条件后，JVM 也只是"允许"回收，具体还取决于 GC 是否执行类卸载（`-XX:+ClassUnloading` 默认开启，CMS 需要 `-XX:+CMSClassUnloadingEnabled`，JDK 8 中默认已开启）。

**为什么内置加载器的类不会卸载**：Bootstrap、Platform（Extension）、Application 类加载器在 JVM 整个生命周期中都存活，它们始终引用着自己加载的类。

**常见场景与问题**：
- 热部署、插件化、Tomcat 重新加载 Web 应用时，丢弃旧的类加载器，旧类随之卸载。
- 如果旧类加载器被某个长期存活的对象引用（如 ThreadLocal、静态缓存、注册的 JDBC 驱动、未停止的线程），类就无法卸载，多次重新部署后会出现元空间泄漏，最终 `OutOfMemoryError: Metaspace`。
- 大量使用 CGLIB、Groovy 脚本、Lambda 动态生成类时，也要关注元空间的增长。可以用 `-Xlog:class+unload`（JDK 9+）或 `-XX:+TraceClassUnloading`（JDK 8）观察卸载情况。

### ClassNotFoundException 和 NoClassDefFoundError 有什么区别？
两者都和"找不到类"有关，但一个是加载时显式查找失败的受检异常，另一个是编译时存在、运行时链接失败的错误。

| 对比 | ClassNotFoundException | NoClassDefFoundError |
| --- | --- | --- |
| 类型 | 受检异常，继承 `ReflectiveOperationException` → `Exception` | 错误，继承 `LinkageError` → `Error` |
| 触发场景 | 通过字符串名动态加载类时找不到：`Class.forName()`、`ClassLoader.loadClass()`、`findSystemClass()` | 编译时类存在，运行时 JVM 隐式加载（new、调用静态方法等）时找不到类定义 |
| 常见原因 | 类名写错、jar 包不在 classpath、驱动依赖缺失 | 打包时漏了依赖、jar 版本冲突、类在别的类加载器下不可见，或者类的静态初始化失败 |
| 处理 | 可以 catch 后降级处理 | 一般需要修复部署或依赖 |

**常见追问**：静态初始化块抛出异常时，第一次访问该类会抛 `ExceptionInInitializerError`，之后再访问就会抛 `NoClassDefFoundError: Could not initialize class X`。排查 NoClassDefFoundError 时要往前翻日志，找第一次出现的 `ExceptionInInitializerError`。

## 双亲委派
### 什么是双亲委派模型？ | 高频
双亲委派模型是类加载器的工作方式：一个类加载器收到加载请求时，不会先自己加载，而是先委派给父加载器，层层向上直到启动类加载器；只有父加载器在自己的搜索范围内找不到这个类时，子加载器才尝试自己加载。

**执行流程**（`ClassLoader.loadClass()` 默认实现）：
1. 调用 `findLoadedClass()` 检查该类是否已经加载过，加载过直接返回。
2. 没有则交给父加载器的 `loadClass()`；父加载器为 null 时交给启动类加载器。
3. 父加载器都加载失败（抛 ClassNotFoundException）后，调用自己的 `findClass()` 加载。
4. 自己也找不到，就抛出 `ClassNotFoundException`。

```java
protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
    synchronized (getClassLoadingLock(name)) {
        Class<?> c = findLoadedClass(name);
        if (c == null) {
            try {
                if (parent != null) {
                    c = parent.loadClass(name, false);
                } else {
                    c = findBootstrapClassOrNull(name);
                }
            } catch (ClassNotFoundException e) {
                // 父加载器无法加载
            }
            if (c == null) {
                c = findClass(name);
            }
        }
        if (resolve) {
            resolveClass(c);
        }
        return c;
    }
}
```

**要点**：
- "双亲"是翻译的叫法，实际是单亲，每个加载器只有一个 parent。
- 父子关系是组合（`parent` 字段），不是继承。
- 双亲委派是 JVM 推荐的模型，不是强制约束，可以被打破。
- JDK 9 起，平台和应用类加载器会先根据类所在的模块找到负责的加载器，再进行委派。

### 双亲委派有什么好处？
- **避免重复加载**：父加载器已经加载过的类，子加载器不会再加载一次，同一个类在 JVM 中只有一份由同一加载器定义的 Class。
- **保证核心类库的安全**：`java.lang.Object`、`java.lang.String` 等核心类总是由启动类加载器加载。即使用户在 classpath 写了一个同名的 `java.lang.String`，请求也会先委派到启动类加载器，加载到的是 JDK 自带的版本，恶意或错误的类无法替换核心 API。此外 JVM 禁止用户类加载器定义 `java.*` 包下的类（`defineClass` 会抛 `SecurityException`）。
- **保证类的一致性**：类的唯一性由"类加载器 + 全限定名"决定。双亲委派让同一个类在各处都由同一个加载器加载，避免出现同名但不相容的两个类（例如 `ClassCastException: X cannot be cast to X`）。
- **层次清晰**：每个加载器只负责自己的范围，职责分明。

### 怎么打破双亲委派？ | 高频
双亲委派的逻辑写在 `ClassLoader.loadClass()` 中，要打破它，就要自定义类加载器并重写 `loadClass()`，让它不先委派父加载器（或改变委派顺序）。只重写 `findClass()` 不会打破双亲委派，因为 `loadClass()` 仍然先走父加载器。

```java
@Override
protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
    synchronized (getClassLoadingLock(name)) {
        Class<?> c = findLoadedClass(name);
        if (c == null) {
            if (name.startsWith("java.")) {
                c = super.loadClass(name, false);  // 核心类仍交给父加载器
            } else {
                try {
                    c = findClass(name);           // 先自己加载
                } catch (ClassNotFoundException e) {
                    c = super.loadClass(name, false);
                }
            }
        }
        if (resolve) resolveClass(c);
        return c;
    }
}
```

**典型的打破场景**：
- **SPI 与线程上下文类加载器**：JDBC 的 `DriverManager` 由启动类加载器加载，但 MySQL 驱动等实现在 classpath 上，启动类加载器看不到。于是 `ServiceLoader` 通过 `Thread.currentThread().getContextClassLoader()`（默认是应用类加载器）去加载实现类，相当于父加载器反过来请求子加载器。JNDI、JAXP 也类似。
- **Tomcat**：每个 Web 应用的 `WebappClassLoader` 先加载自己 `WEB-INF` 下的类，再委派父加载器，实现应用隔离。
- **OSGi / 热部署**：每个模块一个类加载器，按网状依赖委派，替换模块时连同类加载器一起替换。
- **JDK 9 模块化**：委派前先判断类属于哪个模块，交给对应的加载器，也不再是严格的自下而上。

### Tomcat 为什么要打破双亲委派？ | 高频
一个 Tomcat 会部署多个 Web 应用，它们需要彼此隔离，还要和 Tomcat 自身的类隔离，严格的双亲委派做不到这一点。

**需要解决的问题**：
- **应用之间的隔离**：应用 A 依赖 Spring 5，应用 B 依赖 Spring 6，同名类必须能各自加载自己的版本。如果统一由应用类加载器按双亲委派加载，先加载的版本会被所有应用共用。
- **共享公共类库**：多个应用都用的相同版本的类库，应该只加载一份，节省内存。
- **容器与应用隔离**：Tomcat 自己依赖的类不应被应用看到或覆盖。
- **热部署**：JSP 修改后、应用重新部署时，需要丢弃旧类重新加载，这要求每个应用（甚至每个 JSP）有自己的类加载器。

**Tomcat 的类加载器结构**：
- Bootstrap → System（加载 Tomcat 启动所需的类）→ Common（Tomcat 和所有应用共享的 `lib` 目录）。
- Common 下有 Catalina（Tomcat 内部私有）和 Shared（应用间共享，默认合并进 Common）。
- 每个 Web 应用一个 **WebappClassLoader**，每个 JSP 一个 **JasperLoader**。

**WebappClassLoader 的加载顺序**：
1. 先查本地缓存是否已加载。
2. 先交给 Bootstrap / Platform 加载 JDK 核心类，防止应用覆盖 `java.*` 等类。
3. 再自己在 `WEB-INF/classes`、`WEB-INF/lib` 中查找。
4. 找不到才委派给 Common 等父加载器。

所以 Tomcat 并不是完全抛弃双亲委派：JDK 核心类仍然向上委派，只是应用自己的类优先由自己加载（可以通过 `<Loader delegate="true"/>` 改回父优先）。由于类的唯一性由"类加载器 + 全限定名"决定，不同 WebappClassLoader 加载的同名类在 JVM 中是不同的类，从而实现隔离。

## 内存溢出与内存泄漏
### OOM 会发生在哪些区域？分别是什么原因？ | 高频 | 阿里、交通银行
除了程序计数器，其他运行时区域和直接内存都可能发生 OOM。

| 区域 | 错误信息 | 常见原因 |
| --- | --- | --- |
| Java 堆 | `Java heap space` | 堆太小；一次查询太多数据、大文件全读入内存；内存泄漏（静态集合、无上限缓存、ThreadLocal 未清理） |
| Java 堆 | `GC overhead limit exceeded` | 98% 以上时间在 GC 却回收不到 2% 的堆，本质也是堆不够或泄漏 |
| 方法区 | `PermGen space`（JDK 7 及之前）/ `Metaspace`（JDK 8+） | CGLIB、动态代理等生成大量类；类加载器泄漏；`MaxMetaspaceSize` 太小 |
| 虚拟机栈 / 本地方法栈 | `unable to create native thread` | 线程数过多，无法为新线程分配栈，或达到 `ulimit -u` |
| 直接内存 | `Direct buffer memory` | NIO / Netty 大量申请 DirectByteBuffer 回收不及时；`MaxDirectMemorySize` 太小；`DisableExplicitGC` 导致无法靠 `System.gc()` 回收 |
| 数组 | `Requested array size exceeds VM limit` | 数组长度超过 JVM 上限 |

**易错点**：
- 无限递归抛的是 `StackOverflowError`，不是 OOM；HotSpot 栈不能动态扩展，栈相关 OOM 基本只出现在创建线程时。
- 进程总内存超过容器限制时可能被 OOM Killer 直接杀死，JVM 里看不到任何 OOM 异常。

### OOM 和 StackOverflowError 有什么区别？ | 高频
两者都是 `VirtualMachineError` 的子类（属于 Error），但 OOM 表示某块内存不够分配，StackOverflowError 表示单个线程的栈深度超过了栈容量。StackOverflowError 不属于 OOM。

| 对比 | OutOfMemoryError | StackOverflowError |
| --- | --- | --- |
| 含义 | 申请内存时没有足够空间，GC 后仍无法满足 | 线程请求的栈深度超过虚拟机栈允许的最大深度 |
| 发生区域 | 堆、元空间、直接内存，以及创建线程时的栈 | 虚拟机栈 / 本地方法栈 |
| 常见原因 | 内存泄漏、大对象、缓存无上限、动态生成大量类、线程过多 | 无限递归、递归层次过深、方法调用链过长、栈帧过大（局部变量很多） |
| 相关参数 | `-Xmx`、`-XX:MaxMetaspaceSize`、`-XX:MaxDirectMemorySize` | `-Xss`（每个线程的栈大小） |
| 影响范围 | 堆是共享的，一个线程触发 OOM 往往意味着其他线程也分配不到内存 | 通常只影响出错的那个线程 |
| 排查 | Heap Dump + MAT 分析大对象和引用链 | 看异常栈中重复出现的方法，找到递归点 |

**容易混淆的点**：同样和栈有关，递归太深是 StackOverflowError；线程太多，无法再为新线程分配栈空间，则是 `OutOfMemoryError: unable to create native thread`。调大 `-Xss` 能缓解前者，但会让后者更容易发生，因为每个线程占用的栈变大了。

### 栈溢出会影响其他进程吗？ | 高频
一般不会。操作系统为每个进程分配独立的虚拟地址空间，一个 JVM 进程里发生栈溢出，不会破坏其他进程的内存。

**对当前 JVM 的影响**：
- `StackOverflowError` 是在单个线程里抛出的，线程栈私有，默认只会让当前线程的调用失败；没有被捕获时该线程终止，其他线程和 JVM 进程通常继续运行。
- 但要注意间接影响：如果它发生在 main 线程且没有其他非守护线程，JVM 会退出；如果业务线程持有锁时异常退出，`synchronized` 会自动释放锁，但 `Lock` 没在 finally 中释放就可能让其他线程永久阻塞；线程池中的工作线程也会因此被替换。

**可能导致整个 JVM 进程退出的情况**：
- JNI 调用的本地代码发生栈溢出或段错误，JVM 直接崩溃并生成 `hs_err_pid.log`。
- JVM 自身的内部错误。
- 代码调用 `System.exit()` 或 `Runtime.getRuntime().halt()`。
- 进程内存超过限制，被操作系统 OOM Killer 杀死。

**对其他进程的间接影响**：只存在于资源层面，例如一个进程疯狂创建线程或占用大量 CPU、内存，会挤占同一台机器上其他进程的资源，但这不是栈溢出本身直接造成的。

### 什么是内存泄漏？哪些情况会导致内存泄漏？ | 阿里
内存泄漏（Memory Leak）是指对象已经不再被使用，但仍然被某条从 GC Roots 出发的引用链持有，导致 GC 无法回收。泄漏不断积累，堆使用率越来越高，Full GC 后也降不下来，最终 OOM。

**内存泄漏与内存溢出**：泄漏是原因（该释放的没释放），溢出是结果（内存不够了）。溢出不一定是泄漏造成的，也可能只是堆太小或者瞬时数据量太大。

**常见原因**：
- **静态集合**：`static Map/List` 只放不删，生命周期与类相同，元素永远不会被回收。
- **无上限的本地缓存**：用 HashMap 做缓存却没有过期和容量淘汰，应使用 Caffeine、Guava Cache 等带淘汰策略的缓存。
- **ThreadLocal 未 remove**：线程池中线程长期存活，ThreadLocalMap 中的 value 一直被持有。
- **监听器、回调未注销**：注册到全局事件总线的监听器没有移除，对象一直被引用。
- **资源未关闭**：数据库连接、Statement、ResultSet、流、Socket 没关闭，同时占用堆外资源。用 try-with-resources。
- **长生命周期对象持有短生命周期对象**：单例、Spring Bean 中把请求级对象存进成员变量。
- **对象放入 HashSet 后修改了参与 hashCode 计算的字段**：之后 `remove` 找不到它，对象一直留在集合里。
- **内部类持有外部类引用**：非静态内部类、匿名内部类（如线程、Handler）隐式持有外部类实例，导致外部对象无法释放。
- **线程未终止**：创建了线程或线程池却不关闭，线程以及它引用的对象都无法回收。
- **类加载器泄漏**：热部署时旧类加载器被引用，导致元空间泄漏。

### ThreadLocal 为什么可能导致内存泄漏？
每个 Thread 内部有一个 `ThreadLocalMap`，它的 Entry 以 ThreadLocal 对象为 key（弱引用），以存入的值为 value（强引用）。在线程长期存活的场景下，value 可能一直无法回收。

**泄漏过程**：
1. 引用链是：`Thread → ThreadLocalMap → Entry → value`，以及 `Entry --弱引用--> ThreadLocal`。
2. 当外部不再持有 ThreadLocal 的强引用时（比如它是个局部变量，或者所在对象被回收），下一次 GC 时作为 key 的 ThreadLocal 被回收，Entry 的 key 变成 null。
3. 但 value 仍被 Entry 强引用，而 Entry 又被线程的 ThreadLocalMap 持有。只要线程不结束，这个 value 就一直无法访问、也无法回收。
4. 线程池中的核心线程会一直存活，这类 key 为 null 的 Entry 就会越积越多。

**为什么 key 要设计成弱引用**：如果 key 是强引用，ThreadLocal 对象本身也会跟着泄漏。用弱引用至少让 ThreadLocal 能被回收，并且 `ThreadLocalMap` 在 `get()`、`set()`、`remove()` 时会顺带清理 key 为 null 的过期 Entry。但这种清理是被动的、不保证及时，所以不能依赖它。

**正确用法**：
```java
private static final ThreadLocal<UserContext> CTX = new ThreadLocal<>();

try {
    CTX.set(context);
    // 业务逻辑
} finally {
    CTX.remove(); // 用完必须清理
}
```

- 用完后在 finally 中调用 `remove()`，这是最关键的一点。
- 一般把 ThreadLocal 声明为 `static final`，避免重复创建，也让 key 一直有强引用。
- 线程池场景下不 remove 除了泄漏，还会导致线程复用时读到上一个请求遗留的数据，造成数据错乱，这个问题往往比泄漏更严重。

### 内存泄漏的排查思路是什么？
思路是：先从监控确认是否泄漏，再拿到 Heap Dump，分析大对象和它的 GC Roots 引用链，最后定位到代码。

1. **确认现象**：老年代使用率阶梯式上升，每次 Full GC 后的"底线"越来越高，最终频繁 Full GC 或 OOM。用 `jstat -gcutil <pid> 1000` 看 O 和 FGC 的趋势。
2. **获取堆快照**：`jmap -dump:live,format=b,file=heap.hprof <pid>` 或 `jcmd <pid> GC.heap_dump`（`live` 会先触发 Full GC）；或提前配 `-XX:+HeapDumpOnOutOfMemoryError`。dump 大堆会长时间停顿，线上先摘流量；可先用 `jmap -histo:live <pid> | head -20` 看对象排行。
3. **分析快照**：用 MAT 看 Leak Suspects 和 Dominator Tree，找 Retained Heap 最大的对象，再查 Path to GC Roots（排除软、弱引用）找到持有者；必要时对比两个时间点的 dump。
4. **定位修复**：常见是静态集合、无上限缓存、ThreadLocal 未 remove、监听器未注销、连接未关闭。修复后看 Full GC 后内存能否回落稳定。

堆内正常但进程 RSS 持续增长，要怀疑堆外泄漏（直接内存、元空间、JNI），用 `-XX:NativeMemoryTracking=summary` 配合 `jcmd <pid> VM.native_memory` 分析。

## JVM 调优与问题排查
### JVM 为什么需要调优？ | 高频
JVM 默认参数已经能满足大多数应用，没有性能问题时不需要刻意调优。但在高并发、低延迟、大内存场景下，GC 的频率和停顿会直接影响响应时间和稳定性，这时才需要调优。

**调优的目标**：
- **降低停顿**：GC 的 STW 会直接叠加到请求耗时上。例如接口本身 10ms，期间发生一次 50ms 的 Young GC，这次请求就变成约 60ms；秒级 Full GC 会导致大量超时。
- **减少 GC 频率**：尤其是减少 Full GC，降低 GC 占用的 CPU，提高吞吐量。
- **避免 OOM**：合理设置堆、元空间、直接内存和线程栈，防止服务崩溃。
- **匹配业务特点**：根据对象生命周期和流量特征配置堆大小、新生代比例和收集器，提高内存利用率。

**三个核心指标**：吞吐量、延迟（停顿时间）、内存占用，三者不能同时达到最优，调优是在它们之间根据业务取舍。

**原则**：调优是最后手段。大多数 GC 问题根源在代码（内存泄漏、大对象、不合理的缓存、一次查询过多数据），应该先优化代码和架构，再调 JVM 参数；任何调整都要基于监控、GC 日志和压测数据，而不是凭经验套参数。

### 你调优过 JVM 吗？ | 高频
回答时要真实，按"监控发现 → 分析定位 → 针对性优化 → 验证效果"的思路展开。没有独立主导过调优，可以说明系统了解调优思路、参与过线上问题排查。

**可以这样回答**：
1. **先说原则**：JVM 默认参数能满足大多数场景，没有问题不会随意调整；调优之前先排除代码问题。
2. **日常监控**：关注 GC 次数和耗时（尤其 Full GC）、堆和老年代使用率、元空间使用率、线程数、接口 P99 延迟等指标，并配置告警。
3. **发现问题**：例如 GC 频繁、Full GC 过多、单次 GC 耗时长、接口耗时周期性抖动。
4. **分析定位**：开启 GC 日志（JDK 8 用 `-XX:+PrintGCDetails -Xloggc:`，JDK 9+ 用 `-Xlog:gc*`），用 GCeasy 等工具分析；结合 `jstat` 看各区变化，必要时 Heap Dump 用 MAT 分析。
5. **针对性优化**：内存泄漏就改代码；过早晋升就调大年轻代或 Survivor；元空间不足就调整 `MaxMetaspaceSize` 或排查动态类生成；停顿过长考虑换 G1 或 ZGC。
6. **验证**：灰度上线后对比 GC 频率、停顿和接口延迟。

最好能准备一个具体案例（场景、现象、原因、方案、效果），比如下面"JVM 调优案例"中的过早晋升、CMS 碎片导致的 Full GC 等。

### JVM 调优参数有哪些？ | 高频
**堆和内存区域**：

| 参数 | 作用 |
| --- | --- |
| `-Xms` / `-Xmx` | 初始 / 最大堆，生产通常设成相等 |
| `-Xmn` | 年轻代大小（G1 不建议设置） |
| `-XX:NewRatio` / `-XX:SurvivorRatio` | 老年代:年轻代默认 2；Eden:单个 Survivor 默认 8 |
| `-Xss` | 线程栈大小 |
| `-XX:MetaspaceSize` / `-XX:MaxMetaspaceSize` | 元空间首次触发 GC 的阈值 / 最大值 |
| `-XX:MaxDirectMemorySize` | 直接内存上限 |
| `-XX:MaxRAMPercentage` | 容器内按内存百分比设最大堆（JDK 8u191+ / 10+） |

**收集器选择**：`UseSerialGC`、`UseParallelGC`、`UseG1GC`、`UseZGC`；`UseConcMarkSweepGC` 只适用于 JDK 13 及之前。

**GC 行为**：`MaxTenuringThreshold`（晋升年龄，默认 15）、`MaxGCPauseMillis`（G1 默认 200ms）、`InitiatingHeapOccupancyPercent`（G1 并发标记阈值，默认 45）、`CMSInitiatingOccupancyFraction`、`DisableExplicitGC`（屏蔽 `System.gc()`，用直接内存时谨慎）。

**GC 日志**：JDK 8 用 `-XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:gc.log`；JDK 9+ 用 `-Xlog:gc*:file=gc.log:time,uptime`。易错点：JDK 9 起 `PrintGCDateStamps` 已移除，加上会启动失败。

**故障诊断**：`-XX:+HeapDumpOnOutOfMemoryError`、`-XX:HeapDumpPath`、`-XX:NativeMemoryTracking=summary`；`java -XX:+PrintFlagsFinal -version` 查看参数最终值。

### 讲一个 JVM 调优案例 | 高频
回答时按"环境 → 现象 → 分析 → 方案 → 效果"组织。下面三个是 JDK 8 下常见的典型案例。

**案例一：年轻代过小，Young GC 和 Old GC 都频繁**（ParNew + CMS，JDK 8）
- 现象：Young GC 每分钟几十次，Old GC 几分钟一次。
- 分析：为降低单次停顿把年轻代设得很小，Young GC 太频繁，对象还没"死"年龄就涨上去；Survivor 小又让动态年龄阈值很低，短命对象过早晋升。
- 方案与效果：增大 `-Xmn` 和 Survivor。单次 Young GC 耗时只略增（耗时取决于存活对象数量而非 Eden 大小），Young GC 和 Old GC 频率都明显下降。

**案例二：CMS 碎片导致长耗时 Full GC**（ParNew + CMS，JDK 8，延迟敏感接口）
- 现象：高峰期偶发 Full GC，停顿 1 秒以上，请求超时。
- 分析：GC 日志中老年代总剩余空间很大，但最大连续空闲块很小，晋升 promotion failed，退化为 Serial Old 单线程 Full GC。
- 方案：低峰期摘流量后主动触发一次整理式 Full GC，降低高峰期发生概率；长期方案是升级到 G1。

**案例三：G1 停顿目标过小导致 Young GC 频繁**
- 分析：`MaxGCPauseMillis` 设成 20ms，G1 为满足目标自动缩小年轻代，Young GC 变频繁、吞吐下降。
- 方案：调回 100~200ms，去掉手动 `-Xmn`，让 G1 自适应年轻代大小。

### 你知道哪些 JDK 监控工具和排查命令？
**命令行工具**（JDK 自带）：

| 工具 | 用途 | 常用命令 |
| --- | --- | --- |
| `jps` | 列出 Java 进程 | `jps -l` |
| `jstat` | GC、类加载统计 | `jstat -gcutil <pid> 1000` |
| `jinfo` | 查看 / 修改 JVM 参数 | `jinfo -flags <pid>` |
| `jmap` | 对象统计、生成 Heap Dump | `jmap -histo:live <pid>`、`jmap -dump:live,format=b,file=heap.hprof <pid>` |
| `jstack` | 线程栈，查死锁、阻塞、CPU 飙高 | `jstack -l <pid>` |
| `jcmd` | 综合诊断，推荐替代上面几个 | `GC.heap_dump`、`Thread.print`、`VM.native_memory` |
| `jhsdb` | JDK 9+，分析进程或 core 文件 | `jhsdb jmap --heap --pid <pid>`（替代 `jmap -heap`） |

**图形化和低开销工具**：
- **JConsole / VisualVM**：基于 JMX 监控内存、线程，VisualVM 还能分析 dump（JDK 9 起需单独下载）。
- **JFR + JMC**：低开销事件记录（JDK 11 起在 OpenJDK 中开源），`jcmd <pid> JFR.start duration=60s filename=rec.jfr`。
- **MAT**：分析 Heap Dump，找泄漏和大对象。
- **Arthas**：在线诊断，`dashboard`、`thread -n 3`、`trace`、`watch`，不用重启。
- **GC 日志与监控**：GCeasy、GCViewer；Prometheus + Grafana、SkyWalking 等 APM。

**CPU 飙高排查**：`top` 找进程 → `top -Hp <pid>` 找线程 → `printf '%x\n' <tid>` 转十六进制 → `jstack <pid> | grep -A 30 <nid>` 定位代码。若是 GC 线程占用高，转去分析 GC。Arthas 的 `thread -n 3` 一步完成。

### 频繁 Full GC 可能是什么原因？如何排查？
**常见原因**：
- **内存泄漏**：静态集合、缓存、ThreadLocal 持续持有对象，每次 Full GC 回收很少。
- **大对象或瞬时大量数据**：查全表、导出大文件、大报文，迅速填满老年代。
- **过早晋升**：年轻代或 Survivor 太小，短命对象大量进入老年代。
- **堆本身太小**：业务增长后原 `-Xmx` 不够。
- **元空间不足**：动态生成大量类。
- **显式 `System.gc()`**：代码、第三方库或 RMI 定时 GC。
- **收集器相关**：CMS 碎片导致 promotion failed、Concurrent Mode Failure；G1 Mixed GC 跟不上分配速度退化为 Full GC。

**排查步骤**：
1. **看 GC 日志**：确认频率、耗时、GC cause（`Allocation Failure`、`Metadata GC Threshold`、`System.gc()`、`promotion failed` 等）和每次 Full GC 后老年代剩余量。
2. **jstat 实时观察**：`jstat -gcutil <pid> 1000` 看 Old、Metaspace 和 FGC 变化。
3. **判断类型**：
   - Full GC 后底线越来越高：泄漏，dump 分析。
   - 能降下来但老年代涨得快：过早晋升或大对象，看年龄分布（`-Xlog:gc+age=trace`）。
   - Metaspace 接近上限：查动态类生成和类加载器泄漏。
   - cause 是 `System.gc()`：找调用方，或开 `-XX:+ExplicitGCInvokesConcurrent`。
4. **Dump 分析**：MAT 看 Dominator Tree 和 GC Roots 引用链定位代码。
5. **对症处理**：修复泄漏、分页限制数据量；调整 `-Xmx`、`-Xmn`、`SurvivorRatio`、元空间；JDK 8 + CMS 考虑升级 G1。改后观察 Full GC 频率是否回落。

### 线上 OOM 如何排查？ | 蚂蚁、阿里巴巴、拼多多、招商银行
**事前准备**：线上服务都应该配置以下参数，保证 OOM 时有现场可查：

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/logs/heap.hprof
-Xlog:gc*:file=/data/logs/gc.log:time:filecount=10,filesize=100m   # JDK 9+
# JDK 8: -XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:/data/logs/gc.log
```

**排查步骤**：
1. **止血**：重启、摘流量或扩容，重启前确认 dump 已生成（或手动 `jcmd GC.heap_dump`），保留 GC 日志和应用日志。
2. **看错误类型定位区域**：
   - `Java heap space` / `GC overhead limit exceeded`：堆，重点分析 dump。
   - `Metaspace`：动态类生成或类加载器泄漏，`jcmd <pid> VM.classloader_stats` 查看。
   - `Direct buffer memory`：检查 Netty ByteBuf 是否释放、`MaxDirectMemorySize`、`DisableExplicitGC`。
   - `unable to create native thread`：`jstack` 统计线程数和线程名，查线程池配置和 `ulimit -u`。
3. **分析 dump**：MAT 看 Leak Suspects、Dominator Tree、Path to GC Roots，Histogram 看哪类对象数量异常。
4. **结合监控**：老年代持续增长是泄漏；某时刻突然飙升是大查询、大文件或流量突增，对照请求日志找接口。
5. **修复验证**：常见是无分页查询、全量导出、无上限缓存、ThreadLocal 未清理，修复后压测验证。确认只是容量不够才调参数。

**易错点**：进程直接消失而无 OOM 日志，可能是超过容器限制被 OOM Killer 杀掉，用 `dmesg | grep -i kill` 确认，检查堆外内存并让 `-Xmx` 给容器留足余量。

### GC 问题排查的真实场景
以 API 网关（JDK 8，ParNew + CMS，堆 5G）为例：CMS GC 1 小时近 20 次，偶发数秒 Full GC。根因是晋升太多太快（内部减少晋升和泄漏，外部调大 Survivor），长耗时 Full GC 则是 CMS 退化为 Serial Old 单线程整理。

![](images/Java+AI八股-3f8cb6357e2bcb91be327669391cb346.jpg)

**场景一：配置定时全量更新**。现象：摘流量后老年代仍每小时规律上涨。原因：配置中心每小时全量推送几万条配置且逐条打日志。处理：改增量更新、减少日志。

**场景二：threshold 退化为 1**。现象：promotion failed 引发长 STW。原因：日志 `new threshold 1 (max 15)`，年龄 1 的对象就超过 Desired survivor size（= Survivor × TargetSurvivorRatio，默认 50%），存活对象全部晋升。

![](images/Java+AI八股-182072a882c2c1388e37aa67671d4fd0.jpg)

**场景三：大响应体**。现象：只有大流量机器出现，日志有 concurrent mode failure 和 promotion failed。原因：解码转换大响应体产生大对象，提前晋升。处理：推动业务方治理大响应体。

**场景四：增大新生代和 Survivor**。现象：治理后 CMS GC 仍每天约 20 次。原因：Survivor 不足 250MB。处理：`-Xmn` 2G 调到 3G，`SurvivorRatio` 8 改 4，Survivor 512MB，threshold 不再退化。

![](images/Java+AI八股-358f5da028b5c7be2eed8ddc1dca7c0f.jpg)

**场景五：CMS 碎片化**。现象：老年代剩余超过 2G，却因 65538 字节的对象 promotion failure。原因：Max Chunk Size 只有约 64KB。处理：低峰期摘流量后主动触发整理式 Full GC。

**练习：分析下面的配置和日志。**

```text
JDK 8，16 核 / 16G，返回 body 约 200KB，线程数 583
-Xmx13g -Xms13g -Xmn7g -XX:SurvivorRatio=8 -XX:MaxMetaspaceSize=640m
-XX:+UseConcMarkSweepGC -XX:CMSInitiatingOccupancyFraction=80
Full GC 耗时 703ms，触发时老年代约 50%，回收后降到 750MB
Young GC：存活 183MB，耗时 0.02s；Desired survivor size 358MB，new threshold 15
```

**分析**：年轻代健康（threshold 保持 15）；老年代 50% 就"Full GC"而阈值 80%，要先看 cause，可能是没设 `UseCMSInitiatingOccupancyOnly`，或监控把 CMS 并发回收算成 Full GC；回收后降得多，不是泄漏；13G 堆加堆外已接近 16G，有 OOM Killer 风险。

**建议**：加 `UseCMSInitiatingOccupancyOnly`；堆缩到约 10G；更推荐换 G1 并去掉 `-Xmn`；压缩响应体；先灰度一台再推广。

### JVM 中容易混淆的概念有哪些？
1. **方法区与永久代 / 元空间**：方法区是规范，永久代（JDK 7 及之前）和元空间（JDK 8+）是 HotSpot 的实现。
2. **元空间不在堆中**：元空间使用本地内存，只存类元数据；JDK 7 起字符串常量池和静态变量已经在堆中，不在元空间。
3. **对象不一定在堆上**：逃逸分析后可以通过标量替换避免堆分配（HotSpot 并没有真正的栈上分配）。
4. **TLAB 不是独立区域**：TLAB 属于 Eden，只优化分配过程的并发竞争，不保证对象线程安全。
5. **Young GC 也会 STW**：所有收集器的 Young GC 都要暂停用户线程，只是时间较短。
6. **CMS 的代价**：低停顿，但有内存碎片、浮动垃圾和 Concurrent Mode Failure 的风险；JDK 14 已被移除。
7. **G1 不是整代回收**：G1 按 Region 管理，优先回收收益最高的 Region，Mixed GC 只回收部分老年代。
8. **ClassNotFoundException 与 NoClassDefFoundError**：前者是受检异常，发生在显式按名称加载时；后者是 Error，发生在编译时存在、运行时找不到类定义时。
9. **打破双亲委派**：要重写 `loadClass()`；只重写 `findClass()` 仍然遵循双亲委派。
10. **Full GC 不等于 Old GC**：Full GC 回收整个堆和元空间，停顿通常更长；只有 CMS 有独立的 Old GC。
11. **StackOverflowError 不是 OOM**：递归太深是 StackOverflowError，线程太多无法分配栈才是 OOM。
12. **JMM 与 JVM 内存结构**：JMM 是并发可见性和有序性的规范，内存结构是运行时数据区的划分，两者不是一回事。
