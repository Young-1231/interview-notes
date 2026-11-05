## 基础与选型

### 消息队列的作用？ | 高频
**结论**:三个关键词:解耦、异步、削峰填谷。

**解耦**
- 服务之间直接调用是强耦合:下游新增、下线或变慢,上游都要改代码或受影响。
- 引入 MQ 后,生产者只负责把消息发到 Topic/队列,不关心谁来消费;新增下游只需新增订阅者。
- 典型例子:下单后需要通知库存、积分、物流、短信,订单服务只发一条「订单已创建」消息。

**异步**
- 发短信、发邮件、生成报表、写日志等耗时且非核心的操作,同步执行会拉长主流程响应时间。
- 把它们封装成消息投递到 MQ,由消费者异步处理,主流程只需等待消息发送成功即可返回。

**削峰填谷**
- 秒杀、大促等场景瞬时流量远超下游处理能力。
- MQ 作为缓冲区先把请求存下来,消费者按自己的能力匀速消费,把瞬时峰值摊平到后续一段时间,避免数据库等下游被打垮。

此外 MQ 还常用于广播通知、日志与埋点采集、事件驱动架构、跨系统数据同步等场景。

### 使用消息队列会带来哪些问题？ | 高频
**结论**:系统可用性降低、复杂度提高、一致性问题,具体表现为丢消息、重复消费、乱序、堆积等。

1. **可用性降低**:MQ 成为关键依赖,MQ 集群故障会影响整条链路,需要做高可用部署和降级方案。
2. **复杂度提高**,需要额外处理:
   - 消息丢失:生产、存储、消费任一环节都可能丢。
   - 重复消费:重试和重新投递不可避免,消费端要幂等。
   - 顺序问题:多分区/多消费者并行时无法保证全局有序。
   - 消息堆积:消费速度跟不上生产速度。
3. **一致性问题**:异步之后上下游之间只能做到最终一致;本地事务和发消息之间也需要事务消息或本地消息表来保证一致。
4. **运维与排障成本**:监控堆积量、消费延迟、死信,链路追踪变复杂。

所以使用 MQ 要同时设计可靠投递、消费幂等、重试与死信、监控告警和降级方案。

### 为什么选择RocketMQ/Kafka/RabbitMQ？三者有什么区别,怎么选型？
**结论**:Kafka 偏高吞吐的日志流和大数据;RocketMQ 偏业务消息,事务、延迟、顺序消息能力完善;RabbitMQ 偏传统企业集成,路由灵活、延迟低,但吞吐和堆积能力相对弱。

| 维度 | Kafka | RocketMQ | RabbitMQ |
| --- | --- | --- | --- |
| 开发语言 | Scala/Java | Java | Erlang |
| 模型 | Topic + Partition | Topic + Queue | AMQP,Exchange + Queue + Binding |
| 吞吐量(量级参考) | 十万到百万级 | 十万级 | 万级 |
| 延迟 | 毫秒级 | 毫秒级 | 微秒到毫秒级 |
| 消费方式 | 拉模式 | 长轮询拉取(Push 客户端底层也是拉) | 推模式为主,也支持拉 |
| 事务消息 | 有事务(面向 Exactly-Once),不是业务事务消息 | 原生半消息 + 回查 | 有 AMQP 事务但性能差,一般不用 |
| 延迟消息 | 不支持 | 原生支持 | TTL + 死信或延迟插件 |
| 死信队列 | Broker 不支持,依赖客户端框架(如 Spring Kafka) | 原生支持 | 原生支持(死信交换机) |
| 消息堆积 | 很强,按时间/大小保留 | 很强 | 相对弱 |
| 典型场景 | 日志采集、埋点、流式计算、数据管道 | 电商交易、订单、金融业务消息 | 企业内部系统集成、对路由要求复杂的中小规模业务 |

**选型建议**:海量日志、实时计算、对接 Flink/Spark 选 Kafka;需要事务、延迟、顺序消息和重试死信的业务系统选 RocketMQ;需要复杂路由、标准 AMQP、吞吐要求不高选 RabbitMQ(Erlang 技术栈对 Java 团队深入排查有门槛)。

### 消息投递语义有哪些？
**结论**:三种:At most once、At least once、Exactly once。实际业务最常用 At least once + 消费端幂等。

| 语义 | 含义 | 典型做法 |
| --- | --- | --- |
| At most once 最多一次 | 可能丢,但不会重复 | 生产者不重试,消费者先提交 offset 再处理 |
| At least once 至少一次 | 不丢,但可能重复 | 生产者确认 + 重试,消费者处理完再提交 offset/ack |
| Exactly once 恰好一次 | 不丢不重 | Kafka 幂等生产者 + 事务 + read_committed,只在 Kafka 内部的「消费-处理-生产」链路成立 |

**注意点**
- Kafka 的 Exactly-Once 只覆盖 Kafka 到 Kafka 的链路;一旦消费后要写数据库、调第三方接口,就要靠业务幂等,或把 offset 和业务数据放在同一个事务里提交。
- 所以「消息不丢」靠生产者确认、Broker 持久化和副本、消费者处理完再确认;「不重复」最终靠消费端幂等。

### 什么时候不适合用消息队列？
**结论**:当引入 MQ 的收益抵不过它带来的复杂度时就不适合。

1. 调用方必须同步拿到处理结果,例如查询类接口、需要立即返回扣款结果的场景。
2. 要求强一致,不能接受最终一致。
3. 链路简单、流量低,没有解耦和削峰需求,引入 MQ 只增加故障点。
4. 业务无法做幂等,也无法容忍重复或丢失。
5. 团队缺乏 MQ 运维、监控和排障能力。

使用 MQ 前,先评估解耦、异步、削峰的收益是否大于可用性、一致性和运维上的代价。

### MQ和本地异步线程有什么区别？
**结论**:本地线程池只是进程内的异步,轻量但不可靠;MQ 是独立的持久化中间件,能跨服务、可靠投递、削峰和水平扩展,代价是网络开销和运维成本。

| 维度 | 本地异步线程(线程池) | 消息队列 |
| --- | --- | --- |
| 作用范围 | 当前进程内 | 跨进程、跨服务 |
| 可靠性 | 任务在内存中,进程宕机或重启就丢 | 消息持久化,可重试,支持确认机制 |
| 削峰能力 | 受线程池队列容量和内存限制 | 可以堆积大量消息 |
| 扩展性 | 依赖当前实例 | 消费者可以水平扩容 |
| 解耦 | 调用方仍要知道处理逻辑 | 生产者和消费者完全解耦 |
| 成本 | 简单,无额外组件 | 引入网络开销、中间件运维、一致性问题 |

简单的、允许丢失的异步任务(如异步记录访问日志)用线程池即可;需要跨服务解耦、可靠投递、削峰时用 MQ。

## Kafka核心概念

### Kafka的核心概念和体系结构是什么？ | 高频
**结论**:Producer 把消息发到 Broker 集群中 Topic 的某个 Partition,每个 Partition 有多个 Replica(一个 Leader、若干 Follower),Consumer 以 Consumer Group 为单位拉取消息,用 Offset 记录进度;元数据由 Controller 管理。

