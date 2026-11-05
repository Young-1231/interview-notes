## 框架定位与对比
### mybatis有哪些优缺点？ | 工商银行
MyBatis 是一个半自动的持久层框架：SQL 由开发者自己写，框架负责参数绑定、执行 SQL 和把结果集映射成对象，省掉了 JDBC 的样板代码。

**优点**
- SQL 完全可控：可以针对复杂查询、多表关联、索引做精细优化，适合业务复杂、对性能敏感的系统。
- SQL 和代码解耦：SQL 集中写在 XML（或注解）里，便于统一管理和审查。
- 消除 JDBC 样板代码：不用手动获取连接、设置参数、遍历 ResultSet、关闭资源。
- 映射灵活：通过 `resultMap` 支持字段名和属性名不一致、一对一、一对多等复杂映射；也可以直接返回 Map。
- 动态 SQL：`<if>`、`<where>`、`<foreach>` 等标签按条件拼接 SQL。
- 学习成本低，和 Spring 集成方便（mybatis-spring、mybatis-spring-boot-starter）。

**缺点**
- 单表 CRUD 也要手写 SQL，工作量大（MyBatis-Plus 解决了这一点）。
- SQL 依赖具体数据库方言，换数据库时 SQL 可能要改，移植性不如 Hibernate。
- 项目大时 XML 文件多，SQL 写错要到运行时才发现。
- 用 `${}` 不当会有 SQL 注入风险。

### mybatis-plus和mybatis有什么区别？
MyBatis-Plus（MP）是在 MyBatis 基础上的增强工具，只做增强不做改变：原有 MyBatis 的 XML、注解写法全部照常可用，额外提供通用 CRUD 和一批常用插件。

| 对比 | MyBatis | MyBatis-Plus |
| --- | --- | --- |
| 单表 CRUD | 要自己写 SQL | Mapper 继承 `BaseMapper<T>` 即可获得 `insert`、`selectById`、`updateById` 等方法；Service 层有 `IService` / `ServiceImpl` |
| 条件查询 | XML 动态 SQL | `QueryWrapper` / `LambdaQueryWrapper` 条件构造器，Lambda 写法避免硬编码列名 |
| 分页 | 自己写 limit 或用 PageHelper | 内置分页插件（`PaginationInnerInterceptor`） |
| 其他 | 无 | 代码生成器、逻辑删除（`@TableLogic`）、乐观锁（`@Version`）、字段自动填充、主键策略（默认 `ASSIGN_ID`，雪花算法） |

选择：简单 CRUD 多的业务用 MP 效率高；复杂 SQL 仍然写在 XML 里，两者可以混用。

```java
List<User> users = userMapper.selectList(
    new LambdaQueryWrapper<User>()
        .eq(User::getStatus, 1)
        .like(StringUtils.hasText(name), User::getName, name)
        .orderByDesc(User::getCreateTime));
```

### Mybatis和Hibernate有哪些区别？
MyBatis 是半自动 ORM，SQL 自己写；Hibernate 是全自动 ORM（JPA 规范的主流实现），根据对象映射自动生成 SQL。

| 对比 | MyBatis | Hibernate |
| --- | --- | --- |
| ORM 程度 | 半自动，映射 SQL 结果和对象 | 全自动，映射对象和表，操作对象即可 |
| SQL | 手写，可精细优化 | 自动生成，也可以写 HQL/JPQL 或原生 SQL |
| 数据库移植性 | 差，SQL 和方言绑定 | 好，通过 Dialect 适配不同数据库 |
| 对象管理 | 无实体状态管理 | 有持久化上下文：实体状态、脏检查（修改对象自动生成 update）、级联、延迟加载 |
| 学习和调优 | 简单，SQL 直观 | 门槛较高，生成的 SQL 不直观，容易出现 N+1 查询 |
| 适用场景 | 业务复杂、需求变化快、对 SQL 性能要求高（国内互联网主流） | 业务模型稳定、以单表 CRUD 为主、需要跨数据库 |

两者都有一级、二级缓存。不能简单说 Hibernate 性能差，性能问题多来自生成的 SQL 不可控，复杂查询时调优比 MyBatis 难。

