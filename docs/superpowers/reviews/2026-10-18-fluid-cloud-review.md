# 0.5.0 流体云提示审查

日期：2026-10-18
范围：ebd9382..HEAD（设计、守护进程、伴生应用、模块脚本、WebUI、CI）

## 结论

可合入。核心路径（配置 → 回收 → 广播 → 通知）均有测试覆盖；真机流体云显示需在 ColorOS 16 设备上确认。

## 检查项

- 守护进程：通知子进程不进入 inflight 表，被 `waitpid(-1)` 回收时找不到槽位直接跳过，不产生日志行（e2e 断言 log 行数与 output.jsonl 记录数）。
  fork 失败只写 WARN；通知程序不存在时子进程 `_exit(127)`，不影响后续按键。dropped 不提示。
- argv 直接 `execv`，不经 shell，标签中的引号、`$`、中文无需转义；标签按 UTF-8 边界截断（中文用例覆盖）。
- `-f 0x10000020` 包含 FLAG_INCLUDE_STOPPED_PACKAGES：伴生应用安装后从未启动过（无界面，永远不会被用户打开）也能收到广播。
- 接收器受 signature 级权限保护，第三方应用无法伪造提示；root（uid 0）权限检查直接通过。
- `pm install` 通过管道读取 APK，规避 system_server 读取 /data/adb 文件的 SELinux 拒绝；签名冲突时卸载重装（应用无状态）。
- 按 API 36 编译：`setRequestPromotedOngoing` 只在 36.1 SDK 公开，改为写入同名 extra，Android 16 基础版与 QPR 版本都能识别。
- WebUI：缺省不写 `island_notify`，旧配置往返不变；`fingerprint` 纳入新字段，切换后显示“未保存”。

## 已知风险 / 后续

- ColorOS 的自启动与关联启动管控可能拦截发给后台应用的广播：界面与 README 已提示允许自启动；若真机仍被拦截，可改为由守护进程调用 `cmd notification` 之外的方案（例如 `am start-foreground-service`）。
- 每次 CI 构建使用临时签名；升级时由 island.sh 卸载重装。若希望签名稳定，可在仓库 Secrets 中配置 `SIDEKEY_KEYSTORE*`。
- 仓库内的 `module/bin/oplus-sidekey` 仍是 0.4.0 二进制；Release 包由 CI 重新编译，不受影响。
