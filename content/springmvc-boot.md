## Spring MVC 核心
### SpringMVC是什么？
Spring MVC 是 Spring Framework 中基于 Servlet API 的 Web 框架（模块名 `spring-webmvc`），按 MVC 模式把 Web 层分为模型、视图、控制器，核心是前端控制器 `DispatcherServlet`。

- **Model**：封装业务数据，比如 `Model`、`ModelAndView` 中的数据，或者直接返回的对象。
- **View**：渲染页面，比如 Thymeleaf、JSP；前后端分离时通常不用视图，直接返回 JSON。
- **Controller**：接收请求、调用业务逻辑、返回结果，用 `@Controller` / `@RestController` 标注。

**核心特性**
- 前端控制器统一接收请求、分发给处理器，各组件职责单一、可替换。
- 基于注解的请求映射（`@RequestMapping` 系列），参数自动绑定、类型转换和校验（`@Valid`）。
- 通过 `HttpMessageConverter` 支持 RESTful 接口和 JSON 序列化（默认 Jackson）。
- 灵活的视图解析、拦截器、统一异常处理、文件上传、国际化等。

Spring 还有一个响应式 Web 框架 Spring WebFlux，基于 Reactor 和非阻塞 IO，和 Spring MVC 是并列关系。

### SpringMVC有哪些重要组件
核心组件都由 `DispatcherServlet` 调度：它通过 `HandlerMapping` 找处理器，通过 `HandlerAdapter` 执行处理器，再通过 `ViewResolver` 或 `HttpMessageConverter` 产出响应。

| 组件 | 作用 |
| --- | --- |
| `DispatcherServlet` | 前端控制器，请求入口，调度其他组件 |
| `HandlerMapping` | 按 URL、方法找到 Handler，返回 `HandlerExecutionChain`（Handler + 拦截器）；注解方式用 `RequestMappingHandlerMapping` |
| `HandlerAdapter` | 统一调用不同类型的 Handler；注解方式用 `RequestMappingHandlerAdapter` |
| Handler（Controller） | 真正处理业务的方法 |
| `HandlerInterceptor` | 在 Handler 执行前后、请求完成后插入逻辑 |
| `HandlerMethodArgumentResolver` / `HandlerMethodReturnValueHandler` | 解析方法参数 / 处理返回值 |
| `HttpMessageConverter` | 请求体、响应体与对象互转，JSON 用 `MappingJackson2HttpMessageConverter` |
| `ViewResolver` | 把逻辑视图名解析成 View |
| `HandlerExceptionResolver` | 处理 Handler 抛出的异常，支持 `@ExceptionHandler` |

### SpringMVC的执行流程是怎样的？ | 高频 | 农业银行、PDD、阿里云
一句话：请求 → `DispatcherServlet` → `HandlerMapping` 找到 Handler 和拦截器链 → `HandlerAdapter` 执行 Controller → 返回视图交给 `ViewResolver` 渲染，或者返回对象由 `HttpMessageConverter` 写成 JSON → 响应。

1. 请求先经过 Servlet 容器的 Filter 链，然后进入 `DispatcherServlet`，在 `doDispatch()` 中处理。
2. `DispatcherServlet` 遍历 `HandlerMapping`，根据 URL、请求方法等找到对应的 Handler，返回 `HandlerExecutionChain`（Handler + 拦截器列表）。找不到就返回 404。
3. 根据 Handler 类型找到支持它的 `HandlerAdapter`。
4. 依次执行拦截器的 `preHandle()`，任意一个返回 false 就终止请求。
5. `HandlerAdapter` 调用 Controller 方法：先用参数解析器把请求参数、路径变量、请求体（经 `HttpMessageConverter` 反序列化）绑定到方法参数，执行方法后再用返回值处理器处理返回值。
6. 倒序执行拦截器的 `postHandle()`。
7. 处理结果：
   - 有 `@ResponseBody` / `@RestController` 时，返回值在第 5 步就由 `HttpMessageConverter` 序列化为 JSON 写入响应体，不再经过视图解析。
   - 返回视图时，`ViewResolver` 把逻辑视图名解析成 View，View 用模型数据渲染页面。
   - 出现异常时由 `HandlerExceptionResolver` 处理（如 `@ExceptionHandler`）。
8. 倒序执行拦截器的 `afterCompletion()`，最后响应经 Filter 链返回客户端。

### Spring MVC为什么需要HandlerAdapter？
因为 Handler 的类型不统一，`HandlerAdapter` 用适配器模式把各种 Handler 的调用方式统一成 `handle()` 方法，让 `DispatcherServlet` 不需要知道 Handler 具体怎么执行。

**Handler 有多种形式**
- `@RequestMapping` 注解的方法 → `RequestMappingHandlerAdapter`，要做参数解析、数据绑定、返回值处理。
- 实现 `Controller` 接口的类 → `SimpleControllerHandlerAdapter`，调用 `handleRequest()`。
- 实现 `HttpRequestHandler` 接口的类 → `HttpRequestHandlerAdapter`。
- 函数式端点 `RouterFunction` → `HandlerFunctionAdapter`。

**好处**
- 如果没有适配器，`DispatcherServlet` 里要写一堆 `if (handler instanceof ...)`，每增加一种 Handler 都要修改它，违反开闭原则。
- 有了适配器，`DispatcherServlet` 只需要遍历所有 `HandlerAdapter`，调用 `supports(handler)` 找到支持的那个，再调用 `handle()`。新增 Handler 类型只需要新增一个适配器。

