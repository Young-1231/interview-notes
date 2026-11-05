## 单例模式
### 了解哪些设计模式？ | 高频
GoF 的 23 种设计模式分为创建型、结构型、行为型三类，先报分类，再挑常用的结合 JDK / Spring 说明。

| 分类 | 关注点 | 模式 |
| --- | --- | --- |
| 创建型（5 种） | 怎么创建对象 | 单例、工厂方法、抽象工厂、建造者、原型 |
| 结构型（7 种） | 类和对象怎么组合 | 适配器、装饰器、代理、外观、桥接、组合、享元 |
| 行为型（11 种） | 对象之间怎么协作、分配职责 | 策略、模板方法、观察者、迭代器、责任链、命令、备忘录、状态、访问者、中介者、解释器 |

易错点：简单工厂不在 23 种之内，一般看作工厂方法的特例。

**常用模式和典型应用**
- 单例：Spring 默认 Bean 作用域、`Runtime.getRuntime()`。
- 工厂：`BeanFactory`、`FactoryBean`、`Calendar.getInstance()`。
- 建造者：`StringBuilder`、Lombok `@Builder`。
- 代理：Spring AOP、MyBatis Mapper 接口。
- 装饰器：`BufferedInputStream` 等 IO 包装流。
- 适配器：`InputStreamReader`、Spring MVC `HandlerAdapter`。
- 策略：线程池拒绝策略、`Comparator`。
- 模板方法：AQS、`AbstractApplicationContext.refresh()`。
- 观察者：Spring `ApplicationEvent` / `ApplicationListener`。
- 责任链：Servlet `FilterChain`、Spring MVC 拦截器链。

**设计原则**：单一职责、开闭、里氏替换、依赖倒置、接口隔离、迪米特、合成复用。

### 什么是单例模式？懒汉式和饿汉式有什么区别 | 高频
单例模式保证一个类在内存中只有一个实例，并提供一个全局访问点。适合无状态、创建成本高、需要全局共享的对象，比如配置、连接池、工具类。

**三个要素**：私有构造器（禁止外部 `new`）、私有静态变量保存唯一实例、公有静态方法返回实例。

**饿汉式**：类加载（初始化）时就创建实例。
```java
public class Singleton {
    private static final Singleton INSTANCE = new Singleton();
    private Singleton() {}
    public static Singleton getInstance() { return INSTANCE; }
}
```
- 线程安全：JVM 保证类的初始化（`<clinit>`）只执行一次，并且是加锁的。
- 缺点：不是懒加载，实例从未被使用时也会创建，浪费资源；创建失败会导致类初始化失败。

**懒汉式**：第一次调用 `getInstance()` 时才创建。
```java
public class Singleton {
    private static Singleton instance;
    private Singleton() {}
    public static Singleton getInstance() {
        if (instance == null) {          // 多线程同时进入会创建多个实例
            instance = new Singleton();
        }
        return instance;
    }
}
```
- 优点：延迟加载，用到才创建。
- 缺点：上面这种基础写法线程不安全，两个线程同时判断为 null 就会创建两个实例，需要加锁或用 DCL、静态内部类等写法。

| 对比 | 饿汉式 | 懒汉式 |
| --- | --- | --- |
| 创建时机 | 类初始化时 | 第一次使用时 |
| 线程安全 | 天然安全 | 需要额外处理 |
| 资源占用 | 可能浪费 | 按需创建 |
| 实现难度 | 简单 | 复杂一些 |

选择：实例不大、一定会用到，用饿汉式最简单；需要延迟加载，用静态内部类；需要防反射和序列化破坏，用枚举。

### 懒汉式如何保证只创建一个对象 | 高频
保证懒汉式线程安全有四种写法：同步方法、双重检查锁（DCL）、静态内部类、枚举。实际开发中推荐静态内部类或枚举。

**1. 同步方法**：在 `getInstance()` 上加 `synchronized`。简单可靠，但实例创建完之后每次获取仍要加锁，并发性能差。
```java
public static synchronized Singleton getInstance() {
    if (instance == null) instance = new Singleton();
    return instance;
}
```