## SQL 映射与动态 SQL
### #{} 和 ${} 的区别是什么？MyBatis 是如何防止 SQL 注入的 | 高频 | 工商银行、农业银行、腾讯
`#{}` 是预编译占位符，`${}` 是字符串替换。传参数一律用 `#{}`；`${}` 只用于表名、列名、排序字段这类不能用占位符的地方，并且必须做白名单校验。

**`#{}`**
- MyBatis 把它解析成 `?`，通过 JDBC 的 `PreparedStatement` 的 `setXxx()` 设置参数。
- SQL 结构先编译好，参数只作为值传给数据库，不参与 SQL 语法解析，所以注入的 `' OR '1'='1` 只会被当成普通字符串，这就是防注入的原理。
- 自动处理类型转换（通过 `TypeHandler`），字符串不用自己加引号。

**`${}`**
- 在生成 SQL 时把参数值原样拼进 SQL 文本，不做转义。
- 有 SQL 注入风险，比如 `ORDER BY ${col}` 传入 `id; DROP TABLE user`。
- 必须用的场景：动态表名（分表）、动态列名、`ORDER BY` 字段和方向，因为占位符只能代表值，不能代表标识符。

```xml
<!-- 安全：参数走占位符 -->
<select id="findByName" resultType="User">
  SELECT * FROM user WHERE name = #{name}
</select>
<!-- 排序字段只能用 ${}，调用前要在代码里校验 sortCol 属于允许的列名 -->
<select id="listSorted" resultType="User">
  SELECT * FROM user ORDER BY ${sortCol}
</select>
```

**补充**
- 模糊查询不要写 `'%${name}%'`，用 `CONCAT('%', #{name}, '%')`，或者在 Java 里拼好 `%` 再传给 `#{}`。
- `IN` 查询用 `<foreach>` 生成多个 `#{}`，不要把逗号拼接的字符串塞进 `${}`。

### MyBatis查询有哪几种方式 | 高频
最常用的是 Mapper 接口代理 + XML，其次是注解方式；另外还有直接通过 `SqlSession` 按 statement ID 调用、Provider 动态生成 SQL，以及 MyBatis-Plus 的条件构造器。

**1. Mapper 接口 + XML**（最常用，适合复杂 SQL）
```java
UserMapper mapper = sqlSession.getMapper(UserMapper.class);  // Spring 中直接注入 Mapper
User user = mapper.selectById(1);
```
```xml
<mapper namespace="com.example.mapper.UserMapper">
  <select id="selectById" resultType="com.example.entity.User">
    SELECT * FROM user WHERE id = #{id}
  </select>
</mapper>
```

**2. 注解方式**（适合简单 SQL）
```java
@Select("SELECT * FROM user WHERE id = #{id}")
User selectById(Integer id);
```

**3. SqlSession 直接调用**：`sqlSession.selectOne("com.example.mapper.UserMapper.selectById", 1)`，是早期写法，字符串 ID 容易写错。

**4. Provider 注解**：`@SelectProvider(type = UserSqlProvider.class, method = "build")`，用 Java 代码（如 `SQL` 构建类）动态生成 SQL。

**5. MyBatis-Plus**：`BaseMapper` 的通用方法加 `LambdaQueryWrapper`。

**按返回形式**还可以分为：返回单个对象、`List`、`Map`（用 `@MapKey` 指定 key 列）；大结果集用 `ResultHandler` 逐行处理，或者返回 `Cursor<T>` 流式读取，避免一次性把数据全部载入内存。

### xml映射文件中有哪些常见的标签？
映射文件的标签分三类：CRUD 语句标签、结果映射与复用标签、动态 SQL 标签。

**语句标签**
- `<select>`、`<insert>`、`<update>`、`<delete>`：`id` 对应 Mapper 方法名，常用属性有 `parameterType`、`resultType` / `resultMap`。
- `<insert>` 的 `useGeneratedKeys="true" keyProperty="id"` 可以回填自增主键；`<selectKey>` 用于不支持自增的数据库（如 Oracle 序列）获取主键。

**映射与复用**
- `<resultMap>`：定义列和属性的映射，子标签有 `<id>`、`<result>`、`<association>`（一对一）、`<collection>`（一对多）、`<discriminator>`（按列值选择映射）。
- `<sql>` + `<include>`：抽取可复用的 SQL 片段，比如公共列列表。
- `<cache>` / `<cache-ref>`：开启当前 namespace 的二级缓存 / 引用其他 namespace 的缓存。
- `<parameterMap>`：旧的参数映射方式，已经废弃，现在用 `parameterType` 和 `#{}` 内联参数代替。