| 概念 | 说明 |
| --- | --- |
| Producer | 生产者,把消息发送到指定 Topic,按 key 哈希或指定分区选择 Partition |
| Broker | Kafka 服务节点,负责存储消息、处理读写请求 |
| Topic | 主题,逻辑概念,表示一类消息 |
| Partition | 分区,Topic 的物理分片,是并行和存储的基本单位,分区内消息有序 |
| Replica | 副本,同一分区在不同 Broker 上的拷贝 |
| Leader / Follower | 每个分区一个 Leader 负责读写,Follower 从 Leader 拉取数据做同步 |
| Offset | 消息在分区内的位置编号,也用于记录消费进度 |
| Consumer | 消费者,主动从 Broker 拉取消息 |
| Consumer Group | 消费者组,组内消费者分摊分区,组间互不影响 |
| Controller | 负责分区 Leader 选举、副本管理、元数据变更 |

**元数据管理的演进**
- 早期版本依赖 ZooKeeper 存储元数据和选举 Controller。
- Kafka 2.8 引入 KRaft 模式(基于 Raft 的内置元数据仲裁),3.3 起 KRaft 可用于生产。
- Kafka 4.0 完全移除 ZooKeeper,只支持 KRaft。

### Kafka中的Topic和Partition是什么？
**结论**:Topic 是逻辑上的消息分类,Partition 是 Topic 的物理分片;一个 Topic 的全部 Partition 数据合起来才是完整数据。

**Partition 的特点**
- 每个 Partition 是一个只追加写的有序日志,物理上由多个 Segment 文件组成。
- 同一 Partition 内消息有序,不同 Partition 之间无序。
- 不同 Partition 可以分布在不同 Broker 上。

**Partition 的作用**
1. 提高并发写入:多个分区分布在多台 Broker 上并行写。
2. 提高并发消费:同组内一个分区只能被一个消费者消费,分区数决定了组内消费并行度的上限。
3. 水平扩展:Topic 容量和吞吐不受单机限制。
4. 结合副本提供容错。

**注意点**
- 分区数只能增加不能减少。
- 增加分区会改变 key 到分区的映射(hash(key) % 分区数),依赖 key 保证顺序的业务要谨慎。
- 分区过多会增加文件句柄、元数据和 Leader 选举的开销。

### Kafka的offset是什么？
**结论**:Offset 是消息在 Partition 内的位置编号,从 0 开始单调递增,只在同一分区内唯一。

**特点**
- 每条消息写入分区时被分配下一个 offset。
- 消息被清理后 offset 不会被重用。
- 不同分区的 offset 相互独立,所以「offset 全局唯一」是错误说法。

**两类 offset**
- 消息 offset:定位分区中的某一条消息。
- 消费位移(committed offset):消费者组提交的进度,表示「下一条要消费的消息位置」,消费者重启或分区重新分配后据此继续消费。

**相关概念**
- LEO(Log End Offset):分区下一条待写入消息的 offset。
- HW(High Watermark):ISR 中所有副本都已同步到的位置,消费者只能读到 HW 之前的消息。

### Kafka的offset存在哪里？
**结论**:Kafka 0.9 之前消费位移存在 ZooKeeper;0.9 起默认存放在内部 Topic `__consumer_offsets` 中。

```plaintext
__consumer_offsets
```

- 这个 Topic 默认有 50 个分区,按 `group.id` 哈希决定某个消费者组的位移写入哪个分区,该分区 Leader 所在的 Broker 就是这个组的 Group Coordinator。
- 它的清理策略是 compact(日志压缩),对同一个 key(group + topic + partition)只保留最新的位移。

**为什么要从 ZooKeeper 迁出**
1. 位移提交是高频写操作,ZooKeeper 不适合大量频繁写入。
2. 放在 Kafka 自己的 Topic 中,可以复用副本机制保证高可用,也方便横向扩展。

此外,也可以把 offset 存到外部系统(如和业务数据存在同一个数据库事务里),以实现业务侧的精确一次。

### Kafka消费者组是什么？
**结论**:`group.id` 相同的消费者属于同一个消费者组;组内分摊分区实现负载均衡(点对点),不同组各自完整消费一份数据(发布订阅)。

**分配规则**
1. 同一个 Partition 在同一时刻只能被组内一个消费者消费。
2. 一个消费者可以同时消费多个 Partition。
3. 消费者数 > 分区数时,多出来的消费者空闲;消费者数 = 分区数时通常一人一个分区;消费者数 < 分区数时有人消费多个分区。

**两种消费模式**
- 组内是竞争消费:一条消息只会被组内一个消费者处理。
- 组间是广播:不同消费者组各自维护 offset,都能消费到同一条消息。

**分区分配策略**:Range、RoundRobin、Sticky、CooperativeSticky,可通过 `partition.assignment.strategy` 配置。

### Kafka是推模式还是拉模式？
**结论**:Kafka 消费者是拉模式,通过 `poll()` 主动从 Broker 拉取消息。

**拉模式的好处**
1. 消费者按自己的处理能力拉取,不会被 Broker 推送压垮。
2. 消费者可以控制批量大小和拉取频率,方便批量处理。
3. Broker 实现更简单,不需要维护每个消费者的推送状态。

**缺点与优化**
- 缺点是没有数据时可能空轮询。
- Kafka 用长轮询解决:`fetch.min.bytes` 和 `fetch.max.wait.ms` 让 Broker 在数据不足时先挂起请求,有足够数据或等待超时后再返回。

**对比**:RabbitMQ 默认推模式(`basic.consume`),用 `prefetch`(basic.qos)控制未确认消息数;RocketMQ 的 PushConsumer 底层其实也是长轮询拉取。

### Kafka Rebalance是什么？
**结论**:Rebalance 是消费者组内重新分配分区的过程,由 Group Coordinator 协调。频繁 Rebalance 会导致消费暂停和重复消费。

**触发条件**
1. 组内消费者加入或退出(包括崩溃)。
2. 消费者心跳超时(`session.timeout.ms`,Kafka 3.0 起默认 45 秒)。
3. 两次 `poll()` 间隔超过 `max.poll.interval.ms`(默认 5 分钟),通常是单批处理太慢,消费者会被认为失效。
4. 订阅的 Topic 分区数变化,或订阅的 Topic 列表变化。

**影响**
- 传统的 Eager 协议下,所有消费者先放弃全部分区再重新分配,期间整个组停止消费(Stop The World)。
- Rebalance 前未提交的 offset 会导致分区换主后重复消费。

**优化**
- 合理设置 `session.timeout.ms`、`heartbeat.interval.ms`、`max.poll.interval.ms`、`max.poll.records`,避免误判下线。
- 使用 CooperativeStickyAssignor(增量协作式 Rebalance,Kafka 2.4 引入),只迁移需要变动的分区。
- 使用静态成员(`group.instance.id`),消费者短时间重启不触发 Rebalance。
- Kafka 4.0 正式提供新的消费者组协议(KIP-848),分配逻辑移到 Broker 端,进一步减少全组停顿。
- 在 Rebalance 回调(ConsumerRebalanceListener)中提交 offset。

## Kafka高性能与存储

