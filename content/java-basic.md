## Java 语言与平台
### Java 语言有什么特点？ | 建设银行、交通银行
Java 是一门面向对象、跨平台、自带内存管理的静态强类型语言。

- **跨平台**：源码由 `javac` 编译成与平台无关的字节码（`.class`），由各平台上的 JVM 执行，即"一次编译，到处运行"。跨平台的是字节码，JVM 本身是平台相关的。
- **面向对象**：支持封装、继承、多态。Java 不是"纯"面向对象语言，因为还保留了 8 种基本类型。
- **自动内存管理**：对象在堆上分配，由 GC 回收，没有指针运算，也不用手动 `free`，减少了野指针和内存泄漏。
- **执行性能好**：JVM 先解释执行字节码，再由 JIT 把热点代码编译成本地机器码（HotSpot 有 C1、C2 分层编译），长期运行时性能接近本地代码。
- **安全与健壮**：强类型检查、数组越界检查、字节码校验、异常机制。
- **原生支持多线程**：语言层面有 `Thread`、`synchronized`、`volatile`，标准库有 `java.util.concurrent`，JDK 21 起有虚拟线程。
- **生态成熟**：Spring、MyBatis、Netty、Kafka、Hadoop 等，在企业后端、大数据、分布式系统中广泛使用。

### JDK、JRE、JVM 有什么区别和联系？ | 高频
三者是包含关系：**JDK ⊃ JRE ⊃ JVM**。JDK 用于开发，JRE 用于运行，JVM 是执行字节码的核心。

| 名称 | 组成 | 作用 |
| --- | --- | --- |
| JVM（Java 虚拟机） | 类加载器、运行时数据区、执行引擎（解释器 + JIT）、GC | 加载并执行字节码，负责内存管理和垃圾回收；不同操作系统有各自的 JVM 实现 |
| JRE（Java 运行时环境） | JVM + Java 核心类库 | 运行已编译好的 Java 程序，不能编译 |
| JDK（Java 开发工具包） | JRE + 开发工具（`javac`、`java`、`jar`、`javadoc`、`jdb`、`jstack`、`jmap` 等） | 编写、编译、调试、打包 Java 程序 |

补充：从 JDK 9 起引入模块化，JDK 11 起 Oracle 不再单独发布 JRE，需要精简运行时可以用 `jlink` 按模块裁剪出一个自定义运行时镜像。

### 什么是字节码？Java 是编译型还是解释型语言？
字节码是 Java 源码经 `javac` 编译后得到的、面向 JVM 的指令集，存放在 `.class` 文件里，与具体 CPU 和操作系统无关。

- **为什么要有字节码**：同一份 `.class` 可以在任何有 JVM 的平台上运行，实现跨平台；同时字节码比源码更紧凑，JVM 加载时还会做校验，保证安全。
- **执行方式**：Java 既不是纯编译型也不是纯解释型，而是**先编译成字节码，再由 JVM 解释执行 + JIT 编译**。程序启动时由解释器逐条执行字节码；JVM 统计方法调用次数和循环回边次数，把热点代码交给 JIT 编译成本地机器码并缓存，之后直接执行机器码。
- **其他语言**：Kotlin、Scala、Groovy 也编译成字节码运行在 JVM 上。
- **AOT**：GraalVM Native Image 等可以把 Java 程序提前编译成本地可执行文件，启动快、内存小，但会失去部分动态特性（如任意反射需要提前配置）。

### Java 和 C++ 有什么区别？为什么 Web 开发通常用 Java？ | 工商银行、邮政储蓄银行、滴滴
两者都是面向对象语言，核心区别是 Java 运行在 JVM 上、自动管理内存，C++ 直接编译为本地机器码、手动管理内存。

| 维度 | Java | C++ |
| --- | --- | --- |
| 运行方式 | 编译为字节码，JVM 解释 + JIT | 直接编译为目标平台机器码，需按平台分别编译 |
| 内存管理 | GC 自动回收 | 手动 `new/delete`，或用 RAII、智能指针 |
| 指针 | 没有指针运算，只有引用 | 支持指针和指针运算 |
| 继承 | 类单继承，接口多实现 | 支持多重继承（有菱形继承问题，用虚继承解决） |
| 其他 | 没有运算符重载、没有析构函数 | 支持运算符重载、析构函数、模板元编程 |
| 性能 | 启动慢、有 GC 停顿，长期运行接近本地代码 | 无运行时开销，可控性强，适合系统级、高性能场景 |

**Web 开发多用 Java 的原因**：
- 生态完善：Spring / Spring Boot / Spring Cloud、MyBatis、Netty 等覆盖了 Web、微服务、数据访问的全链路。
- 开发效率高、出错少：GC、异常机制、强类型和成熟的 IDE，降低了内存类 bug 和维护成本。
- 并发能力强：完整的线程模型和 `java.util.concurrent` 工具包，JDK 21 虚拟线程进一步降低了高并发 I/O 的成本。
- 稳定可运维：JVM 经过长期打磨，配套的监控、诊断、调优工具（JFR、Arthas、jstack 等）齐全。
- 人才和企业积累多：金融、电商等大型系统大量使用 Java，招聘和技术沉淀都更成熟。

### Java 和 Go 有什么区别？
Java 偏重通用性和庞大的面向对象生态，Go 偏重简洁、编译成单一二进制和原生并发，适合云原生和基础设施。

| 维度 | Java | Go |
| --- | --- | --- |
| 编译与运行 | 编译为字节码，运行在 JVM 上（解释 + JIT） | 直接编译为平台相关的本地二进制，无需虚拟机，交叉编译方便 |
| 启动与内存 | JVM 启动和预热较慢，内存占用较高 | 启动快、内存占用小，部署只需一个可执行文件 |
| 并发模型 | 平台线程与 OS 线程 1:1，依赖线程池；JDK 21 起有虚拟线程（M:N） | goroutine 由运行时调度（GMP，M:N），初始栈只有几 KB；channel 实现 CSP 模型 |
| 面向对象 | 类、继承、接口需显式 `implements` | 没有类和继承，用 struct + 组合；接口隐式实现（鸭子类型） |
| 错误处理 | 异常机制（try-catch） | 多返回值显式返回 `error`，`panic/recover` 只用于严重错误 |
| 泛型 | JDK 5 引入，类型擦除 | Go 1.18 引入 |
| 生态 | 企业级框架极其丰富 | 云原生基础设施（Docker、Kubernetes、etcd）大量使用 |

两者都有 GC。回答时可以补一句：JDK 21 虚拟线程和 GraalVM Native Image 正在缩小 Java 在高并发和启动速度上的差距。

### JDK 8 / 11 / 17 / 21 各有哪些重要新特性？ | 高频
8、11、17、21、25 都是 LTS（长期支持）版本，面试重点是 8、17、21。Spring Boot 3.x 要求 JDK 17+。

| 版本 | 重要特性 |
| --- | --- |
| JDK 8 | Lambda、方法引用、Stream API、接口 `default`/`static` 方法、`Optional`、`java.time`、`CompletableFuture`；HashMap 引入红黑树；元空间取代永久代 |
| JDK 9–10 | 模块系统（JPMS）、G1 成为默认 GC、`String` 改用 `byte[]`、`List.of` 等工厂方法；JDK 10 引入 `var` |
| JDK 11 | 标准化 `HttpClient`（HTTP/2、异步）；`String` 新增 `isBlank()`、`strip()`、`repeat()`；直接运行单文件源码；实验性 ZGC |
| JDK 12–16 | Switch 表达式（14 正式）、更友好的 NPE 提示（14）、文本块（15 正式）、Record 和 `instanceof` 模式匹配（16 正式） |
| JDK 17 | 密封类 `sealed`/`permits` 正式；强封装 JDK 内部 API（反射访问需 `--add-opens`）；Security Manager 标记为废弃待移除 |
| JDK 21 | 虚拟线程正式；Switch 模式匹配和 Record 模式正式；`SequencedCollection`（`getFirst()`、`reversed()`）；分代 ZGC |
| JDK 22–25 | FFM API（22 正式）；Stream Gatherers（24 正式）；虚拟线程在 `synchronized` 中不再钉住载体线程（24）；JDK 25（LTS）正式化 Scoped Values、紧凑源文件与实例 `main` 方法 |

