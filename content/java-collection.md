## 集合体系概览
### Java 集合框架的整体结构？Collection 和 Map 有什么区别？
Java 集合分为两大体系：存单个元素的 `Collection` 和存键值对的 `Map`，两者是平级的根接口，`Map` 并不继承 `Collection`。

**Collection（单列）**
- `List`：有序（按插入顺序）、可重复、可按下标访问。实现类 `ArrayList`、`LinkedList`、`Vector`（及其子类 `Stack`）、`CopyOnWriteArrayList`。
- `Set`：不可重复。`HashSet`（无序）、`LinkedHashSet`（保持插入顺序）、`TreeSet`（排序）。
- `Queue` / `Deque`：队列和双端队列语义。`ArrayDeque`、`LinkedList`、`PriorityQueue`（堆，按优先级出队），并发场景下有 `BlockingQueue` 系列。

**Map（双列）**：key 唯一，每个 key 映射一个 value。`HashMap`、`LinkedHashMap`（保持插入或访问顺序）、`TreeMap`（按 key 排序）、`Hashtable`、`ConcurrentHashMap`。

| 对比 | Collection | Map |
| --- | --- | --- |
| 存储内容 | 单个元素 | key-value 键值对 |
| 访问方式 | 遍历、下标（List）、元素本身 | 通过 key 查找 value |
| 唯一性 | List 可重复，Set 不可重复 | key 不可重复，value 可重复 |
| 遍历 | 本身实现 `Iterable` | 通过 `keySet()`、`values()`、`entrySet()` 视图遍历 |

一句话：List 关注顺序和下标，Set 关注去重，Queue 关注出入队顺序，Map 关注按 key 快速查找。

### Java 常见集合有哪些？分别适合什么场景？ | 农业银行、交通银行
| 需求 | 推荐 | 说明 |
| --- | --- | --- |
| 普通列表、随机访问 | `ArrayList` | 绝大多数场景的默认选择 |
| 栈、队列、双端队列 | `ArrayDeque` | 比 `Stack`、`LinkedList` 更快，不允许 null |
| 优先级队列、Top K | `PriorityQueue` | 二叉小顶堆，出队 O(log n) |
| 去重 | `HashSet` | 依赖 `hashCode` + `equals` |
| 去重且保持插入顺序 | `LinkedHashSet` | |
| 去重且排序、范围查询 | `TreeSet` | 红黑树 |
| 按 key 快速查找 | `HashMap` | 平均 O(1) |
| 保持顺序、实现 LRU | `LinkedHashMap` | `accessOrder = true` + 重写 `removeEldestEntry` |
| key 有序、范围查询 | `TreeMap` | O(log n) |
| 并发读写 Map | `ConcurrentHashMap` | 不要再用 `Hashtable` |
| 读多写少的并发 List | `CopyOnWriteArrayList` | 如监听器列表、配置白名单 |
| 生产者-消费者 | `ArrayBlockingQueue`、`LinkedBlockingQueue` | 线程池的任务队列 |

`Vector`、`Hashtable`、`Stack` 都是 JDK 1.0 的遗留类，方法级 `synchronized`，性能差，新代码不推荐使用。

### List 和 Set 的区别？
两者都继承 `Collection`，核心区别是是否允许重复和是否有序。

| 对比 | List | Set |
| --- | --- | --- |
| 重复元素 | 允许 | 不允许（`add` 重复元素返回 false） |
| 顺序 | 有序，保持插入顺序 | `HashSet` 不保证顺序；`LinkedHashSet` 保持插入顺序；`TreeSet` 按比较规则排序 |
| 下标访问 | 支持 `get(int index)` | 不支持 |
| null | 可存多个 null | `HashSet` 可存一个 null；`TreeSet` 自然排序时不能存 null |
| 判断重复的依据 | 无 | `HashSet` 用 `hashCode()` + `equals()`；`TreeSet` 用 `compareTo()` / `Comparator` 返回 0 |
| 实现类 | `ArrayList`、`LinkedList` | `HashSet`、`LinkedHashSet`、`TreeSet` |

需要保持顺序且允许重复用 List；需要去重用 Set。`contains` 的效率也不同：`ArrayList` 是 O(n)，`HashSet` 平均 O(1)，频繁判断是否存在时应该用 Set。

## List
### ArrayList 的底层结构？插入和删除的时间复杂度？ | 高频 | 工商银行、美团、蚂蚁、农业银行、交通银行
`ArrayList` 底层是可动态扩容的 `Object[] elementData` 数组，实现了 `RandomAccess` 接口，支持按下标 O(1) 随机访问。

| 操作 | 时间复杂度 | 说明 |
| --- | --- | --- |
| `get(i)` / `set(i, e)` | O(1) | 直接按下标访问 |
| `add(e)` 尾部插入 | 均摊 O(1) | 容量满时触发扩容，需要 O(n) 复制，均摊后仍是 O(1) |
| `add(i, e)` 指定位置插入 | O(n) | 需要用 `System.arraycopy` 把 i 之后的元素后移一位 |
| `remove(i)` 指定位置删除 | O(n) | i 之后的元素前移；删除尾部元素是 O(1) |
| `remove(Object)` / `contains` / `indexOf` | O(n) | 需要线性查找 |

特点：内存连续、CPU 缓存友好；允许 null 和重复元素；非线程安全；删除元素不会自动缩容，可调用 `trimToSize()`。

