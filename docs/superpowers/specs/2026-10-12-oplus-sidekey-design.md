# oplus-sidekey 设计文档

- 日期：2026-10-12
- 状态：修订稿 2，待用户审阅
- 目标机型：OnePlus Ace 6 标准版（已真机确认有此键）
- 运行环境：root，KernelSU

## 1. 目标

KernelSU 模块，独占接管 OnePlus 机身上的「自定义侧键」（不是音量键，也不是电源键）。用户可以把按压序列绑定到一条 shell 命令，并通过 KSU WebUI 配置。

## 2. 事实与未确认项

已确认（真机 `getevent -lt` 输出）：

- 侧键位于 `/dev/input/event0`，设备名 `gpio-keys`。
- 按下、松开分别输出 `EV_KEY BTN_TRIGGER_HAPPY32` 的 `DOWN`、`UP`。`BTN_TRIGGER_HAPPY32` 对应键码 `735`（`0x2df`），与 13T 上的数据一致，也与已有模块的默认值一致。
- 同名设备 `gpio-keys` 还有 `/dev/input/event1`。其他设备：`pmic_pwrkey`（event2）、`pmic_resin`（event3）、`touchpanel`（event6）等。

已确认（KernelSU 机制）：

- `webroot/index.html` 作为 WebUI；`kernelsu` npm 库的 `exec` 执行 shell；`service.sh` 在 late_start 阶段后台运行；模块目录下存在 `disable` 文件即禁用该模块；卸载时执行 `uninstall.sh`（[Module WebUI](https://kernelsu.org/guide/module-webui.html)、[Module guide](https://kernelsu.org/guide/module.html)）。

未确认：

- `event0` 是否只承载 735 一个键。`EVIOCGRAB` 独占的是整个设备，若它还有其他键，这些键也会被吞掉。需执行 `su -c "getevent -p /dev/input/event0"` 确认。
- 节点编号在重启后是否稳定。
- `EVIOCGRAB` 独占在该 ROM 上是否生效。
- 守护进程退出（崩溃或被杀）后，独占是否立即释放。
- 独占期间，系统对该键的原生动作是否完全失效。

## 3. 按压模型

- 每次按压按时长分类：按住时长 ≥ `long_press_ms`（默认 300ms）记为 `1`（长按），否则记为 `0`（短按）。
- 松开后开始窗口期 `window_ms`（默认 300ms）。窗口内再次按下，则续接同一序列。长按同样松开后才开始窗口期。
- 序列在以下任一条件满足时结束：
  - 窗口期到期，无后续按压；
  - 序列已达 3 位（第 3 次松开后立即结束，不再等待）。
- 序列结束后：若有绑定则执行对应命令；无绑定则丢弃并写日志。
- 可绑定序列：长度 1–3，只含 `0`/`1`，共 14 个（2 + 4 + 8）。每个序列只绑定一个动作。
- 代价：以 `0` 开头的序列（如 `0`、`00`）要等窗口期结束才能确定，因此单击也会有窗口期延迟。

## 4. 组件

**守护进程 `oplus-sidekey`**（C，NDK 交叉编译，使用 libevdev 库，MIT 许可）

- 由 `service.sh` 以 root 启动。
- 读取配置，打开 `device` 指定的节点，校验 `keycode`，通过 `EVIOCGRAB` 独占。
- 状态机与 libevdev 解耦，便于用模拟事件流做单元测试。
- 动作以 `sh -c <命令>` 在子进程中执行，不阻塞主循环。
- 收到 `SIGHUP` 时重新读取配置。
- 启动时将 pid 写入 `$MODDIR/daemon.pid`，供 WebUI 停止和 `uninstall.sh` 使用。

**配置文件** `$MODDIR/config.conf`，即 `/data/adb/modules/oplus-sidekey/config.conf`

- 与模块同目录保存，不做跨卸载、重装的保留。卸载即删除。

```
device=/dev/input/event0
keycode=735
long_press_ms=300
window_ms=300
0=echo single
00=echo double
000=echo triple
```

- 键名为 `0`/`1` 组成的 1–3 位串，视为绑定；其余键视为配置项。
- 解析时按第一个 `=` 切分，值为完整的命令串。
- 解析失败的行跳过并写日志。

**文件格式要求**

- 所有 shell 脚本（`service.sh`、`uninstall.sh`、`customize.sh`）必须为 LF 换行。CRLF 会导致设备上执行失败。本仓库 `core.autocrlf=true`，提交和检出时需注意。

**KSU WebUI** `webroot/index.html`

- 使用 `kernelsu` 库的 `exec` 读写配置、启停守护进程、查看日志。
- 写配置时将内容以 base64 传入 shell，避免命令注入。
- 界面明确提示：命令以 root 执行，无沙箱。

**日志** `$MODDIR/log.txt`：记录启动、节点校验结果、序列结束、命令退出码、解析错误。

## 5. 数据流

```
/dev/input/eventN（独占读取）
  -> 过滤 keycode
  -> 按压状态机（分类 0/1，窗口期，3 位上限）
  -> 查绑定表
  -> fork + sh -c 执行命令
  -> 写日志
```

## 6. 错误处理

- 节点不存在，或节点上没有 `keycode` 对应的按键：不 grab，写日志并退出。这样不会把键锁死。
- `EVIOCGRAB` 失败：同上。
- 配置某行解析失败：跳过该行，写日志。
- 命令执行失败：记录退出码，不影响守护进程。
- 守护进程崩溃：依赖 fd 关闭释放独占（待真机验证）。

## 7. 卸载与残留

要求：卸载后不留下任何残留。

- 模块自身的全部文件（脚本、配置、pid、日志）都位于 `/data/adb/modules/oplus-sidekey/` 内。
- 已由官方文档确认：卸载时 KernelSU 会执行模块的 `uninstall.sh`（[Module guide](https://kernelsu.org/guide/module.html)）。
- 未由官方文档确认：卸载后 KernelSU 是否删除整个模块目录。需真机验证（见第 9 节）。
- 守护进程运行中卸载不会自动结束。`uninstall.sh` 先读取 `daemon.pid` 结束进程；pid 文件缺失或失效时，再按可执行文件路径（位于 `/data/adb/modules/oplus-sidekey/` 下）查找并结束，避免独占残留到重启。
- KernelSU 的模块配置系统（`ksud module config`）把数据存放在 `/data/adb/ksu/module_configs/<id>/`，卸载时会清除（[Module Configuration](https://kernelsu.org/guide/module-config.html)）。本设计不使用该系统，配置只放在模块目录内。
- 不使用 `initrc/`、`sepolicy.rule`、`system/` 目录，因此不产生需要单独清理的系统级残留。
- 不写模块目录以外的位置：不使用 `/data/adb/oplus-sidekey`、`/data/local/tmp` 等。
- 边界：用户在配置中写的 shell 命令自身产生的副作用，不在模块清理范围内。
- 验收（真机）：卸载后 `/data/adb/modules/oplus-sidekey` 不存在；`ps` 中无 `oplus-sidekey` 进程；`/data/adb` 下无残留；侧键恢复系统原生行为。

## 8. 风险与逃生

- 独占期间，该键的系统原生功能全部失效。这是用户选择的「完全独占」。
- 命令以 root 执行，权限等同 root shell。
- 逃生路径：
  1. WebUI「停止守护进程」按钮；
  2. 在模块目录下创建 `disable` 文件并重启，模块不再加载（KernelSU 官方支持）；
  3. 通过 adb 执行 `su -c "touch /data/adb/modules/oplus-sidekey/disable"`，然后重启。
- 注意：KernelSU 的启动脚本只在启动阶段执行，在管理器中禁用模块不会立即结束已运行的守护进程。是否需要立即生效，见开放问题 2。

## 9. 测试

- **单元测试**（主机上运行，无需真机）：
  - 状态机：14 种序列各自的分类结果；窗口期边界（恰好等于、略超过）；长按阈值边界；第 3 次松开后立即结束。
  - 配置解析：合法行、非法序列、缺失的 `keycode`、值中包含 `=`。
- **真机测试**（用户执行）：
  - `EVIOCGRAB` 独占是否生效，以及 `event0` 是否只有 735 一个键；
  - 守护进程被杀后独占是否释放；
  - 窗口期与长按阈值手感；
  - 卸载残留验收（见第 7 节）。

## 10. 不在范围

- 同一序列绑定多条动作，或带条件的规则。
- 独立的用户层 APK。
- LSPosed / Zygisk 框架 hook。
- 音量键、电源键的接管。
- uinput 虚拟设备透传未绑定的按键。
- 跨卸载、重装保留配置。

## 11. 开放问题

1. **设备匹配方式**，请二选一：
   - A：硬编码 `device=/dev/input/event0`，启动时校验 `keycode`，不符则不 grab。
   - B：启动时扫描 `/dev/input/event*`，自动找到支持键码 735 的设备。
   - 理由：同名设备 `gpio-keys` 有两个，节点编号在重启后可能变化。
2. **模块禁用后的行为**：在 KSU 管理器中禁用模块后，守护进程是否应立即退出（需要它定期检查 `disable` 文件）？还是只在 WebUI 停止或重启后生效？

已确定：

- 无绑定的按压序列：丢弃并写日志，保持完全独占。
- 长按阈值与窗口期：WebUI 可调，范围 100–800ms，默认 300ms。
- 序列上限：3 次按压。
- 多规则：每个序列只绑定一个动作。
- 配置保存在模块目录内，卸载即删除，不做跨重装保留；卸载无残留。