```java
// JDK 16+ record + JDK 21 switch 模式匹配
sealed interface Shape permits Circle, Square {}
record Circle(double r) implements Shape {}
record Square(double side) implements Shape {}

static double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.r() * c.r();
        case Square q -> q.side() * q.side();
    }; // 密封接口的所有子类都已覆盖，不需要 default
}
```

## 基本类型与变量
### Java 的 8 种基本数据类型是什么？分别占多少字节？ | 高频
8 种基本类型分为 4 类，大小由 Java 规范固定，与平台无关。

| 类型 | 字节 | 默认值 | 取值范围 / 说明 | 包装类 |
| --- | --- | --- | --- | --- |
| `byte` | 1 | 0 | -128 ~ 127 | `Byte` |
| `short` | 2 | 0 | -2^15 ~ 2^15-1 | `Short` |
| `int` | 4 | 0 | -2^31 ~ 2^31-1（约 ±21 亿） | `Integer` |
| `long` | 8 | 0L | -2^63 ~ 2^63-1 | `Long` |
| `float` | 4 | 0.0f | IEEE 754 单精度，约 6–7 位有效数字 | `Float` |
| `double` | 8 | 0.0d | IEEE 754 双精度，约 15–16 位有效数字 | `Double` |
| `char` | 2 | `'\u0000'` | 无符号，0 ~ 65535，存 UTF-16 码元 | `Character` |
| `boolean` | 规范未规定 | false | `true` / `false` | `Boolean` |

**关于 `boolean`**：JVM 规范没有规定其大小。编译后 `boolean` 局部变量和运算都按 `int` 处理（占一个 4 字节的局部变量槽）；`boolean[]` 按 `byte` 数组处理，每个元素 1 字节；HotSpot 中作为对象字段时通常占 1 字节。

注意：成员变量有默认值，局部变量没有默认值，必须先赋值再使用。

### 有了基本类型为什么还要包装类型？
因为 Java 很多地方只能使用对象，基本类型需要"包装"成对象才能参与。

- **泛型和集合只能放对象**：`List<int>` 不合法，必须写 `List<Integer>`。
- **可以表示 null**：包装类型能区分"没有值"和"值为 0"。数据库可空字段、接口 DTO 一般用包装类型。
- **提供工具方法和常量**：`Integer.parseInt()`、`Integer.MAX_VALUE`、`Integer.toBinaryString()` 等。
- **面向对象的统一性**：可以作为 `Object` 参数传递、调用 `equals()`/`hashCode()`。

基本类型的优势是不用创建对象、存取快、不会为 null，所以局部变量和大量数值计算优先用基本类型。

| 对比 | 基本类型 | 包装类型 |
| --- | --- | --- |
| 存储 | 局部变量存于栈帧，字段随对象存储 | 引用指向堆上的对象 |
| 默认值 | 0 / false | null |
| 比较 | `==` 比较值 | 必须用 `equals()` |
| 泛型 | 不能用 | 能用 |

### 什么是自动装箱与拆箱？原理是什么？
装箱是基本类型转成对应包装类对象，拆箱是包装类对象转回基本类型。自动装箱/拆箱是 JDK 5 引入的语法糖，由编译器在编译期插入方法调用。

```java
Integer a = 10;   // 自动装箱，编译后等价于 Integer.valueOf(10)
int b = a;        // 自动拆箱，编译后等价于 a.intValue()
```

**注意点**：
- **拆箱可能 NPE**：包装类为 null 时拆箱会抛 `NullPointerException`，例如 `Integer x = null; int y = x;`，或三目运算符 `flag ? map.get(k) : 0` 触发拆箱。
- **性能**：循环中频繁装箱会创建大量对象，如 `Long sum = 0L; for (...) sum += i;`，应改用 `long`。
- **比较陷阱**：包装类之间用 `==` 比较的是引用，受缓存影响，必须用 `equals()`。
- **混合运算时自动拆箱**：`Integer == int` 时，`Integer` 会被拆箱后按数值比较。

### 介绍一下 Integer 的缓存 | 高频
`Integer.valueOf(int)` 会先查 `IntegerCache`，默认缓存 **-128 ~ 127** 的 `Integer` 对象，范围内返回同一个对象，范围外每次 `new` 新对象。自动装箱调用的就是 `valueOf()`，所以也受缓存影响。

```java
Integer a = 127, b = 127;
System.out.println(a == b);       // true，命中缓存
Integer c = 128, d = 128;
System.out.println(c == d);       // false，两个不同对象
System.out.println(c.equals(d));  // true
Integer e = new Integer(127);     // 不走缓存（该构造器 JDK 9 起已废弃）
System.out.println(a == e);       // false
```

- 上限可以通过 JVM 参数 `-XX:AutoBoxCacheMax=<size>`（或系统属性 `java.lang.Integer.IntegerCache.high`）调大，下限固定为 -128。
- 其他包装类：`Byte`、`Short`、`Long` 固定缓存 -128 ~ 127；`Character` 缓存 0 ~ 127；`Boolean` 缓存 `TRUE`/`FALSE`；`Float`、`Double` 没有缓存。
- 结论：包装类比较值一律用 `equals()`，或拆箱后比较。

### 浮点数可以用 == 判断相等吗？金额应该用什么类型？ | 交通银行
不推荐。`float`/`double` 采用 IEEE 754 二进制表示，很多十进制小数（如 0.1）无法精确表示，运算会产生误差。

```java
System.out.println(0.1 + 0.2 == 0.3);    // false，结果是 0.30000000000000004

double a = 0.1 + 0.2, b = 0.3;
boolean eq = Math.abs(a - b) < 1e-9;     // 用误差范围 epsilon 判断"足够接近"
```

- **比较大小**：`<`、`>` 可以直接用，判等时用 epsilon；包装类可用 `Double.compare()`。
- **特殊值**：`NaN != NaN`，要用 `Double.isNaN()` 判断；`0.0 == -0.0` 为 true，但 `Double.equals()` 认为两者不等。
- **金额和精确计算**：用 `BigDecimal`，并且用字符串构造 `new BigDecimal("0.1")` 或 `BigDecimal.valueOf(0.1)`，不要用 `new BigDecimal(0.1)`（会带入二进制误差）。`BigDecimal` 比较数值用 `compareTo()`，`equals()` 还会比较精度（`1.0` 和 `1.00` 不相等）。也可以用 `long` 以"分"为单位存储。

### 成员变量和局部变量有什么区别？
区别在于定义位置、作用域、生命周期、存储位置和默认值。

| 对比 | 成员变量 | 局部变量 |
| --- | --- | --- |
| 定义位置 | 类中、方法外 | 方法、构造器、代码块内部，或方法参数 |
| 分类 | 实例变量、静态变量（类变量） | — |
| 作用域 | 整个类 | 声明处到所在代码块结束 |
| 生命周期 | 实例变量随对象创建和回收；静态变量随类加载和卸载 | 方法调用时创建，方法结束（栈帧弹出）时销毁 |
| 存储位置 | 实例变量在堆中的对象里；静态变量在 JDK 7 及以后随 `Class` 对象存放在堆中 | 栈帧的局部变量表中（引用类型存引用，对象本身在堆上） |
| 默认值 | 有（0 / false / null） | 无，必须显式赋值 |
| 修饰符 | 可用访问修饰符、`static`、`final` 等 | 只能用 `final` |

### 什么是静态变量？静态方法能调用非静态成员吗？
静态变量是用 `static` 修饰的成员变量，属于类而不属于某个对象，所有实例共享一份，在类初始化时赋值，类卸载时才释放。

**存储位置**：静态变量的值在 HotSpot 中，JDK 7 起随 `Class` 对象存放在堆中；JDK 8 用元空间取代永久代，元空间存放的是类的元数据，并不存放静态变量本身。

**静态方法不能直接访问非静态成员（实例变量、实例方法）**：
- 静态方法属于类，调用时可以不存在任何对象，也就没有 `this`。
- 非静态成员属于具体对象，必须先 `new` 出对象才存在。
- 所以在静态方法里直接访问实例成员，编译器无法确定访问的是哪个对象，会编译报错。

