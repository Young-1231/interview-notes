## 事务与隔离级别
### 什么是事务？ | 高频
事务是数据库里不可分割的最小执行单元。它由一组 SQL 操作组成，这组操作要么全部成功提交，要么全部失败回滚，不会只执行一部分。

**典型例子**：转账时，A 扣 100、B 加 100 必须放在同一个事务里，否则中途失败会出现钱扣了却没到账的情况。

```sql
START TRANSACTION;   -- 或 BEGIN
UPDATE account SET balance = balance - 100 WHERE user_id = 1;
UPDATE account SET balance = balance + 100 WHERE user_id = 2;
COMMIT;              -- 出现异常时执行 ROLLBACK
```

**要点**
- MySQL 中只有 InnoDB 等事务型引擎支持事务，MyISAM 不支持。
- 默认 `autocommit = 1`，每条 SQL 自动作为一个事务提交；显式 `BEGIN` 后要手动 `COMMIT` 或 `ROLLBACK`。
- 可以用 `SAVEPOINT` 设置保存点，回滚到事务中间的某个状态。
- DDL 语句会隐式提交当前事务。
- 在 Spring 里一般用 `@Transactional` 声明事务，底层就是关闭 autocommit 后执行 commit / rollback。

### 事务的四大特性（ACID）是什么？ | 高频
ACID 指原子性、一致性、隔离性、持久性。其中一致性是目的，原子性、隔离性、持久性是手段。

- **原子性（Atomicity）**：事务里的操作要么全部完成，要么全部不做；执行出错时会回滚到事务开始前的状态。
- **一致性（Consistency）**：事务执行前后，数据都满足完整性约束和业务规则，比如转账前后两个账户的总额不变，主键、唯一键、外键约束不被破坏。
- **隔离性（Isolation）**：并发执行的事务之间互不干扰，一个事务看不到另一个事务未提交的中间状态，具体能隔离到什么程度由隔离级别决定。
- **持久性（Durability）**：事务一旦提交，对数据的修改就是永久的，即使数据库宕机重启也不会丢失。

### MySQL 是怎么保证 ACID 的？ | 高频 | 农业银行、交通银行
InnoDB 的做法是：原子性靠 undo log，持久性靠 redo log（加上两阶段提交、Doublewrite），隔离性靠 MVCC 和锁，一致性由前三者再加上数据库约束和应用逻辑共同保证。

| 特性 | 实现机制 |
| --- | --- |
| 原子性 | undo log：每次修改前记录旧值（逻辑上的反向操作），回滚时按 undo log 逆向恢复 |
| 持久性 | redo log + WAL：提交时先把 redo log 刷盘（`innodb_flush_log_at_trx_commit = 1`），脏页之后异步刷；宕机后重放 redo log。Doublewrite Buffer 防止页只写了一半 |
| 隔离性 | MVCC（快照读，靠 Read View 和 undo 版本链）+ 锁（当前读，靠记录锁、间隙锁、临键锁），按隔离级别控制可见性 |
| 一致性 | 由 A、I、D 加上主键、唯一、外键、非空等约束和业务逻辑一起保证 |

**补充**
- 事务的控制语句是 `BEGIN` / `START TRANSACTION`、`COMMIT`、`ROLLBACK`，隔离级别有 RU、RC、RR、Serializable 四种，InnoDB 默认 RR。
- redo log 和 binlog 之间用两阶段提交保持一致，保证崩溃恢复后的主库和从库数据一致。

### 并发事务会出现哪些问题？什么是脏读、不可重复读、幻读？ | 高频
多个事务并发执行时，如果不做隔离，会出现脏读、不可重复读、幻读这三类读问题，还有丢失更新这种写问题。隔离级别就是用来控制这些问题的。

- **脏读**：事务 A 读到了事务 B 还没提交的修改。如果 B 之后回滚，A 读到的就是从来没有真正存在过的数据。
- **不可重复读**：事务 A 在同一个事务里两次读同一行，中间事务 B 修改并提交了这行，导致 A 两次读到的值不一样。重点是同一行的内容变了（UPDATE / DELETE）。
- **幻读**：事务 A 用同样的条件做了两次范围查询，中间事务 B 插入（或删除）了满足条件的行并提交，导致 A 第二次查到的行数变了，好像出现了“幻影行”。重点是结果集的行数变了，主要由 INSERT 引起。
- **丢失更新**：两个事务都先读同一个值再各自修改，后提交的覆盖了先提交的。可以用 `UPDATE ... SET x = x - 1` 这种原子更新、`SELECT ... FOR UPDATE` 悲观锁，或者版本号乐观锁来解决。

**举例（不可重复读）**
```sql
-- 事务A                         -- 事务B
SELECT balance FROM acc WHERE id=1;  -- 100
                                 UPDATE acc SET balance=200 WHERE id=1; COMMIT;
SELECT balance FROM acc WHERE id=1;  -- RC 下读到 200，RR 下仍是 100
```

### MySQL 有哪些隔离级别？默认是哪个？分别靠什么实现？ | 高频 | 农业银行、蚂蚁、淘天
SQL 标准定义了四种隔离级别：读未提交（RU）、读已提交（RC）、可重复读（RR）、串行化（Serializable）。InnoDB 默认是 RR。隔离级别越高，一致性越强，并发度越低。

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | InnoDB 实现 |
| --- | --- | --- | --- | --- |
| 读未提交 RU | 可能 | 可能 | 可能 | 读最新版本，不做可见性控制 |
| 读已提交 RC | 不会 | 可能 | 可能 | MVCC，每次 SELECT 都生成新的 Read View；当前读只加记录锁 |
| 可重复读 RR（默认） | 不会 | 不会 | 大部分情况能避免 | MVCC，事务里第一次 SELECT 生成 Read View 并一直复用；当前读加 Next-Key Lock |
| 串行化 | 不会 | 不会 | 不会 | autocommit 关闭时，普通 SELECT 也会隐式变成 `LOCK IN SHARE MODE`，读写互斥 |

