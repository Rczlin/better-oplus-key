# 0.5.0 设计：命令执行后在流体云（灵动岛）显示提示

日期：2026-10-18
基线：0.4.0（5db5ef1）

## 目标

1. 侧键命令执行结束后，可选地在 ColorOS 流体云胶囊中显示一条短提示：成功/失败、按法、动作、耗时。
2. 可在 WebUI 中设置：关闭（默认）/ 每次执行 / 仅失败；提供“发送测试”。
3. 不影响按键处理延迟与守护进程的耗电特征；未安装伴生应用或系统不支持时安静降级。

## 非目标

- 不做常驻胶囊、不做进度实时更新（命令只在结束时提示一次）。
- 不支持 ColorOS 15 及更早版本的私有流体云 SDK。
- 不做提示内容模板自定义。

## 关键约束

ColorOS 16 的流体云接入 Android 16 Live Updates：通知必须由应用发出，并满足
`POST_PROMOTED_NOTIFICATIONS` 权限、`setOngoing(true)`、`setRequestPromotedOngoing(true)`、有 contentTitle、
`setShortCriticalText`（胶囊文字）以及富样式（`Notification.ProgressStyle`）。
root shell 的 `cmd notification post` 无法设置这些标志，只能产生普通通知，因此需要一个伴生应用。

## 方案

### 伴生应用（`companion/`）

- 包名 `io.github.rczlin.sidekey.island`，minSdk/targetSdk 36，仅使用框架 API（无 AndroidX、无 Gradle），按 API 36（Android 16 基础版）编译。
- `setRequestPromotedOngoing` 只在 API 36.1 的 SDK 中公开；为兼容 Android 16 基础版，直接写入同名 extra `android.requestPromotedOngoing=true`（API 36.1 的 `Notification.EXTRA_REQUEST_PROMOTED_ONGOING`，AndroidX NotificationCompat 也是这样实现的）。权限名按字符串声明。
- 一个导出的 `IslandReceiver`，受 `android.permission.INTERACT_ACROSS_USERS_FULL`（signature 级）保护：
  root/shell 发送的广播可以通过，普通第三方应用无法伪造提示。
- 动作 `io.github.rczlin.sidekey.island.SHOW`，extras：
  `seq`（String，0/1 组合）、`label`（String，动作摘要）、`code`（int，退出码）、`duration_ms`（long）、`test`（boolean）。
- 通知：渠道 `sidekey_result`（IMPORTANCE_HIGH），固定 id（新提示替换旧提示），`setOngoing(true)`、
  `setRequestPromotedOngoing(true)`、`setShortCriticalText("✓ 双击" / "✗ 127")`、
  标题 “双击 · 执行成功 / 执行失败（127）”、正文为动作摘要与耗时、
  `ProgressStyle` 单段满进度（成功绿色、失败红色）、`setTimeoutAfter(4000)` 自动消失、`CATEGORY_STATUS`、`setOnlyAlertOnce`。
- 按法名称：0 单击、00 双击、000 三击、1 长按、01 短按+长按，其余按 “短→长→…” 拼接。
- 未授予通知权限时直接返回（系统会丢弃通知，无需额外处理）。

### 守护进程

- 新配置项 `island_notify=0|1|2`：0 关闭（默认），1 每次执行，2 仅失败（退出码非 0，含 fork 失败以外的所有非零结果）。
  范围外取值视为无效配置（与其他整数项一致，整个配置被拒绝并保留旧配置）。
- 新纯函数模块 `sidekey_notify.c`：
  - `sidekey_notify_wanted(mode, code)`；
  - `sidekey_notify_label(cmd, out, cap)`：多行脚本包装（`: sidekey-script;` 前缀）显示为“多行脚本”；
    其他命令取前 96 字节，回退到完整 UTF-8 字符边界，被截断时追加 “…”；
  - `sidekey_notify_prepare(msg, seq, cmd, code, duration_ms)`：生成 argv（不经过 shell，无需转义）：
    `cmd activity broadcast --user 0 -f 0x10000000 -a <ACTION> -n <PKG>/.IslandReceiver --es seq … --es label … --ei code … --el duration_ms …`。
    seq 超过 32 个字符时截断。