正确做法是在静态方法中先创建或传入对象，再通过对象访问：`new User().getName()`。反过来，实例方法可以直接访问静态成员。

### 标识符和关键字有什么区别？常用关键字有哪些？
标识符是程序员给类、方法、变量、包等起的名字；关键字是 Java 语言预留、有特殊语法含义的单词，不能用作标识符。

**标识符规则**：由字母、数字、`_`、`$` 组成，不能以数字开头，不能是关键字或字面量（`true`、`false`、`null`），严格区分大小写（`age` 和 `Age` 不同）。JDK 9 起单独的 `_` 不能作为标识符。

**常用关键字**（全部小写）：
- 访问控制：`public`、`protected`、`private`
- 类、方法和变量修饰：`class`、`interface`、`enum`、`abstract`、`final`、`static`、`extends`、`implements`、`new`、`synchronized`、`volatile`、`transient`、`native`
- 流程控制：`if`、`else`、`switch`、`case`、`default`、`for`、`while`、`do`、`break`、`continue`、`return`
- 异常处理：`try`、`catch`、`finally`、`throw`、`throws`
- 基本类型：`byte`、`short`、`int`、`long`、`float`、`double`、`char`、`boolean`、`void`
- 其他：`this`、`super`、`package`、`import`、`instanceof`、`assert`
- 保留但未使用：`goto`、`const`
- 上下文关键字（只在特定位置有含义，可作变量名）：`var`、`record`、`sealed`、`permits`、`yield`

### Java 有哪些访问修饰符？作用范围是怎样的？
共 4 种访问级别，从宽到窄：`public` > `protected` > 默认（包访问，不写修饰符）> `private`。

| 修饰符 | 本类 | 同包 | 不同包子类 | 不同包非子类 |
| --- | --- | --- | --- | --- |
| `public` | ✓ | ✓ | ✓ | ✓ |
| `protected` | ✓ | ✓ | ✓ | ✗ |
| 默认 | ✓ | ✓ | ✗ | ✗ |
| `private` | ✓ | ✗ | ✗ | ✗ |

- 顶层类只能用 `public` 或默认修饰；内部类四种都可以。
- `protected` 在不同包的子类中，只能通过子类自身（或其子类）的引用访问继承来的成员，不能通过父类引用访问。
- 接口成员默认是 `public`；JDK 9 起接口可以有 `private` 方法。
- JDK 9 模块系统在此之上又加了一层：包没有被模块 `exports`，即使是 `public` 类，模块外也访问不到。

## 面向对象
### 谈谈你对面向对象的理解 | 交通银行、字节、蚂蚁
面向对象（OOP）是把系统看成一组相互协作的对象：每个对象封装自己的状态（属性）和行为（方法），通过对象之间的消息调用完成业务。

- **和面向过程的区别**：面向过程以"步骤"为中心，按函数一步步执行（先做什么、再做什么）；面向对象以"对象"为中心，先找出问题域里有哪些对象、各自负责什么，再让它们协作。
- **例子**：造一辆汽车，面向对象会先抽象出"汽车"类，它由"发动机""轮子""方向盘"等对象组合而成，每个部件有自己的属性和行为，汽车通过调用这些部件完成"启动""转向"。
- **好处**：更贴近现实建模，高内聚低耦合，易复用、易扩展、易维护，适合大型复杂系统。
- **代价**：抽象层次多，设计不当会过度设计；简单脚本类问题用面向过程更直接。

### 面向对象有哪些特性？请分别解释 | 高频
通常说三大特性：**封装、继承、多态**；也有说法加上**抽象**，称四大特性。

- **封装**：把数据和操作数据的方法放在一起，用访问修饰符隐藏内部实现，只暴露必要的接口（如 `private` 字段 + `getter/setter`）。好处是安全、内部可修改而不影响调用方。
- **继承**：子类通过 `extends` 复用父类的属性和方法，并可以扩展或重写。Java 类只支持单继承，接口可以多实现。
- **多态**：同一个父类引用或接口引用，指向不同子类对象时，调用同一方法表现出不同行为。
  - 编译时多态：方法重载，编译期根据参数确定调用哪个方法。
  - 运行时多态：方法重写 + 父类引用指向子类对象，运行期根据对象实际类型动态绑定。
- **抽象**：提取事物的共同特征、忽略非本质细节，用抽象类或接口描述共性。

### 继承和多态分别是什么？有什么区别？ | 高频
继承是类与类之间的关系，解决代码复用；多态是对象的行为特性，解决调用的统一和扩展。**继承（或接口实现）是多态的基础**。

- **继承**：子类通过 `extends` 获得父类的非私有属性和方法，可以新增成员，也可以重写父类方法。构造器不能被继承，子类构造器会先调用父类构造器（显式 `super(...)` 或隐式无参）。
- **多态**：三个前提是**继承或实现、方法重写、父类引用指向子类对象**。运行时 JVM 根据对象的实际类型（通过虚方法表）调用对应的重写方法。

```java
Animal a = new Dog();
a.speak();   // 运行时调用 Dog.speak()
```

注意：多态只针对实例方法。字段和静态方法没有多态，按引用的声明类型决定。

### 多态的目的是什么？解决了什么问题？
多态让调用方只依赖抽象（父类或接口），不依赖具体实现，从而实现解耦和"对扩展开放、对修改关闭"。

- **提高扩展性**：新增一种实现只需新增一个类，调用方代码不改。
- **降低耦合、便于维护**：调用者不关心具体类型，修改某个实现不影响其他代码。
- **统一处理**：一个方法可以接收所有子类型，减少大量 `if-else`/`instanceof` 分支。
- **很多设计模式的基础**：策略模式、模板方法、工厂模式，以及 Spring 依赖注入（注入接口，运行时决定实现）。

```java
interface Animal { void eat(); }
class Dog implements Animal { public void eat() { System.out.println("Dog eats bones"); } }
class Cat implements Animal { public void eat() { System.out.println("Cat eats fish"); } }

class Zoo {
    // 新增 Tiger 只需新建一个实现类，feed 方法无需修改
    public void feed(Animal a) { a.eat(); }
}
```

### Java 为什么是单继承？
Java 类只能单继承，主要是为了避免多继承带来的**菱形继承（钻石问题）**和复杂度。

- **菱形问题**：B、C 都继承 A 并各自重写了 `foo()`，D 同时继承 B 和 C，调用 `D.foo()` 时无法确定用哪个版本；A 的字段在 D 中还可能存在两份。C++ 为此引入了虚继承，进一步增加了语言复杂度。
- **Java 的取舍**：类单继承，保证继承链清晰；需要"多种能力"时用接口多实现，接口之间也可以多继承（`interface C extends A, B`）。
- **接口的冲突处理**：接口没有实例字段，不会出现状态重复。JDK 8 引入 `default` 方法后，如果一个类实现的两个接口有同签名的默认方法，编译器会强制该类重写这个方法，可用 `A.super.foo()` 指定调用哪一个。
- 另外可以用**组合**代替继承来复用代码（组合优于继承）。

### 方法重载和重写有什么区别？ | 高频 | 建设银行、邮政储蓄银行、工商银行
重载是同一个类中方法名相同、参数列表不同，编译期确定调用；重写是子类重新实现父类方法，运行期根据对象实际类型确定调用。

| 对比 | 重载（Overload） | 重写（Override） |
| --- | --- | --- |
| 发生位置 | 同一个类（或父子类之间继承来的同名方法） | 父子类之间，或类实现接口 |
| 方法名 | 相同 | 相同 |
| 参数列表 | 必须不同（类型、个数、顺序） | 必须相同 |
| 返回值 | 无要求，仅返回值不同不构成重载 | 相同，或是父类返回类型的子类（协变返回）；基本类型和 `void` 必须完全相同 |
| 访问修饰符 | 无要求 | 不能比父类更严格（父类 `protected`，子类可以是 `protected`/`public`） |
| 异常 | 无要求 | 不能抛出新的或更宽泛的受检异常，非受检异常不限 |
| 适用范围 | 普通方法、静态方法、构造器 | 不能重写 `private`、`static`、`final` 方法和构造器 |
| 绑定时机 | 编译期（静态分派），编译时多态 | 运行期（动态分派），运行时多态 |

