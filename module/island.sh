#!/system/bin/sh
# 流体云提示伴生应用管理：install | status | test
# 输出 key=value，供 WebUI 解析。
MODDIR=${0%/*}
PKG=io.github.rczlin.sidekey.island
ACTION=$PKG.SHOW
COMPONENT=$PKG/.IslandReceiver
PERM=android.permission.POST_NOTIFICATIONS
APK="$MODDIR/companion/island.apk"
STAMP="$MODDIR/companion/.installed"

is_installed() { pm path "$PKG" 2>/dev/null | grep -q '^package:'; }
is_granted() { dumpsys package "$PKG" 2>/dev/null | grep -q "$PERM: granted=true"; }

# 通过标准输入把 APK 交给 pm：system_server 无权直接读取 /data/adb 下的文件（SELinux），管道则可以。
stream_install() {
  cat "$APK" | pm install -r -d -S "$(stat -c %s "$APK")" 2>&1
}

do_install() {
  if [ ! -f "$APK" ]; then
    echo "island=missing-apk"
    return 1
  fi
  SUM=$(sha256sum "$APK" 2>/dev/null | cut -d' ' -f1)
  if ! is_installed || [ -z "$SUM" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$SUM" ]; then
    rm -f "$STAMP"
    OUT=$(stream_install)
    case "$OUT" in
      *Success*) ;;
      *INSTALL_FAILED_UPDATE_INCOMPATIBLE*|*SIGNATURE*)
        # 伴生应用无状态：签名变化（例如换了构建密钥）时卸载重装
        pm uninstall "$PKG" >/dev/null 2>&1
        OUT=$(stream_install) ;;
    esac
    case "$OUT" in
      *Success*) [ -n "$SUM" ] && echo "$SUM" > "$STAMP" ;;
      *)
        echo "island=failed"
        echo "island.error=$(echo "$OUT" | tr '\n' ' ' | sed 's/ *$//')"
        return 1 ;;
    esac
  fi
  pm grant "$PKG" "$PERM" >/dev/null 2>&1
  echo "island=installed"
}

do_status() {
  if [ -f "$APK" ]; then echo "island.apk=1"; else echo "island.apk=0"; fi
  if is_installed; then echo "island.installed=1"; else echo "island.installed=0"; fi
  if is_granted; then echo "island.granted=1"; else echo "island.granted=0"; fi
  echo "island.sdk=$(getprop ro.build.version.sdk)"
}

do_test() {
  if cmd activity broadcast --user 0 -f 0x10000020 -a "$ACTION" -n "$COMPONENT" --ez test true >/dev/null 2>&1; then
    echo "island=sent"
  else
    echo "island=failed"
    return 1
  fi
}

case "$1" in
  install) do_install ;;
  status) do_status ;;
  test) do_test ;;
  *) echo "usage: island.sh install|status|test" >&2; exit 2 ;;
esac