### ArrayList 的扩容机制 | 高频
一句话：懒初始化，第一次 `add` 时容量变为 10；之后容量不够时扩容为原来的 1.5 倍，通过 `Arrays.copyOf` 把旧数组复制到新数组。

**初始容量（JDK 8 起）**：`new ArrayList<>()` 先指向共享空数组 `DEFAULTCAPACITY_EMPTY_ELEMENTDATA`，第一次 `add` 才分配 10；`new ArrayList<>(0)` 指向另一个空数组 `EMPTY_ELEMENTDATA`，之后按 0 → 1 → 2 → 3 → 4 → 6 → 9 增长，不会跳到 10。

**扩容流程**
1. `add` 时 `size == elementData.length`，调用 `grow(minCapacity)`。
2. 新容量 `oldCapacity + (oldCapacity >> 1)`，即 1.5 倍（向下取整，15 → 22）；仍小于所需容量（如 `addAll` 大量元素）时直接用所需容量。
3. 上限接近 `Integer.MAX_VALUE - 8`，超出抛 `OutOfMemoryError`。
4. `Arrays.copyOf` 复制到新数组，底层是 `System.arraycopy`。

```java
// JDK 17 ArrayList.grow 核心逻辑
int oldCapacity = elementData.length;
if (oldCapacity > 0 || elementData != DEFAULTCAPACITY_EMPTY_ELEMENTDATA) {
    int newCapacity = ArraysSupport.newLength(oldCapacity,
            minCapacity - oldCapacity,   // 最小增长量
            oldCapacity >> 1);           // 期望增长量，即 0.5 倍
    return elementData = Arrays.copyOf(elementData, newCapacity);
} else {
    return elementData = new Object[Math.max(DEFAULT_CAPACITY, minCapacity)]; // 首次 add 分配 10
}
```

**为什么是 1.5 倍**：兼顾扩容次数和空间浪费。对比 `Vector` 默认 2 倍、`HashMap` 2 倍。预知元素数量时用 `new ArrayList<>(n)` 或 `ensureCapacity(n)` 避免多次复制。

### ArrayList 和 LinkedList 的区别？ | 高频 | 交通银行、饿了么
| 对比 | ArrayList | LinkedList |
| --- | --- | --- |
| 底层结构 | `Object[]` 动态数组 | 双向链表（`Node` 含 `prev`、`item`、`next`，维护 `first`、`last`） |
| 随机访问 `get(i)` | O(1)，实现 `RandomAccess` | O(n)，从离 i 更近的一端遍历（i < size/2 从头，否则从尾） |
| 头部插入 / 删除 | O(n)，需要移动所有元素 | O(1) |
| 尾部插入 / 删除 | 均摊 O(1) | O(1) |
| 中间插入 / 删除 | O(n)，移动元素 | 定位 O(n) + 修改指针 O(1)，整体仍是 O(n) |
| 内存 | 连续空间，尾部可能有预留的空闲容量 | 每个节点额外存两个引用和对象头，占用更大，且分散在堆中 |
| 缓存友好 | 好 | 差，节点不连续 |
| 扩容 | 需要，1.5 倍 | 不需要 |
| 额外能力 | 无 | 实现了 `Deque`，可当队列、栈、双端队列 |
| 线程安全 | 都不安全 | 都不安全 |

List 接口的其他实现：`Vector`（同步的动态数组，已不推荐）、`Stack`（继承 `Vector`，推荐用 `ArrayDeque` 代替）、`CopyOnWriteArrayList`（并发场景读多写少）。

结论：查询多、尾部追加用 `ArrayList`，实际开发中绝大多数场景都用它；需要频繁在头部操作或当队列使用时，优先 `ArrayDeque`，其次 `LinkedList`。

### 大量增加和删除，用 ArrayList 好还是 LinkedList 好？
不能简单地说"增删多就用 LinkedList"，要看在哪里增删。

- **在头部增删**：`LinkedList` 是 O(1)，`ArrayList` 需要移动全部元素是 O(n)，`LinkedList` 明显更好（更推荐 `ArrayDeque`）。
- **在尾部增删**：两者都是 O(1)，`ArrayList` 内存连续、没有创建节点对象的开销，通常更快。
- **在中间按下标增删**：`LinkedList` 需要先遍历到位置，这一步就是 O(n)，而且是指针跳跃式访问，缓存命中率低；`ArrayList` 移动元素用的是 `System.arraycopy`，是连续内存的批量复制，非常快。实测中 `ArrayList` 往往不慢甚至更快。
- **遍历过程中边走边删**：用 `LinkedList` 的迭代器 `iterator.remove()` 是 O(1)，这才是 `LinkedList` 真正有优势的场景。

所以一般回答：头部增删或已持有迭代器位置时用 `LinkedList`（或 `ArrayDeque`），其他场景优先 `ArrayList`。

### LinkedList 的底层？插入删除的时间复杂度？ | 交通银行、建设银行
`LinkedList` 是双向链表，内部维护 `first`、`last` 两个指针和 `size`，每个节点是 `Node<E>`，包含 `item`、`prev`、`next`。它同时实现了 `List` 和 `Deque` 接口。

| 操作 | 复杂度 |
| --- | --- |
| `addFirst` / `addLast` / `removeFirst` / `removeLast` / `add(e)` | O(1) |
| `get(i)` / `set(i, e)` | O(n)，最多遍历 n/2 |
| `add(i, e)` / `remove(i)` | O(n)，主要耗在定位；定位后改指针是 O(1) |
| `remove(Object)` / `contains` | O(n) |
| 通过迭代器在当前位置插入或删除 | O(1) |

