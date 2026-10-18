# 计划：0.5.3 延迟与真实按键提示

1. FSM 按住期间提前触发长按（test_fsm 先写失败用例）。
2. `sidekey_notify_server_prepare` / `sidekey_notify_request_line` / `sidekey_notify_env_find`（test_notify）。
3. main.c 常驻发布进程：spawn / sync / write / 重启 / 回收（test_notify_dispatch 用读标准输入的假脚本）。
4. Poster `--serve` 与 `PosterArgs.parseLine`（PosterArgsTest）。
5. WebUI 关闭提示说明（island.test.tsx）。
6. 版本 0.5.3，CHANGELOG，构建 APK/WebUI，CTest、Vitest、Java、lint 全部通过后发布。