### Kafka为什么吞吐量高？高性能设计体现在哪些方面？ | 高频
**结论**:分区并行、顺序追加写、利用 Page Cache、零拷贝、批量和压缩,几方面配合才达到十万甚至百万级 TPS。

1. **分区并行**:Topic 拆成多个 Partition 分布在多个 Broker 上,读写都可以并行,吞吐随分区和机器数水平扩展。
2. **磁盘顺序写**:每个分区是只追加的日志文件,只在末尾写入,避免随机寻址。机械盘和 SSD 上顺序写都远快于随机写。
3. **Page Cache**:写入时先写操作系统页缓存,由操作系统异步刷盘;消费者读取最新数据时通常直接命中页缓存。Kafka 不在 JVM 堆里缓存消息,避免 GC 压力。
4. **零拷贝**:消费者拉取时 Broker 用 `sendfile`(Java 中是 `FileChannel.transferTo`)把数据从页缓存直接发到网卡,不经过用户态。
5. **批量处理**:Producer 按 `batch.size`、`linger.ms` 攒批发送;Broker 以批为单位写入;Consumer 也是批量拉取。减少网络请求次数和系统调用。
6. **压缩**:支持 gzip、snappy、lz4、zstd,以批为单位压缩,Broker 一般直接存储压缩后的批次,消费端解压,节省网络和磁盘。
7. **稀疏索引 + 分段**:日志按 Segment 切分,配合稀疏的 offset 索引和时间索引,二分查找快速定位消息。
8. **拉模式**:消费者按自身能力批量拉取,Broker 逻辑简单。

### 消息队列中的零拷贝技术是什么？Kafka怎么用的？ | 高频
**结论**:零拷贝指减少数据在内核态和用户态之间的 CPU 拷贝和上下文切换。Kafka 在消费者拉取时用 `sendfile` 把日志文件直接发到 socket;RocketMQ 主要用 `mmap` 读写 CommitLog。

**传统 read + write**:4 次上下文切换,4 次拷贝。
1. 磁盘 → 内核页缓存(DMA 拷贝)
2. 页缓存 → 用户缓冲区(CPU 拷贝)
3. 用户缓冲区 → socket 缓冲区(CPU 拷贝)
4. socket 缓冲区 → 网卡(DMA 拷贝)

**mmap + write**:把文件映射到用户进程地址空间,省掉「页缓存 → 用户缓冲区」这一次 CPU 拷贝,剩 3 次拷贝、4 次上下文切换。适合需要在用户态读写文件内容的场景,RocketMQ 的 CommitLog 就是这样读写的。

**sendfile**:一次系统调用完成,2 次上下文切换。数据不进入用户态,只剩 3 次拷贝;如果网卡支持 SG-DMA(scatter-gather),页缓存的数据可以直接由 DMA 拷到网卡,只剩 2 次 DMA 拷贝、0 次 CPU 拷贝。

**Kafka 中的使用**
- 消费者和 Follower 拉取数据时,Broker 调用 `FileChannel.transferTo()`,底层就是 `sendfile`。
- 前提是 Broker 不需要修改数据。如果开启了 SSL/TLS,数据需要在用户态加密,就无法使用 sendfile 零拷贝。
- 写入端 Kafka 主要依靠页缓存和顺序写,索引文件使用 mmap。

### Kafka的数据清理机制了解过吗？ | 高频
**结论**:Kafka 按 Segment 分段存储,清理策略由 `cleanup.policy` 决定,有 delete(按时间/大小删除旧 Segment)和 compact(按 key 保留最新值)两种。

**分段存储**
- 每个 Partition 是一个目录,里面由多个 Segment 组成。
- 每个 Segment 包含 `.log` 数据文件、`.index` 位移索引、`.timeindex` 时间索引,文件名是该段第一条消息的 offset。
- 只有当前活跃 Segment 可以写入;Segment 达到 `log.segment.bytes`(默认 1GB)或 `log.roll.ms/hours`(默认 7 天)时滚动出新段。
- 清理以整个 Segment 为单位,活跃段不会被删除。

**delete 策略(默认)**
- 按时间:`log.retention.hours` 默认 168 小时(7 天),超过保留期的 Segment 被删除。
- 按大小:`log.retention.bytes` 默认 -1(不限制),设置后分区日志总大小超过阈值时删除最旧的 Segment。
- 两个条件满足任一即可清理。

**compact 策略**
- 对相同 key 只保留最新的一条消息,value 为 null 的消息(墓碑)表示删除该 key。
- 适合保存状态快照的场景,比如 `__consumer_offsets`。

## Kafka可靠性与幂等

### Kafka为什么要有副本？高可用机制是怎样的？ | 高频
**结论**:Kafka 高可用靠多 Broker 集群 + 分区多副本。每个分区的副本分散在不同 Broker 上,Leader 宕机后由 Controller 从 ISR 中选出新 Leader 继续服务。

**副本机制**
- 每个 Partition 可以配置多个 Replica(`replication.factor`,生产常用 3),分布在不同 Broker,尽量跨机架。
- 其中一个是 Leader,其余是 Follower。生产者写入和消费者读取默认都走 Leader(Kafka 2.4 起支持配置就近读 Follower)。
- Follower 不对外服务,只是不断从 Leader 拉取数据保持同步。

**故障切换**
- Controller(ZooKeeper 模式下是某个 Broker,KRaft 模式下是 Controller 仲裁)感知到 Broker 宕机后,为它上面作为 Leader 的分区重新选举。
- 新 Leader 默认只从 ISR 中选,保证不丢已提交的消息。
- `unclean.leader.election.enable`(0.11 起默认 false)如果打开,ISR 为空时允许从非同步副本选 Leader,可用性更高但会丢数据。

**为什么需要副本**:如果一个分区只有一份,所在 Broker 宕机后这部分数据就不可读写,磁盘损坏还会永久丢失。副本同时提供了容灾和故障自动切换能力。

### 什么是ISR？ | 高频
**结论**:ISR(In-Sync Replicas)是和 Leader 保持同步的副本集合,包括 Leader 自己。它决定了 `acks=all` 要等哪些副本,以及 Leader 故障时从哪里选新 Leader。

**相关概念**
- AR(Assigned Replicas):分区的全部副本。
- ISR:跟得上 Leader 的副本。
- OSR(Out-of-Sync Replicas):落后太多被移出的副本。AR = ISR + OSR。

**进出 ISR 的规则**
- Follower 如果超过 `replica.lag.time.max.ms`(Kafka 2.5 起默认 30 秒)没有追上 Leader 的 LEO,就被移出 ISR。
- 旧版本还有按消息条数落后判断的参数 `replica.lag.max.messages`,0.9 起已移除,因为突发流量下容易让副本频繁进出 ISR。
- 被移出的 Follower 追上后会重新加入 ISR。

**ISR 的作用**
- 高水位 HW 取 ISR 中所有副本 LEO 的最小值,只有 HW 之前的消息才算「已提交」,对消费者可见。
- `acks=all` 时,Leader 要等 ISR 中所有副本都写入才返回成功。
- 配合 `min.insync.replicas`:如果 ISR 副本数小于该值,`acks=all` 的写入会失败(NotEnoughReplicas),防止只剩 Leader 一个副本时还在「假装可靠」地写入。