- 不需要扩容，按需创建节点，但每个节点额外占用两个引用和一个对象头的空间。
- 不实现 `RandomAccess`，用普通 `for (int i...)` 加 `get(i)` 遍历是 O(n²)，应该用 foreach / 迭代器遍历。
- 允许 null；非线程安全。

### ArrayList、LinkedList 是线程安全的吗？会出现哪些问题？ | 工商银行、美团、蚂蚁、农业银行、交通银行
都不是线程安全的。当它们作为共享数据（单例 Bean 的成员变量、静态变量）被多线程并发修改时会出问题。

**ArrayList 的典型问题**（`add` 里的 `elementData[size++] = e` 不是原子操作）
- **元素被覆盖、丢失**：两个线程读到同一个 `size`，先后写入同一个下标，最终只保留一个，`size` 却可能加了两次，出现 null 元素。
- **数组越界 `ArrayIndexOutOfBoundsException`**：容量还剩 1 时，两个线程都判断"不需要扩容"，第二个线程写入时越界。
- **size 与实际元素数不一致**：`size++` 本身是读-改-写，存在丢失更新。
- **并发修改异常**：一个线程遍历、另一个线程修改，触发 `ConcurrentModificationException`。

**LinkedList 的典型问题**
- 并发 `add` 时多个线程同时修改 `last` 指针和 `next` 指针，导致节点丢失、链表断裂或 `size` 不准。
- 遍历时被其他线程修改同样会抛 `ConcurrentModificationException`。

**解决方案**
- 读多写少：`CopyOnWriteArrayList`。
- 读写都多：`Collections.synchronizedList(new ArrayList<>())`，或自己加锁。注意用它遍历时仍要手动 `synchronized (list) { ... }`，因为迭代器本身不加锁。
- 队列场景改用 `ConcurrentLinkedQueue`、`ConcurrentLinkedDeque` 或 `LinkedBlockingQueue`。
- 不共享：每个线程用局部变量的 List，最安全。

### 什么是快速失败（fail-fast）？和安全失败（fail-safe）有什么区别？
fail-fast 是 `java.util` 下非并发集合的一种错误检测机制：迭代器遍历过程中，如果发现集合结构被**迭代器之外的方式**修改了，立即抛出 `ConcurrentModificationException`，而不是继续返回可能错误的数据。单线程里一边遍历一边调用集合的 `add` / `remove` 也会触发，并不只有多线程场景。

**原理**
- 集合内部有 `modCount` 计数器，每次结构性修改（增删元素、扩容、`clear`；`set` 替换值不算）都会 `modCount++`。
- 创建迭代器时记录 `expectedModCount = modCount`。
- 每次 `next()`（以及迭代器的 `remove()`）前检查 `modCount != expectedModCount`，不相等就抛异常。
- 迭代器自己的 `remove()` 会同步更新 `expectedModCount`，所以用它删除是安全的。

fail-fast 是"尽力而为"的检测，不保证一定抛出，不能拿它来保证并发正确性。

**fail-safe（安全失败）**：`java.util.concurrent` 下的集合（`CopyOnWriteArrayList`、`ConcurrentHashMap` 等）遍历时不会抛 `ConcurrentModificationException`。
- `CopyOnWriteArrayList` 的迭代器基于创建时的数组快照，看不到之后的修改。
- `ConcurrentHashMap` 的迭代器是弱一致的，能反映部分修改，但不保证看到最新状态。
- 代价是可能读到旧数据，以及额外的内存开销。

### 在 for 循环或迭代器中删除 ArrayList 元素会发生什么？怎么解决？
**会发生什么**
- **foreach 中调用 `list.remove()`**：foreach 底层是迭代器，`list.remove` 使 `modCount` 改变，下一次 `next()` 时抛 `ConcurrentModificationException`。特例：删除的是倒数第二个元素时，删除后 `size` 正好等于游标，`hasNext()` 返回 false，循环直接结束，不抛异常，但最后一个元素没被检查到。
- **普通下标 for 循环正序删除**：不会抛异常，但删除后后面的元素前移，`i++` 会跳过紧挨着的那个元素，连续两个符合条件的元素只能删掉一个。

**正确做法**

```java
// 1. 迭代器自己的 remove（会同步 expectedModCount）
Iterator<String> it = list.iterator();
while (it.hasNext()) {
    if ("a".equals(it.next())) it.remove();
}

// 2. JDK 8+ 推荐：removeIf，内部一次遍历批量删除，O(n)
list.removeIf("a"::equals);

// 3. 下标 for 循环倒序删除，前面的元素下标不受影响
for (int i = list.size() - 1; i >= 0; i--) {
    if ("a".equals(list.get(i))) list.remove(i);
}

// 4. Stream 过滤生成新集合
List<String> result = list.stream().filter(s -> !"a".equals(s)).toList(); // toList 为 JDK 16+
```

正序下标循环也可以在删除后 `i--` 修正，但可读性差。多线程场景则应改用 `CopyOnWriteArrayList` 或加锁。

## 线程安全的集合
### Java 中有哪些线程安全的集合？ | 高频
分三代，推荐用 JUC 并发集合。

**1. 遗留同步集合（JDK 1.0）**：`Vector`、`Stack`、`Hashtable`，方法上加 `synchronized` 锁整个对象，性能差。

**2. `Collections` 同步包装器**：`synchronizedList()`、`synchronizedMap()` 等，用一个 mutex 包住每个方法，仍是全局一把锁；复合操作和遍历要外部手动加锁。

**3. JUC 并发集合**

