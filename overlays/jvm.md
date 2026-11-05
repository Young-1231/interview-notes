## 导读
- 必背主线：运行时数据区（线程私有 vs 共享）→ 对象创建与内存布局 → 可达性分析与 GC Roots → 三种回收算法与分代 → CMS / G1 / ZGC → 类加载过程与双亲委派 → OOM 排查与常用命令。
- 最容易混：方法区是规范，永久代 / 元空间是 HotSpot 的实现；JDK 7 起字符串常量池和静态变量都已移到堆里，并不在元空间。
- 版本题常被追问：JDK 8 默认 Parallel，JDK 9 起默认 G1；CMS 在 JDK 9 被废弃，JDK 14 被移除。

## 纠正: 变量存在堆还是栈
原文说静态变量放在方法区（JDK 8 后由元空间实现），实际上在 HotSpot 中，从 JDK 7 开始静态变量就随 Class 对象一起存放在 Java 堆里了。
JDK 8 的元空间只存类的元数据（InstanceKlass、方法、字段描述等），既不放静态变量的值，也不放字符串常量池。

## 纠正: 方法区有什么作用
原文把静态变量列为方法区存储的内容。这只适用于 JDK 6 及之前。HotSpot 从 JDK 7 起把静态变量和字符串常量池都移到了堆中，JDK 8 的元空间里已经没有它们。
规范层面方法区仍然“包含”这些概念，但面试问到 HotSpot 的具体位置时，要回答在堆里。

## 纠正: 一个对象什么时候会进入老年代
原文说动态年龄判断是“某一年龄及以上对象的总大小超过 Survivor 的一半”，实际是按年龄从小到大累加：从年龄 1 开始，把各年龄的对象大小加起来，加到年龄 N 时一旦超过 Survivor 容量的 TargetSurvivorRatio（默认 50%），就把晋升阈值设为 N（不超过 MaxTenuringThreshold），年龄大于等于 N 的对象晋升到老年代。

## 纠正: intern()方法有什么作用
原文说常量池中没有该字符串时，intern() 会把它加入常量池并返回“新创建的对象”的引用。这只是 JDK 6 的行为（会复制一份到永久代）。
JDK 7+ 不会新建对象，而是把当前堆中这个 String 的引用记录到常量池，并直接返回它本身。所以 `String s = new String("a") + new String("b"); s.intern() == s` 在 JDK 7+ 为 true。

## 纠正: 什么是直接内存
原文说直接内存“不会受到垃圾回收的影响”“需要手动释放”，这是错的。DirectByteBuffer 申请的堆外内存由 Cleaner 管理：堆上的 DirectByteBuffer 对象被 GC 回收后，对应的本地内存就会释放，不需要也没有公开 API 去手动释放。
另外，直接内存达到 -XX:MaxDirectMemorySize 上限时，JDK 会主动调用 System.gc() 来回收。所以开启 -XX:+DisableExplicitGC 可能导致 OutOfMemoryError: Direct buffer memory。

## 纠正: 对象的内存布局是怎样的
原文说 Class Pointer 指向“类的 Class 对象”，实际上类型指针（Klass Pointer）指向的是元空间里的类元数据 InstanceKlass，不是堆里的 java.lang.Class 对象。Class 对象是 InstanceKlass 在堆中的镜像（mirror）。
另外，类型指针本身就是对象头的一部分。对象头 = Mark Word + 类型指针（数组还要加 4 字节的长度），布局示例里不应把它和对象头并列。

## 纠正: JVM 调优的参数都有哪些
原文列出的 -XX:+PrintGCDetails、-XX:+PrintGCDateStamps 只适用于 JDK 8。JDK 9 起 GC 日志改用统一日志 -Xlog:gc*（例如 `-Xlog:gc*:file=gc.log:time`）。其中 PrintGCDateStamps 已被移除，加上它 JVM 会直接启动失败。
-XX:+UseConcMarkSweepGC 在 JDK 14+ 会被忽略并打印警告，因为 CMS 已被移除。频繁 Full GC、线上 OOM 排查两题里的同类参数也一样。

## 补充: 对象的创建需要经历哪些过程
对象头大小（64 位 HotSpot）：Mark Word 8 字节，类型指针开启压缩（默认）时 4 字节、否则 8 字节，数组再加 4 字节长度。所以 `new Object()` 是 12 字节头 + 4 字节对齐填充，共 16 字节。
JDK 24 实验性引入、JDK 25 转为正式特性的 Compact Object Headers（-XX:+UseCompactObjectHeaders，非默认）可以把对象头压到 8 字节。

## 补充: 对象能够被回收，就代表一定会被回收吗
关键点是 finalize() 的两次标记：对象第一次被判定不可达后，如果重写了 finalize() 且还没执行过，会被放入 F-Queue 执行。如果在 finalize() 中重新与引用链建立关联，就能“自救”一次，第二次就不行了。finalize() 已在 JDK 9 被标记为废弃，JDK 18 起（JEP 421）被标记为将要移除。
另外，HotSpot 并不使用引用计数法，原文把它和可达性分析并列，容易误解。

