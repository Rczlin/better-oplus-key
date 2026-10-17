# OnePlus 侧键（oplus-sidekey）

KernelSU 模块：接管 OnePlus Ace 6 侧键，让单击、双击、长按等不同按法各自执行一个动作，比如截屏、播放/暂停、打开相机、打开微信。

## 普通用户：三步上手

1. 在 KernelSU 管理器中安装模块 zip，重启手机。
2. 在 KernelSU 管理器的“模块”页点开本模块，进入设置界面。
3. 在“概览”页点 **一键方案** 套用推荐设置，或点 **新增绑定**：
   - 第一步选按压方式：单击、双击、三击、单次长按、短按+长按，也可以用“短按”“长按”自由组合；
   - 第二步从内置动作里点选（截屏、播放/暂停、勿扰开关、打开指定应用……），不需要会写命令；
   - 点 **保存配置**，立即生效。

不确定是否生效？在编辑器里点 **试运行** 看效果，或到 **诊断** 页刷新记录：

- “执行成功”：动作已执行；
- “未匹配”：这个按法没有设置动作；
- “执行失败（数字）”：命令出错，数字是退出码。127 表示命令不存在；2 多半是命令把输出重定向到了 /data/adb 下的文件（system_server 无权读写，`input`/`am`/`cmd` 会报 Failed transaction），请去掉重定向或改为 `>/dev/null`。

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
- 命令为单行，最多 511 个 UTF-8 字节，以 root 执行，请只使用可信命令；
- 时间参数为 100–800 的整数毫秒。

升级模块时会自动保留已有的 `config.conf` 和 `templates.json`。

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