| 类别 | 实现 | 原理与场景 |
| --- | --- | --- |
| Map | `ConcurrentHashMap` | JDK 8 起 CAS + synchronized 锁桶头节点，通用首选 |
| 有序 Map / Set | `ConcurrentSkipListMap`、`ConcurrentSkipListSet` | 跳表 + CAS，有序，适合并发排序和范围查询 |
| 写时复制 | `CopyOnWriteArrayList`、`CopyOnWriteArraySet` | 写时加锁复制新数组、读无锁，读多写少 |
| 非阻塞队列 | `ConcurrentLinkedQueue`、`ConcurrentLinkedDeque` | CAS 无锁链表队列 |
| 阻塞队列 | `ArrayBlockingQueue`（有界，一把锁）、`LinkedBlockingQueue`（两把锁，默认容量 `Integer.MAX_VALUE`）、`SynchronousQueue` 等 | `put` / `take` 阻塞，用于生产者-消费者和线程池 |

### 有哪些线程安全的 List？CopyOnWriteArrayList 的原理？是强一致还是最终一致？
**线程安全的 List**

| 实现 | 原理 | 特点 |
| --- | --- | --- |
| `Vector` | 方法加 `synchronized` | 读写都加锁，已不推荐 |
| `Collections.synchronizedList` | 包装器，每个方法 `synchronized (mutex)` | 读写都加锁；遍历需手动加锁 |
| `CopyOnWriteArrayList` | 写时复制 | 读无锁，写加锁复制数组，读多写少 |

**CopyOnWriteArrayList 原理**
- 底层是 `volatile Object[] array`。
- **读**（`get`、遍历）：直接读当前数组引用，不加锁。
- **写**（`add`、`set`、`remove`）：先加锁（JDK 8 用 `ReentrantLock`，较新版本如 JDK 11、17 改为 `synchronized` 锁一个内部对象），复制出一个新数组，在新数组上修改，最后把 `array` 引用指向新数组。写写互斥，写不阻塞读。
- `volatile` 保证引用替换后，后续的读能立刻看到新数组。
- 迭代器基于创建时的数组快照，不会抛 `ConcurrentModificationException`，但也不支持通过迭代器 `remove`（抛 `UnsupportedOperationException`）。

```java
public boolean add(E e) {
    synchronized (lock) {
        Object[] es = getArray();
        int len = es.length;
        es = Arrays.copyOf(es, len + 1);  // 复制新数组
        es[len] = e;
        setArray(es);                      // volatile 写，替换引用
        return true;
    }
}
```

**一致性**：属于弱一致 / 最终一致，不是强一致。写操作完成（引用替换）之后的读一定能看到新数据；但在写的过程中，并发的读线程看到的仍是旧数组，已经拿到旧数组引用的迭代器也会一直遍历旧快照。

**缺点**：每次写都复制整个数组，写多或数组很大时 CPU 和内存开销高，大数组还可能频繁触发 GC；不适合对实时性要求高的场景。典型用途：监听器列表、黑白名单、路由表等读远多于写的配置类数据。

### 除了 ConcurrentHashMap，还有哪些线程安全的 Map？
| 实现 | 原理 | 适用场景 |
| --- | --- | --- |
| `Hashtable` | 所有方法 `synchronized`，锁整张表 | 遗留类，不推荐 |
| `Collections.synchronizedMap(map)` | 包装器，每个方法用同一把 mutex 加锁 | 并发不高，或需要把 `TreeMap`、`LinkedHashMap` 等特定 Map 包成线程安全的 |
| `ConcurrentHashMap` | CAS + synchronized 锁桶 | 高并发通用首选 |
| `ConcurrentSkipListMap` | 跳表 + CAS，无锁 | 需要 key 有序、范围查询的并发场景，读写 O(log n) |

JDK 中没有 `CopyOnWriteMap`，读多写少时如果想用写时复制的思路，可以自己用 `volatile` 引用 + 整体替换不可变 Map 实现。

`synchronizedMap` 的注意点：`get` 后再 `put` 这类复合操作不是原子的，遍历时也要手动 `synchronized (map)`；`ConcurrentHashMap` 则提供了原子的 `putIfAbsent`、`computeIfAbsent`、`merge` 方法。

## HashMap
### HashMap 的底层数据结构？JDK 1.7 和 1.8 有什么区别？ | 高频 | 交通银行、字节、bilibili
JDK 1.8 起，`HashMap` 是 **数组 + 链表 + 红黑树**：`Node<K,V>[] table` 数组，每个桶存放链表头节点；冲突的元素挂在链表上，链表过长时转为红黑树（`TreeNode`）。

**关键参数**
- 默认初始容量 16（`DEFAULT_INITIAL_CAPACITY = 1 << 4`），且容量总是 2 的幂；最大容量 `1 << 30`。
- 默认负载因子 0.75，扩容阈值 `threshold = capacity × loadFactor`，默认 12。
- `TREEIFY_THRESHOLD = 8`、`UNTREEIFY_THRESHOLD = 6`、`MIN_TREEIFY_CAPACITY = 64`。
- table 也是懒初始化，第一次 `put` 时才在 `resize()` 中创建。

**hash 计算**：`(h = key.hashCode()) ^ (h >>> 16)`，把高 16 位异或到低 16 位（扰动函数），让高位也参与下标计算，减少冲突；下标 `index = (n - 1) & hash`。

**JDK 1.7 与 1.8 对比**