- 子类定义与父类同签名的 `static` 方法叫**方法隐藏**，不是重写，调用哪个由引用的声明类型决定。
- 重写方法建议加 `@Override`，让编译器检查签名是否真的匹配。

### 子类重写父类方法时，返回值能不能不一样？
可以不完全一样，但必须满足**协变返回类型**规则（JDK 5 起）：子类方法的返回类型可以是父类方法返回类型的**子类型**。

```java
class Animal { Animal create() { return new Animal(); } }
class Dog extends Animal {
    @Override
    Dog create() { return new Dog(); }   // 合法，Dog 是 Animal 的子类
}
```

- 返回类型是基本类型或 `void` 时，必须完全相同（`int` 不能改成 `long`）。
- 如果返回类型既不相同也不是子类型，编译报错，提示类似 `return type X is not compatible with Y`。
- 只改返回值、参数相同，既不是合法重写，也不是重载，直接编译错误。

### 构造器能被重写或重载吗？
**构造器不能被重写，但可以被重载。**

- **不能重写**：重写的前提是继承，而构造器不会被子类继承；并且构造器名必须与类名相同，子类不可能写出与父类同名的构造器。子类通过 `super(...)` 调用父类构造器，这不是重写。
- **可以重载**：同一个类可以定义多个参数列表不同的构造器，满足不同的初始化需求，构造器之间可以用 `this(...)` 互相调用。
- `this(...)` 和 `super(...)` 都必须放在构造器第一行（JDK 25 的"灵活构造器体"允许在它们之前写不访问 `this` 的语句，如参数校验）。
- 如果类没有定义任何构造器，编译器会生成默认无参构造器；一旦自己定义了有参构造器，就不再自动生成无参构造器。

### 接口和抽象类有什么区别？ | 高频
抽象类强调"是什么"，用于代码复用；接口强调"能做什么"，用于定义规范和能力。两者都不能直接实例化。

| 对比 | 抽象类 | 接口 |
| --- | --- | --- |
| 关键字 | `abstract class`，子类 `extends` | `interface`，类 `implements` |
| 继承数量 | 只能单继承 | 一个类可实现多个接口，接口可多继承接口 |
| 构造器 | 有（供子类调用，初始化公共状态） | 没有 |
| 成员变量 | 任意类型的实例变量、静态变量 | 只能是 `public static final` 常量 |
| 方法 | 抽象方法和普通方法都可以 | JDK 8 前只有 `public abstract` 方法；JDK 8 起可有 `default`、`static` 方法；JDK 9 起可有 `private` 方法 |
| 访问修饰符 | 成员可以是任意访问级别 | 成员默认 `public`（`private` 方法除外） |
| 设计目的 | 抽取子类公共属性和实现，典型是模板方法模式 | 定义行为契约，实现解耦和多态 |

**怎么选**：多个类有共同状态和部分共同实现、是 is-a 关系时用抽象类；只需要约定一组行为，或一个类需要具备多种能力时用接口。实际开发中通常"面向接口编程"，需要复用实现时再加一个抽象类骨架（如 `AbstractList` 实现 `List`）。

## 对象比较、拷贝与参数传递
### == 和 equals() 有什么区别？ | 高频 | 交通银行
`==` 比较的是值本身：基本类型比较数值，引用类型比较引用地址（是否同一个对象）。`equals()` 是 `Object` 的方法，用于判断两个对象逻辑上是否相等。

- **`Object.equals()` 默认实现就是 `==`**，比较地址。
- `String`、`Integer` 等包装类、`Date`、集合类都重写了 `equals()`，比较内容。
- `equals()` 只能用于引用类型；基本类型只能用 `==`。
- 自定义类需要按内容比较时，要重写 `equals()`，并且**必须同时重写 `hashCode()`**。

```java
String a = "abc", b = "abc";
String c = new String("abc");
System.out.println(a == b);       // true，都指向字符串常量池中的同一个对象
System.out.println(a == c);       // false，c 是堆上新建的对象
System.out.println(a.equals(c));  // true，内容相同
```

**重写 `equals()` 要满足的约定**：自反性、对称性、传递性、一致性，且 `x.equals(null)` 返回 false。推荐写法是 `Objects.equals(a, b)`，可以避免空指针。

### 可以直接用 hashCode 判断两个对象相等吗？ | 交通银行
不可以。**hashCode 相等不代表对象相等，但对象相等（equals 为 true）则 hashCode 一定相等。**

- 不同对象经过哈希算法可能得到相同的哈希值，这就是**哈希冲突**。`int` 只有 2^32 种取值，而对象可能有无穷多种，冲突不可避免；哈希算法越差冲突越多。例如 `"Aa".hashCode() == "BB".hashCode()`，都是 2112。
- 因此规则是：
  - hashCode 不相等，两个对象一定不相等，可以直接排除。
  - hashCode 相等，还要再调用 `equals()` 才能确定是否相等。
  - hashCode 相等且 `equals()` 为 true，才认为两个对象相等。

### hashCode() 有什么用？为什么要同时提供 hashCode() 和 equals()？
`hashCode()` 返回对象的哈希码（一个 `int`），用于确定对象在哈希表（`HashMap`、`HashSet`、`HashTable`）中的存储位置。

两者配合是为了**兼顾效率和正确性**：
- **只用 `equals()`**：判断一个元素是否在集合中，要和所有元素逐个比较，复杂度 O(n)。
- **只用 `hashCode()`**：不同对象可能哈希冲突，无法准确判断相等。
- **结合使用**：先用 `hashCode()` 定位到桶，桶里大多只有很少的元素，再用 `equals()` 精确比较。

以 `HashSet.add()` 为例：先计算 hashCode 定位桶；桶为空直接放入；不为空则与桶中元素比较 hashCode，hashCode 相同再调用 `equals()`，为 true 说明重复，不再加入，否则作为新元素挂在链表或红黑树上。

### 为什么重写 equals() 时必须重写 hashCode()？ | 高频
因为 Java 规定：**如果两个对象 `equals()` 相等，它们的 `hashCode()` 必须相等**。只重写 `equals()` 会破坏这个约定，导致哈希集合工作异常。

- `Object.hashCode()` 默认根据对象身份生成（通常与对象地址相关），两个内容相同的不同对象哈希值一般不同。
- 如果只重写 `equals()`：两个逻辑相等的对象哈希值不同，会被放进 `HashMap`/`HashSet` 的不同桶，导致：
  - `HashSet` 中出现"重复"元素；
  - 用一个内容相同的新对象作为 key 去 `HashMap.get()`，取不到之前存的值。

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof User u)) return false;   // JDK 16+ 模式匹配
    return age == u.age && Objects.equals(name, u.name);
}