**2. 双重检查锁（DCL）**：只在实例还没创建时才加锁。
```java
public class Singleton {
    private static volatile Singleton instance;   // volatile 不能少
    private Singleton() {}
    public static Singleton getInstance() {
        if (instance == null) {                    // 第一次检查：已创建就不加锁，提高性能
            synchronized (Singleton.class) {
                if (instance == null) {            // 第二次检查：防止等锁的线程重复创建
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```
- 第一次检查：实例已经存在时直接返回，绝大多数调用不进入同步块。
- 第二次检查：多个线程同时通过第一次检查后排队等锁，第一个线程创建完实例，后面的线程拿到锁时必须再判断一次，否则会重复创建。
- `volatile`：防止指令重排导致其他线程拿到未初始化完成的对象。

**3. 静态内部类**（推荐）
```java
public class Singleton {
    private Singleton() {}
    private static class Holder {
        private static final Singleton INSTANCE = new Singleton();
    }
    public static Singleton getInstance() { return Holder.INSTANCE; }
}
```
外部类加载时不会初始化 `Holder`，只有第一次调用 `getInstance()` 访问 `Holder.INSTANCE` 时才初始化，由 JVM 的类初始化锁保证线程安全。既是懒加载，又不需要显式加锁。

**4. 枚举**（《Effective Java》推荐）
```java
public enum Singleton {
    INSTANCE;
    public void doSomething() { }
}
```
写法最简洁，线程安全由类初始化保证，并且天然防止反射和反序列化创建新实例。缺点是实例在枚举类初始化时创建，和饿汉式一样，不能单独控制创建时机；枚举也不能继承其他类（可以实现接口）。

注意：饿汉式所说的"类加载时创建"，准确地说是类初始化时创建，而 JVM 在类第一次被主动使用（如调用静态方法）时才初始化它。所以饿汉式只在类里还有其他静态方法、被提前触发初始化时才会"提前创建"。

### 手写一个线程安全的单例模式，DCL写法中为什么需要volatile关键字 | 高频
因为 `instance = new Singleton()` 不是原子操作，其中"初始化对象"和"把引用赋给 instance"两步可能被重排序。没有 volatile 时，另一个线程可能在第一次检查时看到 instance 非空，直接拿到一个还没初始化完成的对象。

**`new Singleton()` 大致分三步**
1. 分配内存空间。
2. 调用构造器，初始化对象。
3. 把 instance 引用指向这块内存。

编译器和 CPU 可能把顺序优化成 1 → 3 → 2，对单线程结果没有影响，但多线程下会出问题：
- 线程 A 在同步块内执行完 1 和 3，instance 已经非空，但对象还没初始化。
- 线程 B 执行第一次检查（在同步块外，不受锁保护），发现 instance 不为 null，直接返回并使用这个对象，读到的字段可能是默认值，导致逻辑错误或空指针。

**volatile 怎么解决**
- 禁止重排序：JMM 规定 volatile 写之前的操作不能重排到 volatile 写之后，实现上在 volatile 写前后插入内存屏障，保证对象完全初始化后才把引用赋给 instance。
- 保证可见性：volatile 写对之后读这个变量的线程立即可见，并且 happens-before 规则保证读到引用的线程也能看到构造器里写入的字段值。
- 这依赖 JDK 5 起修订的 Java 内存模型（JSR-133），JDK 5 之前的 volatile 语义不足以修复 DCL。

**为什么 synchronized 不够**：synchronized 能保证同步块内部的原子性和可见性，但第一次检查在同步块外面，读线程没有加锁，和写线程之间不存在 happens-before 关系，所以看到半初始化的对象是可能的。

完整写法见上一题的 DCL 代码：`private static volatile Singleton instance;`。如果不想处理这些细节，用静态内部类或枚举写法更简单。

### 单例模式会被破坏吗？如何防止 | 高频
会。即使写法正确，懒汉式和饿汉式单例都可以被反射和序列化破坏，克隆也可能产生新对象。枚举单例天然能防住反射和序列化。

