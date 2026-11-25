#!/system/bin/sh
# 媒体控制：效果等同于控制中心媒体卡片上的按钮。
# 用法：media.sh toggle|play|pause|next|previous|stop|forward|rewind
# 首选 cmd media_session dispatch：原生命令直达系统媒体会话（当前/最近播放的应用），
# 不经过前台窗口，也不冷启动 Java 进程；不可用时退回 input keyevent。
# 输出：media=<实际动作> via=session|keyevent，没有可控会话时 media=none via=none

usage() { echo "usage: media.sh toggle|play|pause|next|previous|stop|forward|rewind"; exit 2; }
[ $# -eq 1 ] || usage

# 读取媒体会话状态，与控制中心媒体卡片的判断一致：
# 0 有会话正在播放；1 有可控会话但未在播放（暂停、缓冲中等）；3 没有可控会话；2 无法读取。
# 新格式 state=PLAYING(3)，旧格式 state=3。NONE(0)/STOPPED(1)/ERROR(7) 不算可控：
# 控制中心此时不显示卡片，向系统盲发媒体键会被转给“最近的媒体按钮接收者”，从而把音乐应用拉起来。
session_state() {
  if command -v timeout >/dev/null 2>&1; then
    OUT=$(timeout 2 dumpsys media_session 2>/dev/null) || return 2
  else
    OUT=$(dumpsys media_session 2>/dev/null) || return 2
  fi
  [ -n "$OUT" ] || return 2
  STATES=$(echo "$OUT" | grep -Eo 'state=PlaybackState \{state=[A-Z_]*\(?[0-9]+' | grep -Eo '[0-9]+$')
  for st in $STATES; do
    case "$st" in 3|4|5|6) return 0 ;; esac
  done
  for st in $STATES; do
    case "$st" in 0|1|7) ;; *) return 1 ;; esac
  done
  return 3
}

VERB=$1
case "$VERB" in
  toggle|play|pause|next|previous|stop|forward|rewind) ;;
  *) usage ;;
esac

# 与控制中心一致：没有可控会话（卡片不显示）时什么也不做，不拉起音乐应用。
# 设置 SIDEKEY_MEDIA_LAUNCH=1 可恢复旧行为（无会话时唤起最近的播放器）。
session_state
STATE=$?
if [ "$STATE" -eq 3 ] && [ "${SIDEKEY_MEDIA_LAUNCH:-0}" != 1 ]; then
  echo "media=none via=none"
  exit 0
fi
if [ "$VERB" = toggle ]; then
  case "$STATE" in
    0) VERB=pause ;;
    1|3) VERB=play ;;
    *) VERB=play-pause ;;
  esac
fi

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