@Override
public int hashCode() {
    return Objects.hash(name, age);   // 参与 equals 比较的字段都要参与计算
}
```

注意：作为 `HashMap` key 的对象，参与 hashCode 计算的字段不应在放入后被修改，否则会找不到。`record` 会自动生成符合约定的 `equals()` 和 `hashCode()`。

### 哈希冲突有哪些解决办法？ | 高频
常见方法有**开放定址法、链地址法、再哈希法、建立公共溢出区**。

- **开放定址法**：冲突时按某种探测序列在哈希表中继续找空位。
  - 线性探测：依次往后找，容易产生聚集；ThreadLocalMap 用的就是线性探测。
  - 二次（平方）探测：按 ±1²、±2²… 的步长查找，缓解聚集。
  - 双重哈希：用第二个哈希函数计算步长。
- **链地址法（拉链法）**：同一个桶里的冲突元素用链表串起来。**HashMap 采用这种方式**：JDK 8 起，链表长度达到 8 且数组容量不小于 64 时转为红黑树，树节点减少到 6 以下时退化为链表；数组容量小于 64 时优先扩容而不是树化。
- **再哈希法**：准备多个哈希函数，冲突时换一个函数重新计算，直到不冲突，代价是计算量增加。
- **公共溢出区**：把冲突的元素统一放到一个溢出表中。

另外，HashMap 通过扰动函数 `(h = key.hashCode()) ^ (h >>> 16)` 让高位参与运算，并在负载因子达到 0.75 时扩容，来降低冲突概率。

### 深拷贝、浅拷贝和引用拷贝有什么区别？ | 高频
区别在于复制到哪一层：引用拷贝只复制引用，浅拷贝复制对象本身，深拷贝连对象引用的对象也递归复制。

![](images/Java八股（后端\)+Agent八股8-image-24.png)

| 对比 | 引用拷贝 | 浅拷贝 | 深拷贝 |
| --- | --- | --- | --- |
| 是否创建新对象 | 否，两个变量指向同一对象 | 是，创建一个新对象 | 是，新对象及其引用的对象全部新建 |
| 基本类型字段 | 共享 | 复制值，相互独立 | 复制值，相互独立 |
| 引用类型字段 | 共享 | 只复制引用，指向同一个子对象 | 递归复制子对象，指向不同对象 |
| 独立性 | 完全不独立 | 部分独立，修改子对象会互相影响 | 完全独立 |
| 成本 | 最低 | 低，只复制一层 | 高，要递归复制，还需处理循环引用 |

**实现方式**：
- 浅拷贝：实现 `Cloneable` 并重写 `clone()`，调用 `super.clone()`（`Object.clone()` 默认就是浅拷贝）。
- 深拷贝：在 `clone()` 中对引用字段再逐个 `clone()`；或者序列化后再反序列化（JDK 序列化、JSON）；或者用拷贝构造器手动复制。

注意：`String` 和包装类是不可变对象，浅拷贝共享它们不会有问题。`Cloneable` 设计有缺陷（是标记接口，`clone()` 却定义在 `Object` 中且为 `protected`），实践中更推荐拷贝构造器或静态工厂方法。

### Java 是值传递还是引用传递？为什么没有引用传递？ | 高频
**Java 只有值传递。** 方法调用时，实参的值会被复制一份给形参：基本类型复制的是数值，引用类型复制的是**引用（对象地址）的副本**。

- 传入基本类型：方法内修改形参，不影响外部变量。
- 传入引用类型：形参和实参指向同一个对象，通过形参**修改对象内部状态**，外部可见；但让形参**指向一个新对象**，外部变量不受影响。这正说明传的是引用的副本，而不是引用本身。

```java
static void change(User u) {
    u.setName("B");    // 修改对象内容：外部可见
    u = new User("C"); // 改变形参指向：外部不受影响
}

static void swap(Integer a, Integer b) { Integer t = a; a = b; b = t; } // 无法交换外部变量
```

**真正的引用传递**（如 C++ 的 `int&`）是把变量本身传进去，方法里给形参重新赋值会直接改变外部变量，Java 做不到。

**为什么这样设计**：语义简单统一，方法无法改变调用方变量的指向，副作用更可控、代码更易读；同时 Java 没有指针和取地址操作，也就不需要引用传递这种机制。

## String
### String、StringBuffer、StringBuilder 的区别和使用场景？ | 高频 | 工商银行、美团、蚂蚁、农业银行、交通银行
三者主要区别在**可变性、线程安全性和性能**。

| 对比 | String | StringBuffer | StringBuilder |
| --- | --- | --- | --- |
| 可变性 | 不可变，每次"修改"都返回新对象 | 可变，在原对象内部数组上修改 | 可变，在原对象内部数组上修改 |
| 线程安全 | 安全（不可变天然线程安全） | 安全，方法用 `synchronized` 修饰 | 不安全 |
| 性能 | 频繁拼接时最差 | 有加锁开销 | 最高 |
| 引入版本 | JDK 1.0 | JDK 1.0 | JDK 5 |

- `StringBuffer` 和 `StringBuilder` 都继承自 `AbstractStringBuilder`，底层是可扩容的数组（JDK 9 起为 `byte[]`），容量不够时扩容为约 `原容量 × 2 + 2`。
- **使用场景**：
  - `String`：内容基本不变或少量拼接，如常量、配置、Map 的 key。
  - `StringBuilder`：单线程下大量拼接，如循环里拼 SQL、拼 JSON，最常用。
  - `StringBuffer`：多个线程共享同一个可变字符串时，实际很少用。
- **关于 `+` 拼接**：JDK 8 中 `+` 被编译为 `new StringBuilder().append(...).toString()`；JDK 9 起改为 `invokedynamic` 调用 `StringConcatFactory`，单条表达式性能更好。但在**循环中用 `+=`** 每次迭代都会产生新的中间对象，仍应显式使用 `StringBuilder`。

### String 为什么设计成不可变？如何实现的？ | 高频 | 工商银行、美团、蚂蚁、农业银行、交通银行
**String 不可变是为了支持字符串常量池复用、保证安全、天然线程安全，并能缓存 hashCode。**

**为什么设计成不可变**：
- **字符串常量池**：相同内容的字面量可以共享同一个对象，节省内存。如果 String 可变，`String a = "hi"; String b = a;` 改了 a 就会影响所有共享者。
- **安全性**：String 大量用于类名、文件路径、URL、数据库连接串、用户名密码等。不可变保证它在校验后不会被篡改；类加载器也依赖类名不可变。
- **线程安全**：不可变对象可以被多个线程自由共享，不需要同步。
- **缓存 hashCode**：内容不变，hashCode 只需计算一次并缓存在 `hash` 字段里，作为 `HashMap` key 时性能好，也不会因内容变化而找不到。

**不可变体现在**：对象创建后内容不能改，`concat()`、`replace()`、`substring()`、`toUpperCase()` 等方法都返回新的 String，不修改原对象。

**如何实现**：
- 存储数据的数组用 `private final` 修饰（JDK 8 是 `char[] value`，JDK 9+ 是 `byte[] value`）：`private` 使外部无法访问，`final` 使引用不能指向别的数组。
- String 没有提供任何修改数组内容的方法，对外返回数组时也会复制一份（如 `toCharArray()`）。
- String 类本身用 `final` 修饰，不能被继承，防止子类破坏不可变性。

注意：`final` 只保证数组引用不变，数组元素本身是可以改的，真正保证不可变的是 `private` 加上不暴露修改方法。通过反射强行修改 `value` 在技术上可以做到，但会破坏常量池等语义，而且 JDK 17 强封装后默认已被禁止。

### String 底层是如何实现的？
String 底层是一个**数组**，JDK 9 前后实现不同。

- **JDK 8 及以前**：`private final char[] value;`，每个字符固定占 2 字节（UTF-16）。
- **JDK 9 及以后（Compact Strings，JEP 254）**：`private final byte[] value;` 加一个 `byte coder` 字段。如果所有字符都能用 Latin-1 表示，每个字符只占 1 字节（`coder = LATIN1`）；否则用 UTF-16 编码，每个字符 2 字节（`coder = UTF16`）。对以英文、数字为主的应用，字符串内存占用可减少近一半。

此外还有 `private int hash` 字段缓存哈希值（默认 0，首次调用 `hashCode()` 时计算）。

### String 类能被继承吗？
不能。String 被声明为 `public final class String`，`final` 类不能被继承。这样做是为了保证不可变性和安全性：如果能被继承，子类就可以重写方法、添加可变状态，破坏 String 的语义，而 JDK 大量代码（类加载、安全校验、HashMap 等）都依赖 String 不可变。

同样被 `final` 修饰的还有 `Integer`、`Long` 等所有包装类。

### String 有长度限制吗？
有，**编译期和运行期限制不同**。

- **编译期**：字符串字面量存储在 class 文件常量池的 `CONSTANT_Utf8_info` 结构中，长度字段是 `u2`（无符号 16 位），所以字面量编码后的字节数最多为 **65535**。实际上 javac 要求小于 65535，写一个长度为 65535 的纯 ASCII 字面量会报"常量字符串过长"。中文字符在 class 文件中用修改版 UTF-8 编码，每个占 3 字节，所以可写的中文字面量更少。
- **运行期**：String 长度由 `int` 表示，`length()` 返回 `int`，理论上限是 **2^31 - 1**；实际还受 JVM 数组最大长度（通常略小于 `Integer.MAX_VALUE`）和堆内存大小限制。JDK 9+ 中 UTF-16 字符串每个字符占 2 字节，最大字符数约为 2^30。

### 什么是字符串常量池？在哪里？
字符串常量池（String Pool）是 JVM 维护的一个字符串缓存，用来复用相同内容的字符串，减少重复对象、节省内存。在 HotSpot 中它本质上是一个哈希表（`StringTable`），表里存的是指向堆中 String 对象的引用。

**存放位置**：
- JDK 6 及以前：在永久代（方法区）。
- **JDK 7 起：移到了堆中**。原因是永久代空间小且固定，大量 `intern()` 容易导致 `OutOfMemoryError: PermGen space`，放在堆里可以随普通对象一起被 GC 回收。
- JDK 8 用元空间取代永久代后，字符串常量池仍在堆中。

**工作方式**：
- 使用字面量（`String s = "abc"`）时，JVM 先查常量池，有就直接返回该对象引用，没有就创建对象并放入池中。
- `new String("abc")` 一定在堆上创建一个新对象，不会直接返回池中对象。
- `intern()`：如果池中已有相同内容的字符串，返回池中的引用；没有则把当前字符串的引用加入池中（JDK 7+ 记录的是堆中对象的引用，不再复制一份到永久代），再返回它。

```java
String s1 = "Hello";
String s2 = "Hello";
String s3 = new String("Hello");
System.out.println(s1 == s2);           // true，同一个池中对象
System.out.println(s1 == s3);           // false，s3 是堆上新对象
System.out.println(s1 == s3.intern());  // true，intern 返回池中对象
```

`StringTable` 的桶数量可以通过 `-XX:StringTableSize` 调整，大量使用 `intern()` 时可以调大以减少哈希冲突。

### String s = new String("abc") 创建了几个对象？分别在哪里？ | 高频
**会创建 1 个或 2 个字符串对象**，取决于常量池里是否已有 `"abc"`。

- **池中还没有 `"abc"`：创建 2 个**。一个是字面量 `"abc"` 对应的对象，由 `ldc` 指令在首次执行时创建并登记到字符串常量池（JDK 7+ 对象本身也在堆上）；另一个是 `new String(...)` 在堆上创建的新对象，它用池中对象初始化（两者共享同一个 `value` 数组，不复制数组内容）。
- **池中已有 `"abc"`：创建 1 个**，只有堆上 `new` 出来的那个对象。
- **`s` 是什么**：`s` 是一个引用变量（局部变量时存放在栈帧的局部变量表中），指向堆上 `new` 出来的那个对象，而不是池中的对象，所以 `s == "abc"` 为 false。

### String s = "a" + "b" 会创建几个对象？`+` 拼接的规律是什么？
`"a" + "b"` 两边都是编译期常量，javac 会做**常量折叠**，直接编译成字面量 `"ab"`，等价于 `String s = "ab";`，字节码里不存在 `"a"` 和 `"b"`。

- 如果池中没有 `"ab"`，在首次执行时创建 1 个对象并放入常量池；已有则不创建，直接引用。

**拼接规律**：
```java
String s1 = "ab";
String s2 = "a" + "b";          // 编译期折叠，s1 == s2 为 true
final String x = "a";
String s3 = x + "b";            // x 是 final 且用常量初始化，属于编译期常量，s1 == s3 为 true
String y = "a";
String s4 = y + "b";            // y 是变量，运行期拼接，在堆上生成新对象，s1 == s4 为 false
System.out.println(s1 == s4.intern());  // true
```

- 只要表达式里有**变量**参与，就在运行期拼接（JDK 8 用 `StringBuilder`，JDK 9+ 用 `StringConcatFactory`），结果是堆上的新对象，不会自动放入常量池。
- `final` 变量只有在用编译期常量初始化时才会被折叠；`final String x = getStr();` 不会。

## 异常与 final
### Java 的异常体系是如何分类的？Exception 和 Error 有什么区别？ | 高频
所有异常的顶层父类是 `Throwable`，下分 `Error` 和 `Exception` 两大类。

```text
Throwable
├── Error（错误，程序一般无法处理）
│   ├── OutOfMemoryError、StackOverflowError（都属于 VirtualMachineError）
│   └── NoClassDefFoundError、ExceptionInInitializerError（属于 LinkageError）
└── Exception（异常，程序可以处理）
    ├── 受检异常（Checked）：IOException、SQLException、ClassNotFoundException、InterruptedException
    └── RuntimeException（非受检）：NullPointerException、IllegalArgumentException ...
