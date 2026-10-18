# 0.5.1 实施计划

1. 伴生应用（TDD）
   - [x] `PosterArgsTest`：参数解析、显示时长限制 2–15、异常值容错
   - [x] `PressNamesTest`：耗时 ≥60 秒显示“分 秒”
   - [x] `IslandNotification`：共享构造，按本机规则选择着色/不着色
   - [x] `Poster`：root 发布、开启晋升、测试模式读取 `FLAG_PROMOTED_ONGOING`、失败退回广播
   - [x] `IslandReceiver` 改为使用共享构造（兜底）
2. 守护进程（TDD）
   - [x] `test_config`：`island_seconds` 默认 5、2–15、越界拒绝
   - [x] `test_notify`：app_process 参数、类路径、时长限制、路径过长拒绝
   - [x] `test_notify_dispatch`：端到端参数含 `--show`
   - [x] 实现 `sidekey_notify_prepare` 新签名与 `dispatch_notify`
3. 模块脚本（TDD）
   - [x] `island.sh test [秒]` 走 app_process；失败输出错误；缺少 APK 报告
   - [x] install 打开 `POST_PROMOTED_NOTIFICATIONS` appop
4. WebUI（TDD）
   - [x] `island_seconds` 解析/序列化
   - [x] 显示时长单选、测试结论（promoted）
   - [x] 时间设置滑块、实时说明、越界提示、恢复默认
5. 版本 0.5.1 / versionCode 6，CHANGELOG、README、默认配置
6. 全量验证 → 推送 main → 打 v0.5.1 标签触发 Release