**查看和修改**（MySQL 8.0 的变量名是 `transaction_isolation`，5.7 是 `tx_isolation`）：
```sql
SELECT @@transaction_isolation;
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

**RC 和 RR 的其他区别**
- 加锁：RC 一般只加记录锁、不加间隙锁（外键和唯一键冲突检查除外），语句结束释放不满足条件行的锁；RR 加 Next-Key Lock，阻止往范围内插入。
- binlog：RC 必须用 ROW 格式（STATEMENT 会主从不一致），RR 三种都支持。

**易错点**：InnoDB 的 RR 比标准更强，快照读靠 MVCC、当前读靠 Next-Key Lock，能避免大部分幻读，但快照读与当前读混用时仍可能幻读。

### 为什么互联网公司常用 RC 隔离级别？ | 高频
主要是为了提高并发、减少死锁。RC 不加间隙锁，锁的范围小、冲突少，而 RC 带来的不可重复读，大多数互联网业务都能接受，也可以在业务层补救。阿里等公司的很多业务库都把隔离级别设成了 RC。

**原因**
- **锁粒度更小，并发更高**：RR 下的当前读会加 Next-Key Lock，范围更新或者条件没走索引时会锁住大片间隙，甚至相当于锁全表；RC 只锁命中的记录，而且语句执行完就会释放不满足条件的行上的锁（semi-consistent read 半一致读）。
- **死锁更少**：间隙锁之间不冲突，但会阻塞插入，多个事务交叉插入时很容易形成死锁。RC 基本没有间隙锁，死锁概率大大降低。
- **业务能接受**：大多数业务关心的是读到已提交的数据，不太要求同一个事务里多次读的结果完全一致。需要强一致的地方，可以用 `SELECT ... FOR UPDATE`、乐观锁版本号、唯一索引、幂等设计来保证。
- **历史原因已经消失**：MySQL 早期的 binlog 只有 STATEMENT 格式，在 RC 下会主从不一致，所以默认设成 RR。现在 binlog 普遍用 ROW 格式（MySQL 5.7.7 起是默认值），这个限制已经不存在了。

**代价**：RC 会出现不可重复读和幻读，对报表统计这种需要一致性快照的场景，要额外处理（比如单独开一个 RR 的只读事务，或者在从库上跑）。

### MySQL 什么情况下会产生死锁？如何排查？
死锁是指两个或多个事务互相持有对方需要的锁，又都在等对方释放，形成循环等待。InnoDB 默认开启死锁检测，发现死锁后会选择回滚代价最小的那个事务（undo 量少的），返回 `ERROR 1213 Deadlock found`。

**常见场景**
- **加锁顺序相反**（最典型）：
```sql
-- 事务1                                   -- 事务2
UPDATE account SET b=b-10 WHERE id=1;
                                           UPDATE account SET b=b-10 WHERE id=2;
UPDATE account SET b=b+10 WHERE id=2;      -- 等待事务2
                                           UPDATE account SET b=b+10 WHERE id=1;  -- 死锁