```

| 对比 | Error | Exception |
| --- | --- | --- |
| 含义 | JVM 层面的严重问题或资源耗尽 | 程序可预期、可处理的问题 |
| 是否可恢复 | 通常不可恢复，不建议捕获 | 可以 `try-catch` 或 `throws` 处理 |
| 产生原因 | 内存不足、栈溢出、类链接失败 | 逻辑错误、外部资源异常、非法输入 |

**受检 vs 非受检**：受检异常是 `Exception` 中除 `RuntimeException` 及其子类以外的异常，编译器强制捕获或声明 `throws`；非受检异常是 `RuntimeException` 及其子类加上 `Error`，编译器不强制处理，通常由代码缺陷导致。

**常见运行时异常**：`NullPointerException`、`IndexOutOfBoundsException`、`ClassCastException`、`ArithmeticException`、`IllegalArgumentException`（`NumberFormatException` 是其子类）、`ConcurrentModificationException`。

**`throw` 和 `throws`**：`throw` 在方法体内抛出一个异常对象；`throws` 在方法签名上声明该方法可能抛出的异常类型。

### final 和 finally 有什么区别？finally 一定会执行吗？
两者只是名字相近：`final` 是修饰符，`finally` 是异常处理中的代码块（另外 `finalize()` 是 `Object` 的方法，JDK 9 起已废弃，不要使用）。

**final**：
- 修饰类：不能被继承，如 `String`。
- 修饰方法：不能被子类重写。
- 修饰变量：只能赋值一次。修饰基本类型时值不能变；修饰引用类型时**引用不能指向别的对象，但对象内部状态可以改**，如 `final List<String> list` 仍可以 `add()`。
- `static final` 配合编译期常量初始化时，会被编译器内联。

**finally**：配合 `try` 使用，无论是否发生异常、是否 `return`，`finally` 通常都会执行，用于释放锁、关闭资源等。JDK 7 起关闭资源更推荐 `try-with-resources`，实现了 `AutoCloseable` 的资源会自动关闭。

**finally 不执行的情况**：
- `try` 或 `catch` 中调用了 `System.exit()` 或 `Runtime.halt()`，JVM 直接退出。
- JVM 进程崩溃或被 `kill -9`，或机器断电。
- `try` 中出现死循环或线程一直阻塞，执行不到 `finally`。
- 执行 `try` 的线程是守护线程，而所有非守护线程都已结束，JVM 退出。
- 还没进入 `try` 块就已经返回或抛出异常。

### try 里有 return，finally 还会执行吗？执行顺序是怎样的？ | 高频 | 交通银行、字节、农业银行
**会执行。** 执行顺序是：先计算 `try` 中 `return` 后面的表达式，把结果暂存到一个局部变量里；然后执行 `finally`；最后返回暂存的那个值。所以 **finally 是在返回值已经计算好之后、方法真正返回之前执行的**。

```java
static int test() {
    int x = 1;
    try {
        return x;      // 返回值 1 已经暂存
    } finally {
        x = 2;         // 修改的是局部变量 x，不影响已暂存的返回值
    }
}                      // 返回 1