**1. 反射破坏**：拿到私有构造器并 `setAccessible(true)`，就能再 new 一个实例。
```java
Constructor<Singleton> c = Singleton.class.getDeclaredConstructor();
c.setAccessible(true);
Singleton s1 = c.newInstance();
System.out.println(s1 == Singleton.getInstance());   // false
```
防御：在构造器中判断实例已存在就抛异常。
```java
private Singleton() {
    if (INSTANCE != null) {          // 饿汉式 / 静态内部类写法中可以这样判断
        throw new IllegalStateException("单例已存在");
    }
}
```
这种防御对懒汉式不完全可靠：如果反射先于 `getInstance()` 调用，此时实例还是 null，仍然会创建出两个对象。

**2. 序列化破坏**：单例类实现了 `Serializable` 时，`ObjectInputStream.readObject()` 会绕过构造器创建一个新对象。
防御：添加 `readResolve()` 方法，反序列化时会用它的返回值替换新创建的对象。
```java
private Object readResolve() {
    return getInstance();
}
```

**3. 克隆破坏**：如果单例类实现了 `Cloneable` 并公开 `clone()`，就能复制出新对象。防御方法是不实现 `Cloneable`，或者让 `clone()` 直接返回单例实例。

**枚举为什么安全**
- 反射：`Constructor.newInstance()` 内部检查到目标是枚举类型会直接抛出 `IllegalArgumentException: Cannot reflectively create enum objects`。
- 序列化：枚举序列化时只写出名称，反序列化时通过 `Enum.valueOf()` 按名称找到已有的常量，不会创建新对象。
- 枚举不能被克隆，`Enum.clone()` 是 final 的，直接抛出 `CloneNotSupportedException`。

**补充**：不同类加载器加载同一个类会得到两个不同的 Class，各自有自己的单例，所以单例的唯一性是"同一个类加载器内唯一"。

### 单例模式的扩展问题：为什么构造器要私有、getInstance 要 static、锁加在哪里
这些问题考的是对单例结构的理解。

**为什么构造器用 private**
- 目的是禁止外部通过 `new` 创建实例，所有实例只能通过 `getInstance()` 获取，由类自己控制唯一性。
- `public` 允许任何类实例化；`protected` 允许同包和子类实例化；默认（包级私有）允许同包实例化，都不能保证唯一。
- private 构造器还顺带阻止了被继承，因为子类构造器必须调用父类构造器。
- private 只能防住正常代码，防不住反射，所以构造器里还可以加检查。

**为什么 getInstance() 必须是 static**
- 调用实例方法需要先有对象，但获取对象正是这个方法要做的事，形成循环依赖。
- static 方法属于类本身，可以通过 `Singleton.getInstance()` 直接调用；同理，保存实例的变量也必须是 static，才能在静态方法中访问并且全局只有一份。

**synchronized 加在方法上和加在代码块上的区别**
- 加在 static 方法上：锁的是 `Singleton.class`，每次调用都要获取锁，即使实例早已创建，所有调用都串行执行，性能差。
- 加在代码块上（DCL）：同样锁 `Singleton.class`，但只有实例为 null 时才进入同步块，实例创建后的调用完全不加锁，只做一次 volatile 读。
- 锁对象用 `Singleton.class`，因为 static 方法中没有 `this`，而且类对象是全局唯一的。

**懒汉式和饿汉式怎么选**
- 对象小、一定会用到：饿汉式，简单不易出错。
- 需要延迟加载：静态内部类，兼顾懒加载和线程安全。
- 需要防反射和序列化：枚举。
- DCL 在需要传参初始化等场景下才有优势，写的时候一定要加 volatile。

## 工厂模式
### 什么是工厂模式？简单工厂、工厂方法、抽象工厂有什么区别 | 高频
工厂模式把对象的创建过程封装起来，调用方只依赖抽象接口，不用关心具体实现类怎么 new，从而降低耦合。按抽象程度分为简单工厂、工厂方法、抽象工厂。GoF 的 23 种模式只包含后两种，简单工厂被看作工厂方法的特例。