```
- **间隙锁冲突**：RR 下两个事务对同一不存在的范围 `SELECT ... FOR UPDATE`，都拿到间隙锁（互不冲突），再往间隙插入时插入意向锁与对方间隙锁冲突。
- **二级索引与主键加锁顺序相反**：一个经二级索引回表锁主键，另一个直接锁主键再改二级索引。
- **唯一键冲突**：并发插入同一唯一键，失败方申请共享 Next-Key Lock，多事务间可能成环。

**排查**
- `SHOW ENGINE INNODB STATUS\G` 看 `LATEST DETECTED DEADLOCK`：双方 SQL、持有和等待的锁、回滚了谁。
- `innodb_print_all_deadlocks = ON` 把每次死锁写进错误日志。
- MySQL 8.0 查 `performance_schema.data_locks` / `data_lock_waits`（5.7 是 `information_schema.innodb_locks` / `innodb_lock_waits`）。
- `innodb_deadlock_detect` 默认开启；关掉后只能靠 `innodb_lock_wait_timeout`（默认 50 秒）超时。

**避免**：按相同顺序加锁；事务短小，不在事务里做 RPC；条件走索引，可接受时用 RC 减少间隙锁；应用层捕获死锁后重试。

## MVCC
### 什么是 MVCC？ | 高频
MVCC（Multi-Version Concurrency Control，多版本并发控制）是指给一行数据保留多个历史版本，读操作按自己事务的可见性规则去读合适的版本，不用加锁。这样读和写就不会互相阻塞，可以大幅提高并发度。

**要点**
- InnoDB 用 MVCC 实现了 RC 和 RR 两个隔离级别；RU 直接读最新版本，Serializable 靠加锁，都不用 MVCC。
- **快照读**：普通的 `SELECT`（不加锁），读的是 MVCC 的历史版本。
- **当前读**：`SELECT ... FOR UPDATE`、`SELECT ... FOR SHARE`（8.0 的写法，以前是 `LOCK IN SHARE MODE`）、`INSERT`、`UPDATE`、`DELETE`，读的是最新的已提交版本，并且要加锁。
- MVCC 解决的是读写冲突；写写冲突仍然要靠行锁。

### MVCC 是为了解决什么问题？实现原理是什么？ | 高频
MVCC 要解决的是读写冲突：在不加锁的前提下，让读不阻塞写、写不阻塞读，同时保证隔离性（避免脏读和不可重复读）。它的实现依赖三样东西：行记录里的隐藏字段、undo log 版本链、Read View。

**1. 隐藏字段**：`DB_TRX_ID`（6 字节，最后修改这行的事务 ID）、`DB_ROLL_PTR`（7 字节，指向上一版本在 undo log 中的位置）。

**2. undo log 版本链**：修改前把旧版本写入 undo log，新记录的回滚指针指向它，多个版本串成链表，表头是最新版本。

**3. Read View**：快照读时生成，含 `m_ids`（当时活跃的读写事务 ID）、`min_trx_id`（`m_ids` 最小值）、`max_trx_id`（下一个待分配的事务 ID）、`creator_trx_id`（自己）。

**可见性判断**（从最新版本开始看 `trx_id`）：
- 等于 `creator_trx_id`：自己改的，可见。
- `< min_trx_id`：生成前已提交，可见。
- `>= max_trx_id`：生成后才开启，不可见。
- 介于两者之间：在 `m_ids` 里不可见，否则可见。
- 不可见就顺着回滚指针找上一版本，直到可见或走到链尾（返回空）。

**RC 和 RR 只差 Read View 生成时机**：RC 每次 `SELECT` 都新建，能看到新提交的数据；RR 第一次 `SELECT` 时生成并复用，多次读结果一致。

**补充**：旧版本由 purge 线程在没有 Read View 需要时清理，长事务会导致 undo log 膨胀。

### 可重复读隔离级别下能完全解决幻读吗？ | 高频 | 农业银行、招商银行、拼多多
不能完全解决。InnoDB 的 RR 用两种机制分别防住了大部分幻读：快照读靠 MVCC，当前读靠 Next-Key Lock。但如果一个事务里快照读和当前读混着用，仍然可能出现幻读。

**快照读：MVCC 防住**：事务第一次 `SELECT` 生成 Read View，之后别的事务插入并提交的新行，`trx_id` 对这个 Read View 来说不可见，所以多次普通查询看到的行数一样。

**当前读：Next-Key Lock 防住**：`SELECT ... FOR UPDATE`、`UPDATE`、`DELETE` 会对扫描范围加 Next-Key Lock（记录锁加间隙锁，左开右闭区间），别的事务往这个范围插入数据时会被阻塞，所以两次当前读之间不会多出新行。

**仍会出现幻读的场景**
```sql
-- 事务A
BEGIN;
SELECT * FROM t WHERE id > 5;        -- 快照读，查到 0 行
                                      -- 事务B：INSERT INTO t VALUES (11, ...); COMMIT;
