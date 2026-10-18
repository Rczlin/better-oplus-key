# 评审：0.5.3

- 发布管道写端 CLOEXEC，命令子进程不会持有，守护进程退出时发布进程读到 EOF 自行退出。
- 写端非阻塞：发布进程卡住时最多丢一条提示，不阻塞按键循环；SIGPIPE 已忽略。
- 首次开机时伴生 APK 可能尚未安装：Session 初始化失败后，下一条请求重新初始化。
- 连续 20 次发布失败时发布进程退出，避免无限刷日志；守护进程下次提示再拉起。
- 提前触发长按与输入层的事件时间戳 tick 一致：松开事件晚于阈值时先 tick 触发，再吞掉松开。
- 验证：CTest 16/16、Vitest 188、PosterArgsTest/PressNamesTest、WebUI lint 0 errors、APK/WebUI 构建成功。未在真机验证。
