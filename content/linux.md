## 常用命令
### linux常用命令有哪些？讲一讲你用过的 Linux 命令 | 高频
按类别列举，再结合排障场景举一两个例子（如 `tail -f` 追日志、`lsof -i :8080` 查端口占用）。

| 类别 | 常用命令 |
| --- | --- |
| 文件与目录 | `ls -al`、`cd`、`mkdir -p`、`rm -rf`、`cp -r`、`mv`、`find / -name "*.log" -mtime +7`、`ln -s` |
| 查看文件 | `cat`、`less`、`head -n 20`、`tail -f`、`vim` |
| 文本处理 | `grep`、`awk`、`sed`、`sort`、`uniq -c`、`wc -l`、`xargs` |
| 权限与用户 | `chmod 755`、`chown user:group`、`sudo`、`useradd` |
| 进程与资源 | `ps -ef`、`top`、`kill`、`free -h`、`df -h`、`du -sh`、`vmstat`、`iostat` |
| 后台运行 | `nohup cmd > out.log 2>&1 &`、`jobs`、`fg`、`bg`、`systemctl` |
| 网络 | `ss -lntp` / `netstat -tunlp`、`lsof -i :8080`、`curl`、`ping`、`nc`、`ip addr`、`tcpdump` |
| 压缩与传输 | `tar -czvf` / `tar -xzvf`、`zip` / `unzip`、`scp`、`rsync` |

**权限数字含义**：`chmod 755` 表示所有者 rwx（7），所属组 r-x（5），其他用户 r-x（5），其中 r=4、w=2、x=1。

### 如何创建、删除、重命名文件和目录？请写出对应命令
创建用 `touch` / `mkdir`，删除用 `rm` / `rmdir`，重命名和移动都用 `mv`。

**创建**
- `touch file`：文件不存在则创建空文件，存在则只更新时间戳。
- `> file`：创建空文件，已存在则清空内容。
- `mkdir dir`：创建目录；`mkdir -p a/b/c`：递归创建多级目录，已存在也不报错。

**删除**
- `rm file`：删除文件。GNU rm 默认不提示，直接删除；只有带 `-i`，或者文件写保护且标准输入是终端时才会询问。CentOS / RHEL 的 root 用户默认在 `~/.bashrc` 中设置了 `alias rm='rm -i'`，所以会看到提示，那是别名的效果。
- `rm -f file`：强制删除，忽略不存在的文件，从不提示。
- `rmdir dir`：只能删除空目录。
- `rm -r dir`：递归删除目录及其内容；`rm -rf dir` 强制递归删除，执行前务必确认路径，尤其注意变量为空时 `rm -rf $DIR/` 会变成删除根目录下内容。

**重命名与移动**
- `mv old new`：同一目录下就是重命名。
- `mv file1 file2 dir/`：把多个文件移到目录。
- `mv -i`：目标已存在时询问，避免覆盖。

**复制**：`cp src dst`，复制目录要加 `-r`，`-p` 保留权限和时间戳。

### 怎么搜索出某个目录下所有包含某个字符串的所有文件
用 `grep -r` 递归搜索；需要先按文件名、类型过滤时，用 `find` + `xargs grep`。

```bash
grep -rn "Hello" ./            # -r 递归，-n 显示行号
grep -rl "Hello" ./            # 只列出包含该字符串的文件名
grep -rni "hello" ./           # -i 忽略大小写
grep -rn "Hello" --include="*.java" ./   # 只搜 .java 文件

find /path -type f -name "*.txt" | xargs grep -l "Hello"
find /path -type f -name "*.txt" -print0 | xargs -0 grep -l "Hello"   # 文件名含空格时更安全
```

其他常用参数：`-w` 匹配整个单词，`-v` 反向匹配，`-E` 使用扩展正则，`-A 3` / `-B 3` / `-C 3` 显示匹配行之后 / 之前 / 前后 3 行。代码仓库里搜索可以用更快的 `ripgrep`（`rg`）。

### 怎么对比两个文件的差异
用 `diff` 命令，它逐行比较并输出需要怎样修改才能让第一个文件变成第二个文件。