UPDATE t SET x = 1 WHERE id > 5;     -- 当前读，读到最新数据，把 id=11 也更新了
SELECT * FROM t WHERE id > 5;        -- id=11 的 trx_id 变成了 A 自己，A 能看到，多出一行
```
- 另一个场景：事务 A 先快照读，事务 B 插入并提交，A 再用 `SELECT ... FOR UPDATE` 当前读，两次结果的行数不一样。

**怎么避免**：如果事务需要基于“查询结果”做写操作，一开始就用 `SELECT ... FOR UPDATE` 当前读加锁，锁住范围，别的事务就插不进来了。需要彻底杜绝的话，就用 Serializable 隔离级别。

**结论**：MVCC 只保证快照的一致性，并不能阻止别的事务插入；真正阻止插入的是 Next-Key Lock。InnoDB 的 RR 是 MVCC 加上 Next-Key Lock 共同防范幻读，但不是绝对的。

## 日志
### MySQL 有哪些日志？binlog、redo log、undo log 有什么区别？ | 高频
MySQL 的日志分为 Server 层日志和 InnoDB 引擎日志两类。面试重点是三个：binlog（复制和归档）、redo log（崩溃恢复，保证持久性）、undo log（回滚和 MVCC，保证原子性）。

**日志种类**：错误日志、慢查询日志（超过 `long_query_time`）、通用查询日志（记录所有 SQL，开销大，仅调试用）、binlog、中继日志（从库保存拉来的 binlog 供回放），以及 InnoDB 的 redo log / undo log。

**三大日志对比**

| 对比 | binlog | redo log | undo log |
| --- | --- | --- | --- |
| 所在层 | Server 层，所有引擎都能用 | InnoDB 引擎层 | InnoDB 引擎层 |
| 日志类型 | 逻辑日志：SQL 语句或行变化 | 物理日志：在某个数据页的某个偏移做了什么修改 | 逻辑日志：修改前的旧值（反向操作） |
| 作用 | 主从复制、数据备份恢复 | 崩溃恢复，保证持久性 | 事务回滚（原子性）、MVCC 版本链 |
| 写入方式 | 追加写，一个文件写满了就换新文件，不会覆盖 | 固定大小，循环写，checkpoint 之前的部分可以被覆盖 | 存在 undo 表空间里，由 purge 线程回收 |
| 写入时机 | 事务提交时一次性写入 | 事务执行过程中不断写入 redo log buffer | 每次修改数据前写入 |

**补充**：undo log 本身的修改也会生成 redo log，所以崩溃恢复时可以先恢复 undo log，再用它回滚未提交的事务。

### 有了 binlog 为什么还要 redo log？
因为 binlog 没有崩溃恢复（crash-safe）的能力。它不知道哪些修改已经落到了数据页、哪些还没有，没法精确恢复内存里丢掉的脏页；而 redo log 记录的是数据页的物理修改，配合 checkpoint 能准确知道从哪里开始重放。

**具体原因**
- **定位不同**：binlog 是 Server 层的，设计目标是复制和归档，MyISAM 这类引擎也能用；redo log 是 InnoDB 为了 crash-safe 专门实现的。历史上 MySQL 是先有 binlog，InnoDB 作为插件引入后自带 redo log。
- **能不能知道哪些数据已经落盘**：redo log 通过 LSN 和 checkpoint 记录哪些修改已经刷到数据页了，崩溃后只需要重放 checkpoint 之后的部分。binlog 是追加写，没有这样的信息，不知道从哪里开始补数据。
- **粒度**：redo log 是页级别的物理修改，重放是幂等的、速度快；binlog 是逻辑记录，需要重新执行 SQL 或者行变更，速度慢，而且不能直接作用到数据页上。
- **写入时机**：redo log 在事务执行过程中就不断写入，提交时只要把剩下的刷盘就行；binlog 在提交时才一次性写入。

**为什么不能只留 redo log**：redo log 大小固定、循环写，旧内容会被覆盖，不能用来做全量归档和按时间点恢复；而且它是 InnoDB 私有的物理格式，不方便用来做主从复制和 Canal 这类数据订阅。

**结论**：两者分工不同，binlog 负责复制和归档，redo log 负责崩溃恢复，再用两阶段提交保证它们一致。

### redo log 和 undo log 分别有什么作用？有什么区别？ | 高频
redo log 记录“修改后的数据页是什么样”，用来在崩溃后重做已提交的事务，保证持久性；undo log 记录“修改前的数据是什么样”，用来回滚未提交的事务，并为 MVCC 提供历史版本，保证原子性和隔离性。

| 对比 | redo log | undo log |
| --- | --- | --- |
| 保证的特性 | 持久性（D） | 原子性（A），配合 MVCC 实现隔离性（I） |
| 记录内容 | 物理日志：某个表空间、某个页、某个偏移改成了什么值 | 逻辑日志：INSERT 记主键（回滚时删除），DELETE / UPDATE 记旧值（回滚时恢复） |
| 使用时机 | 崩溃重启时重放 | 事务回滚时；快照读沿版本链读旧版本时 |
| 存储 | 固定大小的文件，循环写 | undo 表空间里的回滚段，由 purge 线程清理 |
| 生命周期 | 对应的脏页刷盘、checkpoint 推过去之后就能被覆盖 | 没有任何事务还需要这个版本时才能清理 |

**协同工作**：崩溃恢复时，先用 redo log 把数据页（也包括 undo 页）恢复到崩溃前的状态，再用 undo log 回滚那些还没提交的事务。最终的结果就是：已提交的修改不丢，未提交的修改不留。

### 讲讲 Redo Log | 高频
redo log 是 InnoDB 用来保证事务持久性的物理日志，核心思想是 WAL（Write-Ahead Logging）：先写日志，再写数据页。事务提交时只要把 redo log 刷盘，脏页可以以后再慢慢刷；万一宕机，重启时重放 redo log，就能把已提交的修改恢复出来。

**为什么需要**：每次提交都刷 16KB 数据页是随机 I/O，改几个字节也要写整页；redo log 只记“哪个页哪个偏移改成什么”，体积小且顺序追加写。

**写入过程**
- 改 Buffer Pool 页时生成 redo 记录，先写 redo log buffer（`innodb_log_buffer_size`，默认 16MB），再按刷盘策略 write 到 page cache 并 fsync。
- 每条记录有单调递增的 LSN，数据页上也记录最后修改的 LSN，用来判断恢复时要不要重放。

**文件结构**
- MySQL 8.0.30 之前：`ib_logfile0`、`ib_logfile1`，大小 = `innodb_log_file_size` × `innodb_log_files_in_group`。
- MySQL 8.0.30 起：`innodb_redo_log_capacity` 统一配置（默认 100MB），`#innodb_redo` 目录下 32 个文件，可在线调整。
- 逻辑上是环：`write pos` 往前写，`checkpoint` 之前对应的脏页已刷盘，可覆盖。

**崩溃恢复**：从 checkpoint 开始扫描，页 LSN 小于记录 LSN 就重放；prepare 状态的事务再结合 binlog 判断提交还是回滚。

### 讲讲 Undo Log | 高频
undo log 是 InnoDB 用来保证事务原子性、并支撑 MVCC 的逻辑日志。它记录的是数据修改前的状态，也就是修改的反向操作。回滚时按 undo log 撤销修改；快照读时，沿着 undo log 组成的版本链找到对当前事务可见的历史版本。

**记录什么**
- INSERT：记主键，回滚时删除；insert undo 提交后可直接删（别的快照本来看不到）。
- DELETE：只打删除标记，undo 记旧行，回滚时去掉标记。
- UPDATE：记被改列的旧值；更新主键时变成“标记删除旧行 + 插入新行”。

**作用**
- 回滚：`ROLLBACK` 或崩溃恢复时，从后往前执行 undo 记录，撤销未提交事务的修改。
- MVCC：`DB_ROLL_PTR` 把各版本串成版本链，快照读用 Read View 从新到旧找第一个可见版本。