**动态 SQL**
- `<if>`：条件成立才拼接。
- `<choose>` / `<when>` / `<otherwise>`：多选一，相当于 switch。
- `<where>`：有条件时才加 WHERE，并去掉开头多余的 AND / OR。
- `<set>`：用于 UPDATE，去掉末尾多余的逗号。
- `<trim>`：自定义前缀、后缀和要去掉的内容，`<where>`、`<set>` 都可以用它实现。
- `<foreach>`：遍历集合，常用于 `IN (...)` 和批量插入。
- `<bind>`：创建一个变量，比如拼接模糊查询的 `%`。

### mybatis的动态sql有什么好处？举例说明？动态sql的执行原理是什么？ | 邮政储蓄银行、网易、蚂蚁
动态 SQL 让一条映射语句根据参数在运行时生成不同的 SQL，避免在 Java 里手工拼字符串，也避免为每种条件组合写一条 SQL。原理是把标签解析成 SqlNode 树，执行时用 OGNL 对参数求值，拼出最终 SQL。

**好处**
- 多条件查询、选择性更新、批量操作只需写一条语句。
- 不用处理多余的 AND、逗号等拼接细节。
- 参数仍然走 `#{}` 预编译，比手工拼接安全。

**例子**：多条件查询和批量查询
```xml
<select id="search" resultType="User">
  SELECT * FROM user
  <where>
    <if test="name != null and name != ''">AND name LIKE CONCAT('%', #{name}, '%')</if>
    <if test="status != null">AND status = #{status}</if>
    <if test="ids != null and ids.size() > 0">
      AND id IN
      <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
    </if>
  </where>
</select>
```

**执行原理**
1. 启动解析阶段：`XMLScriptBuilder` 把含动态标签（或含 `${}`）的语句解析成一棵 `SqlNode` 树（`IfSqlNode`、`WhereSqlNode`、`ForEachSqlNode` 等，根节点是 `MixedSqlNode`），封装为 `DynamicSqlSource`。不含动态内容的语句解析成 `RawSqlSource`，启动时就确定了 SQL。
2. 执行阶段：调用 `getBoundSql(参数)`，各 `SqlNode` 依次 `apply`，`<if test>` 等表达式用 OGNL 对参数求值，满足条件的片段追加到 `DynamicContext` 中，同时完成 `${}` 的文本替换。
3. 拼好的 SQL 再交给 `SqlSourceBuilder`，把 `#{}` 替换成 `?` 并记录参数映射，得到 `BoundSql`，最后交给 `PreparedStatement` 执行。

### Mybatis中Dao接口和xml文件有什么作用？Dao接口支持重载吗？
Dao（Mapper）接口声明方法，XML 提供方法对应的 SQL；二者通过"namespace = 接口全限定名、语句 id = 方法名"绑定。接口方法可以重载，但所有同名重载方法只能对应同一条 SQL 语句。

**绑定原理**
- XML 的 `namespace` 写接口全限定名，每条语句的 `id` 写方法名，MyBatis 启动时把每条语句解析成 `MappedStatement`，以 `namespace.id` 为 key 存入 `Configuration`。
- 接口没有实现类。`getMapper()` 通过 `MapperProxyFactory` 用 JDK 动态代理生成代理对象；调用方法时 `MapperProxy` 用"接口全限定名.方法名"找到 `MappedStatement`，再交给 `SqlSession` 执行。

**重载**
- 语句的 key 只有"接口名.方法名"，不包含参数类型，所以 XML 里同一个 namespace 下不能有两个相同的 id，启动时会报 `Mapped Statements collection already contains value`。
- 可以在接口中声明重载方法，但它们都会映射到同一条 SQL。要让它们表现不同，只能在这条 SQL 里用动态 SQL 判断参数（如 `_parameter`、`@Param` 指定的名字）。
- 实际开发中不推荐重载 Mapper 方法，用不同的方法名更清晰。

**其他注意点**：Mapper 接口方法有多个参数时，用 `@Param("name")` 命名，XML 里才能用 `#{name}` 引用。