```bash
diff file1.txt file2.txt       # 默认格式，a/d/c 分别表示增加、删除、修改
diff -u file1.txt file2.txt    # 统一格式，和 git diff 的输出一样，最常用
diff -q file1.txt file2.txt    # 只报告是否不同（等同于 --brief）
diff -w file1.txt file2.txt    # 忽略所有空白字符
diff -b file1.txt file2.txt    # 忽略空白数量的变化
diff -i file1.txt file2.txt    # 忽略大小写
diff -r dir1 dir2              # 递归比较两个目录
```

其他工具：`vimdiff`（并排高亮对比）、`cmp`（按字节比较，适合二进制文件）、`comm`（比较两个已排序的文件，输出共有行和各自独有的行）。只想判断内容是否一致，也可以比较 `md5sum` 的结果。

### 如何统计一个日志文件中 error 的数量
最常用的是 `grep -c` 或 `grep | wc -l`。要注意两者统计的都是匹配的行数，一行出现多次只算一次；统计出现次数要用 `grep -o`。

```bash
grep -ci "error" app.log               # 统计包含 error 的行数，-i 忽略大小写
grep -i "error" app.log | wc -l        # 同上
grep -oi "error" app.log | wc -l       # 统计 error 出现的总次数
grep -wci "error" app.log              # 只匹配完整单词，避免 errors、ErrorCode 也被算进去
```

**常见延伸**
- 实时查看新增的错误：`tail -f app.log | grep --line-buffered -i error`。日志会按大小或日期轮转时用 `tail -F`，它会在文件被替换后按文件名重新打开。
- 统计各类错误出现次数并排序：`grep -i error app.log | awk '{print $5}' | sort | uniq -c | sort -rn | head`（`$5` 换成实际的字段位置）。
- 统计压缩日志：`zgrep -ci error app.log.gz`。

## 进程与资源监控
### 如何查找并杀死一个进程 | 高频
查找用 `ps`、`pgrep`、`pidof`、`top`，按端口找用 `ss` / `lsof`；杀进程优先用 `kill PID`（SIGTERM）让进程优雅退出，杀不掉再用 `kill -9`（SIGKILL）。

**查找进程**
```bash
ps -ef | grep java | grep -v grep     # 列出所有进程并过滤，grep -v 去掉 grep 自身
ps aux | grep nginx                   # aux 格式额外显示 %CPU、%MEM
pgrep -fl java                        # 直接输出匹配的 PID，-f 匹配完整命令行
pidof nginx                           # 按程序名精确查 PID
lsof -i :8080                         # 查占用 8080 端口的进程
jps -l                                # Java 进程专用
```

**杀死进程**
```bash
kill 1234          # 默认发送 SIGTERM（15）
kill -9 1234       # 发送 SIGKILL（9），强制终止
pkill -f app.jar   # 按名称或命令行匹配，默认发送 SIGTERM
killall nginx      # 杀死所有同名进程，默认发送 SIGTERM
```

**SIGTERM 和 SIGKILL 的区别**
- SIGTERM 可以被进程捕获处理：程序可以完成清理（关闭连接、刷盘、执行 JVM 的 shutdown hook）后再退出，所以优先使用。
- SIGKILL 不能被捕获或忽略，由内核直接终止进程，进程没有机会做清理，可能导致数据丢失。
- `kill -9` 也有杀不掉的情况：处于 D 状态（不可中断睡眠，通常在等待磁盘或 NFS 的 I/O）的进程要等 I/O 返回；僵尸进程（Z 状态）已经退出，只剩进程表项，需要父进程调用 `wait` 回收，或者杀掉父进程让 init/systemd 接管回收。

### 如何查看系统的CPU、内存和磁盘使用情况 | 高频
CPU 和内存看 `top` / `vmstat` / `free`，磁盘空间看 `df` / `du`，磁盘 I/O 看 `iostat`。

