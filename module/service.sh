#!/system/bin/sh
# 开机时由 KernelSU/SukiSU 执行；WebUI“启动服务”也调用本脚本。
MODDIR=${0%/*}
DAEMON="$MODDIR/bin/oplus-sidekey"

escape_cgroup() {
  for f in /sys/fs/cgroup/cgroup.procs /sys/fs/cgroup/freezer/cgroup.procs /dev/freezer/cgroup.procs /dev/cpuset/cgroup.procs; do
    [ -w "$f" ] && echo "$1" > "$f" 2>/dev/null
  done
}

# 启动即表示用户希望服务运行：清除“已停止”标记（开机时也清除，所以总会自启动）。
rm -f "$MODDIR/stop.request"

# 仅当 pid 文件指向的进程确实是本守护进程时，才认为它在运行。
# 只检查 /proc/<pid> 存在不够：pid 可能被系统复用给别的进程。
if [ -f "$MODDIR/daemon.pid" ]; then
  OLD=$(cat "$MODDIR/daemon.pid" 2>/dev/null)
  if [ -n "$OLD" ] && [ "$(readlink "/proc/$OLD/exe" 2>/dev/null)" = "$DAEMON" ]; then
    # 旧版本从 WebUI 启动的守护进程可能还在应用分组里，顺手移出来（含其子进程）。
    escape_cgroup "$OLD"
    for c in $(cat "/proc/$OLD/task/$OLD/children" 2>/dev/null); do escape_cgroup "$c"; done
    exit 0
  fi
fi

# 已有看护进程（例如守护进程正在退避重启）：不重复启动。
SP=$(cat "$MODDIR/supervisor.pid" 2>/dev/null)
if [ -n "$SP" ] && grep -q supervise.sh "/proc/$SP/cmdline" 2>/dev/null; then exit 0; fi

rm -f "$MODDIR/daemon.stderr"
# 守护进程自己写 log.txt / events.jsonl（遵守日志契约）。
# 标准输入输出必须全部指向 /dev/null：绑定命令会继承这些 fd，
# input/am/cmd/settings 等命令通过 binder 把 fd 交给 system_server；
# 若 stderr 指向 /data/adb 下的文件，SELinux 会拒绝 system_server 使用它，
# 命令报 “Failed transaction” 并以退出码 2 失败。
if command -v setsid >/dev/null 2>&1; then
  setsid sh "$MODDIR/supervise.sh" </dev/null >/dev/null 2>&1 &
else
  sh "$MODDIR/supervise.sh" </dev/null >/dev/null 2>&1 &
fi

# 流体云提示伴生应用：开机完成后安装/更新并授予通知权限（幂等：APK 未变时只做授权）。
if [ -f "$MODDIR/island.sh" ]; then
  (
    i=0
    until [ "$(getprop sys.boot_completed)" = "1" ] || [ "$i" -ge 120 ]; do sleep 2; i=$((i + 1)); done
    sh "$MODDIR/island.sh" install
  ) </dev/null >/dev/null 2>&1 &
fi
exit 0