### Kafka的acks参数是什么？
**结论**:`acks` 控制生产者认为「发送成功」需要多少副本确认,取值 0、1、all(-1)。Kafka 3.0 起默认值是 all。

| 取值 | 含义 | 可靠性 | 性能 |
| --- | --- | --- | --- |
| `acks=0` | 发出去就算成功,不等 Broker 响应 | 最低,Broker 没收到也不知道 | 最高 |
| `acks=1` | Leader 写入本地日志就返回 | Leader 刚写完就宕机且 Follower 未同步时会丢 | 中 |
| `acks=all` / `-1` | ISR 中所有副本都写入才返回 | 最高 | 较低 |

**注意点**
- `acks=all` 单独使用不够:如果 ISR 只剩 Leader 自己,效果等同于 `acks=1`。要配合 `replication.factor >= 3`、`min.insync.replicas >= 2`。
- 这里的「写入」是写到各副本的页缓存,不是每条都 fsync 到磁盘。Kafka 的可靠性依赖多副本,而不是每条同步刷盘。

### Kafka如何保证消息不丢失？ | 高频
**结论**:生产者用 `acks=all` + 重试 + 回调处理失败;Broker 用多副本 + `min.insync.replicas` + 禁止 unclean 选举;消费者关闭自动提交,处理成功后再提交 offset。

**生产者端**
1. 不要用「发完就不管」的方式,使用带回调的 `send(record, callback)` 或同步 `get()`,在回调里处理异常,失败的消息记录日志或落库补偿。
2. `acks=all`。
3. 开启重试:`retries`(新版本默认 `Integer.MAX_VALUE`),总时长受 `delivery.timeout.ms`(默认 120 秒)限制。
4. 开启幂等 `enable.idempotence=true`(3.0 起默认开启),避免重试带来重复和乱序。

**Broker 端**
1. `replication.factor >= 3`,副本分布在不同 Broker/机架。
2. `min.insync.replicas >= 2`,且小于副本数,留出一个副本的容错空间。
3. `unclean.leader.election.enable=false`,禁止非同步副本当选 Leader。
4. Kafka 默认靠多副本而不是同步刷盘保证可靠,`log.flush.*` 一般保持默认,由操作系统异步刷盘。

**消费者端**
1. `enable.auto.commit=false`。
2. 业务处理成功后再手动提交 offset。
3. 不要在拉到消息后丢给其他线程异步处理就立即提交 offset。

这样整体是 At least once,可能出现重复,需要消费端幂等兜底。

### Kafka自动提交offset和手动提交offset各有什么问题？
**结论**:自动提交与业务处理进度脱钩,可能重复也可能丢失;手动提交能避免丢失,但提交失败或时机不当仍会重复,所以消费端始终要幂等。

**自动提交**
- 参数 `enable.auto.commit=true`(默认),`auto.commit.interval.ms` 默认 5 秒。
- 实际是在 `poll()` 时检查是否到了提交间隔,如果到了就提交上一次 `poll()` 返回的最大 offset。
- 重复:处理完一批后、下一次提交前消费者崩溃,重启后从旧位移消费,这一段被重复处理。
- 丢失:如果把消息交给其他线程异步处理,主线程继续 `poll()` 触发提交,而异步任务还没处理完就宕机,这些消息就被跳过了。

**手动提交**
- `commitSync()`:同步提交,失败会自动重试,可靠但阻塞。
- `commitAsync()`:异步提交,不阻塞但失败不重试(避免旧位移覆盖新位移),需要在回调里记录。
- 常见写法:正常循环中用 `commitAsync()`,关闭消费者或 Rebalance 前用 `commitSync()` 兜底。
- 问题:业务处理成功但提交失败、或提交前宕机、或发生 Rebalance,都会导致重复消费。
- 如果先提交再处理,则变成 At most once,处理失败会丢消息。

```java
while (running) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(500));
    for (ConsumerRecord<String, String> record : records) {
        handle(record); // 业务处理,需幂等
    }
    consumer.commitAsync();
}
// finally 中:consumer.commitSync(); consumer.close();
```

### Kafka生产者的幂等性是怎么实现的？ | 高频
**结论**:通过 Producer ID(PID)+ 每个分区的单调递增序列号(Sequence Number)实现,Broker 丢弃重复序列号的批次。只能保证单个生产者会话、单个分区内不重复。

**原理**
1. 开启 `enable.idempotence=true`(Kafka 3.0 起默认开启,要求 `acks=all`、`retries > 0`、`max.in.flight.requests.per.connection <= 5`)。
2. 生产者初始化时从 Broker 获取一个 PID(以及 epoch)。
3. 生产者对每个 <PID, 分区> 维护序列号,每个批次带上起始序列号,发送后递增。
4. Broker 为每个 <PID, 分区> 缓存最近 5 个批次的序列号元数据:
   - 序列号是期望的下一个:接受并写入。
   - 序列号重复:说明是重试的重复批次,直接丢弃但返回成功。
   - 序列号跳号:返回 OutOfOrderSequenceException。
5. 因此即使 `max.in.flight` 为 5,重试也不会造成重复或乱序。

**局限**
- 生产者重启后会拿到新的 PID,无法识别重启前发送的重复消息。
- 只保证单分区,跨分区不保证。

**跨分区、跨会话:事务**
- 配置 `transactional.id`,生产者重启后仍能拿回同一个 PID 并通过 epoch 隔离旧实例(fencing)。
- 用 `beginTransaction()` / `commitTransaction()` 让多分区写入,以及 `sendOffsetsToTransaction()` 提交的消费位移,一起原子生效。
- 消费端配置 `isolation.level=read_committed` 只读已提交事务的消息。
- 这就是 Kafka 的 Exactly-Once,但仅限 Kafka 内部的读-处理-写链路,写外部数据库仍需业务幂等。

### Kafka重复消费的原因是什么？如何解决？ | 高频
**结论**:重复来自生产者重试和消费者 offset 提交不及时两类原因。生产端开幂等,消费端处理成功后再提交 offset,并在业务层做幂等。

**常见原因**
1. 生产者没收到 ACK 而重试,导致同一消息写入多次(未开启幂等时)。
2. 消费者处理完业务但还没提交 offset 就宕机或重启。
3. 处理太慢,超过 `max.poll.interval.ms`,被踢出组触发 Rebalance,分区交给别的消费者从旧 offset 开始消费。
4. 提交 offset 失败。

**解决方案**
1. 生产者开启幂等 `enable.idempotence=true`,需要跨分区原子写时用事务。
2. 消费者关闭自动提交,处理成功后再提交;Rebalance 回调中提交 offset。
3. 调整 `max.poll.records`、`max.poll.interval.ms`,避免处理超时导致 Rebalance。
4. 业务幂等(最终兜底):唯一索引、去重表、Redis 去重、状态机、乐观锁版本号等。

MQ 很难天然做到端到端不重复,实际做法是「至少一次投递 + 消费端幂等」。

### Kafka如何保证消息的顺序性？ | 高频
**结论**:Kafka 只保证单个 Partition 内有序。需要有序的消息用同一个 key 发到同一分区,消费端按分区单线程(或按 key 串行)处理。