```java
public interface HandlerAdapter {
    boolean supports(Object handler);
    ModelAndView handle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception;
}
```

### SpringMvc有哪些常用注解？ | 高频 | 农业银行、交通银行、阿里云、携程
按用途分为声明控制器、请求映射、参数绑定、响应与异常四类。

| 用途 | 注解 |
| --- | --- |
| 声明控制器 | `@Controller`（返回值默认是视图名）、`@RestController`（= `@Controller` + `@ResponseBody`） |
| 请求映射 | `@RequestMapping`（可指定 `method`、`params`、`consumes`、`produces`，类和方法上都能用）；`@GetMapping`、`@PostMapping`、`@PutMapping`、`@DeleteMapping`、`@PatchMapping` |
| 参数绑定 | `@RequestParam`（查询 / 表单参数，`required`、`defaultValue`）、`@PathVariable`（如 `/users/{id}`）、`@RequestBody`（JSON 反序列化）、`@RequestHeader`、`@CookieValue`、`@ModelAttribute`、`@Valid` / `@Validated`、`@SessionAttributes` |
| 响应与异常 | `@ResponseBody`、`@ResponseStatus`、`@ExceptionHandler`、`@ControllerAdvice` / `@RestControllerAdvice`、`@CrossOrigin` |

易混点：`@ModelAttribute` 用在参数上是把请求参数绑定到对象（不写注解的对象参数默认也这样）；用在方法上则该方法在本控制器每个请求前执行，向模型添加数据。

### 什么是springmvc的父子容器
传统 Spring + Spring MVC 项目中有两个 IoC 容器：`ContextLoaderListener` 创建的根容器（父容器）管理 Service、DAO、数据源、事务等；`DispatcherServlet` 创建的 Web 容器（子容器）管理 Controller、视图解析器、HandlerMapping 等 Web 组件。子容器可以访问父容器的 Bean，父容器不能访问子容器的 Bean。

**为什么这样设计**
- 职责分离：业务层与 Web 层解耦，替换 Web 框架时业务层不受影响。
- 一个应用可以配置多个 `DispatcherServlet`，各自有子容器，共享同一个父容器中的业务 Bean。

**常见问题**
- 子容器查找 Bean 时先找自己，找不到再到父容器找，所以 Controller 可以注入 Service，Service 不能注入 Controller。
- 如果两个容器都扫描了全部包，Service 会在两个容器中各创建一份。子容器中的那份没有被父容器的事务配置增强，Controller 注入到的是它，导致 `@Transactional` 失效。所以子容器只扫描 `@Controller`，父容器排除 `@Controller`。
- 后置处理器只对所在容器的 Bean 生效，在父容器配置的 AOP 不会作用于子容器的 Controller。

**Spring Boot 中**：默认只有一个容器，`DispatcherServlet` 直接使用应用的 `ApplicationContext`，所以不存在父子容器问题。

## Web 开发实战
### Spring MVC中拦截器和过滤器的区别？ | 高频
Filter 是 Servlet 规范的组件，作用在 `DispatcherServlet` 之前，面向所有请求；Interceptor 是 Spring MVC 的组件，作用在 `DispatcherServlet` 内部、Handler 执行前后，面向映射到 Controller 的请求。

| 对比 | 过滤器 Filter | 拦截器 Interceptor |
| --- | --- | --- |
| 规范 | Servlet（`jakarta.servlet.Filter`，Boot 2.x 是 `javax.servlet`） | Spring MVC（`HandlerInterceptor`） |
| 实现 | Servlet 容器的 `FilterChain` 回调 | `DispatcherServlet.doDispatch()` 中调用 |
| 时机 | 进入 `DispatcherServlet` 前、响应返回后 | `preHandle`、`postHandle`、`afterCompletion` |
| 范围 | 所有请求，包括静态资源 | 只拦截找到了 Handler 的请求 |
| 信息 | 原始 request、response | 额外能拿到 `HandlerMethod`（可读方法注解）、`ModelAndView` |
| 典型用途 | 编码、CORS、XSS 过滤、Spring Security 认证 | 登录校验、权限、注解限流 / 幂等、耗时统计 |

**执行顺序**：Filter → `DispatcherServlet` → `preHandle` → Controller → `postHandle` → 视图渲染 → `afterCompletion` → Filter 返回。

**易错点**：Controller 抛异常时 `postHandle` 不执行，但 `preHandle` 返回 true 后 `afterCompletion` 一定执行，所以清理 ThreadLocal 放在这里。`@ControllerAdvice` 捕获不到 Filter 中的异常。

### 如何实现SpringMVC拦截器
实现 `HandlerInterceptor` 接口重写需要的方法，再通过 `WebMvcConfigurer.addInterceptors()` 注册并指定拦截路径。

**三个方法**（JDK 8 起都是 default 方法，按需重写）
- `preHandle`：Handler 执行前调用。返回 true 继续执行，返回 false 中断请求（需要自己写响应）。常用于登录校验、权限校验。
- `postHandle`：Handler 正常执行后、视图渲染前调用，可以修改 `ModelAndView`。对 `@ResponseBody` 接口来说，响应体此时已经写出，不能再修改。
- `afterCompletion`：整个请求完成后调用，无论是否异常都会执行（前提是 `preHandle` 返回了 true），适合清理资源、记录耗时。

多个拦截器时，`preHandle` 按注册顺序执行，`postHandle` 和 `afterCompletion` 倒序执行。