- `reap_children` 在写完解释日志与输出记录后，若需要提示，则 fork 一个通知子进程 `execv("/system/bin/cmd", argv)`；
  stdin/stdout/stderr 指向 /dev/null，不进入 inflight 表、不写日志与 output.jsonl；被同一个 `waitpid(-1)` 回收。
  fork 失败只写一条 WARN，不影响按键处理。未绑定（dropped）的按法不提示。
- 通知程序路径保存在全局变量（默认 `/system/bin/cmd`），测试中可替换为记录参数的脚本。

### 模块脚本

- `module/island.sh`：
  - `install`：若 `companion/island.apk` 存在且（未安装或 apk 的 sha256 与上次记录不同），执行 `pm install -r`；
    签名不一致导致失败时先 `pm uninstall` 再安装；然后 `pm grant … POST_NOTIFICATIONS`。输出 `island=installed|missing-apk|failed`。
  - `status`：输出 `island.installed=0|1`、`island.granted=0|1`、`island.apk=0|1`。
  - `test`：发送一条 `test=true` 的示例广播。
- `service.sh`：后台等待 `sys.boot_completed=1` 后执行 `island.sh install`（幂等，已是最新时只做 grant）。
- `customize.sh`：设置 `island.sh` 权限；安装时尝试一次 `island.sh install`（失败不影响模块安装，开机后会重试）。
- `uninstall.sh`：卸载伴生应用。

### WebUI

- `config.ts`：解析/序列化 `islandNotify`（0/1/2，缺省 0，仅非 0 时写出）。
- 新 `lib/island.ts`：状态/安装/测试命令与状态解析。
- “绑定 → 时间设置” 中新增“流体云提示”：三档单选、伴生应用状态（已就绪 / 未安装 / 未授权）、
  “安装/修复”与“发送测试”按钮；说明需 ColorOS 16，并可能需要在系统设置中允许该应用使用流体云/实况通知。
- 保存后由守护进程 SIGHUP 重载生效，与其他配置一致。

### 构建与 CI

- `scripts/build-companion.sh`：用 `$ANDROID_HOME` 下 `platforms;android-36` 与 `build-tools;36.0.0`
  （aapt2 编译/链接、javac、d8、zipalign、apksigner）生成 `module/companion/island.apk`。
  签名：若设置 `SIDEKEY_KEYSTORE` 等环境变量则使用之，否则生成临时密钥（签名变化由 `island.sh` 的卸载重装处理，伴生应用无状态）。
- APK 不入库（`.gitignore`）；CI 在打包前安装 SDK 组件并构建。
- 版本 0.5.0 / versionCode 5，CHANGELOG 与 README 更新。

## 兼容性

- 旧配置无 `island_notify`：行为与 0.4.0 一致。
- 新 WebUI + 旧守护进程：旧守护进程会把 `island_notify` 计入“跳过的未知行”并写 WARN，其余不受影响。
- 未安装伴生应用或 Android < 16：广播无接收者，`cmd` 静默返回；界面显示状态提示。

## 验证

- C：`test_notify`（wanted、label 截断/UTF-8/多行脚本、argv 内容）、`test_config`（island_notify 默认值/范围）、
  `test_output_capture` 端到端（替换通知程序为脚本，验证成功/失败/仅失败三种模式下的调用参数与次数）。
- WebUI：配置往返、状态解析、开关保存、测试按钮执行的命令。
- 伴生应用：构建脚本在 CI 生成并签名 APK；`aapt2 dump badging` 校验包名、sdk 版本与权限。
- 真机：需用户在 ColorOS 16 设备上确认胶囊显示（CI 无法验证）。