**生产端**
1. 相同业务 key(如订单 ID)的消息发送时指定同一个 key,默认分区器按 key 哈希到同一分区;也可以直接指定分区号。
2. 防止重试乱序:开启幂等后 `max.in.flight.requests.per.connection <= 5` 也能保证分区内有序;不开幂等时需要设置为 1。
3. 不要随意增加分区数,否则 key 到分区的映射会变化,扩容瞬间可能乱序。

**消费端**
1. 一个分区同一时刻只被组内一个消费者消费,这是天然保证。
2. 如果消费者内部用多线程提升吞吐,不能随机分配线程,要按 key 哈希到固定的内存队列,每个队列单线程处理,才能保证同一 key 的顺序。

**全局有序**:只能用单分区 Topic,牺牲了并行能力,一般只在数据量很小时使用。实际业务通常只需要「同一业务实体内」有序,也就是局部有序。

## RocketMQ

### RocketMQ的架构和高可用是怎样的？
**结论**:RocketMQ 由 NameServer、Broker、Producer、Consumer 组成。高可用靠 Broker 主从复制,以及 DLedger(Raft)或 5.x Controller 模式的自动主从切换。

**核心组件**
- NameServer:无状态的路由注册中心,节点之间互不通信,Broker 定期向所有 NameServer 注册,客户端从 NameServer 拉取路由。
- Broker:存储和转发消息。所有 Topic 的消息顺序写入同一个 CommitLog,再异步构建 ConsumeQueue(按 Topic + Queue 的索引)和 IndexFile(按 key 查询)。
- Topic / MessageQueue:一个 Topic 分为多个 MessageQueue,分布在多个 Broker 上,作用类似 Kafka 的 Partition。

**高可用**
- 主从架构:Master 负责读写,Slave 复制数据;Master 不可用时消费者可以从 Slave 读,但传统模式下不会自动切换,写入只能发到其他 Broker 组的 Master。
- 复制方式:`brokerRole=SYNC_MASTER`(同步复制,Slave 写成功才返回)或 `ASYNC_MASTER`(异步复制,默认)。
- 自动切换:4.5 起支持 DLedger 模式,基于 Raft 在一组 Broker 中自动选主;5.x 推荐使用 Controller 模式,由 Controller 负责主备切换,复制仍然使用原有的 HA 机制。
- 多个 Broker 组 + Topic 的队列分布在多个组上,单个组故障时生产者可以把消息发往其他组。

### RocketMQ如何保证消息不丢失？
**结论**:生产者同步发送并检查结果、失败重试;Broker 同步刷盘 + 同步复制;消费者业务处理成功后再返回 CONSUME_SUCCESS。

**生产者**
- 使用同步发送,检查 `SendResult` 是否为 `SEND_OK`;异步发送要在回调中处理失败。
- 失败自动重试:`retryTimesWhenSendFailed`(同步,默认 2 次)、`retryTimesWhenSendAsyncFailed`(异步,默认 2 次),重试时会尽量避开刚失败的 Broker。
- 对关键消息做本地消息表或事务消息,保证发送和本地事务一致。

**Broker**
- `flushDiskType=SYNC_FLUSH`:消息写入磁盘后才返回(默认 ASYNC_FLUSH,先写页缓存)。
- `brokerRole=SYNC_MASTER`:同步复制到 Slave 后才返回,防止 Master 磁盘损坏丢数据。
- 两者都会降低吞吐,按业务重要程度取舍。

**消费者**
- 在监听器中处理完业务后再返回 `CONSUME_SUCCESS`;处理失败返回 `RECONSUME_LATER` 或抛异常,消息会进入重试流程。
- 不要在监听器里把消息丢给异步线程后立即返回成功。

### RocketMQ的事务消息是如何实现的？
**结论**:基于「半消息 + 二阶段提交 + 事务回查」,保证本地事务和消息发送的最终一致性。

**流程**
1. 生产者发送半消息(Half Message)。Broker 把它写到内部 Topic `RMQ_SYS_TRANS_HALF_TOPIC`,对消费者不可见。
2. 半消息写入成功后,生产者执行本地事务(如写订单表)。
3. 根据本地事务结果向 Broker 发送 Commit 或 Rollback:
   - Commit:Broker 把消息恢复到真实 Topic,消费者可见。
   - Rollback:消息不会投递(写入 Op 消息标记删除)。
4. 事务回查:如果二阶段请求丢失或生产者宕机,Broker 定期扫描超时未决的半消息,回调生产者的 `checkLocalTransaction` 查询本地事务真实状态,再决定提交或回滚。超过最大回查次数(默认 15 次)仍未决的消息会被丢弃。

**使用要点**
- 本地事务执行器和回查方法都要实现,回查方法要能根据业务 ID 查到事务状态(通常查业务表或事务日志表)。
- 事务消息只保证「本地事务成功,消息一定发出」,不保证消费方一定成功。消费方失败靠重试和人工补偿,最终一致。
- 消费端依然要幂等,因为回查和重试都可能带来重复投递。

```java
TransactionMQProducer producer = new TransactionMQProducer("tx_group");
producer.setTransactionListener(new TransactionListener() {
    public LocalTransactionState executeLocalTransaction(Message msg, Object arg) {
        try {
            orderService.createOrder((Order) arg); // 本地事务
            return LocalTransactionState.COMMIT_MESSAGE;
        } catch (Exception e) {
            return LocalTransactionState.ROLLBACK_MESSAGE;
        }
    }
    public LocalTransactionState checkLocalTransaction(MessageExt msg) {
        // 回查:根据业务 key 查询本地事务是否已提交
        return orderService.exists(msg.getKeys())
                ? LocalTransactionState.COMMIT_MESSAGE
                : LocalTransactionState.UNKNOW;
    }
});
```

### RocketMQ如何实现延迟消息？适合什么场景？
**结论**:RocketMQ 4.x 原生支持 18 个固定延迟级别,消息先写到内部延迟 Topic,到期后再投递到目标 Topic;5.x 引入定时消息,支持任意时间点(基于时间轮)。

**4.x 延迟级别**
- 默认 18 级:1s 5s 10s 30s 1m 2m 3m 4m 5m 6m 7m 8m 9m 10m 20m 30m 1h 2h,通过 `message.setDelayTimeLevel(level)` 指定,级别可以在 Broker 的 `messageDelayLevel` 中修改,但不能每条消息任意指定时间。
- 原理:Broker 收到延迟消息后,把目标 Topic 和队列存到消息属性里,改投到内部 Topic `SCHEDULE_TOPIC_XXXX`,每个级别对应一个队列。`ScheduleMessageService` 为每个级别启动定时任务,到期后恢复原 Topic 并重新写入,消费者才能消费。

**5.x 定时消息**
- 可以设置精确的投递时间戳(`setDeliverTimestamp`),Broker 用 TimerWheel 时间轮 + TimerLog 实现,不再受固定级别限制。

**典型场景**
1. 订单超时未支付自动关闭:下单时发一条 30 分钟延迟消息,到期后查询订单状态,未支付就关单并释放库存。
2. 延迟检查任务状态、超时补偿。
3. 定时提醒、预约通知。
4. 失败后的延迟重试(RocketMQ 的消费重试本身就基于延迟级别实现)。

消费到延迟消息时要再次校验业务状态,因为期间状态可能已经变化。