```java
@Component
public class LoginInterceptor implements HandlerInterceptor {
    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse resp, Object handler) {
        String token = req.getHeader("Authorization");
        if (token == null || !tokenService.verify(token)) {
            resp.setStatus(HttpStatus.UNAUTHORIZED.value());
            return false;
        }
        UserContext.set(tokenService.parse(token));     // 存入 ThreadLocal
        return true;
    }
    @Override
    public void afterCompletion(HttpServletRequest req, HttpServletResponse resp, Object handler, Exception ex) {
        UserContext.remove();                            // 防止线程复用导致数据串用和内存泄漏
    }
}

@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Autowired
    private LoginInterceptor loginInterceptor;
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(loginInterceptor)
                .addPathPatterns("/**")
                .excludePathPatterns("/login", "/static/**")
                .order(1);
    }
}
```

`tokenService` 这里省略了注入。如果拦截器用 `new` 创建再注册，它就不是 Spring 管理的对象，内部无法 `@Autowired` 注入 Bean，所以上例把它声明为 Bean 再注入。

### SpringBoot如何进行全局异常处理？
最常用的是 `@RestControllerAdvice` + `@ExceptionHandler`：在一个类中集中处理所有 Controller 抛出的异常，返回统一的响应格式。

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(BusinessException.class)
    public Result<Void> handleBiz(BusinessException e) {
        return Result.fail(e.getCode(), e.getMessage());
    }
    @ExceptionHandler(MethodArgumentNotValidException.class)   // @Valid 校验失败
    public Result<Void> handleValid(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().get(0).getDefaultMessage();
        return Result.fail(400, msg);
    }
    @ExceptionHandler(Exception.class)                          // 兜底
    public Result<Void> handleOther(Exception e) {
        log.error("系统异常", e);
        return Result.fail(500, "系统繁忙");
    }
}
```

**要点**
- `@RestControllerAdvice` = `@ControllerAdvice` + `@ResponseBody`。可以用 `basePackages` 或 `annotations` 限定作用范围。
- 匹配规则：按异常类型找最接近的处理方法，子类异常优先于父类异常。Controller 内部定义的 `@ExceptionHandler` 优先于全局的。
- 可以配合 `@ResponseStatus` 设置 HTTP 状态码，或者返回 `ResponseEntity`。

**其他方式**
- `ErrorController`：Spring Boot 默认由 `BasicErrorController` 处理 `/error` 路径，没有被处理的异常、404 等最终都会转到这里，返回默认的错误页或 JSON。可以自定义实现来改变默认的错误响应。
- 实现 `HandlerExceptionResolver` 接口：更底层的方式，`@ExceptionHandler` 就是由其中的 `ExceptionHandlerExceptionResolver` 支持的。
- Spring Boot 3.x 支持 RFC 9457 的 `ProblemDetail` 标准错误格式，可以通过 `spring.mvc.problemdetails.enabled=true` 开启。

**局限**：全局异常处理只能捕获 `DispatcherServlet` 内部（Controller、拦截器）抛出的异常，Filter 中的异常要在 Filter 里自己处理。

### SpringBoot如何进行跨域请求的处理？
浏览器的同源策略会拦截协议、域名、端口任一不同的跨域请求响应，服务端要通过 CORS 响应头声明允许跨域。Spring Boot 中有三种方式：`@CrossOrigin` 注解、`WebMvcConfigurer` 全局配置、注册 `CorsFilter`。

**1. `@CrossOrigin` 注解**：加在 Controller 类或方法上，作用范围小。
```java
@CrossOrigin(origins = "http://localhost:8081")
@RestController
public class UserController { }
```

**2. 全局配置**
```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOriginPatterns("https://*.example.com")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);       // 预检请求结果缓存 1 小时
    }
}
```

**3. CorsFilter**：注册一个 `CorsFilter` Bean，在过滤器层面处理，优先级最高。项目中有登录拦截器时更可靠：浏览器发出的 OPTIONS 预检请求不带认证信息，可能先被拦截器拒绝，导致跨域失败；用过滤器可以在拦截器之前处理掉预检请求。使用 Spring Security 时要在安全配置中开启 `cors()`。

**注意点**
- `allowCredentials(true)` 时不能用 `allowedOrigins("*")`，Spring 会直接报错，要列出具体的域名，或者用 Spring 5.3 起提供的 `allowedOriginPatterns`。
- 非简单请求（如 `Content-Type: application/json`、自定义请求头）会先发 OPTIONS 预检请求。
- 也可以不在应用里处理，由 Nginx 或网关统一添加 CORS 响应头，或者用反向代理让前后端同源。

## Spring Boot 基础与配置
### SpringBoot和Spring有什么区别？ | 高频 | 工商银行、字节、交通银行
Spring 是提供 IoC、AOP、事务、MVC 等能力的基础框架；Spring Boot 是构建在 Spring 之上的脚手架，用"约定优于配置"、自动配置、Starter 和内嵌服务器，让 Spring 应用可以开箱即用、直接 `java -jar` 运行。Spring Boot 不是替代 Spring，底层仍然是 Spring。

| 对比 | Spring | Spring Boot |
| --- | --- | --- |
| 配置 | 需要手动配置大量 XML 或 Java Config（DispatcherServlet、数据源、事务管理器、视图解析器等） | 根据依赖自动配置，只需在 `application.yml` 中覆盖少量参数 |
| 依赖管理 | 自己挑选各依赖的版本，容易冲突 | Starter 一次引入一组依赖，`spring-boot-dependencies` 统一管理版本 |
| 部署 | 打成 war 包部署到外部 Tomcat | 内嵌 Tomcat / Jetty，打成可执行 jar 直接运行（也可以打 war） |
| 运维 | 需要自己集成监控 | Actuator 提供健康检查、指标等生产级功能 |

**版本对应**
- Spring Boot 2.x 基于 Spring Framework 5.x，最低 Java 8，使用 `javax.*` 包。
- Spring Boot 3.x 基于 Spring Framework 6.x，最低 Java 17，迁移到 Jakarta EE 9+，包名从 `javax.*` 改为 `jakarta.*`，支持 GraalVM 原生镜像。
- Spring Boot 4.0（2025 年 11 月发布）基于 Spring Framework 7，仍以 Java 17 为最低版本。

### 可以通过哪些方式创建SpringBoot项目
常用的是 Spring Initializr 和 IDE 向导，本质上都是调用 Initializr 生成项目骨架。

- **Spring Initializr 网站**：在 start.spring.io 选择构建工具（Maven / Gradle）、语言（Java / Kotlin / Groovy）、Spring Boot 版本、打包方式和依赖，下载生成的项目。也可以用 `curl https://start.spring.io/starter.zip -d dependencies=web -o demo.zip` 在命令行生成。
- **IDE 集成**：IntelliJ IDEA（Ultimate 内置，Community 版需要插件）、VS Code 的 Spring Boot 插件、Spring Tools（基于 Eclipse）都提供新建 Spring Boot 项目的向导。
- **Spring Boot CLI**：`spring init --dependencies=web demo`。
- **手动搭建**：新建普通 Maven 项目，继承 `spring-boot-starter-parent`（或在 `dependencyManagement` 中导入 `spring-boot-dependencies`），添加需要的 Starter 和 `spring-boot-maven-plugin`，再写一个带 `@SpringBootApplication` 的启动类。