static List<String> test2() {
    List<String> list = new ArrayList<>();
    try {
        return list;   // 暂存的是引用
    } finally {
        list.add("x"); // 修改对象内容，调用方能看到
    }
}                      // 返回的 list 里有 "x"
```

- 返回值是基本类型时，`finally` 中修改变量不影响返回结果；返回的是引用时，`finally` 修改对象的内容会体现在结果里，但让变量指向新对象不会。
- **`finally` 里也写了 `return`**：会覆盖 `try`/`catch` 中的返回值，还会吞掉 `try` 中抛出的异常，属于坏实践（IDE 和 `javac -Xlint:finally` 会给出警告），应避免。
- `finally` 中抛出异常，也会覆盖原来的返回值或异常。

## 泛型、反射、注解与代理
### 什么是泛型？什么是泛型擦除？为什么要擦除？ | 高频
泛型是 JDK 5 引入的**参数化类型**机制，把类型作为参数用在类、接口、方法上，在**编译期**做类型检查。

**好处**：编译期类型安全（往 `List<String>` 放 `Integer` 直接编译报错）、取元素无需强转、一套逻辑复用于多种类型。

**泛型擦除**：泛型信息只存在于编译期，编译后类型参数替换为其**上界**（无界 `T` → `Object`，`T extends Number` → `Number`），编译器自动插入强制转换，必要时生成桥接方法保证多态。

```java
public class Box<T> { T value; void set(T v) {} }
// 擦除后在字节码层面等价于
public class Box { Object value; void set(Object v) {} }

List<String> a = new ArrayList<>();
List<Integer> b = new ArrayList<>();
System.out.println(a.getClass() == b.getClass()); // true，运行时都是 ArrayList
```

**为什么要擦除**：为了**向后兼容**。擦除后泛型类与原始类型（raw type）字节码一致，JDK 5 之前的大量旧代码不用修改就能互操作，JVM 也不需要改动。

**擦除带来的限制**：不能 `new T()` / `new T[]` 或创建泛型数组；不能 `instanceof List<String>`；类型参数不能是基本类型；静态成员不能用类的类型参数；仅泛型参数不同的方法（`f(List<String>)` 与 `f(List<Integer>)`）不能重载。

易错点：擦除并非不留痕迹，类、字段、方法签名上的泛型信息保留在 class 文件的 `Signature` 属性中，可通过反射（`getGenericSuperclass()`）读取，Jackson 的 `TypeReference` 就是利用这一点。通配符记 PECS：生产者 `? extends T`（只读），消费者 `? super T`（只写）。

### 什么是反射？有什么优缺点和应用场景？获取 Class 对象有哪些方式？
反射是指程序在**运行时**获取任意类的信息（构造器、字段、方法、注解、父类、接口等），并能动态创建对象、调用方法、读写字段的能力。核心 API 在 `java.lang.reflect` 包中：`Class`、`Constructor`、`Field`、`Method`。

**优点**：
- 运行时才确定要操作的类，不需要编译期依赖，提高灵活性和通用性，降低耦合。
- 是各种框架的基础。

**缺点**：
- **性能开销**：要做方法查找、访问检查、参数装箱，并且不利于 JIT 内联，比直接调用慢（JDK 18 起反射底层改用 `MethodHandle` 实现，差距有所缩小）。
- **安全与封装性**：`setAccessible(true)` 可以访问私有成员，破坏封装；JDK 17 起默认不能对 JDK 内部未开放的包做深度反射，需要 `--add-opens`。
- **失去编译期检查**：方法名、参数写错只能在运行时才暴露，代码可读性也较差。

**应用场景**：
- Spring IoC：根据配置或注解，反射创建 Bean 并注入依赖。
- 动态代理：JDK 动态代理通过 `Method.invoke()` 调用目标方法。
- 注解处理：运行时读取 `@Autowired`、`@RequestMapping`、`@Transactional` 等注解。
- ORM 与序列化：MyBatis 结果映射、Jackson/Gson 的对象与 JSON 互转。
- JDBC 加载驱动、单元测试框架（JUnit 查找 `@Test` 方法）、IDE 代码提示。

**获取 Class 对象的 4 种方式**：
```java
Class<?> c1 = String.class;                         // 1. 类名.class，不会触发类初始化
Class<?> c2 = "abc".getClass();                     // 2. 对象.getClass()
Class<?> c3 = Class.forName("java.lang.String");    // 3. 全限定名，默认会初始化类（执行静态代码块）
Class<?> c4 = Thread.currentThread()
        .getContextClassLoader().loadClass("java.lang.String"); // 4. 类加载器，只加载不初始化
```
同一个类加载器加载的同一个类，这几种方式拿到的是同一个 `Class` 对象。

### 注解的原理是什么？
注解本质上是一个**继承了 `java.lang.annotation.Annotation` 接口的特殊接口**，本身不包含逻辑，只是附加在代码上的元数据，需要由编译器、注解处理器或运行时框架读取后才产生作用。

- **定义**：用 `@interface` 声明，属性以无参方法的形式定义，可以有 `default` 默认值。
- **元注解**：
  - `@Retention`：保留策略。`SOURCE` 只在源码中，编译后丢弃（如 `@Override`）；`CLASS` 保留到 class 文件但运行时不可见（默认值）；`RUNTIME` 运行时可通过反射读取（如 Spring 的注解）。
  - `@Target`：能用在哪里（类、方法、字段、参数等）。
  - `@Inherited`：子类是否继承父类上的类注解；`@Documented`；`@Repeatable`（JDK 8）。
- **两种处理方式**：
  - **编译期**：注解处理器（APT，实现 `javax.annotation.processing.Processor`）在编译时扫描注解并生成代码，如 Lombok、MapStruct。
  - **运行期**：`RUNTIME` 注解会写入 class 文件的 `RuntimeVisibleAnnotations` 属性；调用 `method.getAnnotation(X.class)` 时，JVM 解析这些属性，并用 **JDK 动态代理**生成一个实现了该注解接口的代理对象（处理器是 `AnnotationInvocationHandler`），调用 `x.value()` 实际是从一个保存属性值的 Map 中取值。

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Log { String value() default ""; }

Log log = method.getAnnotation(Log.class);   // 返回的是动态代理对象
if (log != null) System.out.println(log.value());
```

### 什么是动态代理？JDK 动态代理和 CGLIB 有什么区别？
动态代理是在**运行时**动态生成代理类，拦截对目标对象的方法调用并加入增强逻辑（日志、事务、权限、监控），不用为每个类手写代理类。Spring AOP、MyBatis Mapper、RPC 客户端都基于它实现。

| 对比 | JDK 动态代理 | CGLIB |
| --- | --- | --- |
| 原理 | 运行时生成实现目标接口的代理类（继承 `Proxy`），调用转发给 `InvocationHandler.invoke()` | 基于 ASM 生成目标类的**子类**，重写方法，调用转发给 `MethodInterceptor.intercept()` |
| 前提 | 目标类必须实现接口，只能代理接口中的方法 | 目标类和方法不能是 `final`，`private`、`static` 方法也无法代理 |
| 依赖 | JDK 自带 | 第三方库（Spring 已内置 repackage 版本） |
| 调用方式 | 通过反射 `Method.invoke()` 调用目标方法 | 通过 FastClass 机制按索引直接调用，避免反射 |

```java
UserService proxy = (UserService) Proxy.newProxyInstance(
        target.getClass().getClassLoader(),
        target.getClass().getInterfaces(),
        (p, method, args) -> {
            System.out.println("before " + method.getName());
            Object result = method.invoke(target, args);
            System.out.println("after");
            return result;
        });
```

**使用场景**：目标有接口时两者都可用；没有接口只能用 CGLIB。**Spring Framework 默认**：目标实现了接口用 JDK 代理，否则用 CGLIB；**Spring Boot 2.x 起默认 `proxyTargetClass=true`**，统一使用 CGLIB。另外，CGLIB 在 JDK 17 强封装下需要额外的 `--add-opens` 配置，已不再积极维护，独立使用时可以考虑 ByteBuddy。

性能方面，早期 CGLIB 调用更快，但 JDK 8 以后 JDK 代理调用性能已经很接近，选型主要看有没有接口。

### Java 的 SPI 机制是什么？
SPI（Service Provider Interface）是 JDK 内置的**服务发现机制**：接口由调用方定义，实现由第三方提供，运行时通过 `ServiceLoader` 自动找到并加载实现类，实现"面向接口编程 + 可插拔扩展"。

**使用方式**：
1. 定义接口，如 `com.example.PayService`。
2. 服务提供方实现接口，并在 jar 包的 `META-INF/services/` 目录下新建以接口全限定名命名的文件，内容为实现类的全限定名（每行一个）。
3. 调用方使用 `ServiceLoader` 加载：