## 执行原理与高级特性
### mybatis的执行机制是怎样的？ | 高频
一句话：启动时把配置和映射文件解析成 `Configuration`，运行时 Mapper 代理把方法调用转给 `SqlSession`，再由 `Executor` → `StatementHandler` → JDBC 执行 SQL，最后 `ResultSetHandler` 把结果映射成对象。

**启动阶段**：`SqlSessionFactoryBuilder` 解析 `mybatis-config.xml` 和 Mapper XML / 注解，生成全局唯一的 `Configuration`，每条 SQL 对应一个 `MappedStatement`；再创建线程安全的 `SqlSessionFactory`，应用中只需一个。

**执行阶段**
1. `openSession()` 获取 `SqlSession` 并创建 `Executor`。`SqlSession` 非线程安全，用完关闭；Spring 中注入的是线程安全的 `SqlSessionTemplate`，为当前事务绑定 SqlSession。
2. `getMapper()` 返回 JDK 动态代理，`MapperProxy` 按"接口全限定名.方法名"找到 `MappedStatement`，转成 `sqlSession.selectList/update` 等调用。
3. `Executor` 调度和缓存：开二级缓存时外层是 `CachingExecutor`，再查一级缓存，未命中查库。基础执行器有 `SimpleExecutor`（默认）、`ReuseExecutor`（复用 Statement）、`BatchExecutor`（批量）。
4. `StatementHandler` 创建 `PreparedStatement`，`ParameterHandler` 用 `TypeHandler` 设参后执行。
5. `ResultSetHandler` 按 `resultType` / `resultMap` 映射结果。
6. 非自动提交模式下增删改需 `commit()`，最后 `close()`。

### mybatis缓存机制是怎么样的，两级缓存分别在什么时候用 | 高频
MyBatis 有两级缓存：一级缓存是 SqlSession 级别，默认开启；二级缓存是 namespace（Mapper）级别，需要在映射文件里显式开启。查询顺序是：二级缓存 → 一级缓存 → 数据库。

**一级缓存（本地缓存）**
- 范围是同一个 `SqlSession`，底层是 `BaseExecutor` 里的 `PerpetualCache`（HashMap）；key 由 statement ID、分页参数、SQL、参数值、环境 ID 组成。
- 增删改、`commit()`、`rollback()`、`clearCache()`、关闭 SqlSession 时清空；`localCacheScope` 改为 `STATEMENT` 等于关闭。
- 易错点：Spring 中没有事务时每次 Mapper 调用都新开 SqlSession，一级缓存基本不起作用；同一个 `@Transactional` 内才生效。

**二级缓存**
- 范围是同一个 namespace，跨 SqlSession 共享。
- `cacheEnabled` 默认 true，但还需映射文件加 `<cache/>`（或 `@CacheNamespace`）；单条语句可 `useCache="false"`。
- 默认 LRU、最多 1024 个对象；`readOnly=false` 时序列化返回副本，实体需实现 `Serializable`。
- SqlSession `commit()` 或 `close()` 后才写入；同 namespace 增删改会清空；可实现 `Cache` 接口接入 Redis。

**什么时候用**：一级缓存自动生效，适合同一事务内重复查询。二级缓存只适合读多写少、实时性要求低、只在单表 namespace 内修改的数据；生产一般不开，因为别的 namespace 改数据不会清空这里的缓存，多实例间也不一致，通常改在业务层用 Redis。

### mybatis支持延迟加载吗？原理是什么？
支持。延迟加载只对 `<association>` 和 `<collection>` 里的嵌套查询（`select` 属性指定的另一条语句）生效：查主对象时先不查关联对象，等真正访问关联属性时才执行那条查询。原理是返回主对象的动态代理，拦截 getter 触发加载。

**配置**
- 全局：`lazyLoadingEnabled=true`（默认 false）；`aggressiveLazyLoading=false`（3.4.1 起默认 false，为 true 时访问任意属性都会加载全部延迟属性）。
- 单个关联：`fetchType="lazy"` 或 `"eager"`，优先级高于全局配置。

```xml
<resultMap id="userMap" type="User">
  <id column="id" property="id"/>
  <collection property="orders" column="id" fetchType="lazy"
              select="com.example.mapper.OrderMapper.selectByUserId"/>
</resultMap>
```