### SpringBoot有哪些核心注解？ | 高频 | 交通银行、PDD、携程
最核心的是启动类上的 `@SpringBootApplication`，它是 `@SpringBootConfiguration`、`@EnableAutoConfiguration`、`@ComponentScan` 三个注解的组合。

**启动相关**
- `@SpringBootConfiguration`：本质是 `@Configuration`。
- `@EnableAutoConfiguration`：通过 `@Import(AutoConfigurationImportSelector.class)` 导入自动配置类，`@AutoConfigurationPackage` 记录启动类所在包。
- `@ComponentScan`：默认扫描启动类所在包及子包，所以启动类放在根包下。

**配置与条件**
- `@Configuration`、`@Bean`、`@Import`：定义配置类和 Bean。
- `@ConfigurationProperties`（配合 `@EnableConfigurationProperties` / `@ConfigurationPropertiesScan` 注册）、`@Value`：读取配置。
- `@Conditional` 系列：`@ConditionalOnClass`、`@ConditionalOnMissingBean`、`@ConditionalOnProperty` 等，自动配置按需生效的基础。
- `@Profile`：Bean 只在某环境生效。
- `@AutoConfiguration`（2.7 起）：标注自动配置类，可用 `before` / `after` 控制顺序。

**其他常用**：`@RestController`、`@RestControllerAdvice`、`@EnableScheduling`、`@EnableAsync`、`@Transactional`、`@SpringBootTest`。

### properties，yml，yaml配置文件有什么区别，加载优先级是怎样的
`.properties` 是扁平的 `key=value` 格式；`.yml` 和 `.yaml` 是同一种格式的两种扩展名，用缩进表示层级，适合嵌套结构和列表。三者在 Spring Boot 中功能等价，同一位置同时存在时 `.properties` 的优先级高于 `.yml`。

```properties
server.port=8080
spring.datasource.url=jdbc:mysql://localhost:3306/db
```
```yaml
server:
  port: 8080
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/db
```

**格式差异**
- YAML 冒号后必须有空格，缩进只能用空格；支持列表和多文档（`---` 分隔，一个文件写多个 profile）。
- `@PropertySource` 默认只支持 `.properties`，加载 YAML 需自定义 `PropertySourceFactory`；它加载 properties 默认按 ISO-8859-1，含中文要指定 `encoding = "UTF-8"`。

**配置文件位置优先级**（从低到高，高的覆盖低的）：classpath 根目录 → classpath `/config` → 当前工作目录 → 工作目录 `/config` → `/config` 的直接子目录。同一位置 `application-{profile}` 覆盖 `application`。

**外部配置源整体优先级**（常用部分，从高到低）
1. 命令行参数 `--server.port=9090`
2. `SPRING_APPLICATION_JSON`
3. Java 系统属性 `-Dserver.port=9090`
4. 环境变量 `SERVER_PORT`
5. jar 外 `application-{profile}` → jar 外 `application`
6. jar 内 `application-{profile}` → jar 内 `application`
7. `@PropertySource` 引入的属性
8. `SpringApplication.setDefaultProperties` 默认属性

易错点：`@Value` 是读取方式而非配置来源，没有优先级之说；`bootstrap.yml` 属于 Spring Cloud，不是 Spring Boot 本身的机制。

### SpringBoot有哪些读取配置文件的方式？
常用的有 `@Value`、`@ConfigurationProperties`、`Environment` 三种；此外可以通过 `@PropertySource` 引入额外的配置文件，通过命令行参数、环境变量、`spring.config.location` / `spring.config.import` 指定外部配置。