```java
ServiceLoader<PayService> loader = ServiceLoader.load(PayService.class);
for (PayService service : loader) {   // 懒加载，迭代时才实例化
    service.pay();
}
```
JDK 9 起在模块中也可以用 `module-info.java` 的 `provides ... with ...` 和 `uses` 声明服务。

**典型应用**：JDBC 4.0 起 `DriverManager` 通过 SPI 自动加载数据库驱动（不用再 `Class.forName`）；SLF4J 绑定日志实现；Spring Boot 的 `spring.factories` 和 Dubbo SPI 是在同一思想上的增强版。

**JDK SPI 的不足**：只能遍历加载全部实现，不能按名称按需加载某一个；实现类需要无参构造器，不支持依赖注入和 AOP；`ServiceLoader` 实例不是线程安全的。Dubbo SPI 改为 `key=实现类` 的配置形式，支持按名加载、自适应扩展和 IoC。

**SPI 和 API 的区别**：API 是实现方定义接口并提供实现，调用方直接使用；SPI 是调用方定义接口规范，由实现方去实现。

## 对象创建、序列化与其他
### Java 创建对象有几种方式？什么样的类不能被实例化？
常见有 5 种方式，其中 `new` 和反射会调用构造器，`clone()` 和反序列化不走被创建类的构造器。

1. **`new` 关键字**：最常用，调用构造器。
2. **反射 `Class.newInstance()`**：只能调用无参构造器，JDK 9 起已废弃，因为它会把构造器抛出的受检异常原样抛出、绕过编译检查。
3. **反射 `Constructor.newInstance()`**：可以选择任意构造器，推荐用法。
4. **`clone()`**：复制已有对象，类需实现 `Cloneable` 并重写 `clone()`，不调用构造器。
5. **反序列化**：从字节流恢复对象，类需实现 `Serializable`。不会调用该类自身的构造器，只会调用其**第一个不可序列化父类**的无参构造器（例如直接继承 `Object` 时调用 `Object()`）。

```java
User u1 = new User();
User u2 = User.class.getDeclaredConstructor().newInstance();
User u3 = User.class.getDeclaredConstructor(String.class).newInstance("Tom");
User u4 = (User) u1.clone();
try (ObjectInputStream in = new ObjectInputStream(new FileInputStream("user.dat"))) {
    User u5 = (User) in.readObject();
}
```

此外还有间接方式：静态工厂方法（如 `Integer.valueOf()`）、Builder、依赖注入容器（Spring 内部仍然是反射调用构造器），以及 `MethodHandle` 调用构造器。

**不能被实例化的类**：
- **抽象类和接口**：不能直接 `new`（可以通过匿名内部类或子类实现来创建其子类型对象）。
- **构造器全部为 `private` 的类**：外部无法 `new`，如工具类 `Math`、`Collections`，以及单例类（类内部仍能创建，反射 `setAccessible(true)` 也能绕过）。
- **枚举**：构造器隐式为 `private`，不能 `new`，反射调用 `newInstance` 也会抛异常，实例只有声明的那些常量。

注意：所有类都至少有一个构造器（没写时编译器自动生成默认构造器），`static` 只能修饰内部类，静态内部类是可以实例化的。

### 什么是序列化和反序列化？常见序列化协议有哪些？JDK 自带序列化有什么缺点？
**序列化**是把对象转换成字节序列以便存储或网络传输，**反序列化**是还原成对象。典型场景：RPC、对象存入 Redis、消息队列。

**JDK 序列化**：实现 `Serializable` 标记接口，用 `ObjectOutputStream` / `ObjectInputStream` 读写。
- 要显式声明 `serialVersionUID`，反序列化时校验，不一致抛 `InvalidClassException`；不声明则由编译器按类结构计算，加个字段就会变。
- `transient` 字段不参与序列化（反序列化后为默认值），`static` 字段属于类，也不序列化。

**常见协议**：

| 协议 | 类型 | 特点 |
| --- | --- | --- |
| JDK 原生 | 二进制 | 简单，但体积大、慢、仅限 Java |
| JSON（Jackson、Gson） | 文本 | 可读、跨语言、最通用；体积较大 |
| Protobuf | 二进制 | 需 `.proto` 定义，体积小、快、跨语言、兼容性好，gRPC 默认 |
| Hessian | 二进制 | 跨语言，Dubbo 2.x 默认（hessian2） |
| Kryo | 二进制 | Java 专用，快、体积小 |

**JDK 序列化的缺点**：
- **不支持跨语言**。
- **性能差、体积大**：要写入类描述信息。
- **安全问题严重**：反序列化会实例化字节流指定的类，攻击者可利用 gadget 链执行任意代码（如 Apache Commons Collections 漏洞）。JDK 9 起可用 `ObjectInputFilter` 做白名单过滤。
- **版本兼容靠手动管理** `serialVersionUID`。

所以跨服务传输一般用 JSON 或 Protobuf。

### 什么是幂等性？如何实现接口幂等？ | 高频
**幂等**指同一个操作执行一次和执行多次，对系统产生的影响相同。分布式系统中，网络超时重试、用户重复点击、MQ 重复投递都会造成重复请求，所以写操作接口通常要保证幂等，例如支付、下单、扣库存。

**天然幂等**：查询、按 ID 删除、把字段设为固定值（`set status = 2`）。**非幂等**：新增、`set count = count + 1`。

**常见实现方式**：
- **唯一索引（去重表）**：利用数据库唯一约束，重复插入时报 `DuplicateKeyException`，捕获后直接返回之前的结果。适用于创建订单（订单号）、点赞（用户 ID + 文章 ID）、流水记录等。
- **Token 机制**：客户端提交前先向服务端申请一个唯一 Token（存入 Redis），提交时携带；服务端**原子地校验并删除** Token（用 Lua 脚本，或直接 `DEL` 并判断返回值是否为 1），删除成功才执行业务，同一 Token 只能使用一次。适用于防止表单重复提交。
- **状态机 / 乐观锁**：更新时带上状态或版本条件，如 `update order set status = 'PAID' where id = ? and status = 'UNPAID'`，或 `where version = ?`，影响行数为 0 说明已处理过。
- **分布式锁 + 业务判重**：用业务唯一键加锁（Redis `SET key value NX EX`、Redisson），加锁成功后先查询是否已处理，再执行业务。
- **MQ 消费幂等**：用消息唯一 ID 或业务主键记录消费状态（Redis `SETNX` 或去重表），处理前先检查。

实际中常组合使用：前端按钮防重只是辅助，后端必须兜底，最终一般依靠数据库唯一约束或状态条件保证。

### 解释一下 Java 中的栈和队列
栈是**后进先出（LIFO）**的线性结构，队列是**先进先出（FIFO）**的线性结构。

**栈**：只在栈顶操作，`push` 入栈、`pop` 出栈、`peek` 查看栈顶但不移除。应用：方法调用栈、括号匹配、表达式求值、DFS、撤销操作。
- Java 中的 `Stack` 类继承自 `Vector`，方法都加了 `synchronized`，性能差且能按下标访问破坏栈语义，**已不推荐**。
- 推荐用 `Deque<Integer> stack = new ArrayDeque<>();`，调用 `push()`/`pop()`/`peek()`。

**队列**：队尾入队、队头出队。应用：BFS、任务排队、消息缓冲、生产者消费者模型。
- `Queue` 接口的两组方法：`offer`/`poll`/`peek` 失败时返回 false 或 null；`add`/`remove`/`element` 失败时抛异常。
- 常用实现：`ArrayDeque`（循环数组，比 `LinkedList` 更快，不能存 null）、`LinkedList`、`PriorityQueue`（小顶堆，按优先级出队而非 FIFO）。
- 并发场景：`ConcurrentLinkedQueue`（无锁 CAS）；阻塞队列 `ArrayBlockingQueue`、`LinkedBlockingQueue` 等（`put`/`take` 会阻塞），线程池的任务队列就是阻塞队列。
- `Deque` 是双端队列，两端都可以插入删除，所以既能当栈也能当队列。