| 对比 | JDK 1.7 | JDK 1.8 |
| --- | --- | --- |
| 结构 | 数组 + 链表（`Entry`） | 数组 + 链表 + 红黑树（`Node` / `TreeNode`） |
| 链表插入 | 头插法 | 尾插法 |
| 扰动函数 | 4 次位移 + 5 次异或 | 1 次位移 + 1 次异或 |
| 扩容迁移 | 每个元素重新计算下标，头插导致链表顺序反转 | 按 `hash & oldCap` 拆成高低两条链，保持原顺序 |
| 扩容时机 | 插入前判断，且要求当前桶不为空 | 插入后判断 `++size > threshold` |
| 最坏查找 | O(n) | 树化后 O(log n) |
| 并发扩容 | 可能形成环形链表导致死循环 | 不会成环，但依然线程不安全 |

### HashMap 的 put 流程？发生哈希碰撞怎么处理？ | 高频
`put` 调用 `putVal(hash(key), key, value, ...)`：

1. **计算 hash**：`hash = (h = key.hashCode()) ^ (h >>> 16)`；`key == null` 时 hash 为 0，固定放在 0 号桶。
2. **懒初始化**：table 为空则 `resize()` 创建数组（默认 16）。
3. **定位桶**：`i = (n - 1) & hash`。桶为空，直接新建节点放入。
4. **桶不为空（发生碰撞）**：
   - 头节点的 hash 相等且 key 相等（`==` 或 `equals`），记录下来准备覆盖 value。
   - 头节点是 `TreeNode`，调用 `putTreeVal` 按红黑树插入。
   - 否则遍历链表：找到相同 key 就覆盖；遍历到尾部仍没找到，就**尾插**新节点。若插入后链表长度超过 8（遍历计数 `binCount >= TREEIFY_THRESHOLD - 1`），调用 `treeifyBin`。
5. **覆盖旧值**：找到已存在的 key 时替换 value 并返回旧值（`putIfAbsent` 则不替换），这种情况不增加 `modCount` 和 `size`。
6. **新增节点后**：`++modCount`，`++size > threshold` 时 `resize()` 扩容。

**解决哈希冲突的方式**：`HashMap` 用的是**链地址法（拉链法）**，同一个桶内的元素组成链表，链表过长时转为红黑树。其他常见方法还有开放地址法（线性探测，`ThreadLocalMap` 用的就是这种）、再哈希法、建立公共溢出区。

`get` 流程：计算 hash 定位桶 → 检查头节点 → 是树就走 `getTreeNode`，是链表就遍历比较 `hash` 和 `equals`。

### 什么时候链表转红黑树？什么时候退化回链表？为什么阈值是 8 和 6？ | 高频
**树化条件（同时满足）**
- 某个桶的链表长度达到阈值 `TREEIFY_THRESHOLD = 8`：插入新节点后链表节点数超过 8 时调用 `treeifyBin`。
- 数组长度 `table.length >= MIN_TREEIFY_CAPACITY = 64`。如果数组长度小于 64，`treeifyBin` 不会树化，而是直接 `resize()` 扩容 2 倍，因为数组小时冲突多半是容量不够造成的，扩容能把链表拆散。

**退化条件**
- 扩容时，红黑树在 `split` 中按高低位拆分成两部分，某一部分节点数 `<= UNTREEIFY_THRESHOLD = 6` 时，退化为链表。
- 删除节点时（`removeTreeNode`），不是按数量 6 判断，而是当树的结构已经很小（根节点或其左右子节点为空等）时退化。

**为什么是 8**
- `TreeNode` 的大小约是普通 `Node` 的两倍，树化有空间和维护成本，只有冲突严重时才值得。
- 在负载因子 0.75、hashCode 分布良好的情况下，桶中元素个数服从参数约为 0.5 的泊松分布，链表长度达到 8 的概率约为 0.00000006（千万分之六）。所以正常情况下几乎不会树化，树化主要是应对 hashCode 实现很差或恶意构造哈希冲突（哈希碰撞攻击）的情况，把最坏查找从 O(n) 降到 O(log n)。

**为什么退化阈值是 6 而不是 8**：中间留出 7 作为缓冲，避免节点数在 8 附近来回增删时频繁地树化、反树化，造成性能抖动。

**红黑树的好处**：自平衡二叉查找树，查找、插入、删除最坏都是 O(log n)；相比 AVL 树旋转更少，插入删除效率更高。数据量小时链表遍历足够快、内存更省，所以 `HashMap` 只在必要时才用红黑树。

### HashMap 的扩容机制 | 高频
一句话：元素个数超过 `threshold = capacity × loadFactor` 时扩容为原来的 **2 倍**，并把旧数组中的节点迁移到新数组；JDK 1.8 迁移时不需要重新计算 hash，每个节点要么留在原位置，要么移动到"原位置 + 旧容量"。

**触发时机**：第一次 `put` 初始化 table（默认 16，阈值 12）；新增节点后 `++size > threshold`；链表超过 8 但数组长度小于 64 时（`treeifyBin` 改为扩容）。

**迁移过程（JDK 1.8 `resize`）**：新容量和阈值都翻倍，遍历旧数组每个桶：
- 单个节点：直接放到 `hash & (newCap - 1)`。
- 红黑树：`split` 拆成两棵，节点数 `<= 6` 的退化为链表。
- 链表：按 `(hash & oldCap) == 0` 拆成 lo、hi 两条链并保持顺序，lo 放原下标 `j`，hi 放 `j + oldCap`。