**CPU 和内存**
- `top` / `htop`：动态显示整体 CPU、内存、负载以及每个进程的占用。
- `free -h`：内存总量、已用、可用，`-h` 以人类可读的单位显示。
- `vmstat 1`：每秒输出一次，关注 `r`（运行队列长度）、`b`（阻塞进程数）、`si/so`（swap 换入换出）、`cs`（上下文切换次数）、`us/sy/id/wa`。
- `mpstat -P ALL 1`：查看每个 CPU 核的使用率（属于 sysstat 包）。
- `uptime`：1、5、15 分钟平均负载。
- `pidstat -u -p PID 1`：查看单个进程的 CPU 使用（sysstat 包）。

**磁盘**
- `df -h`：每个文件系统的总大小、已用、可用和挂载点；`df -i` 查看 inode 使用情况，inode 耗尽时即使有空间也无法创建文件。
- `du -sh dir`：统计目录总大小；`du -sh * | sort -rh | head` 或 `du -h --max-depth=1 /path` 找出最大的目录。
- `lsblk`：列出块设备和分区。
- `iostat -x 1`（sysstat 包）：看磁盘 I/O，关注 `%util`（设备繁忙程度）、`await`（平均 I/O 耗时）。

**df 和 du 结果不一致**：df 统计文件系统层面的占用，du 遍历目录统计文件大小。文件被删除但仍被进程打开时，空间不会释放，df 显示已用而 du 统计不到。可以用 `lsof | grep deleted` 找到进程，重启进程或清空文件来释放空间。

### 怎么查看 CPU 使用率
最常用的是 `top`：第三行 `%Cpu(s)` 显示整体 CPU 时间分布，进程列表的 `%CPU` 列显示每个进程的占用。

```text
top - 16:54:38 up 7 days,  5:13,  3 users,  load average: 0.00, 0.01, 0.05
%Cpu(s):  0.7 us,  0.3 sy,  0.0 ni, 99.0 id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st
```

**各字段含义**
- `us`：用户态进程（未调整 nice 值）占用的 CPU 时间百分比。
- `sy`：内核态占用的 CPU 时间百分比。
- `ni`：调整过 nice 值的用户态进程占用的 CPU 时间百分比。
- `id`：空闲。CPU 使用率 ≈ 100% − id，上例为 1%。
- `wa`：CPU 空闲且在等待 I/O 完成的时间百分比，偏高说明磁盘 I/O 是瓶颈。
- `hi` / `si`：处理硬中断 / 软中断占用的 CPU 时间百分比。
- `st`：虚拟机中被宿主机上其他虚拟机占用（steal）的时间。

**top 的常用操作**：按 `1` 显示每个核，`P` 按 CPU 排序，`M` 按内存排序，`H` 切换到线程视图；`top -Hp PID` 直接查看某个进程的线程。

**load average**：1、5、15 分钟内处于可运行状态（R）和不可中断睡眠状态（D）的平均进程数。要和 CPU 核数比较，长期超过核数说明系统过载。因为包含 D 状态，I/O 阻塞也会推高负载。

**Java 进程 CPU 飙高的排查**
1. `top` 找到 CPU 占用高的进程 PID。
2. `top -Hp PID` 找到占用高的线程 TID。
3. `printf '%x\n' TID` 把线程 ID 转成十六进制。
4. `jstack PID | grep -A 20 0x<十六进制TID>` 查看该线程的堆栈，定位代码。

其他工具：`vmstat 1`、`mpstat -P ALL 1`、`sar -u 1`（sysstat 包，还能查历史数据）。

### 怎么查看内存使用率
用 `free -h` 看整体内存，用 `top` 或 `ps` 看每个进程的内存占用。判断还剩多少内存要看 `available` 列，而不是 `free` 列。

```text
$ free -h
               total        used        free      shared  buff/cache   available
Mem:           1.8Gi       322Mi       793Mi       1.0Mi       721Mi       1.3Gi
Swap:             0B          0B          0B
```

**字段含义**
- `used`：已被进程使用的内存。
- `free`：完全没被使用的内存。
- `buff/cache`：内核用作缓冲区和页缓存（page cache）的内存。Linux 会把空闲内存拿来缓存文件数据，需要时可以回收。
- `available`：内核估算的、新启动的程序实际能用的内存，约等于 free 加上可回收的缓存。

所以 `free` 很小不代表内存不够，`available` 很小才说明内存紧张。

