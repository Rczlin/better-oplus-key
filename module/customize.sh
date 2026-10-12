#!/system/bin/sh
# KSU 会 source 本文件。
ui_print "- 检查设备"
if [ "$KSU" != "true" ]; then
  abort "此模块仅支持 KernelSU"
fi
set_perm "$MODPATH/bin/oplus-sidekey" 0 0 0755
set_perm "$MODPATH/service.sh" 0 0 0755
set_perm "$MODPATH/uninstall.sh" 0 0 0755
if [ ! -f "$MODPATH/config.conf" ]; then
  cp "$MODPATH/config.conf.default" "$MODPATH/config.conf"
fi
ui_print "- 安装完成，重启后生效"