**为什么只有两种位置**：掩码从 `n - 1` 变成 `2n - 1`，只多出 `oldCap` 那一位，该位为 0 下标不变，为 1 下标加 `oldCap`。例如 oldCap = 16，hash 末 5 位 `1 0101`：旧下标 5，新下标 21 = 5 + 16。

**注意**：扩容要遍历所有节点，代价大。已知数量时指定初始容量 `expected / 0.75 + 1`，或用 JDK 19+ 的 `HashMap.newHashMap(expectedSize)`。HashMap 不会自动缩容。

### HashMap 的容量为什么是 2 的幂次方？
**1. 用位运算代替取模**：当 n 是 2 的幂时，`hash % n == hash & (n - 1)`（hash 为非负数时），按位与比取模快得多。

**2. 让下标分布均匀**：n 为 2 的幂时，`n - 1` 的二进制低位全是 1（如 15 = `1111`），hash 的低位每一位都会参与运算，每个桶被命中的概率相同。如果 n 不是 2 的幂，比如 n = 10，`n - 1 = 1001`，中间两位永远是 0，下标 `0010`、`0011` 等永远不会被用到，空间浪费、冲突加剧。

**3. 扩容迁移高效**：容量翻倍后只多了一个高位参与运算，节点要么留在原位置要么移动 `oldCap`，只需判断 `hash & oldCap` 一位即可，不必重新计算下标。

**怎么保证总是 2 的幂**：构造时传入的初始容量会通过 `tableSizeFor` 向上取整到最近的 2 的幂，例如 `new HashMap<>(10)` 实际容量是 16，`new HashMap<>(17)` 是 32。

另外配合扰动函数 `h ^ (h >>> 16)`：因为只取低几位算下标，让高 16 位也混入低位，弥补了"只用低位"带来的冲突问题。

### HashMap 的负载因子为什么默认是 0.75？
负载因子决定"数组填到多满就扩容"，`threshold = capacity × loadFactor`，0.75 是时间和空间之间的折中。

- **太大（如 1.0）**：空间利用率高、扩容少，但哈希冲突明显增多，链表变长，查询和插入变慢。
- **太小（如 0.5）**：冲突少、查得快，但扩容频繁，一半空间闲置，浪费内存，扩容本身也有开销。
- **0.75 的依据**：JDK 源码注释说明，在 0.75 的负载因子下，桶中节点数近似服从参数为 0.5 的泊松分布，链表长度为 0 / 1 / 2 的概率最高，长度达到 8 的概率仅约千万分之六，时间和空间成本取得较好的平衡。
- 附带的好处：容量是 2 的幂，乘以 0.75 得到的阈值总是整数（16 → 12，32 → 24）。

负载因子可以在构造器中修改：内存敏感可以调大，查询性能敏感可以调小，一般保持默认。

### HashMap 为什么线程不安全？JDK 1.7 的死循环是怎么回事？ | 高频
HashMap 的所有操作都没有同步控制，多线程并发写时会出现以下问题：

- **数据覆盖丢失（1.7 和 1.8 都有）**：两个线程同时 `put`，计算出相同的桶下标且该桶为空，都判断"桶为空"后各自写入，后写的覆盖先写的。
- **size 不准**：`++size` 不是原子操作，并发时计数丢失，可能导致该扩容时没有扩容。
- **扩容期间数据丢失或读不到**：一个线程正在迁移，另一个线程读写的可能是新数组或旧数组中不完整的状态。
- **JDK 1.8 树化并发**：并发树化、平衡操作可能破坏红黑树结构，个别情况下也可能导致 CPU 飙升（结构损坏导致遍历无法结束）。
- **没有可见性保证**：一个线程写入的数据，另一个线程不一定能及时看到。

**JDK 1.7 的死循环**：1.7 扩容 `transfer` 迁移链表时采用**头插法**，迁移后链表顺序会反转。两个线程同时扩容时：线程 A 记下 `e = a, next = b` 后被挂起；线程 B 完成迁移，链表变为 `b → a`；A 恢复后继续按自己记录的指针头插，最终形成 `a → b → a` 的环。之后 `get` 一个落在该桶但不存在的 key 时，会在环上无限循环，CPU 100%。

JDK 1.8 改为**尾插法**，并且迁移时按高低位保持原顺序，不会再形成环，但上面的数据丢失等问题依旧存在。

**结论**：多线程场景使用 `ConcurrentHashMap`，而不是给 HashMap 打补丁。

### equals 和 hashCode 为什么要一起重写？
因为 `HashMap`、`HashSet` 等哈希结构先用 `hashCode()` 定位桶，再用 `equals()` 判断桶里有没有相等的元素。两者必须遵守约定：

- `a.equals(b)` 为 true，则 `a.hashCode() == b.hashCode()` **必须**成立。
- hashCode 相等，equals 不一定为 true（哈希冲突）。
- equals 为 false 时 hashCode 可以相等，但尽量不同，以减少冲突。

**只重写 equals、不重写 hashCode 的后果**：`Object.hashCode()` 默认与对象身份相关，两个逻辑上相等的对象 hashCode 很可能不同，会落到不同的桶，`HashSet` 去重失败、存入两个"相等"的对象，`HashMap.get(new Key(...))` 也找不到之前放进去的值。