**1. `@Value`**：注入单个值，支持默认值和 SpEL。
```java
@Value("${server.port:8080}")
private int port;
```

**2. `@ConfigurationProperties`**（推荐用于一组配置）
```java
@ConfigurationProperties(prefix = "app.sms")
public class SmsProperties {
    private String accessKey;
    private int timeout = 3000;
    // getter / setter；也可以用 record 配合构造器绑定
}
```
通过 `@EnableConfigurationProperties`、`@ConfigurationPropertiesScan` 或 `@Component` 注册。

| 对比 | `@Value` | `@ConfigurationProperties` |
| --- | --- | --- |
| 绑定方式 | 逐个属性 | 按前缀批量 |
| 松散绑定（`access-key` ↔ `accessKey`） | 有限支持 | 完全支持 |
| SpEL | 支持 | 不支持 |
| JSR-303 校验 | 不支持 | 支持（`@Validated`） |
| 复杂类型 | 不方便 | 支持 |

**3. `Environment`**：`environment.getProperty("server.port", Integer.class, 8080)`，代码中动态读取。

**4. `@PropertySource`**：引入额外 `.properties` 文件。

**5. 外部配置**：命令行 `--server.port=9090`；`--spring.config.location` 指定位置；`spring.config.import`（2.4 起）导入其他文件或 Nacos 等配置中心；`spring.profiles.active=dev` 切换环境。

**易错点**：两种注解都不能直接注入静态字段；运行时动态刷新需要 Spring Cloud 的 `@RefreshScope` 或配置中心客户端。

## 自动装配与启动原理
### SpringBoot自动装配原理？ | 高频 | 邮政储蓄银行、农业银行、淘天、字节
一句话：`@EnableAutoConfiguration` 导入 `AutoConfigurationImportSelector`，读取各 jar 声明的自动配置类，过滤后按条件创建 Bean。

**流程**
1. `@Import(AutoConfigurationImportSelector.class)` 是 `DeferredImportSelector`，在用户配置类处理完后才执行，所以用户的 Bean 优先，自动配置靠 `@ConditionalOnMissingBean` 让位。
2. 读取候选自动配置类：Spring Boot 2.7 起是 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`（每行一个全限定名）；2.6 及以前是 `META-INF/spring.factories` 中 `EnableAutoConfiguration` 的值。2.7 两种都支持，3.0 起只能用 `.imports`。
3. 去重并去掉 `exclude` / `spring.autoconfigure.exclude` 排除的类；再基于编译期生成的 `spring-autoconfigure-metadata.properties` 提前做 `@ConditionalOnClass` 过滤，不用加载类。
4. 解析剩余配置类，类上和 `@Bean` 方法上的条件注解决定最终注册哪些 Bean。

**常用条件注解**：`@ConditionalOnClass`（引入依赖才生效）、`@ConditionalOnMissingBean`（用户自定义了就不创建）、`@ConditionalOnProperty`（配置项满足才生效）。

**例子**：引入 `spring-boot-starter-web` 后类路径有了 `DispatcherServlet` 和 Tomcat，自动注册二者，属性来自 `ServerProperties`（`server.*`）。

**排查**：`debug=true` 打印条件评估报告，或访问 `/actuator/conditions`。

### Springboot自动装配用哪个注解？ | 高频
核心注解是 `@EnableAutoConfiguration`，平时不需要单独写，因为启动类上的 `@SpringBootApplication` 已经包含了它。

`@SpringBootApplication` 由三个注解组合而成：
- `@SpringBootConfiguration`：本质是 `@Configuration`，标明启动类也是一个配置类。
- `@EnableAutoConfiguration`：开启自动装配。它本身又包含 `@AutoConfigurationPackage`（把启动类所在的包注册为自动配置包，供 JPA 实体扫描等使用）和 `@Import(AutoConfigurationImportSelector.class)`（导入自动配置类）。
- `@ComponentScan`：扫描启动类所在包及其子包下的组件，并通过 `AutoConfigurationExcludeFilter` 避免把自动配置类当成普通组件扫描进来。

排除某个自动配置：`@SpringBootApplication(exclude = DataSourceAutoConfiguration.class)`，或者配置 `spring.autoconfigure.exclude`。

自动配置类本身用 `@AutoConfiguration` 标注（Spring Boot 2.7 起），它是 `@Configuration(proxyBeanMethods = false)` 的组合，并支持 `before` / `after` 指定顺序。

### SpringBootStarter的工作原理？ | 高频 | 农业银行、PDD、携程
Starter 是"依赖描述 + 自动配置"的组合：引入一个 Starter，就通过 Maven 依赖传递引入了某个功能所需的一组库，同时带来对应的自动配置类，Spring Boot 启动时按条件自动创建相关 Bean。

**两部分**
- **依赖聚合**：Starter 基本没有代码，主要是一个 pom。比如 `spring-boot-starter-web` 引入 Spring MVC、Jackson、内嵌 Tomcat、日志等。版本由 `spring-boot-dependencies` 统一管理，引入时不用写版本号。
- **自动配置**：官方的集中在 `spring-boot-autoconfigure` 模块，第三方一般自带 `xxx-spring-boot-autoconfigure`，在 `AutoConfiguration.imports`（2.7 起）或 `spring.factories`（2.6 及以前）中注册。

**生效过程**：引入 Starter → 类出现在类路径 → `AutoConfigurationImportSelector` 加载自动配置类 → `@ConditionalOnClass` 等条件满足 → 用 `@ConfigurationProperties` 绑定的配置创建默认 Bean → 用户自定义同类 Bean 时通过 `@ConditionalOnMissingBean` 让位。

**命名规范**：官方 `spring-boot-starter-xxx`，第三方 `xxx-spring-boot-starter`（如 `mybatis-spring-boot-starter`）。

### 实现一个 Spring Boot Starter 该如何做 | 高频
步骤：写属性类和自动配置类 → 用条件注解控制 Bean 的创建 → 在 `AutoConfiguration.imports` 中注册自动配置类 → 打包发布，使用方引入依赖即可。

**1. 建模块**：官方推荐拆成 `xxx-spring-boot-autoconfigure`（代码）和 `xxx-spring-boot-starter`（只有 pom），简单场景可合并。依赖 `spring-boot-autoconfigure`，可选 `spring-boot-configuration-processor` 生成配置元数据供 IDE 提示。

**2. 属性类 + 自动配置类**
```java
@ConfigurationProperties(prefix = "sms")
public class SmsProperties {
    private boolean enabled = true;
    private String accessKey;
    private String secretKey;
    // getter / setter
}

