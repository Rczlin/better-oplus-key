# 侧键全链路延迟与真实按键提示修复（0.5.3）

## 现象
1. 从按下到反馈变慢。
2. “发送测试”能出流体云，实际按键不出。

## 全链路
evdev → `sidekey_input_drain` → FSM（长按阈值 / 连按窗口）→ `fork + sh -c` 执行命令 → SIGCHLD 回收 → 提示。

## 原因
- 每次提示 `fork + execv(app_process)`：冷启动 ART、创建系统上下文、建渠道，约数百毫秒 CPU，紧跟在命令之后（`am start` 等异步命令会被拖慢）。
- 测试由 WebUI（KernelSU 管理器环境，含 BOOTCLASSPATH 等）调用；守护进程由 service.sh 启动，环境可能缺少 app_process 必需的变量，失败输出被丢到 /dev/null。
- 长按只在松开时判定，即使没有以它开头的更长组合。
- 默认 `island_notify=0`，界面未说明测试与实际按键的区别。

## 设计
- 常驻发布进程：`Poster --serve` 读标准输入的行协议 `seq\tlabel\tcode\tduration_ms\tshow\n`；守护进程在配置加载/重载且提示开启时预先拉起，关闭时关管道（EOF 退出）；写失败（EPIPE）重启并重发一次；退出由 reap 回收并写 WARN。
- 发布子进程 exec 前用 zygote 的 `/proc/<pid>/environ` 补齐缺失变量，并设 ANDROID_ROOT 等缺省值；stdout/stderr 写 `island.log`（每次拉起截断，常驻模式只记录启动与失败）。
- FSM：按住时若追加 `1` 构成“精确且无更长”的组合，`tick` 返回 `press_t + long_press_ms` 作为唤醒时间，到点即触发并吞掉随后的松开；旧版固定 3 次匹配器保持原语义。
- WebUI：模式为“关闭”时显示说明。

## 风险
- 常驻 ART 进程占用约数十 MB 内存（仅在开启提示时）。