**只重写 hashCode、不重写 equals**：能定位到同一个桶，但 `equals` 仍按 `==` 比较，依然判断为不同对象。

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof User u)) return false;   // JDK 16+ 模式匹配
    return age == u.age && Objects.equals(name, u.name);
}
@Override
public int hashCode() {
    return Objects.hash(name, age);              // 与 equals 使用相同的字段
}
```

补充：作为 key 的对象最好是不可变的。如果放入 HashMap 之后修改了参与 hashCode 计算的字段，hashCode 会变，就再也找不到这个元素了，还会造成内存泄漏。`String`、包装类、`record` 都是很好的 key。

### HashMap 和 Hashtable 的区别？ | 高频
| 对比 | HashMap | Hashtable |
| --- | --- | --- |
| 线程安全 | 不安全 | 安全，几乎所有方法都是 `synchronized`，锁整张表 |
| 性能 | 高 | 低，所有操作串行 |
| null | 允许一个 null key（放在 0 号桶）和多个 null value | key 和 value 都不能为 null，否则抛 `NullPointerException` |
| 默认初始容量 | 16（第一次 put 时懒初始化） | 11（构造时就创建数组） |
| 扩容 | 2 倍，容量始终为 2 的幂；指定初始容量会被向上取整为 2 的幂 | `2n + 1`；直接使用指定的初始容量 |
| 下标计算 | `(n - 1) & hash`，hash 经过扰动 | `(hash & 0x7FFFFFFF) % n`，直接取模 |
| 底层结构 | JDK 8 起数组 + 链表 + 红黑树 | 数组 + 链表，没有树化 |
| 继承 | `AbstractMap` | 遗留的 `Dictionary` 类 |
| 遍历 | Iterator，fail-fast | 除 Iterator 外还支持 `Enumeration` |

`Hashtable` 已经是遗留类。需要线程安全的 Map 应该使用 `ConcurrentHashMap`，它同样不允许 null，但并发性能好得多。

### HashMap 和 HashSet 的区别？ | 交通银行
`HashSet` 底层就是一个 `HashMap`：元素作为 HashMap 的 key，value 统一是一个静态的占位对象 `PRESENT`（`new Object()`）。除了 `clone`、序列化等少数方法，`HashSet` 的方法基本都直接委托给内部的 HashMap。

```java
private transient HashMap<E, Object> map;
private static final Object PRESENT = new Object();

public boolean add(E e) {
    return map.put(e, PRESENT) == null;   // 返回 null 说明之前不存在，添加成功
}
```

| 对比 | HashMap | HashSet |
| --- | --- | --- |
| 实现接口 | `Map` | `Set`（属于 `Collection`） |
| 存储 | 键值对 | 单个元素（即 HashMap 的 key） |
| 添加 | `put(k, v)`，key 已存在时覆盖 value 并返回旧值 | `add(e)`，已存在时返回 false，不做修改 |
| 去重依据 | key 的 `hashCode()` + `equals()` | 同左 |
| null | 一个 null key | 一个 null 元素 |
| 典型用途 | 缓存、索引、计数 | 去重、判断是否存在、集合运算 |

两者都非线程安全。并发场景下 Map 用 `ConcurrentHashMap`；Set 可以用 `ConcurrentHashMap.newKeySet()`，或者 `Collections.synchronizedSet()`。同理，`LinkedHashSet` 基于 `LinkedHashMap`，`TreeSet` 基于 `TreeMap`。

### HashMap 有哪些遍历方式？
```java
// 1. entrySet + foreach：同时需要 key 和 value 时最常用、效率高
for (Map.Entry<String, Integer> e : map.entrySet()) {
    System.out.println(e.getKey() + "=" + e.getValue());
}

// 2. keySet：只需要 key 时使用；如果再用 map.get(key) 取 value，相当于多查了一次
for (String key : map.keySet()) { ... }

// 3. values：只需要 value
for (Integer v : map.values()) { ... }

// 4. 显式 Iterator：遍历过程中需要删除元素时使用
Iterator<Map.Entry<String, Integer>> it = map.entrySet().iterator();
while (it.hasNext()) {
    if (it.next().getValue() == 0) it.remove();
}