**存储和清理**
- 存在 undo 表空间的回滚段里，MySQL 8.0 默认 2 个独立 undo 表空间，支持在线截断；写 undo 页也会产生 redo log。
- update undo 提交后不能立刻删，要等没有 Read View 需要时由 purge 线程清理（同时物理删除打了标记的记录）。
- 长事务会让版本链很长，占空间且拖慢快照读，可用 `information_schema.innodb_trx` 找长事务。

### 讲讲 Binlog | 高频
binlog（二进制日志）是 MySQL Server 层的逻辑日志，记录所有修改表结构和数据的操作（DDL 和 DML），不记录 `SELECT`、`SHOW` 这类只读操作。它主要用于主从复制、数据备份和按时间点恢复，也是 Canal 这类数据订阅工具的数据来源。

**特点**
- Server 层实现，与存储引擎无关。
- 追加写：写到 `max_binlog_size`（默认 1GB）切换新文件，不覆盖；`binlog_expire_logs_seconds`（MySQL 8.0 默认 30 天）清理过期文件。
- MySQL 8.0 默认开启，5.7 默认关闭。
- 执行中先写线程私有的 binlog cache，提交时一次性写入，同一事务不会被拆开。

**三种格式**

| 格式 | 记录内容 | 优点 | 缺点 |
| --- | --- | --- | --- |
| STATEMENT | 执行的 SQL 语句本身 | 日志量小 | `NOW()`、`UUID()`、`LIMIT` 不带 `ORDER BY` 这类不确定的语句，在主从上的执行结果可能不一样 |
| ROW（MySQL 5.7.7 起是默认值） | 每一行变化前后的值 | 精确，主从一致性好，方便做数据订阅和闪回 | 批量修改时日志量很大 |
| MIXED | 一般用 STATEMENT，遇到不安全的语句自动改用 ROW | 兼顾日志量和一致性 | 行为不太好预测 |

**用途**：主从复制（从库 I/O 线程拉到 relay log，SQL 线程回放）；全量备份 + `mysqlbinlog` 做按时间点恢复；Canal、Debezium 伪装成从库订阅变更，同步到缓存、ES 或 MQ。

### binlog 有哪些格式？刷盘策略是怎样的？
binlog 有 STATEMENT、ROW、MIXED 三种格式，MySQL 5.7.7 起默认是 ROW。刷盘由 `sync_binlog` 控制，MySQL 5.7.7 起默认值是 1，也就是每次提交都 fsync。

**格式**
- **STATEMENT**：记录执行的 SQL 语句，日志量小。但 `NOW()`、`UUID()`、`RAND()`、不带 ORDER BY 的 `LIMIT` 这类不确定的语句，会导致主从数据不一致。
- **ROW**：记录每一行变化前后的值，最精确，是 RC 隔离级别和数据订阅的前提；缺点是批量操作的日志量很大，可以用 `binlog_row_image = MINIMAL` 只记录必要的列来缓解。
- **MIXED**：默认用 STATEMENT，遇到不确定的语句自动切换成 ROW。

**写入和刷盘过程**
- 事务执行过程中，binlog 先写进每个线程自己的 binlog cache（`binlog_cache_size`，不够用时会落到临时文件）。
- 提交时，先 write：把 cache 里的内容写进 binlog 文件，这时候还只是在操作系统的 page cache 里；再 fsync：真正持久化到磁盘。

**`sync_binlog` 的取值**

| 值 | 行为 | 风险 |
| --- | --- | --- |
| 0 | 每次提交只 write，什么时候 fsync 由操作系统决定 | 机器宕机或断电时可能丢失多个事务的 binlog |
| 1（默认） | 每次提交都 fsync | 最安全，性能最低，靠组提交（group commit）来提升吞吐 |
| N（N > 1） | 每 N 个事务 fsync 一次 | 宕机时最多丢 N 个事务的 binlog |

**“双 1”配置**：`sync_binlog = 1` 加上 `innodb_flush_log_at_trx_commit = 1`，是保证数据不丢、主从一致的标准配置，也是 MySQL 8.0 的默认值。

### redo log 的刷盘策略是怎样的？写满了会怎么样？
redo log 的刷盘由 `innodb_flush_log_at_trx_commit` 控制，默认是 1，也就是每次提交都 fsync，保证已提交的事务不丢。redo log 是固定大小、循环写的；写满了，新的更新会被阻塞，直到脏页刷盘把 checkpoint 推进，腾出空间。

**`innodb_flush_log_at_trx_commit`**

| 值 | 提交时的动作 | 宕机后果 |
| --- | --- | --- |
| 0 | 提交时什么都不做，后台线程每秒把 log buffer write 进 page cache 并 fsync | MySQL 进程崩溃也可能丢最近约 1 秒的事务 |
| 1（默认） | 每次提交都把 log buffer write 并 fsync 到磁盘 | 不丢已提交的事务 |
| 2 | 每次提交只 write 进操作系统的 page cache，每秒 fsync 一次 | MySQL 进程崩溃不丢；操作系统崩溃或断电可能丢约 1 秒的事务 |

**其他刷盘时机**：后台线程每秒一次（所以未提交事务的 redo 也可能已落盘）；log buffer 用量超过一半；其他事务提交时顺带刷共享 buffer；正常关闭时。

