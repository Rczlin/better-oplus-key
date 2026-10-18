#!/system/bin/sh
MODDIR=${0%/*}
DAEMON="$MODDIR/bin/oplus-sidekey"

# 1) 优先按 pid 文件结束，但只结束确认是本守护进程的 pid。
if [ -f "$MODDIR/daemon.pid" ]; then
  PID=$(cat "$MODDIR/daemon.pid" 2>/dev/null)
  if [ -n "$PID" ] && [ "$(readlink "/proc/$PID/exe" 2>/dev/null)" = "$DAEMON" ]; then
    kill -TERM "$PID" 2>/dev/null
    sleep 1
  fi
fi

# 2) 兜底：按可执行路径精确匹配残留进程，防止独占残留到重启。
for p in /proc/[0-9]*; do
  pid=${p#/proc/}
  exe=$(readlink "$p/exe" 2>/dev/null) || continue
  if [ "$exe" = "$DAEMON" ]; then
    kill -TERM "$pid" 2>/dev/null
  fi
done

# 3) 卸载流体云提示伴生应用（系统服务可能尚未就绪，后台等待开机完成）。
(
  i=0
  until [ "$(getprop sys.boot_completed)" = "1" ] || [ "$i" -ge 120 ]; do sleep 2; i=$((i + 1)); done
  pm uninstall io.github.rczlin.sidekey.island
) </dev/null >/dev/null 2>&1 &
exit 0
