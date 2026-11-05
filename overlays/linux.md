## 导读
Linux 面试主要考常用命令和排障场景：查进程/端口、看 CPU/内存/磁盘、grep 统计日志、软硬链接，外加"输入 ls 回车后发生了什么"（fork + execve + wait）。
- 先背：top/free/df/du、ps + kill、ss/netstat/lsof 查端口、grep -c / wc -l、ln 和 ln -s。
- 最容易混的：kill 和 kill -9（SIGTERM 和 SIGKILL）；df 和 du；free 里的 free 和 available；软链接和硬链接。

## 纠正: 如何创建、删除、重命名文件和目录
原文说"rm filename 删除文件，需确认"，实际上 GNU rm 默认不提示，直接删除。只有带 -i，或者文件是写保护的（且标准输入是终端）时才会询问。
很多发行版（如 CentOS/RHEL 的 root 用户）在 ~/.bashrc 里设置了 alias rm='rm -i'，所以会出现提示，这是别名的效果，不是 rm 的默认行为。

## 补充: 如何查找并杀死一个进程
kill PID 发送 SIGTERM（15），进程可以捕获它，做完清理后再退出，所以优先用这个。kill -9 发送 SIGKILL，不能被捕获或忽略，但有两种情况杀不掉：处于 D 状态（不可中断睡眠，通常在等 I/O）的进程，以及僵尸进程（Z，已经退出，要等父进程 wait 回收，或者杀掉父进程）。
pkill 和 killall 默认也是发送 SIGTERM。

## 补充: 查看内存使用率
看 free 的输出时，要看 available 列，而不是 free 列。Linux 会把空闲内存拿来做 page cache（buff/cache），这部分在需要时可以回收。available 是估算出来的、新程序实际能用的内存。

## 补充: 查找可执行文件
Shell 的查找顺序是：别名 → 函数 → 内置命令 → PATH 中的外部命令。bash 会用一张 hash 表缓存已经找到的命令路径（可以用 hash 命令查看），所以不是每次都重新遍历 PATH。
用 type ls 可以看到一个命令最终被解析成哪一种。

## 自测
### 怎么查看某个端口被哪个进程占用？
ss -lntp | grep 8080、lsof -i :8080 或 netstat -tunlp | grep 8080。查看其他用户的进程需要 root 权限。
### kill 和 kill -9 有什么区别？
kill 默认发送 SIGTERM（15），进程可以捕获并优雅退出。kill -9 发送 SIGKILL，不能被捕获，进程立即被内核终止。
### df 和 du 有什么区别？
df 看整个文件系统的使用情况。du 统计目录下文件的实际大小。文件已删除但仍被进程打开时，空间不会释放，df 和 du 的结果就会不一致，可以用 lsof | grep deleted 排查。
### 怎么统计日志里 error 出现的行数？
grep -ci error app.log，或者 grep -i error app.log | wc -l。两种都统计行数，不是出现次数。要统计出现次数可以用 grep -oi error app.log | wc -l。
### 怎么递归搜索目录里包含某个字符串的文件？
grep -rn "Hello" dir/，只列出文件名用 grep -rl。如果要先按文件类型筛选，可以用 find dir -name "*.txt" | xargs grep -l "Hello"。
### 怎么实时查看日志末尾？
tail -f app.log。日志文件会被轮转时用 tail -F，它会按文件名重新打开。
### 硬链接和软链接有什么区别？
硬链接是指向同一个 inode 的多个文件名，不能跨文件系统，也不能链接目录。软链接存的是目标路径，可以跨文件系统；目标被删除后软链接失效。
### 什么情况下文件的数据才会真正被删除？
inode 的硬链接数为 0，并且没有进程还打开着它。
### 看 CPU 和负载用什么命令？
top/htop 看总体和每个进程的占用，vmstat 1 看 r（运行队列）和 cs（上下文切换），mpstat -P ALL 看每个核，uptime 看 1/5/15 分钟平均负载。
### load average 是什么意思？
单位时间内处于可运行状态（R）和不可中断睡眠状态（D）的平均进程数。要和 CPU 核数对比来判断是否过载。
### 输入 ls 回车后发生了什么？
Shell 解析命令（别名、内置命令、PATH 查找）→ fork 出子进程 → 子进程 execve 加载 /usr/bin/ls → ls 通过 getdents 读取目录并 write 到 stdout → 退出 → Shell 用 waitpid 回收子进程，打印新的提示符。
### 为什么 cd 必须是 Shell 内置命令？
工作目录是进程自己的属性。如果 cd 在子进程里执行，只会改变子进程的目录，影响不到父进程 Shell。
### chmod 755 是什么意思？
文件所有者 rwx（7），所属组 r-x（5），其他用户 r-x（5）。r=4，w=2，x=1。
### 怎么比较两个文件的差异？
diff file1 file2。diff -u 输出统一格式，diff -w 忽略所有空白字符，diff -q 只报告两个文件是否不同。
### 怎么找出占用磁盘最多的目录？
du -sh * | sort -rh | head，或者 du -h --max-depth=1 /path。
### 怎么在后台运行进程，并且退出终端后不被杀掉？
nohup cmd > out.log 2>&1 &。也可以用 tmux/screen，或者交给 systemd 管理。
