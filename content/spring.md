## IoC 与依赖注入
### 什么是 IoC 和 AOP？ | 高频
IoC 管"对象怎么来"，AOP 管"公共逻辑怎么加"，两者是 Spring 的两大核心。

- **IoC（Inversion of Control，控制反转）**：对象的创建权和依赖关系的管理权从业务代码转交给 Spring 容器。业务类不再自己 `new` 依赖，而是声明需要什么，由容器创建并注入。DI（依赖注入）是 IoC 的具体实现方式。
- **AOP（Aspect Oriented Programming，面向切面编程）**：把日志、事务、权限校验、限流、幂等、监控埋点等横切逻辑从业务代码中抽出来，集中写在切面里，在不修改源码的前提下对方法做增强。
- **AOP 的实现**：Spring AOP 基于运行时动态代理。容器为目标 Bean 生成代理对象，调用方拿到的是代理，代理在目标方法前后织入增强逻辑。代理方式有 JDK 动态代理（基于接口）和 CGLIB（基于继承生成子类）两种。

### IoC 有什么好处？相比直接 new 对象 | 高频 | 交通银行、淘天
核心好处是解耦：对象的使用方只依赖抽象，不关心具体实现由谁创建、怎么创建。

- **解耦、易替换**：`OrderService` 依赖 `PayProcessor` 接口，具体是支付宝还是微信实现由容器注入；更换实现只改配置或 Bean 定义，不改业务代码。
- **创建与使用分离**：复杂对象的构造、参数、依赖关系集中在配置里，业务代码更干净。
- **生命周期统一管理**：初始化、销毁回调、作用域都交给容器，不必手动管理资源。
- **对象复用**：Bean 默认单例，避免重复创建无状态对象。
- **便于测试**：依赖通过构造器传入，单元测试时可以直接传 Mock 对象。
- **扩展能力**：容器统一创建对象，才有了 BeanPostProcessor、AOP 代理、事务等在创建过程中"插一脚"的机会。

### 什么是 DI？注入方式有哪些？ | 高频 | 农业银行、招商银行、字节
DI（Dependency Injection，依赖注入）是 IoC 的实现方式：容器创建 Bean 时，把它依赖的对象自动注入进去。

| 方式 | 写法 | 特点 |
| --- | --- | --- |
| 构造器注入 | 依赖作为构造参数 | 依赖不可变（可 `final`）、创建即完整、易测试；Spring 官方推荐。单构造器时 Spring 4.3+ 可省略 `@Autowired` |
| Setter 注入 | `@Autowired` 标在 setter 上 | 适合可选依赖、可重新注入 |
| 字段注入 | `@Autowired`/`@Resource` 标在字段上 | 写法最简单，但隐藏依赖、不能 `final`、脱离容器难以测试 |

"接口注入"是早期 IoC 理论中的一种方式，Spring 并不支持。实际开发推荐构造器注入，配合 Lombok 的 `@RequiredArgsConstructor` 很简洁。

### 注入 Bean 的方式有哪些？为什么不推荐字段上直接用 @Autowired？ | 银行、阿里
注入方式就是构造器、Setter、字段三种。IDEA 提示 "Field injection is not recommended"，针对的是**字段注入**这种方式，而不是 `@Autowired` 注解本身：

- 字段不能声明为 `final`，对象可能处于依赖未注入的状态，脱离容器 `new` 出来时直接 NPE。
- 依赖关系藏在字段里，类依赖过多也不容易察觉（构造器参数一长就会暴露设计问题）。
- 单元测试必须靠反射或启动容器才能注入 Mock。
- 字段注入会掩盖循环依赖问题，构造器注入则会在启动时直接暴露。
- `@Autowired` 是 Spring 专有注解，与容器强绑定；`@Resource` 是 Jakarta 标准注解。

推荐做法：必选依赖用构造器注入，可选依赖用 Setter 注入。

### @Autowired 和 @Resource 的区别 | 高频
两者都能完成依赖注入，主要区别在来源和匹配规则。

| 对比 | @Autowired | @Resource |
| --- | --- | --- |
| 来源 | Spring 注解 | JSR-250 标准（Boot 3 / Spring 6 为 `jakarta.annotation.Resource`，之前是 `javax.annotation.Resource`） |
| 匹配规则 | 先按类型；找到多个时再看 `@Primary`、`@Priority`，最后按字段名/参数名匹配 | 先按名称（`name` 属性，未指定则用字段名）；按名称找不到再按类型 |
| 指定 Bean | 配合 `@Qualifier("xxx")` | 直接 `@Resource(name = "xxx")` |
| 必须性 | `required = true` 默认，找不到抛异常；可设为 false | 找不到抛异常 |
| 可用位置 | 构造器、方法、字段、参数 | 字段、Setter 方法，不支持构造器 |

同一接口有多个实现时：`@Autowired` 会因为找到多个候选而报 `NoUniqueBeanDefinitionException`（除非字段名恰好等于某个 Bean 名或有 `@Primary`），一般用 `@Qualifier` 解决。

## Bean 的定义、作用域与生命周期
### 什么是 Bean？声明 Bean 的方式有哪些？怎么控制创建顺序？ | 农业银行、交通银行
Bean 就是由 Spring IoC 容器创建、装配和管理生命周期的对象。容器先把配置解析成 `BeanDefinition`，再按定义通过反射实例化。

**声明方式**
- XML：`<bean id="..." class="..."/>`（老项目）。
- 注解扫描：`@Component` 及其派生 `@Controller`、`@Service`、`@Repository`，配合 `@ComponentScan`。
- Java 配置类：`@Configuration` + `@Bean` 方法，适合注册第三方类。
- `@Import` 导入配置类、`ImportSelector`、`ImportBeanDefinitionRegistrar`（Spring Boot 自动配置和 `@EnableXxx` 就靠这个）。
- 编程式注册：`BeanDefinitionRegistryPostProcessor`、`FactoryBean`。

