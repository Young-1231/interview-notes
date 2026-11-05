## 导读
- 高频必背:缓存穿透/击穿/雪崩、缓存与数据库双写一致性、分布式锁(SET NX EX + Lua 释放 + 看门狗)、RDB/AOF/混合持久化、过期删除与内存淘汰、主从复制与 Sentinel/Cluster。
- 线程模型别答成"Redis 就是单线程":命令执行是单线程,6.0 起网络 I/O 可多线程,另有后台 bio 线程和 fork 子进程。
- 易混:过期删除策略(惰性+定期)和内存淘汰策略(maxmemory-policy)是两回事;ziplist 在 Redis 7 已被 listpack 取代。

## 纠正: Redis常见5种数据结构的底层实现
原文说 List 在元素少时用压缩列表、多时转双向链表,Hash/Zset 小数据用 ziplist,这是旧版本说法。
- List:3.2 起统一是 quicklist(双向链表,每个节点是一段 ziplist,7.0 起节点改为 listpack);7.2 起元素少时直接用 listpack,变大再转 quicklist。
- Hash、Zset:7.0 起小数据编码是 listpack(默认阈值 128 个元素、单个值 64 字节),超过后分别转 hashtable、skiplist + dict。
- Set:整数且不超过 512 个用 intset;7.2 起少量非整数元素用 listpack;其余用 hashtable。

## 纠正: Redis是单线程的，为什么还这么快
原文把 Redis 当成纯单线程,实际只有"命令执行"是单线程。Redis 6.0 起可开启 I/O 多线程(io-threads,默认关闭)来做网络读写和协议解析;此外还有处理关闭文件、AOF fsync、lazy free 的后台 bio 线程,RDB/AOF 重写由 fork 出的子进程完成。

## 纠正: redis是单线程为什么快
原文说"Redis使用单线程模型",应限定为"命令执行是单线程"。Redis 6.0 起网络 I/O 可配置多线程(默认关闭),另有后台线程做 fsync、异步释放内存等,持久化重写由子进程完成。

## 纠正: Redis是单线程还是多线程
原文把 bgsave、bgrewriteaof 归为"后台多线程"任务,实际它们是 fork 出的子进程,不是线程。后台线程(bio)负责的是关闭文件、AOF fsync 和 lazy free(UNLINK、FLUSHALL ASYNC 等)。4.0 新增的是 lazy free 能力。

## 纠正: redis后台线程是做什么的
原文说 RDB 持久化和执行内存淘汰是后台线程做的,实际 RDB(bgsave)由 fork 出的子进程完成,淘汰策略在主线程里执行(开启 lazyfree-lazy-eviction 后,被淘汰 key 的内存释放才交给后台线程)。后台 bio 线程做三件事:关闭文件、AOF fsync、lazy free 异步释放内存。

## 纠正: Redis集群主从复制原理
原文说增量同步时从节点带上主节点的 runid,这是 4.0 之前的做法。4.0 起 PSYNC 携带的是 replication ID(replid)和 offset(PSYNC2),主从切换后新主节点会保留旧的 replid(replid2),其他从节点仍可增量同步。

## 纠正: redis的持久化机制有哪些？AOF日志和RDB日志有什么区别
原文说 AOF "能保证数据不丢失",实际取决于 appendfsync:默认 everysec 宕机最多丢约 1 秒数据,只有 always 才接近不丢,代价是性能大幅下降。AOF 也谈不上"强一致性"。

## 纠正: redis如何实现分布式锁？可能会出现哪些问题
原文说用 SETNX 加锁"并设置过期时间",SETNX 本身不能带过期时间,SETNX 后再 EXPIRE 是两条命令,中间宕机就会留下永不过期的锁。正确做法是一条原子命令 `SET key uniqueValue NX PX 30000`,释放时用 Lua 脚本先比对 value 再 DEL,不能直接 DEL。

