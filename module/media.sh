#!/system/bin/sh
# 媒体控制：效果等同于控制中心媒体卡片上的按钮。
# 用法：media.sh toggle|play|pause|next|previous|stop|forward|rewind
# 首选 cmd media_session dispatch：原生命令直达系统媒体会话（当前/最近播放的应用），
# 不经过前台窗口，也不冷启动 Java 进程；不可用时退回 input keyevent。
# 输出：media=<实际动作> via=session|keyevent；没有播放器时 media=none via=none 或 media=launch via=app

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

# 没有可控播放器（控制中心不显示媒体卡片）时的行为，读取 media.conf：
#   idle=recent  继续最近播放的应用（默认，系统把“播放”交给最近的媒体按钮接收者）
#   idle=app     打开 app=<包名> 指定的应用并开始播放
#   idle=none    什么也不做
# 只有播放/暂停与播放会拉起；上一首、下一首等在没有播放器时不做任何事。
MODDIR=${0%/*}
IDLE=recent
APP=
if [ -f "$MODDIR/media.conf" ]; then
  while IFS='=' read -r K V; do
    case "$K" in
      idle) case "$V" in none|recent|app) IDLE=$V ;; esac ;;
      app) APP=$V ;;
    esac
  done < "$MODDIR/media.conf"
fi
[ "${SIDEKEY_MEDIA_LAUNCH:-}" = 1 ] && IDLE=recent
case "$APP" in
  *[!A-Za-z0-9_.]*|''|.*|*.|*..*) APP= ;;
  *.*) ;;
  *) APP= ;;
esac

# 拉起由伴生组件 MediaLaunch 完成（root）。--recent 与控制中心空卡片的播放键相同：
# 从 ColorOS 媒体中心的历史播放器里取最近一个，先解冻再发送“播放”，并确认真的开始播放。
APK="$MODDIR/companion/island.apk"
run_launch() {
  [ -f "$APK" ] || return 1
  OUT=$(app_process "-Djava.class.path=$APK" /system/bin --nice-name=sidekey-media \
    io.github.rczlin.sidekey.island.MediaLaunch "$@" 2>&1)
  case "$OUT" in
    *media.launch=history*|*media.launch=session*|*media.launch=app*)
      WHO=$(echo "$OUT" | sed -n 's/^media\.app=//p' | head -n 1)
      HOW=$(echo "$OUT" | sed -n 's/^media\.launch=//p' | head -n 1)
      echo "media=launch via=$HOW app=$WHO"
      exit 0 ;;
  esac
  ERR=$(echo "$OUT" | sed -n 's/^media\.error=//p' | head -n 1)
  [ -n "$ERR" ] && echo "media.error=$ERR"
  return 1
}

launch_recent() {
  run_launch --recent
  # 没有历史播放器或确认失败：交给系统的最近媒体按键接收者
  VERB=play
}

launch_app() {
  if [ -f "$APK" ]; then
    run_launch "$APP" 5000
  else
    monkey -p "$APP" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    sleep 2
  fi
  VERB=play
}

STATE=0
session_state
STATE=$?
if [ "$STATE" -eq 3 ]; then
  case "$VERB" in
    toggle|play)
      case "$IDLE" in
        none) echo "media=none via=none"; exit 0 ;;
        app) if [ -n "$APP" ]; then launch_app; else launch_recent; fi ;;
        *) launch_recent ;;
      esac ;;
    *) echo "media=none via=none"; exit 0 ;;
  esac
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