**控制创建顺序**
- 依赖关系天然决定顺序：A 注入了 B，B 一定先创建。
- 没有直接依赖但需要先初始化时，用 `@DependsOn("b")` 显式声明。
- `@Lazy` 可推迟到第一次使用时才创建。
- `@Order` / `Ordered` 不控制 Bean 的创建顺序，它只影响注入 `List<X>` 时的排序、切面和过滤器的执行顺序。

### Spring Bean 的作用域有哪些？ | 高频 | 交通银行、阿里
通过 `@Scope` 指定，默认 `singleton`。

| 作用域 | 含义 | 适用环境 |
| --- | --- | --- |
| singleton | 每个容器只有一个实例（默认） | 所有 |
| prototype | 每次 `getBean` 或注入都新建一个实例 | 所有 |
| request | 每个 HTTP 请求一个实例 | Web |
| session | 每个 HTTP Session 一个实例 | Web |
| application | 每个 `ServletContext` 一个实例 | Web |
| websocket | 每个 WebSocket 会话一个实例 | Web |

注意点：
- 无状态的 Service、DAO、工具类用 singleton；需要隔离状态的对象才考虑 prototype。
- prototype Bean 容器只负责创建，不管理销毁，`@PreDestroy` 不会被调用。
- 把 prototype/request Bean 注入 singleton 时，只会注入一次，后续不会变。需要每次拿新实例可以用 `ObjectProvider<T>`、`@Lookup` 方法，或 `@Scope(proxyMode = ScopedProxyMode.TARGET_CLASS)` 作用域代理。

### Bean 的生命周期 | 高频
主线是：实例化 → 属性填充 → 初始化 → 使用 → 销毁，扩展点穿插在初始化前后。

1. **实例化**：按 `BeanDefinition` 反射调用构造器或工厂方法创建对象，属性为空。循环依赖的提前暴露就在这之后。
2. **属性填充（populateBean）**：注入 `@Autowired`、`@Value`、`@Resource` 等依赖。
3. **Aware 回调**：`BeanNameAware`、`BeanFactoryAware` 等；`ApplicationContextAware` 由 `ApplicationContextAwareProcessor` 在下一步回调。
4. **BeanPostProcessor 前置**：`postProcessBeforeInitialization()`，`@PostConstruct` 在这里执行。
5. **初始化**：`InitializingBean.afterPropertiesSet()` → 自定义 `init-method`。
6. **BeanPostProcessor 后置**：`postProcessAfterInitialization()`，AOP 代理通常在这里生成，容器里最终放的可能是代理对象。
7. **使用**：单例放入一级缓存 `singletonObjects`。
8. **销毁**：容器关闭时 `@PreDestroy` → `DisposableBean.destroy()` → `destroy-method`。prototype Bean 不走这一步。

### Spring 的单例 Bean 是线程安全的吗？ | 滴滴、银行、农业银行
不是。Spring 只保证单例 Bean 在容器中只有一个实例，不做任何并发控制，是否线程安全取决于 Bean 自身有没有可变的共享状态。

- **无状态 Bean 是安全的**：常见的 Controller、Service、DAO 只持有其他 Bean 的引用，方法内用局部变量，不存在共享可变状态，所以实际开发中大多没有问题。
- **有状态 Bean 不安全**：如果单例里有可修改的成员变量（计数器、缓存的 Map、当前用户等），多线程并发读写就会出问题。

解决办法：
- 首选把 Bean 设计成无状态，状态放到方法局部变量或参数中。
- 必须保存线程相关状态时用 `ThreadLocal`（用完 `remove()`，防止线程池复用导致串数据和内存泄漏）。
- 共享状态使用并发容器（`ConcurrentHashMap`）、原子类或加锁。
- 改用 prototype / request 作用域，让每个线程或请求拿到独立实例。

## IoC 容器原理
### IoC 容器的初始化过程（refresh 流程） | 招商银行、交通银行、PDD
一句话：先把配置解析成 `BeanDefinition` 注册进 `BeanFactory`，经过后置处理器加工，最后实例化所有非懒加载的单例 Bean。入口是 `AbstractApplicationContext.refresh()`，主要步骤：

1. `prepareRefresh()`：初始化并校验 `Environment`。
2. `obtainFreshBeanFactory()`：获取 `DefaultListableBeanFactory`，XML 方式在这里加载 `BeanDefinition`。
3. `prepareBeanFactory()` / `postProcessBeanFactory()`：设置类加载器、内置后置处理器，留给子类扩展。
4. `invokeBeanFactoryPostProcessors()`：`ConfigurationClassPostProcessor` 解析 `@Configuration`、`@ComponentScan`、`@Import`、`@Bean`，注解方式的大部分 `BeanDefinition` 在此注册（Spring Boot 自动配置也在此生效）。
5. `registerBeanPostProcessors()`：注册所有 `BeanPostProcessor`。
6. `initMessageSource()`、`initApplicationEventMulticaster()`、`registerListeners()`：国际化、事件广播器、监听器。
7. `onRefresh()`：Spring Boot 在这里创建并启动内嵌 Tomcat。
8. `finishBeanFactoryInitialization()`：实例化所有非懒加载单例（含 AOP 代理）。
9. `finishRefresh()`：发布 `ContextRefreshedEvent`。

