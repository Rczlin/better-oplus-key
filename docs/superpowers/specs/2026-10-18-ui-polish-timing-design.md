# 0.5.5：测试发布修复、时间上限放宽与界面打磨

## 背景
- 设备上 `island.sh test` 输出 `NullPointerException: ... ConfigurationController.getConfiguration()`，随后退回备用广播。
- 原因：Poster 只调用 `ActivityThread` 构造函数而不调用 `attach()`，Android 13+ 的 `mConfigurationController` 为 null，`getSystemContext()` 读取配置时崩溃。
- 用户希望长按/连按时间上限从 800 毫秒放宽到 1.2 秒，并整体优化前端。

## 设计
1. Poster：构造 `ConfigurationController(ActivityThreadInternal)` 填入 `mConfigurationController`（与 scrcpy 做法一致），失败时忽略以兼容旧系统。
2. 时间范围：守护进程解析器与 WebUI 统一为 100–1200 毫秒（`TIMING_MIN`/`TIMING_MAX`），新增“宽松”预设 700/600。
3. 测试结果：`island.path=broadcast` 时把 `island.error` 一并显示。
4. 界面：按压节奏图形（SequenceGlyph）、吸底保存栏、手机底部弹层、胶囊导航、更大触控区与按压反馈、自绘滑块、FAQ 展开箭头。保留全部现有测试钩子与可访问名称。
