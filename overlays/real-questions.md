# 114 道面试真题

格式:`序号. 题目 | 主题id[,主题id] | 题目关键字(可选,用来直达具体题)`
关键字要在对应主题里能匹配到题目标题,匹配不到构建会报错。

1. List、Set、Map的区别 | java-collection
2. wait和sleep的区别 | juc | wait和sleep
3. JVM的堆分为哪几部分 | jvm | 堆内存分为几个部分
4. 消息中间件有什么作用，哪些场景下需要用到异步？ | mq
5. 如何对当日产生的上百万条数据的日志信息做删除？ | scenario,mysql
6. IO多路复用机制是什么 | network,os,redis
7. 事务的四大特性（ACID） | mysql | 事务的四大特性
8. Spring依赖注入的三种方式 | spring
9. springAOP中before和after是干什么的，切点的注解？ | spring
10. springboot怎么加载类？ | springmvc-boot,jvm
11. 脏读是什么，脏读发生在哪种隔离级别下 | mysql | 并发事务会出现什么问题
12. Java的锁的优化 | juc | 锁升级过程
13. 线程的状态 | juc | 线程的状态
14. @RequestMapping注解作用，提交方式除了get和post还有哪些 | springmvc-boot,network
15. MVC的流程 | springmvc-boot
16. Redis数据结构用过哪些 | redis
17. spring的Bean生命周期 | spring
18. 讲讲csrf原理 | network
19. 用过linux吗，查看环境变量的指令、查看当前用户的指令、755表示什么权限、改变路径的指令？ | linux
20. 介绍一下MVC机制 | springmvc-boot
21. 了解国密吗，对称和非对称常见有哪些打过ctf吗，主要做哪个方向（web） | network
22. 实习项目中最困难的事？ | hmdp,interviews
23. 代码量 | interviews
24. 内存溢出 | jvm | OOM会发生在哪些区域
25. java项目几个人做的？前后端传值需要接口，接口规范如何制定？ | hmdp,scenario
26. 前端框架使用哪个，实习期间遇到vue的问题有哪些，如何解决？ | interviews
27. synchronize | juc | synchronized的底层原理
28. 分布式事务如何实现？ | distributed
29. Java多态的原理？怎么实现的？ | java-basic
30. C++三特性 | java-basic
31. 如何保证线程安全 | juc
32. 索引，什么情况下失效？ | mysql | 索引失效有哪些情况
33. JMM内存模型 | juc | Java内存模型JMM是什么
34. MQ消息可靠性 | mq
35. 浏览器中输入一个web页面的url以后会有哪些流程 | network
36. 线程池参数 | juc | 线程池的参数都有哪些
37. 设计高并发系统 | scenario,distributed
38. Spring和SpringBoot有什么区别? | springmvc-boot
39. Redis雪崩、击穿、穿透 | redis
40. 一张订单表order，两个字段user_id和create_time用户查看某一段时间内所有订单，写sql | mysql
41. Spring的两个核心思想 | spring
42. 如果数据在亿级，然后userid区分度不高，服务器配置不好，如何优化 | mysql,scenario
43. 说一说ArrayList的初始大小，扩容机制 | java-collection | ArrayList的扩容机制
44. jre和jdk区别 | java-basic
45. 如何防止超卖？ | hmdp,scenario
46. ES6新增 | interviews
47. Kafka防止消息丢失的办法 | mq
48. Kafka防止重复消费 | mq
49. 如果要实现用户权限管理要怎么办 | scenario
50. redis在项目中的作用 | redis,hmdp
51. 虚拟内存和物理内存区别 | os
52. OOM的情况 | jvm | OOM会发生在哪些区域
53. 进程调度的算法 | os
54. hashmap和concurrenthashmap区别 | java-collection
55. 基本的集合类 | java-collection
56. springboot常用的注解； | springmvc-boot
57. Http和Https的区别 | network
58. cookie和session的区别 | network
59. tcp四层结构 | network
60. 进程和线程的区别 | os,juc
61. 预防解决死锁的方法 | juc,os
62. 数据库的表锁和行锁有什么作用？ | mysql
63. 了不了解dos攻击，怎么防范？ | network
64. redis的持久化机制? | redis
65. 讲一下zookeeper和eureka保证了CAP原理中的什么？ | distributed
66. 讲一下RPC的原理 | distributed
67. redis为什么是单线程 | redis
68. threadlocal的实现 | juc | threadlocal 原理
69. 做项目对接api时，超时怎么去排查？ | scenario
70. 常见限流方法 | distributed,scenario
71. Redis相关布隆过滤器解决什么问题，具体原理是什么？ | redis
72. 讲一讲你在那些地方用到过多线程，怎么用。 | juc,hmdp
73. Mysql联合索引的设计原则 | mysql
74. aop有那几种通知，切面编程怎么实现的？ | spring
75. 数据量在500w的表，如何实现快速的全表模糊匹配 | mysql,scenario
76. 如何保证交易，订单等不会重复处理 | java-basic,mq | 幂等性
77. hashmap底层怎么实现的 | java-collection
78. 1000w条数据求topk，优化思路 | scenario
79. spring事务传播方式 | spring
80. 了解双亲委派吗? | jvm | 介绍一下双亲委派模型
81. rocketmq相关：怎么保证消息消费端幂等性 | mq
82. 用你的理解讲讲数据库的三范式。 | mysql
83. 分布式和单体式各自的优缺点 | distributed
84. CAS介绍一下原理,有哪些问题? | juc | CAS会有什么问题
85. JVM的垃圾回收机制 | jvm | 什么是垃圾回收
86. 您如何看待人工智能和机器学习在银行软件开发中的应用?是否有相关的项目经验? | llm-basic,agent-core
87. SQL注入怎么发现存在该漏洞? | network,mybatis
88. service层分批调用mapper层那有1w条数据过来，这个传参太大了，微服务吃不消怎么办？ | scenario,mybatis
89. XSS和CSRF区别，怎么防御，怎么发现这些漏洞， | network
90. mysql怎么实现事务 | mysql
91. String，StringBuilder，StringBuffer区别 | java-basic
92. Springcloud有哪些组件? | distributed
93. Redis分布式锁 | redis
94. 讲vue2和vue3的区别 | interviews
95. 线程池 | juc | 线程池的好处
96. 有什么用到栈、队列的例子 | java-collection
97. 知道哪些排序算法最喜欢用什么排序算法 | brain
98. 你的专业课有哪些，你的数据结构这门课学过什么东西，给我们讲讲 | interviews
99. 项目中怎么保证数据库与缓存的一致性? | redis,hmdp
100. tcp三次握手 | network
101. 消息队列怎么使用的? | mq
102. 问项目创新点难点，大模型能用上不? | agent-core,hmdp
103. 死锁 | juc | 死锁的必要条件
104. tcp和udp的区别 | network
105. get和post | network
106. 简单讲讲springboot和mybatis | springmvc-boot,mybatis
107. 项目有没有在实际场景中落地应用? | hmdp,interviews
108. 重载和重写的区别 | java-basic
109. 回表 | mysql | 回表
110. 美团和广州工行研发两边都发offer，你会选择哪个? | interviews
111. js这门语言性能方面怎么样? | interviews
112. 索引结构 | mysql | B+树索引
113. java的设计模式 | design-pattern
114. 技术问题，Linux命令、排序算法、设计模式等 | linux,design-pattern