### BeanFactory 和 ApplicationContext 有什么区别？
`BeanFactory` 是最底层的 IoC 容器接口，`ApplicationContext` 是它的子接口，在其基础上提供企业级功能。

| 对比 | BeanFactory | ApplicationContext |
| --- | --- | --- |
| 定位 | 基础容器，只负责 Bean 的创建、获取、依赖注入 | 完整的应用上下文，实际开发都用它 |
| 单例加载时机 | 懒加载，第一次 `getBean` 时才创建 | 启动 `refresh` 时预先实例化所有非懒加载单例，配置错误能尽早暴露 |
| 扩展功能 | 无 | 国际化 `MessageSource`、事件发布、资源加载 `ResourceLoader`、`Environment` 环境与 Profile |
| 后置处理器 | 需手动注册 BeanPostProcessor | 自动检测并注册 BeanFactoryPostProcessor / BeanPostProcessor |

常见实现：`AnnotationConfigApplicationContext`、`ClassPathXmlApplicationContext`，Spring Boot Web 应用用的是 `AnnotationConfigServletWebServerApplicationContext`。

### BeanDefinition 是什么？
`BeanDefinition` 是 Bean 的"图纸"：Spring 先把 XML、注解、配置类解析成 `BeanDefinition`，注册到 `BeanDefinitionRegistry`（即 `DefaultListableBeanFactory` 内部的 `beanDefinitionMap`），后续一切 Bean 的创建都按它来。

包含的信息：
- Bean 的类名 `beanClassName`、工厂方法（`@Bean` 方法对应 factoryBean + factoryMethod）。
- 作用域、是否懒加载 `lazyInit`、是否 `primary`、`dependsOn`。
- 构造器参数值、属性值。
- 初始化方法、销毁方法名。

意义：把"定义"和"实例化"分开，因此可以在实例化之前通过 `BeanFactoryPostProcessor` 修改定义（例如 `PropertySourcesPlaceholderConfigurer` 替换 `${}` 占位符）。

### BeanPostProcessor 是什么？和 BeanFactoryPostProcessor 有什么区别？
`BeanPostProcessor` 是 Bean 的后置处理器，在每个 Bean 初始化前后提供扩展点，可以修改甚至替换 Bean 实例。

```java
public interface BeanPostProcessor {
    default Object postProcessBeforeInitialization(Object bean, String beanName) { return bean; }
    default Object postProcessAfterInitialization(Object bean, String beanName) { return bean; }
}
```

典型实现：
- `AutowiredAnnotationBeanPostProcessor`：处理 `@Autowired`、`@Value` 注入（属于其子接口 `InstantiationAwareBeanPostProcessor`，在属性填充阶段工作）。
- `CommonAnnotationBeanPostProcessor`：处理 `@Resource`、`@PostConstruct`、`@PreDestroy`。
- `AnnotationAwareAspectJAutoProxyCreator`：在 `postProcessAfterInitialization` 中为需要增强的 Bean 生成 AOP 代理，`@Transactional`、`@Async` 的代理也是这一类机制。

| 对比 | BeanFactoryPostProcessor | BeanPostProcessor |
| --- | --- | --- |
| 作用对象 | `BeanDefinition`（元数据） | Bean 实例 |
| 执行时机 | 所有 Bean 实例化之前，执行一次 | 每个 Bean 初始化前后都执行 |
| 典型用途 | 解析配置类、替换占位符、注册额外的 BeanDefinition | 依赖注入、生命周期注解、AOP 代理 |

### FactoryBean 和 BeanFactory 的区别？
名字相似，完全是两回事：`BeanFactory` 是容器，`FactoryBean` 是容器里一种能"生产对象"的特殊 Bean。

- `BeanFactory`：IoC 容器的顶层接口，负责管理所有 Bean。
- `FactoryBean<T>`：一个接口，实现它的 Bean 通过 `getObject()` 自定义复杂对象的创建逻辑，还有 `getObjectType()`、`isSingleton()`。
- 按名字 `getBean("xxx")` 时，拿到的是 `getObject()` 返回的产品对象；要拿 FactoryBean 本身，需要用 `getBean("&xxx")`。
- 典型场景：MyBatis 的 `MapperFactoryBean` 为每个 Mapper 接口生成代理对象，`SqlSessionFactoryBean` 创建 `SqlSessionFactory`；OpenFeign 的 `FeignClientFactoryBean` 生成远程调用代理。适合创建过程复杂、需要整合第三方框架的对象。

## 循环依赖与三级缓存
### 什么是循环依赖？Spring 能解决哪些？
循环依赖是指两个或多个 Bean 互相持有对方的引用，形成闭环：A 依赖 B、B 依赖 A，或 A → B → C → A，甚至 A 依赖自己。创建 A 时要先有 B，创建 B 时又要先有 A，不处理就会无限递归。

Spring 用三级缓存"提前暴露半成品对象"来解决，但有条件：

| 场景 | 能否解决 |
| --- | --- |
| 单例 + 字段 / Setter 注入 | 能（前提是允许循环引用，见下文 Spring Boot 2.6 的变化） |
| 单例 + 双方都是构造器注入 | 不能，启动报 `BeanCurrentlyInCreationException` |
| 一方构造器、一方 Setter | 取决于创建顺序：先创建的那个是 Setter 注入才能成功 |
| prototype 作用域 | 不能，prototype 不进缓存，直接报错 |
| 含 `@Async` 的 Bean 参与循环 | 通常失败，因为其代理在初始化后才生成，与提前暴露出去的原始对象不一致 |

**Spring Boot 2.6+ 的变化**：从 Spring Boot 2.6 开始，`spring.main.allow-circular-references` 默认为 `false`，即默认禁止循环引用，存在循环依赖时启动直接失败，并打印 "The dependencies of some of the beans in the application context form a cycle"。Spring Framework 本身的三级缓存机制仍然存在（Spring 6 也是如此），只是 Boot 默认把它关掉了。

