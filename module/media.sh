#!/system/bin/sh
# 媒体控制：效果等同于控制中心媒体卡片上的按钮。
# 用法：media.sh toggle|play|pause|next|previous|stop|forward|rewind
# 首选 cmd media_session dispatch：原生命令直达系统媒体会话（当前/最近播放的应用），
# 不经过前台窗口，也不冷启动 Java 进程；不可用时退回 input keyevent。
# 输出：media=<实际动作> via=session|keyevent

usage() { echo "usage: media.sh toggle|play|pause|next|previous|stop|forward|rewind"; exit 2; }
[ $# -eq 1 ] || usage

# 是否有会话正在播放：0 是，1 否，2 无法读取。
# 新格式 state=PLAYING(3)，旧格式 state=3；缓冲、快进、快退也按“正在播放”处理。
playing_state() {
  if command -v timeout >/dev/null 2>&1; then
    OUT=$(timeout 2 dumpsys media_session 2>/dev/null) || return 2
  else
    OUT=$(dumpsys media_session 2>/dev/null) || return 2
  fi
  [ -n "$OUT" ] || return 2
  echo "$OUT" | grep -Eq 'state=PlaybackState \{state=(PLAYING\(3\)|FAST_FORWARDING\(4\)|REWINDING\(5\)|BUFFERING\(6\)|[3-6][,}])' && return 0
  return 1
}

VERB=$1
case "$VERB" in
  toggle)
    playing_state
    case $? in
      0) VERB=pause ;;
      1) VERB=play ;;
      *) VERB=play-pause ;;
    esac ;;
  play|pause|next|previous|stop|forward|rewind) ;;
  *) usage ;;
esac

case "$VERB" in
  play) KEY=play; CODE=126 ;;
  pause) KEY=pause; CODE=127 ;;
  play-pause) KEY=play-pause; CODE=85 ;;
  next) KEY=next; CODE=87 ;;
  previous) KEY=previous; CODE=88 ;;
  stop) KEY=stop; CODE=86 ;;
  forward) KEY=fast-forward; CODE=90 ;;
  rewind) KEY=rewind; CODE=89 ;;
esac

RES=$(cmd media_session dispatch "$KEY" 2>&1)
RC=$?
case "$RES" in
  *rror*|*xception*|*nknown*|*"not found"*|*"Can't find"*) RC=1 ;;
esac
if [ "$RC" -eq 0 ]; then
  echo "media=$VERB via=session"
  exit 0
fi
input keyevent "$CODE"
RC=$?
echo "media=$VERB via=keyevent"
exit $RC