## 纠正: 什么是集群脑裂问题
原文说 Redis 通过 Quorum 和一致性协议"确保只有一个主节点具有写权限",实际做不到。quorum 只用来判定主节点客观下线和选 leader,被隔离的旧主在被降级前仍会接受写入,恢复后作为从节点全量同步,这些写会丢失。只能用 min-replicas-to-write、min-replicas-max-lag 让孤立旧主拒绝写入,以此缩小损失。

## 纠正: 多大算大key，会导致什么问题，怎么解决
原文说操作大 key "可能引发垃圾回收(GC)",Redis 是 C 写的,没有 GC。大 key 的真实问题是:命令执行和 DEL 阻塞主线程、网络带宽高、集群数据倾斜、fork/迁移变慢。删除大 key 用 UNLINK(或开启 lazyfree)异步释放。

## 纠正: qps多少算热key，会导致什么问题，怎么解决
原文把热 key 导致的问题叫"缓存雪崩",概念混了。热 key 的直接问题是单节点 CPU/带宽被打满;热 key 过期导致请求打到数据库是缓存击穿;雪崩指大量 key 同时过期或 Redis 整体不可用。

## 纠正: 如何从海量key中找某一固定前缀的key
原文说 COUNT "用于限制每次返回的key数量",实际 COUNT 只是每次迭代扫描工作量的提示(默认 10),返回数量可能多于或少于它,带 MATCH 时甚至可能返回空而游标未结束,要一直迭代到游标为 0。SCAN 还可能返回重复 key,业务要去重。

## 纠正: Redis使用的业务场景
原文说倒序排名用 zcard-zrank,这样算差 1,正确是 zcard - zrank - 1,而且直接用 ZREVRANK 就行。

## 补充: redis有事务吗？是否支持回滚
- 入队时就出错(命令不存在、参数个数错):EXEC 直接拒绝,整个事务都不执行(2.6.5 起)。
- 执行时出错(如对 String 执行 LPUSH):只有出错的命令失败,其余照常执行,不回滚。
- WATCH 是乐观锁,被 WATCH 的 key 在 EXEC 前被改动,EXEC 返回 nil。Lua 脚本能保证执行期间不被其他命令插入,但脚本中途报错同样不会回滚已执行的写操作。

## 补充: Redis的持久化机制有哪些，RDB和AOF的优缺点
- 默认配置:RDB 开启,AOF 关闭(appendonly no);开启 AOF 后默认 appendfsync everysec。
- aof-use-rdb-preamble 从 5.0 起默认 yes,即 AOF 重写默认就是混合格式。
- 7.0 起 AOF 改为 Multi Part AOF:一个 base 文件加若干 incr 文件,由 manifest 管理,重写不再需要 AOF 重写缓冲区。
- 两者同时开启时,重启优先用 AOF 恢复。

## 补充: Redis的内存淘汰策略
默认策略是 noeviction(原文没列),内存满后写命令报错,读命令照常执行。Redis 的 LRU/LFU 都是近似算法:每次随机采样 maxmemory-samples(默认 5)个 key 来挑淘汰对象,不维护全量链表。

## 补充: redis中的内存淘汰策略
原文少了 4.0 加入的 allkeys-lfu 和 volatile-lfu,目前一共 8 种,默认 noeviction。

## 补充: Redison分布式锁存在什么问题
RedLock 有公认争议:Martin Kleppmann 指出它依赖各节点时钟正确,并且客户端 GC 停顿、网络延迟后锁可能已经过期,自己却以为还持有。严格互斥要靠 fencing token(单调递增版本号,由存储端校验)或 ZooKeeper/etcd。Redisson 已将 RedissonRedLock 标记为废弃。

## 补充: 删除redis中的key，它会立刻被清理掉吗
- DEL 同步释放内存;UNLINK 先摘除 key,内存交给后台线程释放。过期 key 不会到点立刻删,要靠惰性删除或定期删除。
- RDB:生成快照时跳过已过期的 key;主节点加载时忽略过期 key,从节点全部载入,等主节点同步 DEL。
- AOF:过期 key 被删除时追加一条 DEL;AOF 重写时跳过已过期的 key。
- 从节点不主动删除过期 key,统一等主节点发 DEL(3.2 起读从节点时会对过期 key 返回空)。