处理方式：
- 首选重构，消除循环（抽出公共逻辑到第三个 Bean、改用事件解耦）。
- 在注入点加 `@Lazy`，注入的是一个延迟代理，真正使用时才去容器取，构造器循环也能用这种方式打破。
- 实在需要兼容老代码，再配置 `spring.main.allow-circular-references=true`。

### 三级缓存是什么？怎么解决循环依赖？ | 高频
三级缓存是 `DefaultSingletonBeanRegistry` 中的三个 Map：

| 缓存 | 字段 | 存放内容 |
| --- | --- | --- |
| 一级 | `singletonObjects` | 完全创建好的单例 Bean（成品），日常 `getBean` 从这里取 |
| 二级 | `earlySingletonObjects` | 提前暴露的早期引用（半成品，可能已是代理），保证多次获取拿到同一个对象 |
| 三级 | `singletonFactories` | `ObjectFactory` 工厂 lambda：`() -> getEarlyBeanReference(beanName, mbd, bean)`，需要时才生成早期引用 |

`getSingleton` 查找顺序：一级 → 二级 → 三级；从三级拿到工厂后调用 `getObject()` 生成早期引用，放入二级缓存并删除三级缓存中的工厂。

**以 A ↔ B（Setter / 字段注入）为例：**
1. 创建 A：实例化 A（构造器执行完，属性为空），把 A 的 `ObjectFactory` 放入三级缓存。
2. 填充 A 的属性，发现需要 B，`getBean(B)`。
3. 创建 B：实例化 B，B 的工厂放入三级缓存；填充 B 的属性，发现需要 A。
4. `getBean(A)`：一级、二级没有，三级有 A 的工厂，调用它得到 A 的早期引用（如果 A 需要 AOP，这里会提前生成 A 的代理），放入二级缓存，移除三级。
5. B 拿到 A 的早期引用，完成属性填充和初始化，放入一级缓存。
6. 回到 A，拿到成品 B 完成注入和初始化。初始化后检查：A 的代理已经提前生成过（记录在 `earlyProxyReferences` 中），不会再生成第二个，最终把二级缓存里的那个对象放入一级缓存。

关键点：Bean 的创建分成"实例化"和"初始化"两步，正是这个间隙让 Spring 可以把半成品提前暴露出去。

### 为什么需要三级缓存，两级不行吗？
如果只为了打破循环，两级缓存（成品 + 半成品）就够了。第三级缓存是为了 **AOP 代理** 和 **不打乱代理创建时机**。

- 正常情况下，AOP 代理在 Bean 生命周期最后一步 `postProcessAfterInitialization` 才创建。
- 发生循环依赖时，B 需要拿到 A 的"最终形态"。如果 A 最终要被代理，B 拿到的必须是代理对象，否则 B 持有的是原始对象，容器里的却是代理，两者不一致，增强（如事务）在 B 中会失效。
- 如果只有两级缓存，想保证这一点，就必须在每个 Bean 实例化后立刻创建代理放入二级缓存，这样所有 Bean（哪怕根本没有循环依赖）都提前代理，违背了"初始化完成后再代理"的设计。
- 三级缓存存的是工厂，**只有真的发生循环依赖、有人来取早期引用时**，才调用 `getEarlyBeanReference` 提前生成代理；没有循环依赖的 Bean 仍按正常时机代理。
- 二级缓存则保证工厂只被调用一次，多个 Bean 同时依赖 A 时拿到的是同一个早期引用（同一个代理），而不是每次都新建。

总结：一级存成品，二级存半成品保证唯一，三级存工厂实现"按需、延迟"地生成早期代理。

### 为什么构造器注入的循环依赖无法解决？
三级缓存的前提是"先实例化、再提前暴露"。构造器注入时依赖是构造参数，A 必须先拿到 B 才能执行构造器，而 B 的构造器又需要 A，两者谁都实例化不出来，连半成品对象都没有，自然没东西可以放进三级缓存。

Spring 在创建前把 Bean 名放入"正在创建"集合 `singletonsCurrentlyInCreation`，再次进入时发现已在集合中，就抛出 `BeanCurrentlyInCreationException`。

解决：在构造参数上加 `@Lazy`，注入一个延迟解析的代理对象，构造器能正常执行，第一次调用方法时才去容器里拿真正的 Bean；或者把其中一方改为 Setter 注入；根本上还是建议重构消除循环。

## AOP 与动态代理
### AOP 的核心概念、通知类型和应用场景 | 高频 | 农业银行、交通银行、得物
AOP 把横切逻辑从业务代码中抽离成切面，通过代理在指定方法前后织入。

**核心概念**
- 切面 Aspect：横切逻辑的模块化封装，`@Aspect` 类。
- 连接点 JoinPoint：可以被增强的点，Spring AOP 中只有方法执行。
- 切点 Pointcut：筛选连接点的表达式，如 `execution(* com.xx.service..*(..))`、`@annotation(com.xx.Log)`。
- 通知 Advice：在切点上执行的增强逻辑。
- 目标对象 Target、代理对象 Proxy、织入 Weaving（把切面应用到目标、生成代理的过程）。

**五种通知**

| 注解 | 执行时机 |
| --- | --- |
| `@Before` | 目标方法执行前 |
| `@AfterReturning` | 正常返回后，可获取返回值 |
| `@AfterThrowing` | 抛出异常后，可获取异常 |
| `@After` | 方法结束后，无论成功失败（类似 finally） |
| `@Around` | 包裹整个调用，通过 `ProceedingJoinPoint.proceed()` 决定是否、何时执行目标方法，可修改参数和返回值，功能最强 |

