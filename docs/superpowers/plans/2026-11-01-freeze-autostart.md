# 0.5.6 实施计划
1. CTest：test_cgroup（写入存在的文件、跳过缺失路径、拒绝非法 pid）；test_input 新增过期事件丢弃用例。
2. 实现 sidekey_cgroup.c，main.c 启动时调用；sidekey_input.c 加入 SIDEKEY_INPUT_STALE_MS。
3. module/supervise.sh、service.sh、uninstall.sh、customize.sh 权限。
4. WebUI stopCmd 先写 stop.request（Vitest 断言顺序）；FAQ 与服务状态文案。
5. CTest、Vitest、lint、构建、APK；版本 0.5.6/11，CHANGELOG；推送 main，打 v0.5.6。
