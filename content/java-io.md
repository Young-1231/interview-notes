## IO 流基础
### 你怎么理解Java的IO流 | 农业银行、腾讯
IO 流是 Java 用"流"这一统一抽象处理输入输出的机制：不管数据来自文件、网络、内存还是控制台，都按顺序的字节或字符序列来读写。`java.io` 的 40 多个类都派生自四个抽象基类。

**按方向和数据单位分为四个基类**

| | 输入 | 输出 |
| --- | --- | --- |
| 字节流 | `InputStream` | `OutputStream` |
| 字符流 | `Reader` | `Writer` |

**按角色分**
- 节点流：直接连接数据源，比如 `FileInputStream`、`FileReader`、`ByteArrayInputStream`、`Socket` 拿到的流。
- 处理流（包装流）：包在其他流外面增加功能，比如 `BufferedInputStream`（缓冲）、`InputStreamReader`（字节转字符）、`DataInputStream`（读基本类型）、`ObjectInputStream`（反序列化）。

**使用要点**
- 流用完必须关闭，推荐 JDK 7 的 try-with-resources，自动调用 `close()`；关闭外层包装流会连带关闭内层流。
- 传统 `java.io` 是阻塞的，面向流，只能顺序读写；JDK 1.4 的 NIO 面向缓冲区和通道；JDK 7 的 NIO.2 增加了 `Path`、`Files` 工具类和异步通道。

```java
try (BufferedReader reader = Files.newBufferedReader(Path.of("app.log"), StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        // 处理每一行
    }
}
```

### 字节流和字符流有什么区别？为什么有了字节流还需要字符流
字节流以字节（8 bit）为单位读写，能处理任何数据；字符流以字符为单位读写，本质是"字节流 + 字符编码转换"，专门处理文本。

| 对比 | 字节流 | 字符流 |
| --- | --- | --- |
| 基类 | `InputStream` / `OutputStream` | `Reader` / `Writer` |
| 读写单位 | 字节 | 字符（Java 的 `char` 是 UTF-16 编码单元） |
| 编码 | 不涉及编码 | 读时按字符集把字节解码成字符，写时编码成字节 |
| 适用 | 图片、音视频、压缩包等二进制文件，以及任何数据 | 文本文件 |
| 缓冲 | 基础类本身没有缓冲 | 编码转换时内部带有缓冲，所以写完要 `flush()` 或关闭才能确保写出 |

**为什么还需要字符流**
- 字符和字节不是一一对应的：UTF-8 中一个汉字占 3 个字节，GBK 中占 2 个。用字节流读文本时，按固定字节数截断可能把一个汉字拆开，导致乱码；自己处理解码又很繁琐。
- 字符流在内部按指定的字符集完成编解码，可以直接按字符、按行（`BufferedReader.readLine()`）处理文本。

**编码注意点**
- 用 `InputStreamReader(in, StandardCharsets.UTF_8)` 显式指定字符集。`FileReader` 在 JDK 11 之前只能使用平台默认字符集，JDK 11 新增了带 `Charset` 参数的构造方法。
- JDK 18（JEP 400）起，默认字符集统一为 UTF-8，不再依赖操作系统设置。

### 什么是字节缓冲流
字节缓冲流是 `BufferedInputStream` 和 `BufferedOutputStream`，它们包装在其他字节流外面，在内存中维护一个缓冲区（默认 8192 字节），把多次小的读写合并成少量大块的系统调用，从而提高性能。

**原理**
- `BufferedInputStream`：第一次 `read()` 时从底层流一次性读满缓冲区，之后的 `read()` 直接从内存数组中取，取完再批量读下一块。
- `BufferedOutputStream`：`write()` 先写进缓冲区，缓冲区满、调用 `flush()` 或 `close()` 时才一次性写到底层流。
- 性能提升的本质是减少系统调用和用户态/内核态切换次数：`FileInputStream.read()` 每读 1 个字节都是一次本地调用。

**注意点**
- 输出缓冲流写完要 `flush()` 或关闭，否则缓冲区里的数据可能没写出去。
- 如果本身就用一个大数组批量读写（如 `read(byte[8192])`），缓冲流带来的提升就不明显了。
- 字符流对应的是 `BufferedReader` / `BufferedWriter`，额外提供 `readLine()` 和 `newLine()`。
- 构造时可以指定缓冲区大小：`new BufferedInputStream(in, 64 * 1024)`。

### Java IO 中用到了哪些设计模式？ | 高频
最典型的是装饰器模式和适配器模式，另外还能看到工厂模式、观察者模式和策略模式的影子。