### RocketMQ如何保证顺序消费？
**结论**:发送端用 `MessageQueueSelector` 把同一业务 ID 的消息发到同一个 MessageQueue,消费端使用 `MessageListenerOrderly`,对每个队列加锁串行消费。

**发送端**
```java
producer.send(msg, (mqs, message, arg) -> {
    long orderId = (Long) arg;
    return mqs.get((int) (orderId % mqs.size()));
}, orderId);
```
- 需要同步发送;如果队列所在 Broker 宕机,消息会被发到其他队列,短时间内可能乱序,严格顺序场景要接受这一点或牺牲可用性。

**消费端**
- `MessageListenerOrderly` 会在 Broker 端锁定队列,保证同一队列同一时刻只被一个消费者实例消费;在实例内部再对队列加本地锁,保证单线程处理。
- 顺序消费失败时不会跳过,而是在本地挂起一段时间后重试当前消息,会阻塞该队列后续消息,所以要设置合理的最大重试次数并告警。

### RocketMQ的消费重试和死信队列是怎样的？
**结论**:并发消费失败的消息会进入重试队列 `%RETRY%消费组`,按延迟级别递增间隔重试,默认最多 16 次;仍然失败就进入死信队列 `%DLQ%消费组`。

- 重试间隔从 10 秒开始逐级增加,最长 2 小时,16 次重试总共约 4 小时 46 分钟。
- 最大重试次数可以通过 `maxReconsumeTimes` 调整。
- 死信队列是以消费组为单位的特殊 Topic,不会再被自动消费,需要人工排查或单独启动消费者处理。
- 死信 Topic 默认权限只能写不能读,需要在控制台修改权限后才能消费。

## RabbitMQ

### RabbitMQ的消息模型是怎样的？
**结论**:生产者把消息发给 Exchange,Exchange 按类型和 Binding 规则路由到 Queue,消费者从 Queue 消费。生产者不直接发到队列。

**核心概念**
- Connection / Channel:一个 TCP 连接上复用多个轻量 Channel。
- Exchange:交换机,只负责路由,不存储消息。
- Queue:真正存储消息的地方。
- Binding / Routing Key:Exchange 和 Queue 之间的绑定规则。
- VHost:虚拟主机,做多租户隔离。

**Exchange 类型**
| 类型 | 路由规则 |
| --- | --- |
| direct | routing key 完全匹配 |
| topic | 按通配符匹配,`*` 匹配一个单词,`#` 匹配零个或多个单词 |
| fanout | 忽略 routing key,广播到所有绑定队列 |
| headers | 按消息头属性匹配,较少使用 |

### RabbitMQ如何保证消息不丢失？ | 高频
**结论**:生产者开启 Publisher Confirm 和 Return 回调;Broker 端交换机、队列、消息都持久化,推荐使用仲裁队列;消费者手动 ack,处理成功后再确认。

**生产者阶段**
- Publisher Confirm:消息被 Broker 接收(持久化消息落盘后)返回 ack,失败返回 nack,生产者据此重试或落库补偿。
- Publisher Return:设置 `mandatory=true`,消息到达交换机但没有匹配的队列时退回给生产者,否则会被直接丢弃。
- Spring Boot 中对应 `publisher-confirm-type: correlated` 和 `publisher-returns: true`。

**Broker 阶段**
1. 交换机持久化(durable)。
2. 队列持久化(durable)。
3. 消息持久化(`delivery_mode=2`,Spring AMQP 默认就是持久化消息)。
- 三者缺一不可:队列不持久化,重启后队列和消息都没了。
- 持久化只防重启不防单点磁盘故障,还要配合集群副本:3.8 起推荐仲裁队列(Quorum Queue,基于 Raft),经典镜像队列在 3.9 被标记为弃用,4.0 已移除。

**消费者阶段**
- 关闭自动确认,改为手动 ack:业务处理成功后 `basicAck`;失败时 `basicNack`/`basicReject`,根据情况重新入队或转入死信。
- 消费者未 ack 就断开连接,消息会重新投递给其他消费者。
- Spring AMQP 中可以用 `acknowledge-mode: auto`(方法正常返回才 ack,抛异常则 nack)配合 `retry` 本地重试,超过次数后转死信队列,避免无限重新入队。

### RabbitMQ重复消费如何解决？ | 高频
**结论**:重复消费的根源是消息被处理但 ack 没有成功到达 Broker,消息被重新投递。解决靠消费端幂等。

**常见原因**
1. 消费者处理完业务后、ack 之前宕机或连接断开。
2. 网络抖动导致 ack 丢失。
3. 生产者没收到 confirm 而重发。
4. 消费失败重新入队。

**解决方案**
1. 每条消息携带全局唯一 ID 或业务唯一标识(订单号、支付流水号)。
2. 消费前检查是否已处理:查业务表、去重表或 Redis。
3. 用数据库唯一索引兜底,重复插入直接失败并按「已处理」返回 ack。
4. 状态机校验,例如订单已经是「已支付」就不再处理支付成功消息。

例如支付回调:以支付流水号作为唯一键,数据库已存在该支付记录就说明处理过,直接 ack 跳过。

### RabbitMQ中死信交换机是什么？ | 高频
**结论**:死信是无法被正常消费的消息。队列通过 `x-dead-letter-exchange` 绑定一个死信交换机(DLX),消息变成死信后被转发到 DLX,再路由到死信队列由专门的消费者处理。

**成为死信的三种情况**
1. 消息被消费者 `basic.reject` 或 `basic.nack` 拒绝,且 `requeue=false`。
2. 消息 TTL 过期(队列级 `x-message-ttl` 或消息级 `expiration`)。
3. 队列达到最大长度(`x-max-length` / `x-max-length-bytes`),默认溢出策略下最早的消息被丢弃并成为死信。
4. 仲裁队列还有一种:消息重新投递次数超过 `delivery-limit`。

**流程**:生产者 → 原始交换机 → 原始队列 → 消息成为死信 → 死信交换机 → 死信队列 → 死信消费者。可以用 `x-dead-letter-routing-key` 指定死信转发时的路由键。

**应用场景**
1. 消费失败的消息隔离,方便排查和人工补偿。
2. 配合 TTL 实现延迟队列,如超时订单取消。
3. 失败消息延迟重试。

### RabbitMQ延迟队列怎么实现？ | 高频
**结论**:两种方式:TTL + 死信交换机,或者官方的 `rabbitmq_delayed_message_exchange` 延迟插件。

**TTL + 死信交换机**
1. 创建一个没有消费者的延迟队列,设置 TTL 并绑定死信交换机。
2. 生产者把消息发到延迟队列。
3. 消息过期后成为死信,被转发到死信交换机并路由到真正的业务队列。
4. 消费者监听业务队列,收到消息时正好延迟了 TTL 时长。

**注意队头阻塞**:RabbitMQ 只检查队头消息是否过期。如果在消息上分别设置不同 TTL,前面一条 TTL 长的消息会挡住后面 TTL 短的消息。所以这种方式通常按延迟时长分队列(如 10s 队列、30min 队列),每个队列用统一的 TTL。