**写满了会怎么样**
- 环形结构：`write pos` 往前写，`checkpoint` 往前擦，checkpoint 之前对应的脏页已刷盘可覆盖。
- `write pos` 追上 `checkpoint` 即写满：必须同步刷脏推进 checkpoint，期间更新被阻塞，表现为 TPS 骤降、SQL 偶发变慢。正常情况下用到一定比例就会提前刷脏。
- 易错点：写满不会覆盖未刷盘的日志，也不丢数据，只会变慢。
- 优化：调大容量（MySQL 8.0.30 起 `innodb_redo_log_capacity`，之前 `innodb_log_file_size`），按磁盘能力设 `innodb_io_capacity`。

### 讲讲 binlog 和 redo log 的两阶段提交
两阶段提交（2PC）是 MySQL 内部的一个 XA 事务：把 redo log 的提交拆成 prepare 和 commit 两步，中间夹着写 binlog。这样就能保证 redo log 和 binlog 在逻辑上一致，主库崩溃恢复后的数据和用 binlog 复制出来的从库数据一致。

**为什么需要**：redo log 决定主库恢复后的数据，binlog 决定从库和备份的数据。先写 redo 再写 binlog 中间宕机，主库有从库没有；反过来则从库有主库没有。

**流程**
1. prepare：InnoDB 写 redo log 并刷盘，标记 prepare，记录 XID。
2. 写 binlog 并刷盘（受 `sync_binlog` 控制），带同一 XID。
3. commit：redo log 标记 commit，只需写 log buffer，不必立刻刷盘（binlog 已持久化，可凭它判断）。

**崩溃恢复判断**
- redo 已 commit：直接提交。
- redo 是 prepare：拿 XID 查 binlog，binlog 完整则提交，没有或不完整则回滚。
- 即以 binlog 是否写成功作为提交标准。

**组提交**：双 1 下每个事务要 fsync 两次。MySQL 5.7 起提交分 flush、sync、commit 三阶段排队，同一批事务的 redo 和 binlog 合并 fsync，可用 `binlog_group_commit_sync_delay` 调攒批时间。

## SQL 语句与执行流程
### 一条 SELECT 语句的执行过程是怎样的？ | 高频
一条查询要经过 Server 层的连接器、（查询缓存）、解析器、预处理器、优化器、执行器，然后由执行器调用存储引擎的接口读取数据，最后把结果返回给客户端。

![](images/Java+AI八股-image-5.png)

1. **连接器**：建立 TCP 连接，校验用户名和密码，读取这个用户的权限（之后权限修改了，这个连接也要重新登录才会生效）。空闲连接超过 `wait_timeout`（默认 8 小时）会被断开。
2. **查询缓存**：MySQL 8.0 已经完全移除。5.7 及以前，会先拿 SQL 文本去缓存里找，命中就直接返回；但只要表有任何更新，这张表的缓存就全部失效，命中率很低。
3. **解析器**：做词法分析（识别关键字、表名、列名）和语法分析（判断 SQL 是否符合语法），生成语法树。语法错误就是在这一步报的。
4. **预处理器**：检查表和列是否存在，把 `SELECT *` 展开成所有列。
5. **优化器**：基于成本选择执行计划，比如走哪个索引、多表 JOIN 的顺序、要不要用索引下推或者子查询改写。`EXPLAIN` 看到的就是这一步的结果。
6. **执行器**：先检查有没有这张表的权限，再按执行计划调用存储引擎的接口。比如先取满足条件的第一行，然后循环取下一行；对于引擎层没法判断的条件，在 Server 层过滤，最后把结果集返回给客户端。
7. **存储引擎**：InnoDB 先在 Buffer Pool 里找对应的数据页，找不到再从磁盘读进来，然后按索引查找或者扫描。

### 一条 UPDATE 语句的执行流程是怎样的？日志是怎么写的？ | 高频
UPDATE 前面走的流程和 SELECT 一样（连接器、解析器、优化器、执行器）。区别在执行阶段：InnoDB 要先写 undo log，再修改 Buffer Pool 里的页并写 redo log，最后用两阶段提交把 redo log 和 binlog 一起提交。数据页之后再由后台线程异步刷盘。

以 `UPDATE t SET age = 19 WHERE id = 1` 为例（双 1 配置）：

1. **找记录并加锁**：按主键找到 id = 1，页不在 Buffer Pool 就从磁盘读入，加行级 X 锁。
2. **判断是否需要更新**：新旧值完全相同就直接返回。
3. **写 undo log**：记旧值 age = 18，用于回滚和 MVCC（undo 页的修改也产生 redo）。
4. **改内存页 + 写 redo log buffer**：页变脏页；非唯一二级索引的变更可能先进 Change Buffer。
5. **写 binlog cache**。
6. **两阶段提交**：redo prepare 刷盘 → binlog 写入并刷盘 → redo 标记 commit。
7. **返回成功、释放锁**，数据页未刷盘也没关系。
8. **异步刷脏**：后台线程刷脏页，先写 Doublewrite Buffer 防部分写。

**宕机恢复**：已提交靠 redo 重放，未提交靠 undo 回滚，prepare 状态看 binlog 是否写成功决定提交或回滚。

### SQL 查询关键字的执行顺序是什么？ | 高频
书写顺序是 `SELECT → FROM → JOIN → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT`，逻辑执行顺序是 `FROM → ON → JOIN → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT`。

```sql
SELECT d.name, COUNT(*) AS emp_count
FROM employee e
JOIN department d ON e.department_id = d.id
WHERE e.salary > 10000
GROUP BY d.name
HAVING COUNT(*) > 5
ORDER BY emp_count DESC
LIMIT 10;
```

