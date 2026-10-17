#!/system/bin/sh
# KSU 会 source 本文件。
ui_print "- 检查设备"
if [ "$KSU" != "true" ]; then
  abort "此模块仅支持 KernelSU"
fi
set_perm "$MODPATH/bin/oplus-sidekey" 0 0 0755
set_perm "$MODPATH/service.sh" 0 0 0755
set_perm "$MODPATH/uninstall.sh" 0 0 0755

# 升级安装时 $MODPATH 指向 modules_update 下的新目录，旧配置留在 modules 下。
# 先迁移用户已有的绑定与模板，避免升级后被默认配置覆盖。
OLD_MODDIR="/data/adb/modules/${MODPATH##*/}"
for FILE in config.conf templates.json; do
  if [ ! -f "$MODPATH/$FILE" ] && [ -f "$OLD_MODDIR/$FILE" ] && [ "$OLD_MODDIR" != "$MODPATH" ]; then
    if cp "$OLD_MODDIR/$FILE" "$MODPATH/$FILE"; then
      chmod 0644 "$MODPATH/$FILE"
      ui_print "- 已保留原有 $FILE"
    fi
  fi
done

if [ ! -f "$MODPATH/config.conf" ]; then
  cp "$MODPATH/config.conf.default" "$MODPATH/config.conf"
fi
ui_print "- 安装完成，重启后生效"
ui_print "- 在 KernelSU 管理器中打开本模块即可配置侧键"
