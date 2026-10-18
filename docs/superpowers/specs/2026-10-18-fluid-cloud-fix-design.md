# 流体云提示修复与时间设置优化（0.5.1）设计

## 背景（真机反馈，OnePlus Ace 6 / ColorOS 16）

1. 测试提示只显示为普通通知，没有进入流体云。
2. 只有第一次按键有提示，之后连普通通知都没有。
3. 时间设置需要优化。

## 根因

### 1. 没有晋升为实况通知

AOSP 中 `Notification.hasPromotableCharacteristics()` 有两套互斥规则：

| 版本 | 规则 |
| --- | --- |
| Android 16（未启用 `ui_rich_ongoing`） | ongoing + 标题 + 可晋升样式 + **必须** `EXTRA_COLORIZED=true`（通话样式除外） |
| Android 16 QPR1（启用 `ui_rich_ongoing`） | 需 `EXTRA_REQUEST_PROMOTED_ONGOING` + ongoing + 标题 + 可晋升样式 + **不得**着色 |

0.5.0 只按 QPR1 规则构造。设备若仍走旧规则，通知不会获得 `FLAG_PROMOTED_ONGOING`。
另外 QPR1 中晋升权限是 `normal|appop`，用户/系统可通过 appop 关闭。

### 2. 只有第一次送达

0.5.0 通过 `cmd activity broadcast` 唤醒伴生应用。ColorOS 会冻结或拦截后台应用（自启动/关联启动管控），
第一次之后广播无法送达，接收器不运行，通知也就没有。

## 方案

### 发布路径：root 直接发布

- 守护进程 fork + `execv("/system/bin/app_process", …)`：
  `app_process -Djava.class.path=<模块>/companion/island.apk /system/bin --nice-name=sidekey-island io.github.rczlin.sidekey.island.Poster --seq … --label … --code … --duration … --show …`
  仍不经过 shell；所有用户内容都是类名之后的 main 参数。
- `Poster`（运行于 uid 0）：构造 `ActivityThread` 取系统 Context → `createPackageContext(伴生包)`；
  通过 `INotificationManager`：
  - `createNotificationChannelsForPackage` 建立渠道；
  - `appCanBePromoted` 为假时 `setCanBePromoted(pkg, uid, true, fromUser=true)`；
  - `enqueueNotificationWithTag(pkg, opPkg="android", …)`：NMS 的 `resolveNotificationUid` 允许 uid 0 以 `android` 身份代任意包发布，通知仍归属伴生应用。
- 失败时（隐藏 API 变化等）退回旧广播路径，并输出 `island.path=broadcast`。
- `island.sh install` 额外执行 `appops set <pkg> POST_PROMOTED_NOTIFICATIONS allow`。

### 通知样式

`IslandNotification.build` 先按 QPR1 规则构造；若本机 `hasPromotableCharacteristics()` 为假，改用着色版本；由系统自身判断，不猜版本。

### 显示时长

- 新配置 `island_seconds=2..15`，默认 5（缺省不写入）；守护进程与 WebUI 使用相同边界。
- WebUI：3 / 5 / 8 / 10 / 15 秒单选；测试按钮使用当前（未保存）选择。

### 测试诊断

`island.sh test [秒]` 调用同一个 Poster（`--test`），Poster 轮询 `getAppActiveNotifications` 读取系统实际给出的 `FLAG_PROMOTED_ONGOING`，
输出 `island.promoted=1|0`。WebUI 据此给出“已显示在流体云”或设置路径提示。

### 时间设置

- 数值框 + 滑块（100–800，步长 10），实时一句话说明效果；
- 超范围即时提示；
- “恢复默认”（300/300）。

## 不做

- 不让伴生应用常驻或申请自启动白名单（root 发布路径不需要）。
- 不引入 Gradle/AndroidX。