1. **FROM**：确定数据来自哪些表，先把参与连接的表做笛卡尔积（逻辑上）。
2. **ON**：按连接条件筛选。
3. **JOIN**：如果是外连接，把没匹配上的行补回来，对应的列填 NULL。
4. **WHERE**：按行过滤。这时候还没分组，所以不能用聚合函数，也不能用 SELECT 里定义的别名。
5. **GROUP BY**：分组。
6. **HAVING**：对分组后的结果过滤，可以用聚合函数。
7. **SELECT**：计算要返回的列和表达式，定义别名。
8. **DISTINCT**：去重。
9. **ORDER BY**：排序。这一步已经在 SELECT 之后了，所以可以用别名（比如上面的 `emp_count`）。
10. **LIMIT / OFFSET**：截取结果。

**注意**
- 这是逻辑上的执行顺序，实际执行时优化器会调整，比如把 WHERE 条件下推到 JOIN 之前、利用索引的顺序免去排序。
- MySQL 有个扩展：允许在 GROUP BY 和 HAVING 里使用 SELECT 中定义的别名，但这不是标准 SQL，写的时候不要依赖它。
- WHERE 和 HAVING 的区别：WHERE 在分组前过滤行，HAVING 在分组后过滤组。能在 WHERE 里过滤掉的条件，就尽量不要放到 HAVING 里，可以减少分组的数据量。

### UNION 和 UNION ALL 有什么区别？ | 高频
两者都用来把多个 `SELECT` 的结果上下合并。区别在于 `UNION` 会对合并后的结果去重，`UNION ALL` 直接保留所有行，包括重复的行。

| 对比 | UNION | UNION ALL |
| --- | --- | --- |
| 去重 | 去重（相当于对整个结果做 DISTINCT） | 不去重 |
| 性能 | 要用临时表去重，数据量大时开销明显 | 直接拼接，更快；MySQL 5.7 起，简单的 UNION ALL 甚至不需要临时表 |
| 使用场景 | 确实需要去掉重复行时 | 能确定结果不会重复，或者允许重复时，优先用它 |

```sql
SELECT name FROM student
UNION              -- 改成 UNION ALL 就保留重复的名字
SELECT name FROM teacher;
```

**共同的要求**
- 每个 SELECT 的列数必须相同，对应列的类型要兼容；结果的列名取第一个 SELECT 的列名。
- 要对整体排序，就在最后写一个 `ORDER BY`；如果要对单个子查询排序，需要把它用括号括起来并配合 `LIMIT`，否则子查询里的排序会被忽略。

### BETWEEN 是开区间还是闭区间？ | 高频
闭区间，两端都包含。`a BETWEEN x AND y` 等价于 `a >= x AND a <= y`。

**注意点**
- 要求 x ≤ y，写反了（`BETWEEN 10 AND 1`）会查不到任何结果。
- `NOT BETWEEN x AND y` 等价于 `a < x OR a > y`。
- **日期时间的坑**：如果列是 `DATETIME`，`create_time BETWEEN '2024-01-01' AND '2024-01-31'` 中右边界会被当成 `'2024-01-31 00:00:00'`，31 号当天的数据就漏掉了。更稳妥的写法是左闭右开：
```sql
WHERE create_time >= '2024-01-01' AND create_time < '2024-02-01'
```
- BETWEEN 能走索引的范围扫描。

### LEFT JOIN 和 RIGHT JOIN 有什么区别？ | 高频
两者都是外连接，区别在于保留哪一边的全部行。`LEFT JOIN` 保留左表的所有行，右表没匹配上的列用 NULL 补齐；`RIGHT JOIN` 正好反过来。

```sql
SELECT * FROM A LEFT JOIN B ON A.id = B.a_id;   -- A 的全部行 + B 匹配上的
SELECT * FROM A RIGHT JOIN B ON A.id = B.a_id;  -- B 的全部行 + A 匹配上的
```

| 连接方式 | 结果 |
| --- | --- |
| INNER JOIN | 只返回两边都匹配上的行 |
| LEFT JOIN | 左表全部 + 右表匹配上的，匹配不上就补 NULL |
| RIGHT JOIN | 右表全部 + 左表匹配上的，匹配不上就补 NULL |
| FULL OUTER JOIN | MySQL 不支持，可以用 `LEFT JOIN ... UNION ... RIGHT JOIN` 模拟 |

**注意点**
- 两者可以互相转换：`A RIGHT JOIN B` 等价于 `B LEFT JOIN A`，实际开发中一般统一写 `LEFT JOIN`，可读性更好。
- **ON 和 WHERE 的区别**：对外连接来说，ON 里的条件只影响右表能不能匹配上，左表的行仍然全部保留；条件放在 WHERE 里，就是在连接完成之后再过滤，比如 `WHERE B.status = 1` 会把补了 NULL 的行过滤掉，结果就变成了内连接。
- **找出没有匹配的行**：`A LEFT JOIN B ON ... WHERE B.id IS NULL`。
- **性能**：让小表（或者过滤后结果小的表）作为驱动表，被驱动表的连接字段要建索引。MySQL 8.0.18 起，没有索引的等值连接可以用 Hash Join，代替原来的 Block Nested-Loop。

### 写 SQL：查询每个班级成绩第二名的学生
MySQL 8.0 用窗口函数最直接：按班级分区、按成绩降序排名，再取排名为 2 的那一行。要先确定并列成绩怎么算，选择不同的排名函数。