**延迟插件**
- 安装插件后声明 `x-delayed-message` 类型的交换机,消息头设置 `x-delay` 毫秒数。
- 消息先存在交换机中,到期再路由到队列,没有队头阻塞问题,支持任意延迟时间。
- 缺点是延迟消息存在单节点的 Mnesia 表中,不适合海量延迟消息或很长的延迟。

**典型场景**:订单 30 分钟未支付自动取消、定时通知、延迟重试。

### RabbitMQ的高可用机制有哪些？普通集群和镜像集群有什么区别？ | 高频
**结论**:RabbitMQ 有单机、普通集群、镜像集群三种传统模式。普通集群只共享元数据,不算真正高可用;镜像集群把队列复制到多个节点。新版本推荐使用仲裁队列替代镜像队列。

**普通集群**
- 多个节点组成集群,只同步元数据(交换机、队列定义、绑定)。
- 队列的消息只存在于创建它的节点上;消费者连到其他节点时,由该节点从队列所在节点拉取转发。
- 优点是提高吞吐;缺点是队列所在节点宕机后,这个队列的消息不可用(持久化的话要等节点恢复),该节点也容易成为瓶颈。

**镜像集群(经典镜像队列)**
- 通过 policy 把队列和消息复制到多个节点,一个主节点、多个镜像节点。
- 主节点宕机后,最老的镜像提升为新主,对客户端基本透明。
- 缺点:每条消息都要同步到所有镜像,网络和性能开销大;单个队列的数据量无法通过加节点线性扩展;网络分区时可能出现数据不一致。
- 经典镜像队列在 RabbitMQ 3.9 被标记为弃用,4.0 已移除。

**仲裁队列(Quorum Queue)**
- RabbitMQ 3.8 引入,基于 Raft 协议,写入需要多数派节点确认。
- 数据安全性和故障切换更可靠,是目前官方推荐的高可用队列。
- 声明时设置 `x-queue-type=quorum`,通常部署 3 或 5 个节点。

| 模式 | 消息是否多副本 | 节点宕机影响 | 现状 |
| --- | --- | --- | --- |
| 普通集群 | 否,只有元数据共享 | 队列所在节点宕机则队列不可用 | 仍可用,用于扩展吞吐 |
| 镜像集群 | 是,全量镜像 | 自动切换到镜像 | 3.9 弃用,4.0 移除 |
| 仲裁队列 | 是,Raft 多数派 | 多数派存活即可读写 | 推荐 |

此外 RabbitMQ 3.9 起还提供 Stream 队列,面向大量消息堆积和重复消费的日志式场景。

## 通用问题与实战

### 消息队列如何保证消息不丢失？从生产者、Broker、消费者三个角度说明
**结论**:生产者等确认并重试,Broker 持久化加多副本,消费者处理成功后再确认。三个环节都做到,才能实现 At least once。

| 环节 | 丢失原因 | Kafka | RocketMQ | RabbitMQ |
| --- | --- | --- | --- | --- |
| 生产者 | 网络失败、Broker 未写入 | `acks=all` + 重试 + 回调处理 | 同步发送检查 `SEND_OK` + 重试 | Publisher Confirm + Return(`mandatory`) |
| Broker | 宕机、页缓存未刷盘、单点磁盘故障 | 副本数 ≥ 3、`min.insync.replicas` ≥ 2、禁止 unclean 选举 | 同步刷盘 + 同步复制 | 交换机、队列、消息持久化 + 仲裁队列 |
| 消费者 | 先确认后处理,处理失败或宕机 | 关闭自动提交,处理后手动提交 offset | 处理成功后返回 `CONSUME_SUCCESS` | 手动 ack |

**补充**
- 生产端的终极兜底是本地消息表或事务消息:先把消息和业务数据写在同一个本地事务里,再由定时任务补发。
- 可靠性和性能是权衡:同步刷盘、同步复制、`acks=all` 都会降低吞吐。
- 不丢必然会带来可能重复,所以消费端要幂等。

### 消息队列是怎么保证高可用的？
**结论**:三者都靠集群 + 数据多副本 + 故障自动切换,但实现不同。

| MQ | 高可用方式 | 故障切换 |
| --- | --- | --- |
| Kafka | 每个 Partition 多副本分布在不同 Broker,Leader 读写、Follower 同步 | Controller 从 ISR 中选新 Leader;4.0 起元数据完全由 KRaft 管理 |
| RocketMQ | 多个 Broker 组,每组 Master/Slave 主从复制 | 传统主从不自动切换(只能从 Slave 读);DLedger(Raft)或 5.x Controller 模式下自动选主 |
| RabbitMQ | 普通集群只共享元数据;镜像队列或仲裁队列复制消息 | 仲裁队列基于 Raft,多数派存活即可;经典镜像队列 4.0 已移除 |

此外,生产者和消费者要配置多个 Broker 地址或 NameServer 地址,客户端自动重连;部署上做到跨机架或跨可用区。

### 什么是消息重复消费？如何保证消费幂等？ | 高频
**结论**:为了不丢消息,MQ 普遍采用至少一次投递,生产者重试和消费者确认丢失都会导致重复。解决办法是消费端幂等:同一条消息处理多次,结果和处理一次相同。

**产生重复的原因**
- 生产者没收到 ACK 而重发,Broker 中出现两条相同消息。
- 消费者处理成功后 ack/offset 提交失败,或提交前宕机。
- Rebalance 导致分区换消费者,从旧位移重新消费。

**幂等方案**
1. **数据库唯一索引**:以订单号、支付流水号或消息 ID 作为唯一键,重复插入报唯一键冲突,捕获后视为已处理。
2. **去重表 / 消费记录表**:处理前插入消息 ID,和业务操作放在同一个本地事务里,插入失败说明已处理过。
3. **Redis 去重**:`SET key value NX EX` 原子写入消息 ID 并设置过期时间。注意先标记后处理时,处理失败要删除标记,否则消息会被误判为已处理;Redis 和数据库之间也不是原子的,关键业务最好用数据库唯一约束兜底。
4. **状态机**:更新时带状态条件,如 `UPDATE orders SET status='PAID' WHERE id=? AND status='UNPAID'`,影响行数为 0 说明已处理。
5. **乐观锁版本号**:`WHERE version = ?`,重复消息版本不匹配。
6. **Token 机制**:业务方先申请唯一 Token,处理时校验并删除 Token,只有一次能成功。

**注意点**
- 消息 ID 要用业务唯一 ID。MQ 生成的消息 ID 在业务层重新构造消息发送时会变化(如补偿任务重发会得到新的 msgId),不可靠。
- 并发场景下「先查后写」不是原子的,要靠唯一索引或分布式锁兜底。
- Kafka 的幂等生产者只解决「生产端重试导致的重复写入」,不能代替消费端幂等。

### 怎么保证消息的顺序消费？
**结论**:放弃全局并行,把需要有序的消息路由到同一个队列/分区,并保证同一队列只被一个消费线程串行处理。

**发送端**
- Kafka:用业务 key(如订单 ID)作为消息 key,哈希到同一 Partition。
- RocketMQ:使用 `MessageQueueSelector`,按业务 ID 选择 MessageQueue。
- RabbitMQ:同一业务的消息发到同一个队列。
- 同一业务的消息由同一生产者同步、顺序发送;Kafka 开启幂等防止重试乱序。