**看进程内存**
- `top` 中 `%MEM` 列，以及 `VIRT`（虚拟内存）、`RES`（实际占用的物理内存）、`SHR`（共享内存）。按 `M` 按内存排序。
- `ps aux --sort=-%mem | head` 列出内存占用最高的进程。
- `cat /proc/meminfo` 查看详细的内存统计；`vmstat` 的 `si/so` 不为 0 说明发生了 swap。

内存耗尽时，内核的 OOM Killer 会杀掉进程，可以用 `dmesg | grep -i oom` 确认。

### 怎么查看某个进程使用的端口
用 `ss`、`netstat` 或 `lsof`，既可以按进程查端口，也可以按端口反查进程。查看其他用户的进程信息需要 root 权限，否则不会显示 PID 和进程名。

**ss**（iproute2 自带，比 netstat 快，推荐）
```bash
ss -tulnp | grep nginx     # -t TCP，-u UDP，-l 监听中，-n 不解析服务名，-p 显示进程
ss -tulnp | grep 1234      # 按 PID 过滤
ss -lntp | grep :8080      # 按端口反查进程
```

**netstat**（net-tools 包，较新的发行版默认可能没装）
```bash
netstat -tulnp | grep 1234
```

**lsof**
```bash
lsof -i -n -P | grep nginx     # 按进程名，-n 不解析主机名，-P 不解析端口名
lsof -i -n -P -a -p 1234       # 按 PID，-a 表示条件取交集
lsof -i :8080                  # 按端口反查进程
```

`ss -lntp` 中 Recv-Q / Send-Q 在监听状态下分别表示当前全连接队列长度和队列上限，可以用来判断 accept 队列是否溢出。

## 文件系统与命令执行
### 什么是软链接和硬链接？它们有什么区别？ | 高频
硬链接是给同一个 inode 再起一个文件名；软链接（符号链接）是一个独立的小文件，内容是目标文件的路径，类似 Windows 的快捷方式。

| 对比 | 硬链接 | 软链接 |
| --- | --- | --- |
| 命令 | `ln src link` | `ln -s src link` |
| inode | 和源文件是同一个 inode | 有自己的 inode |
| 跨文件系统 | 不能，inode 号只在一个文件系统内唯一 | 可以 |
| 链接目录 | 不能，避免目录树出现环 | 可以 |
| 删除源文件 | 不影响，其他文件名仍能访问数据 | 链接失效，成为悬空链接 |
| `ls -l` 显示 | 普通文件，链接数加 1 | 类型为 `l`，显示 `link -> src` |

**原理**
- 目录项保存的是"文件名 → inode 号"的映射。硬链接就是多一个指向同一 inode 的目录项，inode 中的链接计数加 1。
- 删除文件（`rm`）实际是删除目录项并把链接计数减 1。计数为 0 且没有进程打开这个文件时，数据块才真正被释放。
- 软链接访问时，内核读取其中保存的路径再去解析，所以目标被删或被移动后链接失效；相对路径的软链接是相对于链接自身所在目录解析的。

用 `ls -i` 可以看到 inode 号，`stat file` 可以看到链接数。

### Linux 中输入指令 ls 并回车，底层发生了什么？ | 高频
整体流程：终端把输入交给 Shell → Shell 解析命令并找到 `/usr/bin/ls` → `fork` 出子进程 → 子进程 `execve` 加载 ls → ls 通过系统调用读取目录、`write` 到标准输出 → ls 退出 → Shell `waitpid` 回收子进程，打印新的提示符。

1. **终端输入**：键盘输入经终端（或伪终端 pty）传给前台的 Shell 进程（bash、zsh 等），Shell 从标准输入读到 `ls\n`。
2. **Shell 解析**：分词、展开别名和通配符、判断命令类型，在 `PATH` 中找到可执行文件。
3. **创建子进程**：Shell 调用 `fork()`（现代实现底层常用 `clone()`），子进程复制父进程的地址空间（写时复制）、文件描述符和环境变量。
4. **加载程序**：子进程调用 `execve("/usr/bin/ls", argv, envp)`，用 ls 的程序替换自身，动态链接器加载 `libc.so` 等共享库，然后从 `main` 开始执行。
5. **读取目录**：ls 用 `openat()` 打开当前目录，用 `getdents64()` 读取目录项；`ls -l` 还要对每个文件调用 `stat` 类系统调用获取权限、大小、时间等元数据。
6. **格式化输出**：排序、过滤隐藏文件、按参数格式化，通过 `write()` 写到文件描述符 1（标准输出），终端把内容显示出来。
7. **进程退出**：ls 调用 `exit()` 返回退出码（0 表示成功），内核释放它的资源并给父进程发送 SIGCHLD。
8. **父进程回收**：Shell 在 `waitpid()` 中拿到退出状态（可以用 `echo $?` 查看），回收子进程，避免产生僵尸进程，然后打印新的提示符。