**装饰器模式**：在不修改原有类的前提下，通过包装动态地给对象增加功能。
- `FilterInputStream` / `FilterOutputStream` 是装饰器基类，持有一个被装饰的 `InputStream`，子类 `BufferedInputStream`（缓冲）、`DataInputStream`（读基本类型）等在其基础上扩展功能。
- 装饰器和被装饰者实现同一个接口（都是 `InputStream`），所以可以多层嵌套：`new DataInputStream(new BufferedInputStream(new FileInputStream("a.bin")))`。
- 好处是避免了"缓冲 × 数据类型 × 数据源"的子类组合爆炸。

**适配器模式**：把一个接口转换成客户期望的另一个接口。
- `InputStreamReader` 把 `InputStream` 适配成 `Reader`，`OutputStreamWriter` 把 `OutputStream` 适配成 `Writer`，内部借助 `StreamDecoder` / `StreamEncoder` 完成编解码。
- 和装饰器的区别：装饰器不改变接口只增强功能，适配器的目的是转换接口。

**其他模式**
- 工厂模式：NIO.2 的 `Files.newInputStream()`、`Files.newBufferedReader()`、`Path.of()` 等静态工厂方法，调用方不用关心具体实现类。
- 观察者模式：NIO.2 的 `WatchService` 监听目录变化，注册后由事件通知；NIO 的 `Selector` 也有类似的事件通知思想。
- 策略模式：`File.list(FilenameFilter)`、`File.listFiles(FileFilter)` 把过滤规则作为可替换的策略对象传入。

## IO 模型：BIO、NIO、AIO
### 什么是BIO、NIO、AIO？它们之间有什么区别？ | 高频
三者是 Java 支持的三种 IO 模型：BIO 是同步阻塞，一个连接一个线程；NIO 是同步非阻塞，基于 Selector 多路复用，一个线程管理多个连接；AIO 是异步非阻塞，IO 完成后由系统回调通知。

**概念区分**：阻塞/非阻塞看数据没准备好时线程是否挂起；同步/异步看数据从内核拷贝到用户空间是否要应用线程自己完成。BIO、NIO 都要线程自己 `read`，所以都是同步；AIO 由操作系统拷贝完再通知，是异步。

| 对比 | BIO | NIO | AIO |
| --- | --- | --- | --- |
| 引入版本 | JDK 1.0（`java.io`、`java.net`） | JDK 1.4（`java.nio`） | JDK 7（NIO.2） |
| 模型 | 同步阻塞 | 同步非阻塞 / IO 多路复用 | 异步非阻塞 |
| 线程模型 | 一个连接一个线程 | 一个线程通过 Selector 管理多个 Channel | 发起操作后立即返回，完成后回调 |
| 核心组件 | `ServerSocket`、`Socket`、流 | `Channel`、`Buffer`、`Selector` | `AsynchronousSocketChannel`、`CompletionHandler`、`Future` |
| 编程复杂度 | 简单 | 复杂（多用 Netty 封装） | 较复杂 |
| 适用场景 | 连接数少且固定 | 连接数多、每次请求处理时间短，如聊天、网关、RPC | 连接数多且操作耗时长 |

**底层实现**：NIO 的 Selector 在 Linux 上用 epoll（macOS 用 kqueue）；AIO 在 Windows 上基于 IOCP 是真异步，在 Linux 上是 epoll 加线程池模拟，优势不明显。所以 Linux 服务端主流是 NIO，Netty 也基于 NIO（曾尝试 AIO 后放弃）。

### BIO是什么？
BIO（Blocking I/O）是同步阻塞 IO：线程调用 `accept()`、`read()`、`write()` 后会一直阻塞，直到操作完成。服务端通常采用"一个连接一个线程"的模型。

**工作方式**
1. 主线程调用 `ServerSocket.accept()` 阻塞等待连接。
2. 每接收一个连接，就交给一个新线程（或线程池中的线程）处理。
3. 处理线程调用 `InputStream.read()`，客户端没发数据时线程一直阻塞。

```java
ServerSocket server = new ServerSocket(8080);
while (true) {
    Socket socket = server.accept();          // 阻塞等待连接
    pool.execute(() -> handle(socket));        // 每个连接占用一个线程，read 时阻塞
}
```

**问题**
- 线程数随连接数线性增长，每个平台线程默认占用约 1MB 栈空间（`-Xss` 决定），大量线程导致内存占用高、上下文切换频繁。
- 大部分线程只是在等数据，CPU 利用率低。
- 用线程池可以限制线程数（伪异步 IO），但连接数超过线程数时新连接只能排队。