**消费端**
- 一个队列/分区只对应一个消费者线程。Kafka 组内一个分区天然只给一个消费者;RocketMQ 使用 `MessageListenerOrderly`;RabbitMQ 一个队列只挂一个消费者,并设置 `prefetch=1` 或保证单线程处理。
- 消费者内部想多线程提速,只能按 key 哈希到固定线程,保证同一 key 串行。

**代价**
- 吞吐下降,并行度受队列数限制。
- 某条消息消费失败会阻塞同队列后续消息,需要设置最大重试次数和告警。
- 实际需求通常是局部有序(同一订单内有序),全局有序只能用单分区单消费者。

### 死信队列是什么？有什么作用？
**结论**:死信队列(DLQ)存放无法正常消费的消息,把异常消息从正常链路中隔离出来,便于排查和补偿。

**消息成为死信的常见条件**
1. 消费失败且重试次数达到上限(RocketMQ 默认重试 16 次后进入 `%DLQ%消费组`)。
2. 消息 TTL 过期(RabbitMQ)。
3. 队列长度达到上限,消息被挤出(RabbitMQ)。
4. 消息被拒绝且不重新入队(RabbitMQ `basic.reject/nack` 且 `requeue=false`)。

**各 MQ 支持情况**
- RabbitMQ:通过队列参数 `x-dead-letter-exchange` 绑定死信交换机。
- RocketMQ:原生支持,按消费组自动创建死信 Topic。
- Kafka:Broker 不提供死信队列,一般由客户端实现,如 Spring Kafka 的 `DeadLetterPublishingRecoverer` 把失败消息转发到 `原Topic.DLT`。

**作用**
1. 隔离异常消息,避免一条坏消息无限重试、阻塞正常消费。
2. 保留现场,便于定位失败原因。
3. 单独消费死信做告警、人工干预或自动补偿。
4. 在 RabbitMQ 中配合 TTL 实现延迟队列。

### 如何实现延迟消息？RabbitMQ、RocketMQ、Kafka分别怎么做？
**结论**:RocketMQ 原生支持(4.x 固定 18 个级别,5.x 任意时间定时消息);RabbitMQ 用 TTL + 死信交换机或延迟插件;Kafka 不原生支持,需要自己实现。

| MQ | 实现方式 | 特点 |
| --- | --- | --- |
| RocketMQ 4.x | `setDelayTimeLevel`,消息先进 `SCHEDULE_TOPIC_XXXX`,定时任务到期转投 | 只能用固定级别 |
| RocketMQ 5.x | 定时消息 `setDeliverTimestamp`,时间轮实现 | 支持任意时间点 |
| RabbitMQ | TTL + 死信交换机;或 `rabbitmq_delayed_message_exchange` 插件 | TTL 方案有队头阻塞,需按延迟时长分队列;插件方案更灵活但不适合海量消息 |
| Kafka | 多级延迟 Topic 或外部存储 + 定时投递 | 需要自行开发 |

**Kafka 的常见做法**
1. **多级延迟 Topic**:创建 `delay-5s`、`delay-30s`、`delay-5m` 等 Topic,生产者按延迟时长发送。转发服务消费这些 Topic,检查消息是否到期:到期就转投真实业务 Topic;未到期就 `pause()` 该分区并在到期后 `seek()` 回来重新拉取,避免忙等。缺点是延迟级别固定,Topic 管理复杂。
2. **外部存储 + 定时扫描**:先把消息和执行时间写入 MySQL 或 Redis ZSet(score 为执行时间),定时任务扫描到期消息再投递到 Kafka。灵活,但需要额外存储和扫描,要注意扫描的重复与并发问题。
3. **时间轮**:在转发服务中用时间轮调度,适合大量短延迟消息。

**典型场景**:订单超时关闭、延迟检查任务状态、预约通知、失败延迟重试。

### 如果有100万消息堆积在MQ,如何解决？ | 高频
**结论**:堆积的本质是消费速度持续低于生产速度。先定位原因并恢复消费能力,再扩容提升吞吐,必要时临时扩容追平积压,最后做好预防和监控。

**先定位原因**
1. 消费者是否宕机、卡死或不断抛异常重试(如下游接口超时、慢 SQL)。
2. 是否有毒消息导致同一条消息反复失败(顺序消费时会阻塞整个队列)。
3. 消费者数量和队列/分区数量是否匹配。
4. 是否生产端流量突增。
5. Kafka 中是否 offset 提交异常或频繁 Rebalance,导致消费停滞。

**处理手段**
1. **修复消费端问题**:修 bug、优化慢 SQL、给下游调用加超时,异常消息转入死信,避免阻塞。
2. **提高单消费者能力**:批量拉取、批量写库,消费者内部按 key 并行处理。
3. **增加消费者实例**:Kafka 中组内消费者数不能超过分区数,多出来的会空闲;RocketMQ 同理受 MessageQueue 数限制;RabbitMQ 可以直接加消费者。
4. **扩分区/队列**:Kafka 可以增加分区(注意会影响按 key 的顺序)。
5. **临时紧急扩容**:新建一个分区数是原来几倍的临时 Topic,写一个只做转发不做业务的程序,把积压消息快速搬到临时 Topic,再用大量消费者并行消费临时 Topic;追平后恢复原架构。
6. **生产端限流或降级**:必要时暂停或延后非核心消息的生产。
7. **RabbitMQ**:使用惰性队列让消息直接存磁盘,减少内存压力(3.12 起经典队列默认就是这种行为,仲裁队列也会把消息写盘)。

**注意点**
- 盲目加消费者可能把下游数据库或接口打垮,要评估下游承载能力。
- 如果消息设置了 TTL 已经过期丢失,需要从业务数据中查出缺失的数据补发。
- 预防:监控消费延迟(Kafka 的 consumer lag)、堆积量告警,提前做容量评估和压测。

### 消息队列有哪些容易混淆的点？
1. MQ 提升主流程响应速度,是把耗时操作异步后移,不是让任务消失。
2. MQ 能削峰,但如果消费能力长期不足,最终仍会堆积。
3. 不丢失和不重复不能只靠 MQ:不丢靠三个环节的确认机制,不重复靠消费端幂等。
4. Kafka 只保证单 Partition 内有序,不保证 Topic 全局有序。
5. Kafka 组内消费者数量超过 Partition 数量时,多出来的消费者空闲。
6. 自动提交 offset 可能重复也可能丢失;手动提交能避免丢失,但仍可能重复。
7. Kafka 幂等生产者只保证单会话、单分区不重复;Exactly-Once 只覆盖 Kafka 内部链路。
8. ISR 不是全部副本,而是与 Leader 保持同步的副本集合(包含 Leader)。
9. `acks=all` 要配合 `min.insync.replicas >= 2` 才真正可靠。
10. Kafka 的「零拷贝」用于消费者拉取时的 `sendfile`,开启 SSL 后不能使用。
11. RabbitMQ 的 TTL + 死信延迟方案有队头阻塞问题,经典镜像队列在 4.0 已移除,推荐仲裁队列。
12. RocketMQ 4.x 延迟消息只支持固定级别,5.x 才支持任意时间。