用 `strace ls` 可以看到 ls 执行过程中的全部系统调用。

### Shell 是如何解析命令并找到可执行文件的？
Shell 先分词和展开，再按"别名 → 函数 → 内置命令 → PATH 中的外部命令"的顺序确定命令是什么。

**解析**
- 分词：把输入拆成命令名和参数，例如 `ls -l /tmp` 拆成 `ls`、`-l`、`/tmp`。
- 展开：别名替换（很多发行版默认定义了 `alias ls='ls --color=auto'`）、变量展开（`$HOME`）、通配符展开（`*.log` 由 Shell 展开成文件列表，而不是交给 ls 处理）。
- 处理重定向和管道：`>`、`<`、`|` 由 Shell 设置好文件描述符后再执行命令。

**查找顺序**
1. 别名。
2. Shell 函数。
3. 内置命令，如 `cd`、`echo`、`export`，直接在 Shell 进程内执行，不创建子进程。
4. 外部命令：依次在 `PATH` 列出的目录（如 `/usr/local/bin:/usr/bin:/bin`）中查找同名的可执行文件，用第一个找到的。命令名中带 `/`（如 `./run.sh`）时直接按路径执行，不查 PATH。

**hash 缓存**：bash 会把找到的外部命令路径缓存在一张哈希表中（用 `hash` 命令查看），之后不再遍历 PATH。

**为什么 cd 必须是内置命令**：当前工作目录是进程自己的属性。如果 cd 作为外部程序在子进程里执行，只能改变子进程的目录，子进程退出后父进程 Shell 的目录不变。`export` 设置环境变量也是同样的道理。

用 `type ls` 可以看到命令最终被解析成别名、内置命令还是某个路径下的文件；`which ls` 只查找 PATH 中的外部命令。

### fork 和 execve 分别做了什么？
`fork` 负责"复制出一个进程"，`execve` 负责"把这个进程换成另一个程序"。Shell 执行外部命令就是先 fork 再在子进程里 execve。

**fork()**
- 创建一个几乎与父进程相同的子进程：复制地址空间、打开的文件描述符、信号处理方式、环境变量、当前目录等，但 PID 不同。
- 调用一次返回两次：父进程中返回子进程的 PID，子进程中返回 0，出错时返回 -1。
- 采用写时复制（Copy-On-Write）：fork 时父子进程共享同一批物理页，并把页标记为只读，任何一方写入时才复制那一页，所以 fork 的成本主要是复制页表。

**execve()**
- 用新程序替换当前进程的代码段、数据段、堆和栈，PID 保持不变。
- 内核读取可执行文件（ELF 格式），建立新的内存映射；如果是动态链接程序，先由动态链接器（如 `ld-linux-x86-64.so.2`）加载共享库，再跳到程序入口。
- 打开的文件描述符默认保留（设置了 `FD_CLOEXEC` 的除外），这就是 Shell 能在 exec 之前先设置好重定向和管道的原因。
- 成功时不返回（原来的代码已经不存在了），失败时返回 -1，比如文件不存在或没有执行权限。

**为什么分成两步**：在 fork 之后、exec 之前，子进程可以先调整重定向、管道、环境变量、工作目录、资源限制，然后再执行新程序，这让 Shell 实现 `ls > out.txt`、`a | b` 非常自然。

**回收**：子进程退出后，父进程必须调用 `wait` / `waitpid` 读取退出状态，否则子进程会一直保留为僵尸进程；父进程先退出时，子进程由 init（systemd）接管并回收。
