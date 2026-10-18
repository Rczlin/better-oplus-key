# 流体云执行提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧键命令执行结束后，按设置（关闭/每次/仅失败）在 ColorOS 16 流体云显示结果提示。

**Architecture:** 守护进程在回收命令子进程后，fork 一个不经 shell 的 `cmd activity broadcast` 子进程，把结果发给无状态伴生应用；伴生应用发出 promoted ongoing 通知进入流体云，4 秒后自动消失。WebUI 负责开关、伴生应用状态与测试。

**Tech Stack:** C11 + CTest；React/Vite/Vitest；Android 框架 API（Java，aapt2/d8/apksigner，无 Gradle）；POSIX sh。

**Spec:** `docs/superpowers/specs/2026-10-18-fluid-cloud-notify-design.md`

## Global Constraints

- 配置项 `island_notify=0|1|2`，默认 0；范围外取值使整份配置无效（与其他整数项一致）。
- 伴生应用包名 `io.github.rczlin.sidekey.island`，接收器 `.IslandReceiver`，动作 `io.github.rczlin.sidekey.island.SHOW`。
- 广播 extras：`seq`(String)、`label`(String)、`code`(int)、`duration_ms`(long)、`test`(boolean)。
- 动作摘要最多 96 字节（UTF-8 边界）+ “…”；seq 最多 32 字符；多行脚本显示“多行脚本”。
- 提示 4000 ms 后自动消失；新提示替换旧提示。
- 通知子进程不进入 inflight 表、不写 log.txt / output.jsonl；fork 失败只记 WARN。
- 版本 0.5.0 / versionCode 5。

## Review Focus

1. 通知子进程被 `waitpid(-1)` 回收时不得误匹配 inflight 槽位或产生日志行 —— e2e 测试断言 log 行数。
2. 标签截断在多字节 UTF-8 中间时不能产生非法字节 —— test_notify 用中文命令覆盖。
3. 伴生应用未安装 / 未授权时，守护进程与 WebUI 均不报错 —— island.sh status 解析覆盖缺失场景。
4. 未绑定按法（dropped）不触发提示 —— e2e 覆盖。
5. 旧配置无该项时保存不写出 `island_notify` —— config 往返测试。

---

### Task 1: 配置项 island_notify（C + WebUI 解析）
**Files:** Modify `daemon/include/sidekey_config.h`, `daemon/src/sidekey_config.c`, `daemon/tests/test_config.c`, `webui/src/lib/config.ts`; Test `webui/tests/config.test.ts`
- [ ] 写失败测试：默认 0；`island_notify=2` 解析为 2；`=3` 返回 -1；WebUI 往返仅非 0 时写出。
- [ ] 运行确认失败 → 实现 → 运行通过 → 提交。

### Task 2: sidekey_notify 纯函数模块
**Files:** Create `daemon/include/sidekey_notify.h`, `daemon/src/sidekey_notify.c`, `daemon/tests/test_notify.c`; Modify `daemon/CMakeLists.txt`
**Produces:** `int sidekey_notify_wanted(int mode, int code)`；`size_t sidekey_notify_label(const char *cmd, char *out, size_t cap)`；`int sidekey_notify_prepare(sidekey_notify_msg_t *m, const char *seq, const char *cmd, int code, long long duration_ms)`，`m->argv` 以 NULL 结尾。
- [ ] 写失败测试（模式矩阵、ASCII/中文截断、多行脚本、argv 完整序列、seq 截断）→ 失败 → 实现 → 通过 → 提交。

### Task 3: 守护进程派发通知
**Files:** Modify `daemon/src/main.c`, `daemon/tests/test_output_capture.c`（或新 `test_notify_dispatch.c`）, `daemon/CMakeLists.txt`
**Consumes:** Task 1/2 接口。
- [ ] 写失败 e2e：通知程序替换为记录参数的脚本；模式 1 成功/失败均调用、模式 2 仅失败、模式 0 与 dropped 不调用；log.txt 行数不因通知子进程增加。
- [ ] 失败 → 实现 `g_notify_bin` + `dispatch_notify()` → 通过 → 提交。

### Task 4: 伴生应用与构建脚本
**Files:** Create `companion/AndroidManifest.xml`, `companion/res/drawable/ic_sidekey.xml`, `companion/src/io/github/rczlin/sidekey/island/IslandReceiver.java`, `companion/src/io/github/rczlin/sidekey/island/PressNames.java`, `scripts/build-companion.sh`; Modify `.gitignore`
- [ ] PressNames 纯 Java 单测（主机 javac 运行）：0/00/000/1/01/0110。
- [ ] 构建脚本生成签名 APK；`aapt2 dump badging` 校验包名、sdk 36、两个权限。→ 提交。

### Task 5: 模块脚本
**Files:** Create `module/island.sh`; Modify `module/service.sh`, `module/customize.sh`, `module/uninstall.sh`, `scripts/package-module.sh`
- [ ] 用假 `pm`/`cmd`/`getprop` 的 PATH 桩做 sh 测试（`scripts/tests/test_island_sh.py`）：未安装→安装+授权；sha 未变→只授权；签名冲突→卸载重装；无 apk→missing-apk；status 输出。→ 提交。

### Task 6: WebUI 设置与测试
**Files:** Create `webui/src/lib/island.ts`, `webui/tests/island.test.tsx`; Modify `webui/src/components/BindingsView.tsx`, `webui/src/App.tsx`
- [ ] 失败测试：三档单选写入配置；状态行（已就绪/未安装/未授权）；“发送测试”“安装/修复”执行对应命令。→ 实现 → 通过 → lint/tsc/build → 提交。

### Task 7: CI、版本与文档
**Files:** Modify `.github/workflows/build.yml`, `module/module.prop`, `CHANGELOG.md`, `README.md`, `module/config.conf.default`
- [ ] CI 安装 `platforms;android-36` `build-tools;36.0.0` 并在打包前运行 build-companion；推送后确认 Actions 通过。→ 提交。