**原理**
1. 映射结果时，如果有延迟加载的属性，MyBatis 用代理工厂（默认 Javassist，3.5.10 起 CGLIB 已被标记为废弃）为结果对象创建子类代理，并把待执行的嵌套查询保存在 `ResultLoaderMap` 中。
2. 调用代理对象的 getter（如 `getOrders()`）时，拦截器发现该属性还没加载，就执行对应的嵌套查询，把结果 set 进去，再返回。
3. 调用 `equals`、`clone`、`hashCode`、`toString` 默认会触发加载全部延迟属性（由 `lazyLoadTriggerMethods` 配置）。

**注意**：嵌套查询有 N+1 问题（1 条主查询 + N 条关联查询），延迟加载只是把它推迟了。一次就要拿全部数据时，用连接查询 + 嵌套结果映射更高效。

### Mybatis中的插件是如何运行的？怎样自己编写一个插件？
MyBatis 插件就是拦截器：它只能拦截四大核心对象 `Executor`、`StatementHandler`、`ParameterHandler`、`ResultSetHandler` 的方法。这四个对象创建时，`InterceptorChain.pluginAll()` 用 JDK 动态代理把它们层层包装，调用被拦截的方法时先进入插件逻辑。

| 对象 | 可拦截方法 |
| --- | --- |
| `Executor` | `update`、`query`、`commit`、`rollback` 等 |
| `StatementHandler` | `prepare`、`parameterize`、`batch`、`update`、`query` |
| `ParameterHandler` | `getParameterObject`、`setParameters` |
| `ResultSetHandler` | `handleResultSets`、`handleOutputParameters` |

**运行原理**
1. 插件按配置顺序存入 `InterceptorChain`。
2. 创建四大对象时依次调用 `plugin()`，默认 `Plugin.wrap(target, this)`：目标实现了 `@Signature` 声明的接口就生成 JDK 代理，否则返回原对象。
3. 多个插件形成多层代理，后配置的在最外层、最先执行。
4. `Plugin.invoke()` 判断方法在签名中就调用 `intercept(invocation)`，插件内 `invocation.proceed()` 继续原方法。

**编写步骤**：实现 `Interceptor` 重写 `intercept()`（3.5.2 起 `plugin()`、`setProperties()` 有默认实现）；用 `@Intercepts` + `@Signature` 声明类型、方法名、参数类型；XML 用 `<plugins>` 注册，Spring Boot 中声明为 Bean 即可自动注册。

```java
@Intercepts({@Signature(type = StatementHandler.class, method = "prepare",
        args = {Connection.class, Integer.class})})
public class SlowSqlInterceptor implements Interceptor {
    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        long start = System.currentTimeMillis();
        try {
            return invocation.proceed();
        } finally {
            StatementHandler handler = (StatementHandler) invocation.getTarget();
            long cost = System.currentTimeMillis() - start;
            // 记录 handler.getBoundSql().getSql() 和耗时
        }
    }
}
```

注意这里只统计了 `prepare` 的耗时，真正的执行耗时应拦截 `query` / `update`。常见应用：PageHelper / MyBatis-Plus 分页、慢 SQL 监控、数据权限、字段加解密、多租户。

### mybatis连接池是什么？
连接池负责预先创建并复用数据库连接，避免每次执行 SQL 都要做 TCP 连接和数据库认证。MyBatis 自带简单的连接池实现，但实际项目里一般由 Spring Boot 管理数据源，默认是 HikariCP。

**MyBatis 内置的数据源类型**（`<dataSource type="...">`）
- `UNPOOLED`：`UnpooledDataSource`，每次请求都新建连接，用完关闭。
- `POOLED`：`PooledDataSource`，维护空闲连接和活跃连接两个列表，可以配置最大活跃连接数（`poolMaximumActiveConnections`，默认 10）、最大空闲连接数、获取连接的最长等待时间等。调用 `close()` 时连接归还到池中而不是真正关闭，这是通过代理 Connection 实现的。
- `JNDI`：从应用服务器的 JNDI 上下文获取数据源。

**和 Spring Boot 集成时**：MyBatis 直接使用容器里的 `DataSource` Bean。Spring Boot 2.0 起默认连接池是 HikariCP，也可以换成 Druid（自带监控和 SQL 防火墙）等。连接池的关键参数有最大连接数、最小空闲连接数、连接超时、空闲超时和连接最大存活时间。
