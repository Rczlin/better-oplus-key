# 0.5.6：脱离应用冻结分组与开机自启看护

## 问题
ColorOS 17（SukiSU 4.3.0 LKM，Android 17）上：服务显示运行中，但按侧键没反应；打开 SukiSU 管理器后，之前所有按压瞬间一起执行。用户确认只要打开管理器（不必进 WebUI）就恢复。

## 根因
WebUI 的“启动服务”通过管理器进程执行 service.sh，守护进程继承管理器应用的 cgroup（uid_<app>/pid_<n>）。ColorOS 冻结后台应用时冻结整个分组，守护进程停在 ppoll 中，evdev 事件在内核排队；管理器回到前台解冻后一次性处理。

## 设计
1. 守护进程启动时把自身 pid 写入各层级根组 cgroup.procs（v2 根、v1 freezer、cpuset），并把结果写入 log.txt；`SIDEKEY_NO_CGROUP_ESCAPE` 供单元测试关闭。
2. service.sh 对已运行的旧守护进程及其子进程同样迁出，用户点一次“启动服务”即可修复而无需重启。
3. 输入层丢弃时间戳早于当前 5 秒以上的按键边沿并重置 FSM，防止任何原因的积压在恢复时连发。
4. 新增 supervise.sh 看护：迁出 cgroup 后前台运行守护进程，非预期退出按 2→60 秒指数退避重启；存在 stop.request / disable / remove 时退出。service.sh 启动时清除 stop.request（因此开机总会自启），WebUI 停止命令先写 stop.request 再发 TERM。卸载脚本先写标记再结束看护进程。
