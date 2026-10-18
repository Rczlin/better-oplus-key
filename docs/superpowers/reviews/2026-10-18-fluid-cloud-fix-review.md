# 0.5.1 自审

## 验证

- CTest 16/16、WebUI Vitest 188、island.sh 14、伴生 Java 测试全部通过；WebUI lint 0 error、build 成功。
- APK 构建成功：`dump badging` 为 `io.github.rczlin.sidekey.island` 0.5.1 / 6，dex 含 `Poster`、`PosterArgs`、`IslandNotification`。

## 依据（AOSP android16-release / android16-qpr1-release）

- `INotificationManager.aidl`：`enqueueNotificationWithTag(pkg, opPkg, tag, id, n, userId)`、`createNotificationChannelsForPackage`、`appCanBePromoted`、`setCanBePromoted`、`getAppActiveNotifications` 两个分支签名一致。
- `NotificationManagerService.isUidSystemOrPhone` 含 `uid == ROOT_UID`；`resolveNotificationUid` 对 `isCallerAndroid` 放行代发。
- `Notification.hasPromotableCharacteristics` 两套规则见设计文档；`FLAG_PROMOTED_ONGOING = 0x00040000`。

## 风险

- 未在真机验证；ColorOS 可能定制 NMS。Poster 失败时退回广播，WebUI 会提示“备用广播”。
- `app_process` 依赖守护进程继承的 init 环境（`BOOTCLASSPATH` 等），KernelSU/Magisk 的 service.sh 均满足。
- 每次提示启动一个 ART 进程（约数百毫秒、短暂内存），只在命令结束后异步运行，不影响按键响应。
- `setCanBePromoted(fromUser=true)` 会在关闭状态下替用户打开组件的实况通知；只在用户启用流体云提示后、提示发布时执行。
