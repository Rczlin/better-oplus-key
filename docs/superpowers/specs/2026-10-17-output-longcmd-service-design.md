# 0.4.0 设计：命令输出、长命令、服务详情与性能

日期：2026-10-17
基线：用户上传的 0.3.0（仅二进制为用户重编译版本）

## 目标

1. 侧键触发的命令能看到执行输出（stdout/stderr）、退出码与耗时。
2. 支持长命令：单条命令上限由 511 字节提升到 4095 字节；编辑器支持多行脚本。
3. 概览页改版：服务详情（PID、运行时长、CPU、内存、线程、文件句柄、唤醒次数）与耗电评估、今日统计、最近一次执行与输出。
4. 性能：守护进程按需分配命令内存、去掉每次按键的 fopen/fclose 热路径以外的浪费；WebUI 合并 shell 调用、按需加载视图、可见时才自动刷新。
5. 保持配置格式与日志契约向后兼容（旧 log.txt 行格式不变）。

## 非目标

- 不做长期耗电统计（uid 0 的 batterystats 混合了所有 root 进程，数值不可归因）。耗电以 CPU 时间、平均占用与唤醒频率做“估算”，界面明确标注。
- 不改变按键状态机与时间语义。

## 方案

### 守护进程：输出捕获

- 每次派发命令时 `pipe2(O_CLOEXEC)`；子进程 stdin→/dev/null，stdout/stderr→管道写端。
  选择管道而不是文件：`cmd`/`input`/`am` 会把 stdio fd 交给 system_server，/data/adb 下的文件会被 SELinux 拒绝（0.3.0 修复的退出码 2），
  而 KernelSU 允许所有域使用 su 域的 fifo（libsu/WebUI 的 ksu.exec 即依赖这一点）。
- pipe2 失败时退回 /dev/null（命令照常执行，只是没有输出）。
- 父进程把读端设为非阻塞并加入 ppoll；每轮主循环非阻塞读取，单次执行最多保留 4096 字节，超出部分读出丢弃并标记 truncated（避免子进程因管道满而阻塞）。截断点回退到完整 UTF-8 字符边界。
- 子进程被回收时再读一次后关闭读端（后台残留进程再写会收到 EPIPE，不影响守护进程，SIGPIPE 已忽略）。
- 回收时：log.txt 照旧写 `seq=… action=… result=…`；另写一行 JSON 到 `output.jsonl`（上限 256 KiB，沿用按行对齐的截尾策略）：
  `{"time":"YYYY-MM-DD HH:MM:SS","wall_ms":N,"seq":"0","action":"…","code":0,"duration_ms":N,"truncated":false,"output":"…"}`。
  JSON 转义放在纯函数 `sidekey_output_format_record`（新文件 sidekey_output.c），可单测。

### 守护进程：长命令

- `SIDEKEY_CMD_MAX` 由 512 提升到 4096；绑定结构中的命令改为精确长度的堆分配（以前每条绑定固定占 512 字节）。
- 配置总量上限仍为 64 KiB。错误日志文案同步为 4095。

### WebUI：多行脚本

- 配置是按行解析的，多行脚本在保存时编码为一行：
  `: sidekey-script; eval "$(printf %s '<base64>' | base64 -d)"`（toybox 自带 base64）。
- 编辑器检测到该格式会解码回多行显示；动作名称显示为“多行脚本”，预览显示解码后的内容。
- 字节计数按最终写入配置的长度计算，并提示上限 4095。

### WebUI：服务详情与耗电评估

- 新命令 `serviceInfoCmd`：一次 shell 调用输出 key=value：state、pid、/proc/<pid>/stat、status 中的 VmRSS/VmHWM/Threads/上下文切换、fd 数、/proc/uptime、CLK_TCK、各文件大小。
- `parseServiceInfo` 计算：运行时长、CPU 总时间、平均 CPU 占用、内存、线程、句柄、每小时唤醒（自愿上下文切换数/小时，守护进程每次被唤醒必然产生一次自愿切换，可近似代表唤醒次数）。
- 两次采样之差得到“最近 CPU 占用”。
- 耗电评估：平均 CPU < 0.1% 且每小时唤醒 < 2000 → 极低；< 0.5% → 低；否则 偏高（提示检查是否有命令在后台常驻）。
- 概览可见且 WebView 在前台时每 5 秒刷新一次；隐藏时暂停。

### WebUI：命令输出

- 诊断页新增“命令输出”标签：最近 100 条执行，显示时间、按法、动作名称、退出码、耗时与输出（可展开、可复制）。
- 试运行不再截断为 300 字符：完整输出放在可滚动区域（最多 16 KiB）。

### WebUI：性能

- 概览刷新合并为一次 shell 调用（状态 + 进程详情 + 日志尾部 + 输出尾部）。
- 模板库、诊断、编辑器、方案对话框改为 React.lazy 按需加载；vendor 拆分为独立 chunk，利于 WebView 缓存。
- 日志只读尾部（log 300 行、output 100 行）。

## 兼容性

- 旧 config.conf 直接可用；log.txt 格式不变；旧 WebUI 遇到 >511 字节命令会拒绝加载（升级后不存在此组合）。
- 新 WebUI 配合旧二进制：长命令会被旧守护进程拒绝（日志会写 configuration rejected），README 说明需同时更新二进制；output.jsonl 不存在时输出页显示“需 0.4.0 守护进程”。

## 验证

- C：新增 test_output（JSON 转义、UTF-8 截断）、test_config 长命令边界、test_daemon_lifecycle 子进程 stdio 指向管道、输出捕获端到端（fork 真实 /bin/sh 执行 echo）。
- WebUI：serviceInfo 解析、多行脚本编解码、输出解析、概览/诊断渲染、试运行完整输出。
- 构建、lint、tsc、Playwright 视觉检查（1280/390）。

## 审查后修订（2026-10-17）

- 读取预算：每个 fd 每轮最多读 64 KiB 后回到主循环，持续高速输出的命令不会卡住按键处理。
- 后台进程：主 shell 被回收时若管道仍未 EOF，读端转入“孤儿”表（最多 16 个）继续读取丢弃直到 EOF，`cmd &` 的写入不会因 EPIPE 失败。
- 管道 fd 若落在 0–2（守护进程启动时标准 fd 被关闭），先用 F_DUPFD_CLOEXEC 移到 3 以上。
- 新配置项 `capture_output=0|1`（默认 1）：真机上若某些 binder 命令写管道被拒，可关闭收集，回到 /dev/null。
- JSON 中非法 UTF-8 字节替换为 \ufffd；output.jsonl 上限 512 KiB。
- 多行脚本包装改为 `S=$(printf %s '<b64>' | base64 -d) || exit 126; eval "$S"`，脚本末尾追加 `\n#`，保证 heredoc 结束标记后有换行且不改变退出码（mksh/dash/bash 验证）。
- 概览：今日统计在设备上 grep 计算；日志/输出文件大小未变时不传尾部；输出只取最近 20 条；启停时递增代号丢弃晚到的旧结果，忙时排队一次刷新。
- 段标记改为 `@@sidekey-log@@` / `@@sidekey-output@@`。