同一切面内（Spring 5.2.7+）的顺序：`@Around` 前半段 → `@Before` → 目标方法 → `@AfterReturning` / `@AfterThrowing` → `@After` → `@Around` 后半段。

**常见场景**：日志与审计、权限校验、声明式事务 `@Transactional`、接口限流与幂等、性能监控耗时统计、缓存 `@Cacheable`、异步 `@Async`、统一异常转换、分布式锁注解。

```java
@Aspect
@Component
public class LogAspect {
    @Around("@annotation(com.example.annotation.Log)")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.currentTimeMillis();
        try {
            return pjp.proceed();
        } finally {
            log.info("{} 耗时 {} ms", pjp.getSignature(), System.currentTimeMillis() - start);
        }
    }
}
```

### 多个切面的执行顺序怎么控制？
用 `@Order` 注解或实现 `Ordered` 接口，**值越小优先级越高**。

- 优先级高的切面在外层：进入方法时先执行，退出时最后执行，像洋葱一样层层包裹。例如 `@Order(1)` 的日志切面和 `@Order(2)` 的权限切面：日志前置 → 权限前置 → 目标方法 → 权限后置 → 日志后置。
- 不指定顺序时，两个切面都是最低优先级，执行顺序不确定，不能依赖类名或注册顺序。
- `@Order` 要加在 `@Aspect` 切面类上，加在通知方法上无效。同一切面内多个同类型通知的顺序也不保证，需要严格顺序就拆成多个切面。
- 实际例子：Spring 的事务切面默认是最低优先级，自定义的分布式锁切面如果要包在事务外面（先加锁、事务提交后再释放锁），就要给锁切面设置更小的 order。

### AOP 的实现原理？JDK 动态代理和 CGLIB 的区别？ | 高频
Spring AOP 基于运行时动态代理：在 Bean 初始化完成后，由 `AbstractAutoProxyCreator`（BeanPostProcessor）判断该 Bean 是否匹配某个切点，匹配就用 `ProxyFactory` 生成代理替换原 Bean 放入容器。调用代理方法时，会把匹配的通知组成拦截器链（`MethodInterceptor`）依次执行，最后反射调用目标方法。

| 对比 | JDK 动态代理 | CGLIB |
| --- | --- | --- |
| 原理 | 运行时生成实现相同接口的代理类，调用转发到 `InvocationHandler.invoke()` | 基于 ASM 生成目标类的子类，重写方法，调用转发到 `MethodInterceptor.intercept()` |
| 要求 | 目标类必须实现接口，只能代理接口中的方法 | 不需要接口；不能代理 `final` 类和 `final` 方法 |
| 依赖 | JDK 自带 | Spring 3.2 起已内置到 spring-core |
| 注入时的类型 | 只能按接口类型注入，按实现类注入会报错 | 可以按实现类注入 |

**Spring 怎么选**
- Spring Framework 默认（`proxyTargetClass = false`）：目标实现了接口用 JDK 动态代理，否则用 CGLIB。
- **Spring Boot 2.x 起默认使用 CGLIB**：`spring.aop.proxy-target-class` 默认为 `true`，即使目标实现了接口也用 CGLIB，避免按实现类注入时类型不匹配；配置为 `false` 才会对有接口的类用 JDK 代理。Spring Boot 3.x 保持这个默认。

两种方式都拦截不到 `private`、`static` 方法，也拦截不到类内部的 `this.xxx()` 自调用，这是事务失效等问题的根源。性能上，JDK 8 之后两者差距已经很小，不是选择的主要依据。

### Spring AOP 和 AspectJ 有什么区别？
| 对比 | Spring AOP | AspectJ |
| --- | --- | --- |
| 织入时机 | 运行时动态代理 | 编译期（ajc）、编译后或类加载期（LTW）修改字节码 |
| 连接点 | 只支持方法执行，且只能是 Spring Bean 的方法 | 方法调用与执行、构造器、字段读写、静态初始化等 |
| 自调用 | 拦截不到 | 能拦截（直接改了字节码） |
| 性能与复杂度 | 每次调用经过代理，开销略大；使用简单 | 无代理开销；需要特殊编译器或 agent |

Spring AOP 复用了 AspectJ 的注解（`@Aspect`、`@Before` 等）和切点表达式解析器，但底层仍然是代理，并不是 AspectJ 织入。需要拦截自调用或非 Spring 对象时，可以用 `@EnableLoadTimeWeaving` 或 `@Transactional(mode = AdviceMode.ASPECTJ)` 切到 AspectJ。

## Spring 事务
### Spring 事务的实现方式和原理 | 高频
Spring 事务分编程式和声明式两种，底层都由 `PlatformTransactionManager` 统一管理，声明式事务通过 AOP 代理实现。

**编程式事务**：用 `TransactionTemplate`（推荐）或 `PlatformTransactionManager` 手动控制，粒度细到代码块，但侵入业务。

```java
transactionTemplate.executeWithoutResult(status -> {
    orderMapper.insert(order);
    stockMapper.deduct(skuId, 1);   // 抛出运行时异常或调用 status.setRollbackOnly() 即回滚
});
```

**声明式事务**：加 `@Transactional`，业务无感知。Spring Boot 通过 `TransactionAutoConfiguration` 自动开启，无需 `@EnableTransactionManagement`。