**适用场景**：连接数少且固定的场景，比如内部管理工具。它的优点是编程模型简单直观。

**补充**：JDK 21 正式引入虚拟线程，虚拟线程在阻塞 IO 时会自动让出底层的平台线程，用同步阻塞的写法也能支撑大量并发连接。

### NIO是什么？ | 高频 | 农业银行、腾讯、招商银行
NIO 是 JDK 1.4 引入的 `java.nio` 包（官方名称是 New I/O），核心是 Channel、Buffer、Selector 三个组件。网络编程中它是同步非阻塞模型：Channel 设置为非阻塞后注册到 Selector，一个线程就能监听并处理大量连接的就绪事件。

**三大组件**
- **Channel**：双向可读写，如 `SocketChannel`、`ServerSocketChannel`、`FileChannel`。网络 Channel 可设为非阻塞；`FileChannel` 只能阻塞，不能注册到 Selector。
- **Buffer**：数据必须经过 Buffer 读写，核心属性 `capacity`、`position`、`limit`；写完调 `flip()` 切到读模式，读完调 `clear()` 或 `compact()`。`allocateDirect()` 分配堆外内存，少一次拷贝。
- **Selector**：多路复用器。Channel 注册 `OP_ACCEPT`、`OP_READ` 等事件，`select()` 阻塞到有 Channel 就绪，再遍历 `selectedKeys()` 处理。

```java
// ... 创建 selector、server，绑定端口
server.configureBlocking(false);
server.register(selector, SelectionKey.OP_ACCEPT);
while (true) {
    selector.select();                                   // 阻塞直到有就绪事件
    Iterator<SelectionKey> it = selector.selectedKeys().iterator();
    while (it.hasNext()) {
        SelectionKey key = it.next();
        it.remove();                                     // 必须手动移除
        if (key.isAcceptable()) {
            SocketChannel ch = server.accept();
            ch.configureBlocking(false);
            ch.register(selector, SelectionKey.OP_READ);
        } else if (key.isReadable()) {
            // 从 SocketChannel 读到 ByteBuffer 并处理
        }
    }
}
```

**和 BIO 的区别**：BIO 面向流、阻塞、一个连接一个线程；NIO 面向缓冲区、非阻塞、一个线程多路复用多个连接。易错点：`select()` 本身是阻塞的，但它等的是所有连接的事件，就绪后 `read` 不会卡在单个连接上。

**其他**：`FileChannel.transferTo()` 实现零拷贝（Linux 上用 sendfile），`FileChannel.map()` 得到 `MappedByteBuffer`。原生 API 复杂，还要处理粘包半包、空轮询 bug（Netty 通过重建 Selector 规避），生产中一般用 Netty。

### AIO是什么？
AIO（Asynchronous I/O）是 JDK 7 在 NIO.2 中引入的异步 IO：应用发起读写后立即返回，操作系统完成数据准备和拷贝之后，通过回调（`CompletionHandler`）或 `Future` 通知应用，线程既不阻塞也不需要轮询。

**核心类**：`AsynchronousServerSocketChannel`、`AsynchronousSocketChannel`、`AsynchronousFileChannel`。

```java
AsynchronousServerSocketChannel server =
        AsynchronousServerSocketChannel.open().bind(new InetSocketAddress(8080));
server.accept(null, new CompletionHandler<AsynchronousSocketChannel, Void>() {
    @Override
    public void completed(AsynchronousSocketChannel ch, Void att) {
        server.accept(null, this);                     // 继续接收下一个连接
        ByteBuffer buf = ByteBuffer.allocate(1024);
        ch.read(buf, buf, new CompletionHandler<Integer, ByteBuffer>() {
            public void completed(Integer len, ByteBuffer b) { /* 数据已在 b 中 */ }
            public void failed(Throwable e, ByteBuffer b) { }
        });
    }
    @Override
    public void failed(Throwable e, Void att) { }
});
```

**和 NIO 的区别**：NIO 是"数据就绪了通知你，你自己去读"（Reactor 模式）；AIO 是"数据读好了放进你的 Buffer 再通知你"（Proactor 模式）。

**为什么用得少**
- Windows 上基于 IOCP，是真正的异步；Linux 上 JDK 的实现底层仍是 epoll，再用内部线程池执行回调，并非内核级异步，相比 NIO 没有明显性能优势。
- 回调式编程更复杂。
- Netty 曾经加入 AIO 支持，后来因为在 Linux 上没有收益而移除。

Linux 5.1 引入的 io_uring 是真正的内核异步 IO 接口，但 JDK 标准库目前没有基于它实现 AIO，需要借助 Netty 的 io_uring 传输等第三方实现。