// 5. JDK 8 forEach / Stream
map.forEach((k, v) -> System.out.println(k + "=" + v));
map.entrySet().removeIf(e -> e.getValue() == 0);
```

注意点：
- HashMap 遍历顺序不保证是插入顺序，需要顺序时用 `LinkedHashMap`。
- 遍历时直接调用 `map.remove()` 会触发 fail-fast，抛出 `ConcurrentModificationException`，要删除就用迭代器的 `remove()` 或 `removeIf`。

### TreeMap 是什么？和 HashMap 怎么选？
`TreeMap` 是基于**红黑树**实现的有序 Map，按 key 的自然顺序（key 实现 `Comparable`）或构造时传入的 `Comparator` 排序。

- `get`、`put`、`remove`、`containsKey` 都是 O(log n)。
- 判断 key 是否相同用的是 `compareTo` / `compare` 返回 0，不是 `equals`，所以比较器要和 `equals` 保持一致，否则会出现"看似不同的 key 被覆盖"的情况。
- 自然排序时 key 不能为 null；value 可以为 null。
- 实现了 `NavigableMap` / `SortedMap`，支持丰富的有序和范围操作：`firstKey()`、`lastKey()`、`floorKey(k)`（≤ k 的最大 key）、`ceilingKey(k)`（≥ k 的最小 key）、`headMap(k)`、`tailMap(k)`、`subMap(from, to)`、`descendingMap()`。
- 非线程安全，并发场景用 `ConcurrentSkipListMap`。

| 对比 | HashMap | TreeMap |
| --- | --- | --- |
| 结构 | 数组 + 链表 + 红黑树 | 红黑树 |
| 顺序 | 无序 | 按 key 排序 |
| 复杂度 | 平均 O(1) | O(log n) |
| null key | 允许一个 | 自然排序时不允许 |

只需要按 key 查找用 `HashMap`；需要按 key 排序、范围查询、找最近的 key（如按时间段、按分数区间查找，一致性哈希环）时用 `TreeMap`。

## ConcurrentHashMap
### ConcurrentHashMap 的实现原理？JDK 1.7 和 1.8 有什么不同？ | 高频 | 交通银行、饿了么
一句话：JDK 1.7 用 **Segment 分段锁**（`ReentrantLock`），JDK 1.8 去掉 Segment，改为 **CAS + synchronized 锁单个桶的头节点**，结构与 HashMap 一样是数组 + 链表 + 红黑树。

**JDK 1.7：Segment 数组 + HashEntry 数组 + 链表**

![](images/Java+AI八股-image.png)

Segment 数量由 `concurrencyLevel` 决定，默认 16，**初始化后不能扩容**。写操作先定位 Segment 再加锁，获取失败时 `scanAndLockForPut` 边自旋边预建节点；读不加锁，靠 `volatile` 保证可见性。

**JDK 1.8：Node 数组 + 链表 / 红黑树**

![](images/Java+AI八股-image-1.png)

空桶 CAS 插入，非空桶 `synchronized` 锁头节点（红黑树时锁 `TreeBin`）；读不加锁，`Node` 的 `val`、`next` 为 `volatile`。树化阈值同 HashMap（链表超过 8 且数组 ≥ 64，≤ 6 退化）。

| 对比 | JDK 1.7 | JDK 1.8 |
| --- | --- | --- |
| 结构 | Segment[] + HashEntry[] + 链表 | Node[] + 链表 + 红黑树 |
| 锁 | Segment（`ReentrantLock`） | CAS + `synchronized` 锁桶头节点 |
| 锁粒度 | 一段（默认 16 段） | 一个桶 |
| 最大并发度 | Segment 数，固定 | 桶数，随扩容增加 |
| 最坏查找 | O(n) | O(log n) |
| 扩容 | 每个 Segment 各自扩容 | 全表扩容，多线程协作迁移 |
| size | 不加锁重试，失败后锁全部 Segment | `baseCount` + `CounterCell` 累加 |

**为什么 1.8 用 synchronized 而不是 ReentrantLock**：锁粒度细到单个桶后竞争很少，synchronized 经锁优化后低竞争开销很小；直接锁头节点，不用为每个桶额外建锁对象，更省内存。

### ConcurrentHashMap 为什么是线程安全的？（put / get 流程） | 高频
线程安全靠三点：**写操作用 CAS 或锁住单个桶互斥、读操作靠 volatile 保证可见性、扩容和计数都有专门的并发控制**。以 JDK 1.8 为例：

**put 流程（`putVal`）**
1. key 或 value 为 null 抛 `NullPointerException`，计算 `spread(key.hashCode())`。
2. 自旋处理：table 为空则 `initTable()`（CAS 把 `sizeCtl` 设为 -1 抢初始化权，其他线程 `yield`）；目标桶为空则 `casTabAt` 放入，失败继续自旋；头节点 hash 为 `MOVED`（`ForwardingNode`）说明正在扩容，先 `helpTransfer`；否则 `synchronized` 锁头节点，再次确认头节点没变后按链表或 `TreeBin` 插入/覆盖。
3. 链表长度 ≥ 8 时 `treeifyBin`（数组 < 64 时改为扩容）。
4. `addCount`：CAS 更新 `baseCount`，冲突时更新 `CounterCell`，再检查是否达到扩容阈值。

**get 流程**：全程不加锁，`tabAt` volatile 读头节点；头节点 hash < 0（`ForwardingNode` 或 `TreeBin`）时调用其 `find`，扩容中会去新表查；否则遍历链表。

**扩容（`transfer`）**：每个线程按步长 `stride`（最小 16 个桶）领取一段桶迁移，迁完放 `ForwardingNode` 占位；其他线程 put 遇到它就协助扩容；迁移单个桶同样锁头节点，与 put 互斥；get 遇到它去新表读。

**为什么 key、value 不能为 null**：`get` 返回 null 时无法区分"不存在"还是"值为 null"，而并发下再调 `containsKey` 判断的结果不可靠。

易错点：单个方法线程安全，"先 `get` 再 `put`"不是原子的，应改用 `putIfAbsent`、`computeIfAbsent`、`merge`；`size()` 和迭代器都是弱一致的。

### ConcurrentHashMap 用的是悲观锁还是乐观锁？
两者都有，按操作耗时选择不同的并发控制方式（以 JDK 1.8 为例）。

- **乐观锁（CAS）**：初始化数组（CAS 修改 `sizeCtl`）、往空桶放入第一个节点（`casTabAt`）、更新计数 `baseCount` / `CounterCell`、扩容时领取迁移区间。这些操作都很短，CAS 失败重试的成本低，比加锁更划算。
- **悲观锁（synchronized）**：桶不为空时，锁住头节点再遍历链表或红黑树、比较 key、插入或替换、迁移桶。这些操作耗时较长，如果用 CAS 自旋，失败后要重新遍历，长时间自旋会浪费 CPU，直接加锁更稳定。
- **读不加锁**：依赖 `volatile` 的可见性。

JDK 1.7 的 Segment 继承 `ReentrantLock`，写操作是悲观锁，但获取锁时先用 `tryLock` 自旋若干次，也带了一点乐观的思想。