**原理**
1. 启动时 `BeanFactoryTransactionAttributeSourceAdvisor` 匹配带 `@Transactional` 的 Bean，生成代理。
2. 调用时进入 `TransactionInterceptor.invokeWithinTransaction()`，解析传播行为、隔离级别、超时、只读、回滚规则。
3. `PlatformTransactionManager.getTransaction()` 按传播行为新建、加入或挂起事务。新建时拿连接、`setAutoCommit(false)`，并绑定到 `TransactionSynchronizationManager` 的 ThreadLocal。
4. 执行目标方法，MyBatis、JdbcTemplate 从当前线程取同一个连接，所以处于同一事务。
5. 正常返回 `commit`，异常按回滚规则 `rollback`；最后释放连接，恢复挂起的外层事务。

事务管理器：JDBC / MyBatis 用 `DataSourceTransactionManager`（较新的 Spring Boot 默认注册子类 `JdbcTransactionManager`），JPA 用 `JpaTransactionManager`。

### Spring 事务的隔离级别有哪些？ | 高频
通过 `@Transactional(isolation = Isolation.XXX)` 设置，本质是在拿到连接后调用 `Connection.setTransactionIsolation()`，最终由数据库实现，所以要和 MySQL 的隔离级别一起理解。

| 级别 | 脏读 | 不可重复读 | 幻读 |
| --- | --- | --- | --- |
| `DEFAULT`（默认） | 使用数据库自己的默认级别 | | |
| `READ_UNCOMMITTED` 读未提交 | 可能 | 可能 | 可能 |
| `READ_COMMITTED` 读已提交 | 避免 | 可能 | 可能 |
| `REPEATABLE_READ` 可重复读 | 避免 | 避免 | 标准中可能 |
| `SERIALIZABLE` 串行化 | 避免 | 避免 | 避免，性能最差 |

- MySQL InnoDB 默认是 `REPEATABLE_READ`，并通过 MVCC（快照读）和 Next-Key Lock（当前读）在很大程度上避免了幻读，但快照读与当前读混用时仍可能出现幻读；Oracle、PostgreSQL、SQL Server 默认是 `READ_COMMITTED`。
- 非 `DEFAULT` 的隔离级别只在新开启事务时生效，加入已有事务时沿用外层事务的级别。

### Spring 事务的传播行为有哪些？ | 高频
传播行为定义了"一个事务方法被另一个方法调用时，事务该怎么处理"，通过 `propagation` 设置，共 7 种：

| 传播行为 | 当前有事务 | 当前无事务 |
| --- | --- | --- |
| `REQUIRED`（默认） | 加入当前事务 | 新建事务 |
| `REQUIRES_NEW` | 挂起当前事务，新建一个独立事务 | 新建事务 |
| `NESTED` | 在当前事务中创建嵌套事务（保存点） | 新建事务（同 REQUIRED） |
| `SUPPORTS` | 加入当前事务 | 以非事务方式执行 |
| `NOT_SUPPORTED` | 挂起当前事务，以非事务方式执行 | 以非事务方式执行 |
| `MANDATORY` | 加入当前事务 | 抛异常 `IllegalTransactionStateException` |
| `NEVER` | 抛异常 | 以非事务方式执行 |

**最容易混的三个**
- `REQUIRED`：内外是同一个事务，任何一处回滚都整体回滚。内层抛异常被外层 catch 住时，事务已被标记为 rollback-only，外层提交会抛 `UnexpectedRollbackException`。
- `REQUIRES_NEW`：内外是两个独立事务、两个连接。内层提交后不受外层回滚影响；内层回滚，外层只要捕获异常就能正常提交。适合记录操作日志、审计这种"无论如何都要落库"的场景。注意它会多占一个连接，大量使用可能耗尽连接池。
- `NESTED`：同一个事务、同一个连接，进入内层时打一个 savepoint。内层回滚只回到保存点，外层可继续提交；外层回滚则内层一起回滚。依赖 JDBC 保存点，`DataSourceTransactionManager` 支持，`JpaTransactionManager` 默认不支持。

### @Transactional 在什么情况下会失效？ | 高频
根本原因只有两类：**调用没有经过代理对象**，或者**异常没有被事务拦截器感知 / 不在回滚规则内**。

**代理相关**
1. **同类自调用**：`this.b()` 调的是原始对象，绕过代理，最常见。
2. **访问权限**：`private` 一定不生效。Spring 6.0 之前只有 `public` 生效；Spring 6.0+（Boot 3.x）在 CGLIB 类代理下 `protected` 和包可见方法也能生效；JDK 接口代理只对接口的 `public` 方法生效。
3. **`final` / `static` 方法**：CGLIB 无法重写增强。
4. **类不归 Spring 管理**：自己 `new` 的对象没有代理。
5. **多线程**：连接绑定在当前线程 ThreadLocal 上，新线程的操作不在原事务中。

**异常与配置相关**
6. **异常被 catch 吞掉**：拦截器以为成功，照常提交。确需 catch 时可手动 `TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()`。
7. **异常类型不匹配**：默认只回滚 `RuntimeException` 和 `Error`，检查型异常需 `rollbackFor = Exception.class`。
8. **传播行为不当**：`NOT_SUPPORTED`、`NEVER`、`SUPPORTS`（外层无事务时）以非事务执行。
9. **数据库不支持事务**：如 MyISAM。
10. **事务管理器与数据源不对应**：多数据源时常见。

**自调用解决**：拆到另一个 Bean（最推荐）；`@Lazy` 注入自身代理；`exposeProxy = true` 后用 `AopContext.currentProxy()`；或改用 `TransactionTemplate`。

### 为什么 Spring 事务基于 ThreadLocal？
数据库事务是绑定在**同一个连接**上的：只有同一个 Connection 上执行的多条 SQL 才属于同一个事务。Service 方法内会调用多个 DAO / Mapper，它们之间并没有显式传递连接。

