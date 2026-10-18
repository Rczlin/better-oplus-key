# 0.5.5 实施计划
1. 测试先行：CTest 与 Vitest 中把上限断言改为 1200/1201，增加备用广播错误文案断言。
2. 修改 `sidekey_config.c`、`config.ts`、`BindingsView`、README。
3. Poster 增加 `fillConfigurationController`。
4. `island.ts` 解析并显示 `island.error`。
5. 界面打磨：button 尺寸、SequenceGlyph、AppShell 导航、BindingsView 吸底保存栏与滑块、BindingEditor/PacksDialog 底部弹层、FAQ。
6. 运行 CTest、Vitest、lint、WebUI 构建与 APK 构建；更新版本号与 CHANGELOG；推送 main 并打 v0.5.5 标签。