@AutoConfiguration
@ConditionalOnClass(SmsClient.class)
@ConditionalOnProperty(prefix = "sms", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(SmsProperties.class)
public class SmsAutoConfiguration {
    @Bean
    @ConditionalOnMissingBean           // 使用方自定义了 SmsClient 就不再创建
    public SmsClient smsClient(SmsProperties props) {
        return new SmsClient(props.getAccessKey(), props.getSecretKey());
    }
}
```

**3. 注册自动配置类**
- Spring Boot 2.7 / 3.x：`META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` 中写一行 `com.example.sms.SmsAutoConfiguration`。
- Spring Boot 2.6 及以前：`META-INF/spring.factories` 中写 `org.springframework.boot.autoconfigure.EnableAutoConfiguration=com.example.sms.SmsAutoConfiguration`。

**4. 打包发布**：发布到私服，使用方引入 `sms-spring-boot-starter`，配置 `sms.access-key` 即可注入 `SmsClient`。

**易错点**：自动配置类不要放在使用方 `@ComponentScan` 能扫到的包下，否则会被当成普通配置类，条件注解的顺序保证失效；第三方 Starter 命名不要以 `spring-boot` 开头。

### SpringBoot的启动流程？ | 高频
一句话：`SpringApplication.run()` 先创建 `SpringApplication`，再准备 Environment、创建上下文、执行 `refresh()`（自动配置、Bean 实例化、启动内嵌服务器），最后执行 Runner 并发布就绪事件。

**1. 创建 SpringApplication**：推断应用类型（SERVLET / REACTIVE / NONE）；从 `META-INF/spring.factories` 加载 `ApplicationContextInitializer` 和 `ApplicationListener`（这两类仍用 spring.factories，与自动配置类的注册文件不同）；推断主启动类。

**2. 执行 run()**
1. 通过 `SpringApplicationRunListener` 发布 `ApplicationStartingEvent`。
2. 准备 `Environment`：命令行参数、系统属性、环境变量、`application.yml`，发布 `ApplicationEnvironmentPreparedEvent`。
3. 打印 Banner，按类型创建 `ApplicationContext`。
4. 准备上下文：执行 `ApplicationContextInitializer`，注册启动类，发布 `ApplicationPreparedEvent`。
5. **`refresh()`**：解析配置类并导入自动配置类 → 注册 `BeanPostProcessor` → `onRefresh()` 创建内嵌 Tomcat → 实例化非懒加载单例 → `finishRefresh()` 启动服务器监听端口并发布 `ContextRefreshedEvent`。
6. 发布 `ApplicationStartedEvent`，执行 `ApplicationRunner` 和 `CommandLineRunner`。
7. 发布 `ApplicationReadyEvent`，对外服务；出错则发布 `ApplicationFailedEvent`。

## 生产实践
### Spring Boot 中的 Bean 是单例吗？会不会有线程安全问题？怎么解决 | 高频
默认是单例（singleton 作用域），每个容器中一个 Bean 定义只有一个实例，所有线程共享。单例本身不会导致线程安全问题，问题出在 Bean 有可变的成员变量并被多个线程同时修改时。

**为什么大多数 Bean 是安全的**：Controller、Service、DAO 一般是无状态的，成员变量只有注入的其他 Bean（初始化后不再改变），业务数据都在方法的局部变量里，局部变量在各自线程的栈上，不会共享。

**有问题的例子**
```java
@Service
public class CounterService {
    private int count;                 // 可变成员变量，多线程 count++ 会丢失更新
    public void incr() { count++; }
}
```

**解决办法**
- **设计成无状态**：首选。不要用成员变量保存请求相关的数据，改用方法参数和局部变量。
- **ThreadLocal**：每个线程一份数据，比如保存当前登录用户。线程池复用线程，用完必须 `remove()`。
- **并发工具**：用 `AtomicInteger`、`LongAdder`、`ConcurrentHashMap` 替代普通类型和集合，或者用 `synchronized` / `ReentrantLock` 保护临界区。
- **不可变对象**：成员变量声明为 `final` 且不对外提供修改。
- **改变作用域**：`@Scope("prototype")` 每次获取都创建新实例；Web 应用中可以用 `request` / `session` 作用域。注意 prototype Bean 注入到单例 Bean 中时只会注入一次，要每次拿新实例需要用 `ObjectProvider` 或 `@Lookup`。

**其他作用域**：singleton（默认）、prototype、request、session、application、websocket。

### SpringBoot项目如何替换自带的tomcat服务器？
`spring-boot-starter-web` 默认依赖 `spring-boot-starter-tomcat`。替换方法是在 pom 中把它排除，再引入 Jetty 或 Undertow 的 Starter，Spring Boot 会根据类路径自动配置对应的内嵌服务器。

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <exclusions>
        <exclusion>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-tomcat</artifactId>
        </exclusion>
    </exclusions>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-jetty</artifactId>
</dependency>
```

**原理**：`ServletWebServerFactoryAutoConfiguration` 中按 `@ConditionalOnClass` 判断类路径中有 Tomcat、Jetty 还是 Undertow 的类，创建对应的 `TomcatServletWebServerFactory` / `JettyServletWebServerFactory` / `UndertowServletWebServerFactory`。

**调整参数**
- 通用配置用 `server.*`，比如 `server.port`、`server.servlet.context-path`；服务器专属配置用 `server.tomcat.*`、`server.jetty.*`、`server.undertow.*`，例如 `server.tomcat.threads.max`。
- 代码定制：实现 `WebServerFactoryCustomizer<TomcatServletWebServerFactory>` 等。

**版本注意**：Spring Boot 4.0 移除了对 Undertow 的支持（Undertow 尚不兼容 Servlet 6.1），3.x 中 Tomcat、Jetty、Undertow 都可用。WebFlux 应用默认使用 Reactor Netty。

### SpringBoot怎么实现定时任务？
最简单的是 Spring 自带的 `@EnableScheduling` + `@Scheduled`；需要集群调度、分片、可视化管理时，使用 XXL-Job、ElasticJob、Quartz 等框架。

```java
@SpringBootApplication
@EnableScheduling
public class App { }

@Component
public class ReportTask {
    @Scheduled(cron = "0 0 * * * ?")          // 每小时整点执行
    public void hourly() { }

    @Scheduled(fixedRate = 5000)              // 每次开始执行后 5 秒再次执行
    public void rate() { }

    @Scheduled(fixedDelay = 5000, initialDelay = 10000)   // 上次执行结束 5 秒后再执行，启动 10 秒后首次执行
    public void delay() { }
}
```

**三种触发方式**
- `fixedRate`：按固定频率，从上一次开始执行的时间点计算间隔。
- `fixedDelay`：从上一次执行结束的时间点计算间隔。
- `cron`：Spring 的 cron 表达式有 6 位：秒 分 时 日 月 周（不支持年），比如 `0 0 2 * * ?` 是每天凌晨 2 点。可以用 `zone` 指定时区。

**注意点**
- 默认所有定时任务共用一个单线程的调度器，一个任务执行慢会阻塞其他任务。Spring Boot 2.1 起可以用 `spring.task.scheduling.pool.size` 调整线程数，或者自定义 `TaskScheduler` / 结合 `@Async`。
- 集群部署时每个实例都会执行一次，需要用分布式锁（如 ShedLock、Redisson）保证只有一个实例执行，或者改用分布式调度框架。
- 任务内部要捕获异常并记录日志，避免问题被吞掉。
- 需要动态修改执行时间时，可以实现 `SchedulingConfigurer` 注册 `Trigger`。

### SpringBoot如何实现热部署？
开发环境最常用的是 `spring-boot-devtools`：它在类路径文件变化时自动重启应用，速度比手动冷启动快。需要真正不重启地替换类时，可以用 JRebel 这类工具。

**devtools 原理**
- 使用两个类加载器：不变的第三方 jar 由 base 类加载器加载，项目自己的类由 restart 类加载器加载。
- 检测到类路径变化时，丢弃 restart 类加载器并新建一个重新加载项目类，第三方库不用重新加载，所以比冷启动快。严格来说这是快速重启，不是热替换。
- 静态资源和模板修改不需要重启，配合浏览器的 LiveReload 插件可以自动刷新页面。
- 还会禁用模板缓存等开发期不需要的缓存。

**使用**
```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-devtools</artifactId>
    <scope>runtime</scope>
    <optional>true</optional>
</dependency>
```
devtools 是根据类路径变化触发的，所以 IDE 中要让代码修改后重新编译：IntelliJ IDEA 中手动 Build，或者开启 "Build project automatically" 和运行时自动编译选项。以 `java -jar` 运行打包后的应用时 devtools 会自动禁用，不会影响生产环境。

**其他方式**
- IDE 自带的 HotSwap（JVM 的类重定义能力）：调试模式下可以替换方法体，但不支持新增方法、字段或修改类结构。
- JRebel：商业插件，不重启 JVM 就能重新加载修改后的类，支持结构变化。

### SpringBoot怎么配置多数据源？
有两种思路：按包或 Mapper 静态划分（每个数据源配一套 DataSource、SqlSessionFactory、事务管理器），或者用 `AbstractRoutingDataSource` 在运行时动态切换。实际项目中也常直接用 dynamic-datasource 这类开源组件。

**方式一：静态多数据源**（不同业务库分别访问）

```yaml
spring:
  datasource:
    primary:
      jdbc-url: jdbc:mysql://localhost:3306/primary_db   # HikariCP 绑定时用 jdbc-url 而不是 url
      username: root
      password: ${PRIMARY_DB_PASSWORD}
    secondary:
      jdbc-url: jdbc:mysql://localhost:3306/secondary_db
      username: admin
      password: ${SECONDARY_DB_PASSWORD}
```

```java
@Configuration
@MapperScan(basePackages = "com.example.mapper.primary", sqlSessionFactoryRef = "primarySqlSessionFactory")
public class PrimaryDataSourceConfig {
    @Primary @Bean
    @ConfigurationProperties(prefix = "spring.datasource.primary")
    public DataSource primaryDataSource() { return DataSourceBuilder.create().build(); }

    @Primary @Bean
    public SqlSessionFactory primarySqlSessionFactory(@Qualifier("primaryDataSource") DataSource ds) throws Exception {
        SqlSessionFactoryBean factory = new SqlSessionFactoryBean();
        factory.setDataSource(ds);
        return factory.getObject();
    }

    @Primary @Bean
    public PlatformTransactionManager primaryTransactionManager(@Qualifier("primaryDataSource") DataSource ds) {
        return new DataSourceTransactionManager(ds);
    }
}
// SecondaryDataSourceConfig 同理，扫描 com.example.mapper.secondary，不加 @Primary
```

要点：
- 自定义 DataSource 后 `DataSourceAutoConfiguration` 因 `@ConditionalOnMissingBean` 不再生效，每个数据源要自己配。
- `@Primary` 标记默认数据源，其余用 `@Qualifier` 注入；事务指定管理器：`@Transactional(transactionManager = "secondaryTransactionManager")`。
- 直接绑定 `HikariDataSource` 时属性名是 `jdbc-url`；写 `url` 需先绑定 `DataSourceProperties` 再 `initializeDataSourceBuilder()`。

**方式二：动态数据源**（读写分离、多租户）：继承 `AbstractRoutingDataSource` 重写 `determineCurrentLookupKey()` 从 ThreadLocal 取 key；真实数据源放进 `targetDataSources`；自定义注解（如 `@DS("slave")`）+ AOP 在方法前写入 key、结束后清除。

**易错点**
- 事务开始后切换数据源不生效，切换切面必须在事务切面之前执行。
- 跨数据源写不能靠本地事务保证一致，需要 Seata 等分布式事务或业务补偿。
- 开源方案：dynamic-datasource-spring-boot-starter（`@DS` 切换）；分库分表用 ShardingSphere。

### 什么是SpringBoot Actuator（监视器）？
Actuator 是 Spring Boot 的生产级监控管理功能，引入 `spring-boot-starter-actuator` 后通过 HTTP 或 JMX 暴露端点（前缀 `/actuator`），查看健康、指标、配置、日志级别等。

| 端点 | 作用 |
| --- | --- |
| `health` | 健康检查，汇总数据库、Redis、磁盘状态；提供 Kubernetes liveness / readiness 探针 |
| `info` | 版本、构建、Git 信息 |
| `metrics` / `prometheus` | 基于 Micrometer 的 JVM、GC、HTTP 耗时等指标；后者需 `micrometer-registry-prometheus` |
| `loggers` | 运行时查看和修改日志级别 |
| `env`、`configprops` | 配置属性 |
| `beans`、`mappings`、`conditions` | Bean、请求映射、自动配置条件评估 |
| `threaddump`、`heapdump` | 线程转储、堆转储 |
| `shutdown` | 优雅关闭，默认禁用 |

**暴露配置**：Spring Boot 2.x 起 HTTP 默认只暴露 `health`（2.x 早期版本还包括 `info`，2.5 起默认只有 `health`），其他端点需配置：
```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      show-details: when-authorized
```

**安全**：`env`、`heapdump`、`configprops` 会泄露配置、密钥和内存数据。生产只暴露必要端点，用 Spring Security 保护，或用 `management.server.port` 分离管理端口只在内网开放。常见搭配 Prometheus + Grafana 或 Spring Boot Admin。

### SpringBoot如何优雅停机？
优雅停机是指应用关闭时先停止接收新请求，等正在处理的请求完成后再释放资源退出，避免请求中断和数据不一致。Spring Boot 2.3 起内置支持，3.4 起默认开启。

```yaml
server:
  shutdown: graceful                    # 2.3 ~ 3.3 默认是 immediate，3.4 起默认 graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s     # 每个生命周期阶段的最长等待时间，默认 30s
```

**过程**
1. 进程收到 SIGTERM（`kill PID`、`docker stop`、Kubernetes 删除 Pod）后，JVM 执行 Spring 注册的 shutdown hook，开始关闭 ApplicationContext。
2. Web 服务器停止接收新请求：Tomcat、Jetty、Reactor Netty 在网络层停止接收连接，Undertow 对新请求返回 503。
3. 等待正在处理的请求完成，超过 `timeout-per-shutdown-phase` 就强制结束。
4. 依次停止其他 `SmartLifecycle` 组件，销毁 Bean（执行 `@PreDestroy`、`DisposableBean`），关闭连接池等资源。

**注意点**
- 必须用 `kill PID`（SIGTERM）停止进程，`kill -9` 不会触发 shutdown hook，优雅停机不会生效。
- 自己的线程池要在销毁时 `shutdown()` 并 `awaitTermination()`；Spring 管理的 `ThreadPoolTaskExecutor` 可以设置 `setWaitForTasksToCompleteOnShutdown(true)` 和等待时间。
- 微服务场景下还要先从注册中心下线实例，等调用方刷新地址列表后再停机，否则调用方仍会把请求发过来。
- Kubernetes 中，Pod 的 `terminationGracePeriodSeconds`（默认 30s）要大于应用的停机等待时间，常配合 `preStop` hook 先 sleep 几秒，等流量摘除。