## 自测
### Redis 是单线程的吗?
命令执行是单线程。6.0 起网络 I/O 可多线程(默认关闭),另有后台 bio 线程和 fork 出的持久化子进程。
### Redis 为什么快?
纯内存操作、I/O 多路复用(epoll)、单线程执行命令没有锁竞争和上下文切换、底层数据结构高效。
### Redis 7 中 Hash 和 ZSet 的小数据编码是什么?
listpack(取代 ziplist,解决连锁更新)。超过 128 个元素或单值超过 64 字节时,Hash 转 hashtable,ZSet 转 skiplist + dict。
### ZSet 大数据量时为什么要同时用 skiplist 和 dict?
dict 按 member 以 O(1) 查 score,skiplist 按 score 做范围查询和排名,时间复杂度 O(log N)。
### 过期 key 怎么删除?
惰性删除(访问时检查)加定期删除(默认每 100ms 随机抽查一批带 TTL 的 key)。
### 默认的内存淘汰策略是什么?纯缓存场景推荐哪个?
默认 noeviction。纯缓存推荐 allkeys-lru,热点稳定时用 allkeys-lfu。
### RDB 和 AOF 的核心区别?
RDB 是定时生成的二进制快照,恢复快但会丢两次快照之间的数据;AOF 记录写命令,everysec 最多丢约 1 秒,但文件大、恢复慢。
### 混合持久化是什么?
AOF 重写时先写一份 RDB 格式的全量数据,后面追加增量命令,恢复快又少丢数据,5.0 起默认开启。
### bgsave 的原理?
fork 子进程写快照,靠 Copy-On-Write 和主进程共享内存。只有 fork 复制页表时会短暂阻塞主进程。
### Redis 事务支持回滚吗?
不支持。入队错误会让整个事务不执行;运行时错误只影响出错的那条命令,其余照常执行。WATCH 提供乐观锁。
### 正确的 Redis 分布式锁怎么写?
`SET key uuid NX PX ttl` 原子加锁,用 Lua 脚本比对 uuid 后 DEL,业务执行时间不确定时用看门狗续期。
### Redisson 看门狗的默认参数?
不指定 leaseTime 时锁默认 30 秒过期,每 10 秒(过期时间的 1/3)续期一次。指定了 leaseTime 就不续期。
### RedLock 的做法和争议?
向 N 个独立主节点加锁,过半成功且总耗时小于 TTL 才算拿到锁。它依赖时钟,也防不住 GC 停顿导致的锁过期,严格互斥需要 fencing token。
### 缓存穿透、击穿、雪崩怎么区分?
穿透是查不存在的数据(用空值缓存、布隆过滤器);击穿是单个热点 key 过期(用互斥锁、逻辑过期);雪崩是大量 key 同时过期或 Redis 挂了(用随机 TTL、高可用、限流降级)。
### 缓存与数据库双写一致性的常用方案?
先更新数据库再删缓存(Cache-Aside)。删除失败用 MQ 重试或订阅 binlog(Canal)异步删除,再加 TTL 兜底。
### 全量同步和增量同步怎么判断?
从节点 PSYNC 带上 replid 和 offset:replid 一致且 offset 还在 repl_backlog 里就增量同步,否则全量同步(bgsave 发 RDB,再补缓冲区里的命令)。
### Redis Cluster 怎么分片?为什么是 16384 个槽?
CRC16(key) % 16384 定位槽,槽分给各个主节点。16384 位的槽位图只有 2KB,心跳包小,而且节点数一般不超过 1000,这个槽数足够。
### Sentinel 怎么判断主节点下线?
单个 Sentinel 超时判定主观下线(SDOWN),达到 quorum 个 Sentinel 同意后判定客观下线(ODOWN),再选 leader 执行故障转移。
### 怎么缓解脑裂?
配置 min-replicas-to-write 和 min-replicas-max-lag,让同步的从节点不够的旧主拒绝写入。脑裂无法彻底避免。
### 怎么删除大 key?
用 UNLINK 或开启 lazyfree 异步释放内存;集合类型也可以用 HSCAN、SSCAN 等分批删除。