## 补充: 哪些情况会触发类初始化
“通过子类访问父类静态变量”只会初始化父类，不会初始化子类，并不是谁都不初始化。另外，Class.forName(name) 默认会初始化类，而 ClassLoader.loadClass() 只加载、不初始化。

## 补充: 如何选择垃圾回收器
各版本默认收集器：JDK 8 默认 Parallel（Parallel Scavenge + Parallel Old），JDK 9 起默认 G1。在 CPU 少于 2 核或内存小于约 1792MB 的非服务器级机器上，JVM 会选 Serial。
ZGC 在 JDK 11 实验性引入，JDK 15 转正，JDK 21 增加分代模式，JDK 23 起默认使用分代模式，JDK 24 移除了非分代模式。

## 补充: 基本数据类型存放在什么地方
常被追问的一点：基本类型如果是对象的成员变量，它的值随对象一起存放在堆中；只有方法内的局部变量才在栈帧的局部变量表里。另外，JIT 经逃逸分析做标量替换后，对象字段也可能被拆成局部变量，不再分配在堆上。

## 自测
### 哪些内存区域是线程私有的？
程序计数器、虚拟机栈、本地方法栈。堆和方法区是线程共享的。
### 哪个区域不会发生 OOM？
程序计数器，它是 JVM 规范里唯一没有规定 OutOfMemoryError 的区域。
### 方法区、永久代、元空间是什么关系？
方法区是 JVM 规范里的逻辑概念。永久代（JDK 7 及之前）和元空间（JDK 8+，使用本地内存）是 HotSpot 对它的两种实现。
### JDK 7+ 字符串常量池和静态变量在哪里？
都在 Java 堆中，不在永久代，也不在元空间。
### 对象创建的五步是什么？
类加载检查 → 分配内存（指针碰撞或空闲列表，优先走 TLAB）→ 内存置零 → 设置对象头 → 执行 `<init>` 构造方法。
### 64 位 JVM 默认开启压缩指针时，new Object() 占多少字节？
16 字节：8 字节 Mark Word + 4 字节类型指针 + 4 字节对齐填充。
### 常见的 GC Roots 有哪些？
虚拟机栈局部变量引用的对象、类静态属性引用的对象、常量引用的对象、JNI 引用的对象、synchronized 持有的对象，以及 JVM 内部引用（如系统类加载器、基本类型的 Class 对象）。
### 为什么 Java 不用引用计数法？
因为它无法处理循环引用。HotSpot 用的是可达性分析。
### 三种基本回收算法各自的缺点是什么？
标记-清除会产生碎片；复制算法要浪费一半空间（HotSpot 的 Eden:S0:S1 = 8:1:1，只浪费 10%）；标记-整理要移动对象，停顿较长。
### 对象晋升到老年代有哪几种途径？
年龄达到 MaxTenuringThreshold（默认 15）、大对象直接进入老年代、动态年龄判断、Minor GC 后 Survivor 放不下时由分配担保晋升。
### JDK 8 和 JDK 9+ 的默认 GC 分别是什么？
JDK 8 是 Parallel（Parallel Scavenge + Parallel Old），JDK 9 起是 G1。
### CMS 的四个阶段中，哪些需要 STW？
初始标记和重新标记需要 STW，并发标记和并发清除不需要。CMS 在 JDK 9 被废弃，JDK 14 被移除。
### CMS 发生 Concurrent Mode Failure 会怎样？
退化为 Serial Old，对老年代做单线程的标记-整理 Full GC，停顿很长。
### G1 怎么做到停顿时间可预测？
它把堆分成等大的 Region，按回收收益排序，在 MaxGCPauseMillis 目标内优先回收收益最高的 Region。
### 三色标记的漏标怎么解决？
CMS 用增量更新（记录黑色对象新增的引用，重新标记时再扫描），G1 用 SATB 原始快照（记录被删除的引用）。
### 类加载过程有哪几步？
加载 → 验证 → 准备（静态变量赋零值）→ 解析（符号引用转为直接引用）→ 初始化（执行 `<clinit>`）。
### 怎么打破双亲委派？
自定义类加载器并重写 loadClass()。只重写 findClass() 不会打破双亲委派。典型例子有 Tomcat、SPI（线程上下文类加载器）、OSGi。
### JDK 9 之后类加载器有什么变化？
扩展类加载器被平台类加载器（Platform ClassLoader）取代，rt.jar 也没有了，核心类库改为按模块组织。
### 软引用和弱引用的回收时机有什么区别？
软引用在内存不足时才回收，弱引用只要发生 GC 就会回收。
### CPU 飙高怎么定位到代码？
用 top 找到进程，`top -Hp pid` 找到线程，把线程 id 转成十六进制，再用 `jstack pid | grep` 查找对应的线程栈。
