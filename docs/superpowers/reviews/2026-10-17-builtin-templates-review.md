# 内置模板与新手模式：独立代码审查与验证

日期：2026-10-17  
范围：`specs/2026-10-17-builtin-templates-easy-mode-design.md` 对应的全部改动。

## 审查结论

独立审查未发现 Critical。4 项 Important 与 7 项 Minor 已修复，2 项 Minor 作为已知事项保留。

| 级别 | 问题 | 处理 |
|---|---|---|
| Important | 选中带参数动作（打开应用/网址）时沿用上一个命令，参数无效时也保留旧命令，可能误保存 | 参数无效时清空命令，“添加绑定”随之禁用；补测试 |
| Important | 带参数动作在手动改写命令后仍高亮，继续输入参数会覆盖手写命令 | 仅当命令与参数生成结果一致（或尚未生成）时高亮；补测试 |
| Important | 试运行无超时、无互斥，`am start` 失败时退出码仍为 0 | `timeout 10 sh -c`，与保存/启停互斥，输出含 Error/Exception 判为失败，始终展示错误输出；补测试 |
| Important | Wi‑Fi/蓝牙开关未考虑飞行模式状态值，部分 ROM 缺少 `svc bluetooth` | 按 `case 1|2` 判断开启；优先 `cmd wifi`/`cmd bluetooth_manager`，回退 `svc` |
| Minor | 静音键在个别机型只弹出音量面板 | 动作说明中注明 |
| Minor | `customize.sh` 硬编码模块 ID | 改为 `${MODPATH##*/}` |
| Minor | CMake `find_program(REQUIRED)` 需 3.18 | 改为显式检查 + `FATAL_ERROR`，删除重复注释 |
| Minor | 错误文案仍写“Shell 模板页” | 改为“模板库” |
| Minor | 内置动作被重复收录进“我的模板” | 无参数内置动作不再自动收录 |
| Minor | 方案确认步骤焦点丢失 | “返回”按钮自动获得焦点 |
| Minor | 试运行未提示会以 root 真实执行 | 增加明确提示 |
| 保留 | 打开应用使用 `monkey`，启动略慢 | 兼容性最好，保留 |
| 保留 | 套用方案后焦点回到页面主体 | 不影响操作，保留 |

## 验证证据（Linux arm64 主机）

- WebUI：`vitest` 10 个文件 139/139 通过（新增 presets 9、easy-mode 9、templates +1）。
- `tsc -b`：通过；`oxlint`：0 错误，2 条既有 warning（shadcn 组件导出）。
- `vite build`：通过，产物写入 `module/webroot`（同时清除了旧快照中残留的过期资源文件）。
- C 守护进程：CTest 12/12 通过；UBSan 构建 12/12 通过（使用 vendored libevdev 回退）。
- 模块脚本 `sh -n` 通过。
- 无头 Chromium + 假 `ksu.exec`：1280px 与 390px 下概览、方案、绑定、编辑器、模板库、诊断均无横向溢出，控制台无错误；完成“套用方案 → 新增打开应用绑定 → 保存”并确认配置与模板各写入一次。临时服务已关闭。

## 设备验收边界

守护进程二进制未改动（主机无法 NDK 交叉编译）。各内置命令在 ColorOS 上的实际效果、支付宝 scheme、`cmd wifi`/`cmd bluetooth_manager` 可用性，以及 KernelSU 升级迁移，需要在真机上确认。

## 0.3.0 追加：执行失败（2）修复与模板扩充

- 根因：service.sh 把守护进程 stderr 重定向到 `$MODDIR/daemon.stderr`（/data/adb，SELinux 类型 adb_data_file），绑定命令继承该 fd。
  `input`/`am`/`settings`/`svc` 均为 `cmd <service>` 包装，`cmd` 通过 binder 把自身 stdio 交给 system_server；
  system_server 无权访问 adb_data_file，事务以 FAILED_TRANSACTION（0x80000002）失败，`cmd` 返回该值，退出码低 8 位即 2。
  WebUI 的 ksu.exec 走 libsu 管道，因此同样的命令在 WebUI 里能成功，侧键触发却失败。
- 修复：service.sh 以 `</dev/null >/dev/null 2>&1` 启动守护进程（对已编译二进制即刻生效）；
  daemon 子进程在 exec 前再将 0/1/2 dup2 到 /dev/null（需重新编译二进制）。新增 test_daemon_lifecycle 用例，先确认在未修复时失败。
- 模板：内置动作扩充至 50 个，新增“常用页面”“进阶”分类，参数类型增加电话、脚本路径、组件名；一键方案增至 7 套。
- 仍需真机确认：飞行模式/定位/深色模式命令、微信扫一扫 extra、支付宝乘车码、`input keyevent --longpress`。
