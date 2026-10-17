#!/system/bin/sh
MODDIR=${0%/*}
DAEMON="$MODDIR/bin/oplus-sidekey"

# 仅当 pid 文件指向的进程确实是本守护进程时，才认为它在运行。
# 只检查 /proc/<pid> 存在不够：pid 可能被系统复用给别的进程。
if [ -f "$MODDIR/daemon.pid" ]; then
  OLD=$(cat "$MODDIR/daemon.pid" 2>/dev/null)
  if [ -n "$OLD" ] && [ "$(readlink "/proc/$OLD/exe" 2>/dev/null)" = "$DAEMON" ]; then
    exit 0
  fi
fi

# 守护进程自己写 log.txt / events.jsonl（遵守日志契约）。
# 这里只捕获它崩溃前的 stderr，写到独立文件，避免破坏日志格式。
"$DAEMON" "$MODDIR" </dev/null >/dev/null 2>>"$MODDIR/daemon.stderr" &