Spring 的做法是：事务开启时把连接（`ConnectionHolder`）放进 `TransactionSynchronizationManager` 中的 ThreadLocal（key 是 DataSource），之后同一线程里的 MyBatis、JdbcTemplate 通过 `DataSourceUtils.getConnection()` 都能拿到这个连接。好处是：
- 不需要在方法参数里一路传递 Connection，业务代码无感知。
- 不同线程（不同请求）的事务天然隔离，互不干扰。
- 挂起和恢复（`REQUIRES_NEW`、`NOT_SUPPORTED`）也就是把当前线程绑定的资源暂存起来，再绑定新的。

代价是：事务只在当前线程内有效，在事务方法里开新线程、用线程池或 `@Async` 执行的数据库操作都不在原事务中。

### 声明式事务有什么局限？大事务有什么问题？
`@Transactional` 用起来方便，但有几个局限：

- **粒度是整个方法**：方法里只要有一部分需要事务，整个方法都会在事务中执行，容易形成大事务。
- **事务边界不直观**：调用链上某处加了 `@Transactional`，下游方法可能不知不觉处于事务中。
- **受代理机制限制**：自调用、非 public、final、异常被吞等都会失效。
- **不可回滚的操作**：事务里的 RPC 调用、发 MQ、写缓存、写文件，数据库回滚了它们不会回滚，容易产生不一致；比如事务还没提交消息就被消费，消费方查不到数据。

大事务的危害：长时间占用数据库连接导致连接池耗尽；行锁持有时间变长，并发下锁等待和死锁增多；undo log 堆积；主从延迟增加；回滚代价大。

优化建议：
- 查询、远程调用、计算等放到事务外，事务里只保留必要的写操作；可以用 `TransactionTemplate` 精确控制边界。
- 需要在提交后执行的动作（发消息、删缓存）用 `@TransactionalEventListener(phase = AFTER_COMMIT)` 或 `TransactionSynchronization.afterCommit()`。
- 设置 `timeout`，纯读方法可以设置 `readOnly = true`。

## 常用注解
### Spring 常见注解有哪些？ | 高频
按用途分组记忆。

| 用途 | 注解 |
| --- | --- |
| 声明 Bean | `@Component`、`@Controller`、`@Service`、`@Repository`；`@Configuration` + `@Bean`；`@ComponentScan`、`@Import` |
| 依赖注入 | `@Autowired`、`@Qualifier`、`@Primary`、`@Resource`、`@Value` |
| 作用域与生命周期 | `@Scope`、`@Lazy`、`@DependsOn`、`@Conditional`；`@PostConstruct`、`@PreDestroy`（Boot 3 在 `jakarta.annotation` 包） |
| AOP 与事务 | `@Aspect`、`@Pointcut`、`@Before`、`@Around`；`@Transactional`；`@Async`、`@Scheduled`（需 `@EnableAsync`、`@EnableScheduling`） |
| Spring MVC | `@RestController`（= `@Controller` + `@ResponseBody`）、`@GetMapping` 等；取参 `@PathVariable`、`@RequestParam`、`@RequestBody`、`@RequestHeader`；`@RestControllerAdvice` + `@ExceptionHandler`；`@Validated` / `@Valid` |
| Spring Boot | `@SpringBootApplication`（= `@SpringBootConfiguration` + `@EnableAutoConfiguration` + `@ComponentScan`）、`@ConfigurationProperties`、`@ConditionalOnClass` / `@ConditionalOnMissingBean` / `@ConditionalOnProperty` |

### @Component、@Controller、@Service、@Repository 的区别
四个注解都会把类注册为 Bean，后三个都是 `@Component` 的派生注解（源码上标注了 `@Component`），对容器而言功能几乎一样，区别主要是分层语义：

- `@Controller`：表现层。配合 Spring MVC 时，被识别为处理器，其中的 `@RequestMapping` 方法会注册为请求映射。
- `@Service`：业务层，纯语义标识，没有额外行为。
- `@Repository`：持久层。配合 `PersistenceExceptionTranslationPostProcessor`，会把底层数据访问异常（如 JPA / Hibernate 异常）统一转换为 Spring 的 `DataAccessException` 体系。
- `@Component`：不属于以上分层的通用组件，如工具类、拦截器。

按分层使用，可读性更好，也便于用切点表达式按层做增强。MyBatis 的 Mapper 接口通常由 `@Mapper` / `@MapperScan` 注册，不依赖 `@Repository`。

### @Configuration 和 @Component 有什么区别？
两者都能让类成为 Bean，也都能在里面写 `@Bean` 方法，区别在于 `@Bean` 方法之间互相调用时的语义。

- `@Configuration`（默认 `proxyBeanMethods = true`，Full 模式）：配置类本身会被 CGLIB 增强。在配置类里调用另一个 `@Bean` 方法时，会被拦截并返回容器中已有的单例，保证单例语义。
- `@Component` 或 `@Configuration(proxyBeanMethods = false)`（Lite 模式）：不做 CGLIB 增强，`@Bean` 方法互调就是普通 Java 方法调用，每调用一次就 `new` 一个新对象，不是容器里的那个 Bean。

```java
@Configuration
public class AppConfig {
    @Bean public DataSource dataSource() { return new HikariDataSource(); }
    @Bean public JdbcTemplate jdbcTemplate() {
        return new JdbcTemplate(dataSource());   // Full 模式下返回的是同一个 DataSource 单例
    }
}
```

Spring Boot 的自动配置类普遍使用 `proxyBeanMethods = false`，减少 CGLIB 开销、加快启动；这时 Bean 之间的依赖通过方法参数注入，而不是方法互调。