假设表是 `students(student_id, class_id, name, score)`：

```sql
SELECT student_id, class_id, name, score
FROM (
    SELECT student_id, class_id, name, score,
           DENSE_RANK() OVER (PARTITION BY class_id ORDER BY score DESC) AS rk
    FROM students
) t
WHERE rk = 2;
```

**三个排名函数的区别**（以成绩 100、100、90 为例）

| 函数 | 排名结果 | 取 rk = 2 时 |
| --- | --- | --- |
| `ROW_NUMBER()` | 1、2、3 | 每个班固定只取一个人，并列时是任意的一个 |
| `RANK()` | 1、1、3 | 有并列第一时就没有第二名 |
| `DENSE_RANK()` | 1、1、2 | 取到第二高的分数对应的所有学生 |

**MySQL 5.7 没有窗口函数时**：用相关子查询，找比自己分数高的不同分数正好有 1 个的学生：
```sql
SELECT s.student_id, s.class_id, s.score
FROM students s
WHERE 1 = (
    SELECT COUNT(DISTINCT s2.score)
    FROM students s2
    WHERE s2.class_id = s.class_id AND s2.score > s.score
);
```
这个写法的效果相当于 `DENSE_RANK`，数据量大时性能差，可以给 `(class_id, score)` 建联合索引。

### MySQL 高频手撕 SQL
常考窗口函数、分组聚合 + HAVING、多表 JOIN、分页、事务和锁、覆盖索引。以下均为 MySQL 8.0 写法。

**1. 按年龄倒序生成连续行号**
```sql
SELECT id, name, age,
       ROW_NUMBER() OVER (ORDER BY age DESC) AS rn
FROM t_user;
```

**2. 每个用户的最大连续登录天数**（`user_login(uid, login_date)`，思路：日期减行号，连续日期得到同一个值）
```sql
WITH d AS (SELECT DISTINCT uid, login_date FROM user_login),
r AS (SELECT uid, login_date,
             ROW_NUMBER() OVER (PARTITION BY uid ORDER BY login_date) AS rn
      FROM d),
g AS (SELECT uid, DATE_SUB(login_date, INTERVAL rn DAY) AS grp, COUNT(*) AS cnt
      FROM r GROUP BY uid, grp)
SELECT uid, MAX(cnt) AS max_continuous_days
FROM g
GROUP BY uid;
```

**3. 条件筛选 + 排序 + 分页**：查询年龄 20 到 30、status = 1 的用户，按创建时间倒序，取第一页，每页 10 条。
```sql
SELECT id, name, age, create_time
FROM t_user
WHERE age BETWEEN 20 AND 30 AND status = 1
ORDER BY create_time DESC
LIMIT 0, 10;    -- 第 n 页就是 LIMIT (n-1)*10, 10
```

**4. 每个部门的人数、平均工资（保留 2 位小数）、最高工资**
```sql
SELECT d.id AS dept_id, d.dept_name,
       COUNT(e.id)            AS emp_num,
       ROUND(AVG(e.salary), 2) AS avg_salary,
       MAX(e.salary)          AS max_salary
FROM dept d
LEFT JOIN emp e ON e.dept_id = d.id
GROUP BY d.id, d.dept_name
ORDER BY avg_salary DESC;   -- LEFT JOIN 保留空部门，COUNT(e.id) 得 0
```

**5. 2025 年累计下单金额超过 1000 的用户，带上订单数和总金额**
```sql
SELECT u.id, u.username,
       COUNT(o.id)   AS order_count,
       SUM(o.amount) AS total_amount
FROM t_user u
JOIN `order` o ON o.user_id = u.id
WHERE o.create_time >= '2025-01-01' AND o.create_time < '2026-01-01'
GROUP BY u.id, u.username
HAVING SUM(o.amount) > 1000;
```

**6. 模拟死锁**（两个事务以相反顺序更新两行）
```sql
-- 会话1
START TRANSACTION;
UPDATE account SET balance = balance - 10 WHERE id = 1;
-- 会话2
START TRANSACTION;
UPDATE account SET balance = balance - 10 WHERE id = 2;
-- 会话1：等待会话2释放 id=2 上的锁
UPDATE account SET balance = balance + 10 WHERE id = 2;
-- 会话2：等待会话1释放 id=1 上的锁，形成死锁，InnoDB 回滚其中一个事务
UPDATE account SET balance = balance + 10 WHERE id = 1;
```

**7. 扣库存时查询并加排他锁**
```sql
START TRANSACTION;
SELECT stock FROM product WHERE id = 100 FOR UPDATE;   -- id 是主键，只锁这一行
UPDATE product SET stock = stock - 1 WHERE id = 100 AND stock > 0;
COMMIT;
```

**8. 带异常回滚的转账事务**（存储过程写法）
```sql
DELIMITER //
CREATE PROCEDURE transfer(IN from_id BIGINT, IN to_id BIGINT, IN amt DECIMAL(10,2))
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    START TRANSACTION;
    UPDATE account SET balance = balance - amt WHERE user_id = from_id AND balance >= amt;
    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'insufficient balance';
    END IF;
    UPDATE account SET balance = balance + amt WHERE user_id = to_id;
    COMMIT;
END //
DELIMITER ;
```

**9. 为 `SELECT id, username FROM t_user WHERE phone = ?` 建覆盖索引**
```sql
CREATE INDEX idx_phone_username ON t_user(phone, username);   -- 叶子节点自带主键 id
```