| 对比 | 简单工厂 | 工厂方法 | 抽象工厂 |
| --- | --- | --- | --- |
| 结构 | 一个工厂类，根据参数用 if/switch 决定创建哪种产品 | 一个抽象工厂接口，每种产品对应一个具体工厂 | 抽象工厂接口中定义创建一组相关产品的方法，每个具体工厂负责一个产品族 |
| 产品 | 一个产品等级 | 一个产品等级 | 多个产品等级（产品族） |
| 新增产品 | 要修改工厂类，违反开闭原则 | 新增产品类和对应的工厂类即可，符合开闭原则 | 新增产品族容易（加一个具体工厂）；新增产品种类要修改接口和所有工厂，违反开闭原则 |
| 缺点 | 工厂类职责过重，产品多时逻辑臃肿 | 类的数量成对增加 | 结构复杂，扩展产品种类困难 |
| 例子 | `Calendar.getInstance()`、`NumberFormat.getInstance()` | `Collection.iterator()`（每种集合返回自己的迭代器）、Spring 的 `FactoryBean` | JDBC 的 `Connection`（同一个驱动创建配套的 `Statement`、`PreparedStatement`） |

**两个概念**
- 产品等级结构：同一类产品的继承结构，比如空调抽象类和海尔空调、格力空调。
- 产品族：同一个工厂生产的、位于不同产品等级中的一组产品，比如海尔工厂生产的海尔空调和海尔冰箱。

工厂方法解决"创建哪一种产品"，抽象工厂解决"创建哪一整套配套的产品"。

### 简单工厂模式怎么实现？有什么优缺点
简单工厂用一个工厂类集中创建对象：调用方传入参数，工厂根据参数决定实例化哪个具体产品，并以抽象类型返回。

![](images/Java+AI八股-1-1.png)

**角色**
- 工厂类：核心，包含判断逻辑，负责创建产品。
- 抽象产品：具体产品的父类或接口。
- 具体产品：工厂创建的对象。

```java
abstract class BMW { }
class BMW320 extends BMW { }
class BMW523 extends BMW { }

class BMWFactory {
    public static BMW create(int type) {
        return switch (type) {                 // JDK 14 起的 switch 表达式
            case 320 -> new BMW320();
            case 523 -> new BMW523();
            default -> throw new IllegalArgumentException("未知车型: " + type);
        };
    }
}

BMW car = BMWFactory.create(320);              // 调用方只依赖 BMW 和工厂
```

工厂方法常写成 static 的，所以简单工厂也叫静态工厂方法。

**优点**
- 创建和使用分离：调用方不需要知道具体类名和创建细节，只需要知道参数。
- 结合配置文件或反射（按类名创建），可以在不改调用方代码的情况下更换产品。

**缺点**
- 违反开闭原则：每增加一种产品都要修改工厂类的判断逻辑。
- 工厂类集中了所有创建逻辑，产品多了会很臃肿；工厂出问题会影响所有调用方。

适合产品种类少且稳定的场景。

### 工厂方法模式怎么实现？和简单工厂相比有什么改进
工厂方法把工厂也抽象出来：定义一个创建产品的接口，由具体工厂子类决定实例化哪个产品，把对象的创建延迟到子类。新增产品时只需新增产品类和对应的工厂类，不用修改已有代码，符合开闭原则。

![](images/Java+AI八股-1-2.png)

**角色**
- 抽象工厂：声明工厂方法，返回抽象产品。
- 具体工厂：实现工厂方法，创建具体产品。
- 抽象产品、具体产品：同简单工厂。

```java
interface BMWFactory {
    BMW create();
}
class BMW320Factory implements BMWFactory {
    public BMW create() { return new BMW320(); }
}
class BMW523Factory implements BMWFactory {
    public BMW create() { return new BMW523(); }
}

BMWFactory factory = new BMW320Factory();   // 选定具体工厂就决定了产品
BMW car = factory.create();
```

