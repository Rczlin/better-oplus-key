# OnePlus 侧键（oplus-sidekey）

KernelSU 模块：接管 OnePlus Ace 6 侧键，让单击、双击、长按等不同按法各自执行一个动作，比如截屏、播放/暂停、打开相机、打开微信。

[GitHub 仓库](https://github.com/Rczlin/better-oplus-key) · [下载最新版](https://github.com/Rczlin/better-oplus-key/releases/latest) · [自动构建](https://github.com/Rczlin/better-oplus-key/actions)

从 Release 下载 `oplus-sidekey-<版本>.zip`，在 KernelSU 管理器中安装。安装此版本后，管理器可通过 GitHub 检查和安装后续更新；更新会保留已有绑定与模板，安装后重启生效。

## 普通用户：三步上手

1. 在 KernelSU 管理器中安装模块 zip，重启手机。
2. 在 KernelSU 管理器的“模块”页点开本模块，进入设置界面。
3. 在“概览”页点 **一键方案** 套用推荐设置，或点 **新增绑定**：
   - 第一步选按压方式：单击、双击、三击、单次长按、短按+长按，也可以用“短按”“长按”自由组合；
   - 第二步从内置动作里点选（截屏、播放/暂停、勿扰开关、打开指定应用……），不需要会写命令；
   - 点 **保存配置**，立即生效。

不确定是否生效？在编辑器里点 **试运行** 看完整输出，或到 **诊断** 页刷新记录（“命令输出”标签可看到每次侧键触发的命令打印了什么、退出码和耗时）：

- “执行成功”：动作已执行；
- “未匹配”：这个按法没有设置动作；
- “执行失败（数字）”：命令出错，数字是退出码。127 表示命令不存在；2 多半是命令把输出重定向到了 /data/adb 下的文件（system_server 无权读写，`input`/`am`/`cmd` 会报 Failed transaction），请去掉重定向或改为 `>/dev/null`。

“概览”页会显示服务进程的 PID、运行时长、CPU 占用、内存、唤醒次数和耗电评估（每 5 秒自动刷新，页面在后台时暂停），以及今日按压统计和最近一次执行的输出。耗电评估根据 CPU 时间与唤醒次数估算：服务不按键时在内核中休眠，不持有唤醒锁。

觉得长按难按、单击反应慢？到 **绑定 → 时间设置** 选“灵敏 / 标准 / 从容”。

> 同时设置了单击和双击时，单击需要等待“连按间隔”（默认 300 毫秒）确认你不再按第二下，这是正常现象。停止服务后侧键恢复系统原有功能。

## 内置动作

| 类别 | 动作 |
|---|---|
| 系统操作 | 返回桌面、返回上一页、最近任务、截屏、熄屏锁定、点亮屏幕、电源菜单、下拉通知栏、打开快捷设置、收起通知栏、语音助手 |
| 媒体与音量 | 播放/暂停、下一首、上一首、停止、快进、快退、音量加、音量减、静音切换 |
| 开关切换 | 勿扰、Wi‑Fi、蓝牙、移动数据、飞行模式、定位、深色模式、自动旋转、自动亮度 |
| 常用页面 | 相机、录像、闹钟、计时器、拨号盘、搜索、系统设置、Wi‑Fi 设置、蓝牙设置 |
| 应用与扫码 | 支付宝扫一扫/付款码/收款码/乘车码、微信扫一扫、打开微信、打开支付宝、打开指定应用（可读取已安装应用列表）、打开网址 |
| 进阶 | 拨打电话、运行脚本文件、打开应用指定页面（包名/Activity） |

微信扫一扫、支付宝乘车码依赖应用版本和城市，建议先在编辑器里“试运行”。

一键方案：日常效率、音乐控制、单手导航、扫码支付、通勤出行、睡前模式、网络开关。套用前会提示将被替换的已有组合。

保存过的命令会自动收进“模板库 → 我的模板”，内置动作按动作名称命名，可重命名、编辑、删除。

## 进阶：配置文件

配置位于 `/data/adb/modules/oplus-sidekey/config.conf`：

```ini
keycode=735
long_press_ms=300
window_ms=300
0=input keyevent 120
00=am start -a android.media.action.STILL_IMAGE_CAMERA
1=if [ "$(settings get global zen_mode)" = "0" ]; then cmd notification set_dnd priority; else cmd notification set_dnd off; fi
```

- 组合只含 `0`（短按）和 `1`（长按），长度不限；
- 命令最多 4095 个 UTF-8 字节，以 root 执行，请只使用可信命令；在界面里输入多行脚本时会自动编码为一行（`: sidekey-script; eval ...`），配置文件中请保持单行；
- 时间参数为 100–800 的整数毫秒；
- `capture_output=0` 关闭命令输出收集（默认开启，可在“绑定 → 时间设置”中切换）。若某条 `input`/`am`/`cmd` 命令只在开启时报“执行失败（2）”，关闭即可。

升级模块时会自动保留已有的 `config.conf` 和 `templates.json`。

模块目录中的运行文件：`log.txt`（解释日志，≤512 KB）、`events.jsonl`（原始按键事件，≤512 KB）、`output.jsonl`（命令输出，每条 ≤4 KB 输出，文件 ≤512 KB），超出后自动保留最近一半。

> 0.4.0 的命令输出与 4095 字节长命令需要重新编译的守护进程（`scripts/build-daemon.ps1`）。若仍使用旧二进制，超过 511 字节的命令会被拒绝加载、诊断页也不会有命令输出。

## 开发

| 目录 | 内容 |
|---|---|
| `daemon/` | C 守护进程与 CTest 测试（主机无 libevdev 时自动使用 `third_party/libevdev`） |
| `webui/` | React + Vite 界面，构建产物输出到 `module/webroot` |
| `module/` | 模块安装包内容 |
| `scripts/` | Windows（PowerShell）与 Linux（sh）的构建、打包脚本 |
| `docs/superpowers/` | 设计、计划与审查记录 |

```sh
# 守护进程主机测试
bash scripts/test-host.sh
# 界面
cd webui && npm ci && npm test && npm run lint && npm run build
# 打包（Linux/macOS）
sh scripts/package-module.sh
```

Android ARM64 守护进程使用 NDK 构建：`scripts/build-daemon.ps1`。

Linux 使用 `NDK=/path/to/ndk bash scripts/build-daemon.sh`，与 Windows 脚本采用相同的 ARM64 / Android API 29 目标。

## 自动构建与发布

每次推送、Pull Request 或手动运行 Actions，都会执行守护进程测试、WebUI 测试与 lint，再从源码编译 ARM64 守护进程和 WebUI。安装包保存在该次运行的 Artifacts 中，保留 14 天。

发布正式版时：

1. 更新 `module/module.prop` 的 `version`，递增 `versionCode`（KernelSU 按此整数判断更新），并更新 `CHANGELOG.md`。
2. 提交并推送代码，然后推送对应标签，例如 `git tag v0.4.1` 和 `git push origin v0.4.1`。
3. Actions 检查标签与 `version` 一致后，自动创建公开 Release，上传模块 zip、`update.json` 和 `changelog.md`，并设为最新版。

`updateJson` 指向最新 Release 的更新元数据；zip 和更新说明指向具体版本，确保下载内容与版本一致。首次上线版本为 `v0.4.0`。
