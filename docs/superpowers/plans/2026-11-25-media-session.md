# 计划：媒体会话控制

1. 测试先行：`scripts/tests/test_media_sh.py` 用 PATH 桩模拟 cmd/dumpsys/input，覆盖动词映射、toggle 新旧格式、cmd 失败回退、非法参数。
2. 实现 `module/media.sh`，customize.sh 设 0755。
3. WebUI：presets 测试（新命令、legacy 识别、升级函数）→ 实现 `MEDIA_SH`、`legacyCommands`、`upgradeLegacyCommands`；App 读配置后升级草稿并 toast；更新受影响测试。
4. 文档：README 媒体说明、CHANGELOG 0.5.8、版本号 0.5.8 / versionCode 13。
5. 验证：host 测试、python 测试、vitest、lint、build、打包；推送 main 与 tag，确认 CI。
