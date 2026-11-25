# 媒体控制改走媒体会话（0.5.8）

## 背景
媒体预设此前是 `input keyevent 85/87/88/86/90/89`：
- `input` 每次冷启动一个 Java 进程（app_process），在 ColorOS 上约 300 ms 以上；
- 按键先经输入分发到前台窗口，游戏、视频类前台应用可能吞掉；
- 播放/暂停（85）进入媒体会话后，框架默认回调会为“双击切歌”等待双击超时（约 300 ms）再执行单击。

用户希望效果等同于在控制中心媒体卡片上点暂停、上一首、下一首。

## 目标
- 新增 `module/media.sh <toggle|play|pause|next|previous|stop|forward|rewind>`，root 执行：
  1. 首选 `cmd media_session dispatch <key>`：原生 `cmd` 进入 system_server 的 MediaSessionService，直接交给当前媒体按钮会话（即控制中心显示的那个正在/最近播放的会话），不经过前台窗口，不启动 Java 进程。
  2. `toggle` 先读 `dumpsys media_session`：任一会话处于 PLAYING/BUFFERING/快进/快退（新格式 `PLAYING(3)`，旧格式 `state=3`）则发 `pause`，否则发 `play`。显式 play/pause 不触发框架的双击等待，与控制中心按钮语义相同；无会话时 `play` 会唤回最近的播放应用继续播放。读取失败时退回 `play-pause`。
  3. `cmd` 失败（非 0 或输出含 Error/Exception/Unknown/not found）时退回 `input keyevent`。
  4. 输出一行 `media=<verb> via=session|keyevent`。
- WebUI 媒体预设改为 `sh /data/adb/modules/oplus-sidekey/media.sh <verb>`；旧 `input keyevent` 命令作为 legacy 仍识别为同名预设。
- 读取配置时把与旧媒体预设完全一致的命令升级为新命令，仅修改草稿（显示“未保存”），并用 toast 告知数量；保存后生效。
- 音量与静音保持 keyevent 不变。

## 不做
- 不改守护进程与流体云；不做 Java TransportControls 路径（显式 play/pause 已与之等效，且无需 JVM）。

## 风险
- 个别 ROM 若裁剪 `cmd media_session`，自动退回 keyevent。
- `dumpsys` 格式差异：识别失败时退回 `play-pause`，最多多一次双击等待。