### 读取配置文件中的值用哪个注解？ | 高频
单个值用 `@Value`，成组的结构化配置用 `@ConfigurationProperties`。

```java
@Value("${server.port:8080}")        // 冒号后是默认值
private Integer port;

@Value("#{T(java.lang.Math).random() * 100}")   // #{} 是 SpEL 表达式
private double random;

@ConfigurationProperties(prefix = "app.redis")
public class RedisProps {            // 需要 @Component 或 @EnableConfigurationProperties 注册
    private String host;
    private int port;
    // getter / setter
}
```

| 对比 | @Value | @ConfigurationProperties |
| --- | --- | --- |
| 绑定方式 | 逐个属性 | 按前缀批量绑定 |
| 松散绑定（`user-name` 对应 `userName`） | 不支持 | 支持 |
| SpEL | 支持 | 不支持 |
| 复杂类型（List、Map、嵌套对象） | 麻烦 | 天然支持 |
| 校验 | 不支持 | 配合 `@Validated` 支持 JSR-303 校验 |

注意：`@Value` 不能注入 `static` 字段；所在类必须是 Spring Bean 才生效。

## 设计模式与版本演进
### Spring 中用到了哪些设计模式？ | 高频
核心是工厂、单例、代理、模板方法、观察者，回答时挑 4 到 5 个各配一个具体类即可。

| 模式 | 体现 |
| --- | --- |
| 工厂模式 | `BeanFactory` / `ApplicationContext` 按 BeanDefinition 创建对象；`FactoryBean` |
| 单例模式 | Bean 默认 singleton，由 `DefaultSingletonBeanRegistry` 维护（容器级单例，非私有构造器写法） |
| 代理模式 | AOP、`@Transactional`、`@Async`、`@Cacheable`，JDK / CGLIB 动态代理 |
| 模板方法 | `JdbcTemplate`、`TransactionTemplate`；`refresh()` 定义固定流程，`onRefresh()` 留给子类 |
| 观察者模式 | `ApplicationEvent`、`@EventListener`，由 `ApplicationEventMulticaster` 广播 |
| 适配器模式 | MVC 的 `HandlerAdapter`；AOP 的 `AdvisorAdapter` 把 Advice 适配成 `MethodInterceptor` |
| 责任链模式 | `HandlerExecutionChain` 拦截器链；AOP 拦截器链 |
| 策略模式 | `Resource` 多种实现、`InstantiationStrategy`、各种 `PlatformTransactionManager` |
| 装饰器模式 | `BeanWrapper`、`TransactionAwareDataSourceProxy` |

### Spring 6.0 / Spring Boot 3.0 有哪些新特性？
Spring Framework 6.0 和 Spring Boot 3.0 于 2022 年 11 月发布，最大变化是基线升级和原生镜像支持。

- **基线升级**：最低 JDK 17；Java EE 迁移到 Jakarta EE 9+，包名 `javax.*` 改为 `jakarta.*`，升级时改动最大。
- **AOT 与 GraalVM 原生镜像**：构建期生成 Bean 定义代码和反射元数据，编译为 Native Image，启动毫秒级、内存更低；代价是构建慢，反射、动态代理受限，需要 hints。Spring Native 已合并进来。
- **可观测性**：基于 Micrometer Observation 统一指标和链路，Sleuth 迁移到 Micrometer Tracing。
- **HTTP Interface**：`@HttpExchange` 声明式 HTTP 客户端，类似 Feign。
- **ProblemDetail**：支持 RFC 7807 错误响应格式。
- **虚拟线程**：Spring 6.1 / Boot 3.2 起，JDK 21 上 `spring.threads.virtual.enabled=true` 启用；同版本新增 `RestClient`、`JdbcClient`。
- 自动配置注册文件从 `spring.factories` 改为 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`（Boot 2.7 引入，3.0 起旧方式不再支持自动配置）。

### Spring 中容易混淆的几组概念
- **IoC 与 DI**：IoC 是思想（控制权交给容器），DI 是实现方式（容器把依赖注入进来）。
- **BeanFactory 与 ApplicationContext**：前者是基础容器、懒加载；后者是子接口，启动时预实例化单例，并提供事件、国际化、资源加载等功能。
- **BeanFactory 与 FactoryBean**：前者是容器，后者是一个能生产对象的 Bean，`&name` 拿它本身。
- **BeanFactoryPostProcessor 与 BeanPostProcessor**：前者在实例化前改 BeanDefinition，后者在初始化前后处理 Bean 实例（AOP 代理在这里生成）。
- **@Autowired 与 @Resource**：前者 Spring 注解、先按类型；后者 Jakarta 标准注解、先按名称。
- **JDK 代理与 CGLIB**：前者基于接口，后者基于继承、不能代理 final；Spring Boot 2.x 起默认 CGLIB。
- **循环依赖**：只能解决单例 + 属性 / Setter 注入，构造器和 prototype 不行；三级缓存的第三级是为了按需生成早期 AOP 代理；Spring Boot 2.6+ 默认禁止循环引用。
- **事务失效**：多数是没走代理（自调用、非 public、final、未被管理）或异常没抛到拦截器（被 catch、检查型异常未配置 `rollbackFor`）。
- **REQUIRES_NEW 与 NESTED**：前者是独立的新事务和新连接；后者是同一事务内的保存点，外层回滚会连带内层。
- **自动装配**：Spring Boot 自动配置不是无条件装配，而是通过 `@Conditional` 系列注解按 classpath、已有 Bean、配置项等条件按需生效，用户自定义的 Bean 优先（`@ConditionalOnMissingBean`）。

