#!/system/bin/sh
# 守护进程看护：开机自启后常驻，守护进程异常退出时自动重新拉起。
# 用户在 WebUI 点“停止服务”会先写入 stop.request，看护进程随之退出，不会再拉起。
# 等待期间阻塞在 wait/sleep 上，不占 CPU、不持唤醒锁。
MODDIR=${0%/*}
DAEMON="$MODDIR/bin/oplus-sidekey"

# 离开启动者的 cgroup（例如从 SukiSU/KernelSU 管理器 WebUI 启动时继承的应用分组）。
# ColorOS 17 冻结后台应用时会冻结整个分组，守护进程就会收不到按键，直到管理器回到前台。
escape_cgroup() {
  for f in /sys/fs/cgroup/cgroup.procs /sys/fs/cgroup/freezer/cgroup.procs /dev/freezer/cgroup.procs /dev/cpuset/cgroup.procs; do
    [ -w "$f" ] && echo "$1" > "$f" 2>/dev/null
  done
}
escape_cgroup $$

echo $$ > "$MODDIR/supervisor.pid"
trap 'rm -f "$MODDIR/supervisor.pid"' EXIT

stopped() { [ -f "$MODDIR/stop.request" ] || [ -f "$MODDIR/disable" ] || [ -f "$MODDIR/remove" ]; }

DELAY=2
while ! stopped; do
  STARTED=$(date +%s)
  # 标准输入输出必须全部指向 /dev/null（原因见 service.sh）。
  "$DAEMON" "$MODDIR" </dev/null >/dev/null 2>&1
  stopped && break
  # 稳定运行超过 1 分钟后才退出的，视为偶发，立即从短间隔重试；连续失败则退避到最多 60 秒。
  if [ $(( $(date +%s) - STARTED )) -ge 60 ]; then DELAY=2; fi
  sleep "$DELAY"
  DELAY=$((DELAY * 2)); [ "$DELAY" -gt 60 ] && DELAY=60
done