**和简单工厂的对比**
- 简单工厂：一个工厂负责所有产品，新增产品要改工厂。
- 工厂方法：一个具体工厂负责一种产品，新增产品只需扩展，不修改原有代码。
- 代价：每增加一个产品就要增加一个具体产品类和一个具体工厂类，类的数量成倍增加。

**应用**：`Collection.iterator()` 中每种集合返回自己的迭代器实现；`java.net.URLStreamHandlerFactory`；Spring 的 `FactoryBean.getObject()`。

### 抽象工厂模式怎么实现？和工厂方法有什么区别
抽象工厂提供一个接口，用来创建一系列相关或相互依赖的对象（一个产品族），而不需要指定具体类。客户端只要选定一个具体工厂，拿到的所有产品就一定是配套的。

![](images/Java+AI八股-1-3.png)

![](images/Java+AI八股-1-4.png)

**例子**：宝马 320 系列配 A 型发动机和 A 型空调，523 系列配 B 型发动机和 B 型空调。
```java
interface Engine { }
class EngineA implements Engine { }
class EngineB implements Engine { }

interface AirCondition { }
class AirConditionA implements AirCondition { }
class AirConditionB implements AirCondition { }

interface PartsFactory {                 // 一个工厂负责一整个产品族
    Engine createEngine();
    AirCondition createAirCondition();
}
class BMW320PartsFactory implements PartsFactory {
    public Engine createEngine() { return new EngineA(); }
    public AirCondition createAirCondition() { return new AirConditionA(); }
}
class BMW523PartsFactory implements PartsFactory {
    public Engine createEngine() { return new EngineB(); }
    public AirCondition createAirCondition() { return new AirConditionB(); }
}
```

**优点**
- 保证客户端始终使用同一产品族中的对象，不会出现 320 配 B 型空调这种组合错误。
- 切换整个产品族只需要换一个具体工厂实例。

**缺点**
- 新增一个产品族容易：加一个具体工厂。
- 新增一种产品（比如再加一个座椅）困难：要修改抽象工厂接口和所有具体工厂，违反开闭原则。

**和工厂方法的区别**
- 工厂方法：一个抽象产品，每个具体工厂只创建一种具体产品。
- 抽象工厂：多个抽象产品，每个具体工厂创建一个产品族中的多种具体产品。
- 当抽象工厂中只有一个产品时，就退化成了工厂方法。

**应用**：JDBC 中不同数据库驱动的 `Connection` 创建配套的 `Statement`、`PreparedStatement`；切换 UI 主题时整套创建按钮、文本框等控件。

### Spring框架中哪些地方用到了工厂模式
Spring IoC 容器本身就是一个大工厂，此外 `FactoryBean`、`@Bean` 方法以及静态 / 实例工厂方法配置都是工厂模式的应用。

- **BeanFactory / ApplicationContext**：IoC 容器的顶层接口，根据 BeanDefinition 创建、组装和管理 Bean，调用方通过 `getBean()` 按名称或类型获取，不用自己 new，也不用关心依赖注入的细节。`ApplicationContext` 继承 `BeanFactory`，并扩展了事件、国际化、资源加载等能力，启动时默认预先实例化所有非懒加载的单例 Bean。
- **FactoryBean**：当一个 Bean 的创建逻辑很复杂时，实现 `FactoryBean<T>` 接口，在 `getObject()` 中自定义创建过程。容器中按名称获取到的是 `getObject()` 返回的对象，加 `&` 前缀才能拿到 FactoryBean 本身。典型例子：MyBatis 的 `SqlSessionFactoryBean` 创建 `SqlSessionFactory`，`MapperFactoryBean` 为 Mapper 接口创建代理对象。
- **工厂方法配置**：XML 中用 `factory-method` 指定静态工厂方法，或用 `factory-bean` + `factory-method` 指定实例工厂方法；注解方式下 `@Configuration` 类里的 `@Bean` 方法本质上也是工厂方法。

`BeanFactory` 和 `FactoryBean` 是常见的对比题：前者是管理所有 Bean 的容器（工厂），后者是一个能生产其他对象的特殊 Bean。
