# oplus-sidekey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 KernelSU 模块，由 root 守护进程独占接管 OnePlus Ace 6 标准版的自定义侧键（`/dev/input/event0`，键码 735 / `0x2df`），按 1–3 次「单击/长按」序列绑定 shell 命令，并通过 KSU WebUI 配置。

**Architecture:** 一个 C 守护进程（libevdev 读取，状态机解析按压序列，`EVIOCGRAB` 独占），由 `service.sh` 启动。状态机与设备 I/O 解耦，可在 WSL Ubuntu 上做原生单元测试。配置为模块目录内的纯文本文件。KSU WebUI 用 `kernelsu` 库的 `exec` 读写配置、启停守护进程。卸载时 `uninstall.sh` 结束守护进程。

**Tech Stack:** C11；libevdev（MIT，源码随模块编译）；Android NDK `28.2.13676358` clang（交叉编译 arm64-v8a）；meson（libevdev 构建）；WSL Ubuntu 24/26 + gcc（主机单元测试）；原生 HTML/CSS/JS + `kernelsu@3.0.2`（WebUI，无构建步骤）。

**Spec:** `docs/superpowers/specs/2026-10-12-oplus-sidekey-design.md`（修订稿，提交 `4296cee`）

## Global Constraints

- 所有 shell 脚本（`service.sh`、`uninstall.sh`、`customize.sh`）必须为 **LF** 换行，禁止 CRLF。
- 键码固定为 `735`（`0x2df`），设备通过启动时扫描 `/dev/input/event*` 按键码匹配，不硬编码节点。
- 多设备匹配：只 grab 第一个匹配设备，其余不动，写日志。
- 按压分类：按住 ≥ `long_press_ms`（默认 300）为 `1`，否则 `0`。窗口期 `window_ms`（默认 300）在松开后开始。序列上限 3 位。
- 每个序列只绑定一个动作。无绑定序列：丢弃并写日志，保持独占。
- 配置、pid、日志全部位于 `/data/adb/modules/oplus-sidekey/` 内，不写模块目录之外。
- 不使用 `initrc/`、`sepolicy.rule`、`system/`。
- 禁用模块仅在重启后生效（不轮询 `disable` 文件）。
- 文件与源码以 LF 保存。本仓库 `core.autocrlf=true`，提交前用 `.gitattributes` 固定 `*.sh text eol=lf`。
- 测试与真机验证分离：自动化测试必须全部通过；真机项由用户执行，计划里只列清单。

---

## File Structure

```
better-oplus-key/                          (仓库根)
├── .gitattributes                          Task 0
├── .gitignore                              Task 0
├── module/                                 模块源码（打包进 zip 的内容）
│   ├── module.prop                         Task 6
│   ├── customize.sh                        Task 6
│   ├── service.sh                          Task 6
│   ├── uninstall.sh                        Task 6
│   ├── config.conf.default                 Task 6
│   ├── bin/
│   │   └── oplus-sidekey                   Task 5（构建产物，由脚本生成）
│   └── webroot/
│       └── index.html                      Task 7
├── daemon/                                 守护进程源码
│   ├── CMakeLists.txt                      Task 1 (主机测试) / Task 5 (NDK 构建)
│   ├── include/
│   │   ├── sidekey_fsm.h                   Task 2
│   │   └── sidekey_config.h                Task 3
│   ├── src/
│   │   ├── sidekey_fsm.c                   Task 2
│   │   ├── sidekey_config.c                Task 3
│   │   ├── sidekey_scan.c                  Task 4
│   │   └── main.c                          Task 5
│   └── tests/
│       ├── test_fsm.c                      Task 2
│       ├── test_config.c                   Task 3
│       └── test_scan.c                     Task 4
├── third_party/
│   └── libevdev/                           Task 0（git submodule 或 vendored 源码，见 Task 0）
├── scripts/
│   ├── build-daemon.sh                     Task 5
│   ├── test-host.sh                        Task 1
│   └── package-module.sh                   Task 8
└── docs/superpowers/{specs,plans}/
```

职责边界：
- `sidekey_fsm`：纯函数状态机，输入事件时间戳与按下/松开，输出完成的序列。不依赖任何 I/O。
- `sidekey_config`：解析 `config.conf`，产出绑定表与参数。不依赖 I/O 以外的状态。
- `sidekey_scan`：枚举 `/dev/input/event*`，判断设备是否声明目标键码。
- `main.c`：串联以上模块，负责 grab、事件循环、派发 shell、信号处理、pid 文件。

---

### Task 0: 仓库脚手架与 libevdev 源码

**Files:**
- Create: `.gitattributes`
- Create: `.gitignore`
- Create: `third_party/libevdev/`（从上游 `https://gitlab.freedesktop.org/libevdev/libevdev.git` 拉取的固定版本）

**Interfaces:**
- Consumes: 无
- Produces: 仓库可用的换行规则；`third_party/libevdev/` 源码树（含 `libevdev/libevdev.h`、`meson.build`）

- [ ] **Step 1: 固定 libevdev 版本并拉取源码**

记录上游当前 HEAD 作为固定版本（先取 tag，避免使用未发布提交）：

```bash
git ls-remote --tags https://gitlab.freedesktop.org/libevdev/libevdev.git | tail -5
```

选择最新稳定 tag（形如 `libevdev-1.13.x`），然后：

```bash
git clone --depth 1 --branch <选定的tag> https://gitlab.freedesktop.org/libevdev/libevdev.git third_party/libevdev
rm -rf third_party/libevdev/.git
```

去掉 `.git` 是为了把它当作普通 vendored 源码提交，避免子模块在 Windows/WSL 间的换行问题。

- [ ] **Step 2: 写 `.gitattributes`**

```gitattributes
* text=auto eol=lf
*.sh text eol=lf
*.c text eol=lf
*.h text eol=lf
*.conf text eol=lf
*.prop text eol=lf
*.html text eol=lf
```

- [ ] **Step 3: 写 `.gitignore`**

```gitignore
build/
dist/
*.zip
```

- [ ] **Step 4: 验证 libevdev 许可证文件存在**

Run: `Get-Content third_party/libevdev/COPYING`（PowerShell）或 `cat third_party/libevdev/COPYING`（WSL）
Expected: 文件存在，包含 MIT 许可文本。若不是 MIT，停止并报告给用户，不继续。

- [ ] **Step 5: 提交**

```bash
git add .gitattributes .gitignore third_party/libevdev
git commit -m "chore: scaffold repo and vendor libevdev"
```

---

### Task 1: 主机测试框架（WSL gcc + CMake）

**Files:**
- Create: `daemon/CMakeLists.txt`
- Create: `scripts/test-host.sh`

**Interfaces:**
- Consumes: 无
- Produces: `scripts/test-host.sh` 作为所有主机单元测试的统一入口，退出码 0 表示全部通过

- [ ] **Step 1: 写一个必然失败的占位测试，验证测试框架本身能跑**

创建 `daemon/tests/test_smoke.c`：

```c
#include <stdio.h>
int main(void) {
    fprintf(stderr, "smoke: framework not wired yet\n");
    return 1;
}
```

- [ ] **Step 2: 写 `daemon/CMakeLists.txt`（仅主机测试目标）**

```cmake
cmake_minimum_required(VERSION 3.16)
project(oplus_sidekey C)
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
enable_testing()

add_executable(test_smoke tests/test_smoke.c)
add_test(NAME smoke COMMAND test_smoke)
```

- [ ] **Step 3: 写 `scripts/test-host.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build/host"
cmake -S "$ROOT/daemon" -B "$BUILD" -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build "$BUILD"
ctest --test-dir "$BUILD" --output-on-failure
```

- [ ] **Step 4: 在 WSL 中运行，确认失败**

Run（WSL 内，从仓库根）: `bash scripts/test-host.sh`
Expected: FAIL，`smoke: framework not wired yet`，退出码非 0。

- [ ] **Step 5: 把占位测试改为通过，证明框架可用**

把 `test_smoke.c` 的 `return 1` 改为 `return 0`，去掉 `fprintf`。

- [ ] **Step 6: 重新运行，确认通过**

Run: `bash scripts/test-host.sh`
Expected: `100% tests passed`。

- [ ] **Step 7: 提交**

```bash
git add daemon/CMakeLists.txt daemon/tests/test_smoke.c scripts/test-host.sh
git commit -m "test: host test harness via WSL gcc and ctest"
```

---

### Task 2: 按压状态机（核心逻辑，纯函数）

**Files:**
- Create: `daemon/include/sidekey_fsm.h`
- Create: `daemon/src/sidekey_fsm.c`
- Create: `daemon/tests/test_fsm.c`
- Modify: `daemon/CMakeLists.txt`（加入测试目标）

**Interfaces:**
- Consumes: 无
- Produces:
  ```c
  typedef struct sidekey_fsm sidekey_fsm_t;
  typedef struct {
      int long_press_ms;   /* 默认 300 */
      int window_ms;       /* 默认 300 */
  } sidekey_fsm_cfg_t;
  /* 完成的序列回调：seq 为 "0"/"1" 串（长度 1..3），不以 NUL 结尾。 */
  typedef void (*sidekey_on_seq_fn)(const char *seq, int len, void *ctx);

  void sidekey_fsm_init(sidekey_fsm_t *f, const sidekey_fsm_cfg_t *cfg,
                        sidekey_on_seq_fn cb, void *ctx);
  /* 键按下/松开事件；t_ms 为单调时钟毫秒。 */
  void sidekey_fsm_key(sidekey_fsm_t *f, int pressed, long long t_ms);
  /* 周期性调用，检查窗口期是否到期。返回下一次需要唤醒的绝对时间（ms），无则 -1。 */
  long long sidekey_fsm_tick(sidekey_fsm_t *f, long long t_ms);
  ```

- [ ] **Step 1: 写失败的测试，覆盖单次按压分类**

`daemon/tests/test_fsm.c`：

```c
#include <stdio.h>
#include <string.h>
#include <assert.h>
#include "sidekey_fsm.h"

typedef struct { char seqs[16][4]; int n; } rec_t;

static void rec_cb(const char *seq, int len, void *ctx) {
    rec_t *r = (rec_t *)ctx;
    assert(len >= 1 && len <= 3);
    memcpy(r->seqs[r->n], seq, len);
    r->seqs[r->n][len] = '\0';
    r->n++;
}

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { \
    fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)

static void test_single_short_tap(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f;
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 1000);
    sidekey_fsm_key(&f, 0, 1100);      /* 按住 100ms < 300 => 0 */
    sidekey_fsm_tick(&f, 1100 + 300);  /* 窗口到期 */
    CHECK(r.n == 1);
    CHECK(strcmp(r.seqs[0], "0") == 0);
}

static void test_single_long_press(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f;
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 1000);
    sidekey_fsm_key(&f, 0, 1400);      /* 按住 400ms >= 300 => 1 */
    sidekey_fsm_tick(&f, 1400 + 300);
    CHECK(r.n == 1);
    CHECK(strcmp(r.seqs[0], "1") == 0);
}

int main(void) {
    test_single_short_tap();
    test_single_long_press();
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    printf("test_fsm: all passed\n");
    return 0;
}
```

- [ ] **Step 2: 把测试接入 CMake，运行确认失败（缺实现）**

在 `daemon/CMakeLists.txt` 追加（并移除 `test_smoke` 的 `add_test` 行，保留文件也可）：

```cmake
add_library(sidekey_fsm STATIC src/sidekey_fsm.c)
target_include_directories(sidekey_fsm PUBLIC include)
add_executable(test_fsm tests/test_fsm.c)
target_link_libraries(test_fsm PRIVATE sidekey_fsm)
add_test(NAME fsm COMMAND test_fsm)
```

Run: `bash scripts/test-host.sh`
Expected: 链接失败或 `sidekey_fsm.h` 不存在，属于预期失败。

- [ ] **Step 3: 写头文件 `daemon/include/sidekey_fsm.h`**

内容严格按上面 Interfaces 段的声明，加上头文件保护与 `#include <stddef.h>`。

- [ ] **Step 4: 写最小实现，让两个测试通过**

`daemon/src/sidekey_fsm.c`：

```c
#include <string.h>
#include "sidekey_fsm.h"

#define MAX_SEQ 3

struct sidekey_fsm {
    sidekey_fsm_cfg_t cfg;
    sidekey_on_seq_fn cb;
    void *ctx;
    char seq[MAX_SEQ + 1];
    int len;
    int pressed;
    long long press_t;
    long long release_t;   /* 上次松开时间，用于窗口期；无松开则 -1 */
};

void sidekey_fsm_init(sidekey_fsm_t *f, const sidekey_fsm_cfg_t *cfg,
                      sidekey_on_seq_fn cb, void *ctx) {
    memset(f, 0, sizeof(*f));
    f->cfg = *cfg;
    f->cb = cb;
    f->ctx = ctx;
    f->release_t = -1;
}

static void flush(sidekey_fsm_t *f) {
    if (f->len > 0) {
        f->cb(f->seq, f->len, f->ctx);
    }
    f->len = 0;
    f->release_t = -1;
}

void sidekey_fsm_key(sidekey_fsm_t *f, int pressed, long long t_ms) {
    if (pressed) {
        f->pressed = 1;
        f->press_t = t_ms;
        return;
    }
    if (!f->pressed) return;
    f->pressed = 0;
    long long held = t_ms - f->press_t;
    f->seq[f->len++] = (held >= f->cfg.long_press_ms) ? '1' : '0';
    f->seq[f->len] = '\0';
    f->release_t = t_ms;
    if (f->len >= MAX_SEQ) {
        flush(f);
    }
}

long long sidekey_fsm_tick(sidekey_fsm_t *f, long long t_ms) {
    if (f->len == 0 || f->pressed) return -1;
    long long deadline = f->release_t + f->cfg.window_ms;
    if (t_ms >= deadline) {
        flush(f);
        return -1;
    }
    return deadline;
}
```

- [ ] **Step 5: 运行，确认两个测试通过**

Run: `bash scripts/test-host.sh`
Expected: `test_fsm: all passed`，`fsm` 测试 PASS。

- [ ] **Step 6: 增加失败的测试：多次按压与三次上限**

在 `test_fsm.c` 增加：

```c
static void test_double_click(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f;
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 0);   sidekey_fsm_key(&f, 0, 50);
    sidekey_fsm_key(&f, 1, 200); sidekey_fsm_key(&f, 0, 250);   /* 第二次在窗口内 */
    sidekey_fsm_tick(&f, 250 + 300);
    CHECK(r.n == 1);
    CHECK(strcmp(r.seqs[0], "00") == 0);
}

static void test_triple_click_flushes_immediately(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f;
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 0);   sidekey_fsm_key(&f, 0, 50);
    sidekey_fsm_key(&f, 1, 100); sidekey_fsm_key(&f, 0, 150);
    sidekey_fsm_key(&f, 1, 200); sidekey_fsm_key(&f, 0, 250);   /* 第3次松开，立即结束 */
    CHECK(r.n == 1);                       /* 不需要 tick，已经结束 */
    CHECK(strcmp(r.seqs[0], "000") == 0);
}

static void test_window_boundary_not_yet(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f;
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 0); sidekey_fsm_key(&f, 0, 50);
    sidekey_fsm_tick(&f, 50 + 299);        /* 差 1ms，未到期 */
    CHECK(r.n == 0);
}
```

并在 `main()` 中调用这三个测试。

- [ ] **Step 7: 运行，确认新测试失败或通过情况**

Run: `bash scripts/test-host.sh`
Expected: 若实现正确，三个新测试应通过；若失败，据 FAIL 行修正实现。注意 `test_triple_click_flushes_immediately` 依赖 `flush` 在 `len >= MAX_SEQ` 时触发，已在 Step 4 实现。

- [ ] **Step 8: 增加长按与短按混合序列的测试**

```c
static void test_mixed_long_then_short(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f;
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 0);   sidekey_fsm_key(&f, 0, 400);  /* 长按 => 1 */
    sidekey_fsm_key(&f, 1, 500); sidekey_fsm_key(&f, 0, 550);  /* 短按 => 0，窗口内 */
    sidekey_fsm_tick(&f, 550 + 300);
    CHECK(r.n == 1);
    CHECK(strcmp(r.seqs[0], "10") == 0);
}
```

- [ ] **Step 9: 运行并修正，直到全部通过**

Run: `bash scripts/test-host.sh`
Expected: `test_fsm: all passed`。

- [ ] **Step 10: 提交**

```bash
git add daemon/include/sidekey_fsm.h daemon/src/sidekey_fsm.c daemon/tests/test_fsm.c daemon/CMakeLists.txt
git commit -m "feat: press-sequence state machine with host tests"
```

---

### Task 3: 配置解析

**Files:**
- Create: `daemon/include/sidekey_config.h`
- Create: `daemon/src/sidekey_config.c`
- Create: `daemon/tests/test_config.c`
- Modify: `daemon/CMakeLists.txt`

**Interfaces:**
- Consumes: `sidekey_fsm_cfg_t`（来自 Task 2 的 `sidekey_fsm.h`）
- Produces:
  ```c
  #define SIDEKEY_MAX_BINDINGS 14
  #define SIDEKEY_CMD_MAX 512
  typedef struct {
      char seq[4];                 /* "0"/"1" 串，长度 1..3 */
      char cmd[SIDEKEY_CMD_MAX];
  } sidekey_binding_t;
  typedef struct {
      int keycode;                 /* 默认 735 */
      sidekey_fsm_cfg_t fsm;       /* long_press_ms / window_ms */
      int n_bindings;
      sidekey_binding_t bindings[SIDEKEY_MAX_BINDINGS];
      int skipped_lines;           /* 解析失败的行数，用于日志 */
  } sidekey_config_t;
  /* 从内存缓冲区解析。成功返回 0，致命错误返回 -1（如 keycode 无效）。 */
  int sidekey_config_parse(const char *text, sidekey_config_t *out);
  ```

- [ ] **Step 1: 写失败测试**

`daemon/tests/test_config.c`：

```c
#include <stdio.h>
#include <string.h>
#include "sidekey_config.h"

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { \
    fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)

static void test_defaults_and_bindings(void) {
    const char *txt =
        "keycode=735\n"
        "long_press_ms=300\n"
        "window_ms=300\n"
        "0=echo single\n"
        "00=echo double\n"
        "000=echo triple\n";
    sidekey_config_t c;
    CHECK(sidekey_config_parse(txt, &c) == 0);
    CHECK(c.keycode == 735);
    CHECK(c.fsm.long_press_ms == 300);
    CHECK(c.n_bindings == 3);
    CHECK(strcmp(c.bindings[0].seq, "0") == 0);
    CHECK(strcmp(c.bindings[0].cmd, "echo single") == 0);
    CHECK(strcmp(c.bindings[2].seq, "000") == 0);
    CHECK(c.skipped_lines == 0);
}

static void test_value_containing_equals(void) {
    const char *txt = "keycode=735\n0=sh -c 'a=1; echo $a'\n";
    sidekey_config_t c;
    CHECK(sidekey_config_parse(txt, &c) == 0);
    CHECK(strcmp(c.bindings[0].cmd, "sh -c 'a=1; echo $a'") == 0);
}

static void test_invalid_sequence_skipped(void) {
    const char *txt = "keycode=735\n0000=echo too_long\n2=echo bad\n0=echo ok\n";
    sidekey_config_t c;
    CHECK(sidekey_config_parse(txt, &c) == 0);
    CHECK(c.n_bindings == 1);
    CHECK(strcmp(c.bindings[0].seq, "0") == 0);
    CHECK(c.skipped_lines == 2);
}

static void test_missing_keycode_uses_default(void) {
    const char *txt = "0=echo x\n";
    sidekey_config_t c;
    CHECK(sidekey_config_parse(txt, &c) == 0);
    CHECK(c.keycode == 735);
}

static void test_bad_keycode_is_fatal(void) {
    const char *txt = "keycode=notanumber\n";
    sidekey_config_t c;
    CHECK(sidekey_config_parse(txt, &c) == -1);
}

static void test_crlf_tolerant(void) {
    const char *txt = "keycode=735\r\n0=echo x\r\n";
    sidekey_config_t c;
    CHECK(sidekey_config_parse(txt, &c) == 0);
    CHECK(strcmp(c.bindings[0].cmd, "echo x") == 0);
}

int main(void) {
    test_defaults_and_bindings();
    test_value_containing_equals();
    test_invalid_sequence_skipped();
    test_missing_keycode_uses_default();
    test_bad_keycode_is_fatal();
    test_crlf_tolerant();
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    printf("test_config: all passed\n");
    return 0;
}
```

- [ ] **Step 2: 接入 CMake 并运行确认失败**

在 `daemon/CMakeLists.txt` 追加：

```cmake
add_library(sidekey_config STATIC src/sidekey_config.c)
target_include_directories(sidekey_config PUBLIC include)
target_link_libraries(sidekey_config PUBLIC sidekey_fsm)
add_executable(test_config tests/test_config.c)
target_link_libraries(test_config PRIVATE sidekey_config)
add_test(NAME config COMMAND test_config)
```

Run: `bash scripts/test-host.sh`
Expected: 因头文件/实现缺失而失败。

- [ ] **Step 3: 写头文件与最小实现**

实现要点（按测试逐条满足）：
- 逐行读取，去掉结尾 `\r`。
- 空行与 `#` 开头行忽略。
- 按第一个 `=` 切分键与值。
- 键为 `keycode`、`long_press_ms`、`window_ms` 时写入对应字段，非法数字返回 -1（致命）。
- 键匹配 `^[01]{1,3}$` 视为绑定，超出范围或含其他字符计为 `skipped_lines`。
- 绑定超过 `SIDEKEY_MAX_BINDINGS` 时计为 `skipped_lines`。
- 值超过 `SIDEKEY_CMD_MAX - 1` 时截断并计为 `skipped_lines`。
- 默认值：`keycode=735`，`long_press_ms=300`，`window_ms=300`。

- [ ] **Step 4: 运行直到全部通过**

Run: `bash scripts/test-host.sh`
Expected: `test_config: all passed`。

- [ ] **Step 5: 提交**

```bash
git add daemon/include/sidekey_config.h daemon/src/sidekey_config.c daemon/tests/test_config.c daemon/CMakeLists.txt
git commit -m "feat: config parser with host tests"
```

---

### Task 4: 设备扫描（按键码匹配）

**Files:**
- Create: `daemon/include/sidekey_scan.h`
- Create: `daemon/src/sidekey_scan.c`
- Create: `daemon/tests/test_scan.c`
- Modify: `daemon/CMakeLists.txt`

**Interfaces:**
- Consumes: `libevdev`（Task 0 的 `third_party/libevdev`，主机构建时需同样编译）
- Produces:
  ```c
  /* 扫描 dir（默认 "/dev/input"）下的 event* 节点，返回第一个声明 keycode 的设备路径。
     写入 out（长度 out_len）。找到返回 1，未找到返回 0，出错返回 -1。
     matched_count 返回所有匹配设备数（用于日志）。 */
  int sidekey_scan_find(const char *dir, int keycode, char *out, size_t out_len,
                        int *matched_count);
  ```

- [ ] **Step 1: 构建主机 libevdev**

在 `daemon/CMakeLists.txt` 中用 `add_subdirectory` 或 `ExternalProject` 构建 `third_party/libevdev`。主机测试需要 libevdev 的 `.so`/`.a`，因此在 WSL 中用 meson 构建（meson 与 ninja 已在 WSL 或需安装）。

先安装依赖（WSL）：

```bash
sudo apt-get update && sudo apt-get install -y meson ninja-build pkg-config
```

在仓库根运行：

```bash
cd third_party/libevdev
meson setup ../../build/libevdev-host --prefix=$PWD/../../build/libevdev-host-prefix -Ddocumentation=disabled -Dtests=disabled
meson compile -C ../../build/libevdev-host
meson install -C ../../build/libevdev-host
cd ../..
```

Expected: `build/libevdev-host-prefix/lib/libevdev.a` 存在。

- [ ] **Step 2: 写失败测试（用 tmp 目录模拟设备节点，不依赖真实 /dev/input）**

真实 `/dev/input` 无法在 WSL 里造出 `EV_KEY` 能力。因此测试只覆盖「枚举与过滤逻辑」，用一个注入的能力读取函数代替 libevdev 调用。改造接口：

把 Interfaces 中的函数拆成两层：`sidekey_scan_find_with(dir, keycode, probe_fn, ctx, ...)`，`probe_fn(path, keycode, ctx)` 返回 1/0/-1。`sidekey_scan_find` 是用真实 libevdev 探测函数调用它。

`daemon/tests/test_scan.c`：

```c
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "sidekey_scan.h"

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { \
    fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)

/* 假探测：只有 event0 声明 keycode 735 */
static int fake_probe(const char *path, int keycode, void *ctx) {
    (void)ctx;
    if (keycode != 735) return 0;
    return strstr(path, "event0") != NULL ? 1 : 0;
}

static void test_finds_only_matching_node(void) {
    char out[64] = {0};
    int matched = -1;
    /* 用一个不存在的目录也应能运行：枚举函数对目录做 readdir，这里改用固定候选列表 */
    const char *cands[] = {"/dev/input/event0", "/dev/input/event1", "/dev/input/event2"};
    int r = sidekey_scan_find_candidates(cands, 3, 735, fake_probe, NULL,
                                         out, sizeof(out), &matched);
    CHECK(r == 1);
    CHECK(strcmp(out, "/dev/input/event0") == 0);
    CHECK(matched == 1);
}

static void test_none_found(void) {
    char out[64] = {0};
    int matched = -1;
    const char *cands[] = {"/dev/input/event1"};
    int r = sidekey_scan_find_candidates(cands, 1, 735, fake_probe, NULL,
                                         out, sizeof(out), &matched);
    CHECK(r == 0);
    CHECK(matched == 0);
}

static int two_match_probe(const char *path, int keycode, void *ctx) {
    (void)keycode; (void)ctx;
    return (strstr(path, "event0") || strstr(path, "event1")) ? 1 : 0;
}

static void test_multiple_matches_picks_first_and_counts(void) {
    char out[64] = {0};
    int matched = -1;
    const char *cands[] = {"/dev/input/event0", "/dev/input/event1"};
    int r = sidekey_scan_find_candidates(cands, 2, 735, two_match_probe, NULL,
                                         out, sizeof(out), &matched);
    CHECK(r == 1);
    CHECK(strcmp(out, "/dev/input/event0") == 0);
    CHECK(matched == 2);
}

int main(void) {
    test_finds_only_matching_node();
    test_none_found();
    test_multiple_matches_picks_first_and_counts();
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    printf("test_scan: all passed\n");
    return 0;
}
```

- [ ] **Step 3: 接入 CMake 并运行确认失败**

在 `daemon/CMakeLists.txt` 追加 `sidekey_scan` 库与 `test_scan` 目标，`test_scan` 链接 `sidekey_scan`，`add_test(NAME scan COMMAND test_scan)`。

Run: `bash scripts/test-host.sh`
Expected: 失败（缺少头文件与实现）。

- [ ] **Step 4: 实现 `sidekey_scan_find_candidates`（纯逻辑）与 `sidekey_scan_find`（列目录 + 真实 libevdev 探测）**

头文件 `sidekey_scan.h` 声明：

```c
typedef int (*sidekey_probe_fn)(const char *path, int keycode, void *ctx);
int sidekey_scan_find_candidates(const char *const *paths, int n, int keycode,
                                 sidekey_probe_fn probe, void *ctx,
                                 char *out, size_t out_len, int *matched_count);
int sidekey_scan_find(const char *dir, int keycode, char *out, size_t out_len,
                      int *matched_count);
```

`sidekey_scan_find_candidates` 逐个调用 probe，统计匹配数，记录第一个匹配路径，返回值为是否找到。

`sidekey_scan_find` 用 `opendir/readdir` 列出 `dir` 下名为 `event<数字>` 的节点，排序后交给 `sidekey_scan_find_candidates`，probe 用 libevdev：

```c
static int libevdev_probe(const char *path, int keycode, void *ctx) {
    (void)ctx;
    int fd = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) return 0;               /* 无权限或节点消失：视为不匹配，不报错 */
    struct libevdev *dev = NULL;
    int ret = libevdev_new_from_fd(fd, &dev);
    int has = 0;
    if (ret == 0) {
        has = libevdev_has_event_code(dev, EV_KEY, keycode);
        libevdev_free(dev);
    }
    close(fd);
    return has ? 1 : 0;
}
```

注意：节点排序用数字升序，保证「第一个」在两次运行间稳定。

- [ ] **Step 5: 运行直到全部通过**

Run: `bash scripts/test-host.sh`
Expected: `test_scan: all passed`。

- [ ] **Step 6: 提交**

```bash
git add daemon/include/sidekey_scan.h daemon/src/sidekey_scan.c daemon/tests/test_scan.c daemon/CMakeLists.txt
git commit -m "feat: input device scan by keycode capability"
```

---

### Task 5: 守护进程主循环与 NDK 交叉编译

**Files:**
- Create: `daemon/src/main.c`
- Create: `scripts/build-daemon.sh`
- Modify: `daemon/CMakeLists.txt`（加入 NDK 目标，与主机目标分开）

**Interfaces:**
- Consumes: `sidekey_fsm.h`（Task 2）、`sidekey_config.h`（Task 3）、`sidekey_scan.h`（Task 4）
- Produces: 可执行文件 `bin/oplus-sidekey`（arm64-v8a，Android API 29+），命令行 `oplus-sidekey <moddir>`

主循环职责：
1. 读取 `<moddir>/config.conf`；失败则写日志并退出（不 grab）。
2. `sidekey_scan_find("/dev/input", keycode, ...)`；未找到则写日志并退出（不 grab）。
3. `open` 设备，`EVIOCGRAB` 独占。失败则写日志并退出。
4. 写 `<moddir>/daemon.pid`。
5. 用 `poll` 同时等待设备 fd 与 FSM 的唤醒时间；收到 `SIGHUP` 则重新读配置（重新 grab 不必要，只更新绑定表与 FSM 参数）。
6. 序列完成回调：查绑定，命中则 `fork`，子进程 `execl("/system/bin/sh", "sh", "-c", cmd, NULL)`，父进程不阻塞、记录退出码（用 `SIGCHLD` + `waitpid(WNOHANG)`）。
7. 收到 `SIGTERM` 时释放 grab、删除 pid 文件、退出。

- [ ] **Step 1: 写 NDK 构建脚本并先让它失败**

`scripts/build-daemon.sh`（在 WSL 中运行，NDK 通过 Windows 路径访问）：

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NDK="${NDK:-/mnt/l/CodeProgram/Android/Sdk/ndk/28.2.13676358}"
BUILD="$ROOT/build/android-arm64"
cmake -S "$ROOT/daemon" -B "$BUILD" -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a \
  -DANDROID_PLATFORM=android-29 \
  -DCMAKE_BUILD_TYPE=Release
cmake --build "$BUILD" --target oplus-sidekey
mkdir -p "$ROOT/module/bin"
cp "$BUILD/oplus-sidekey" "$ROOT/module/bin/oplus-sidekey"
"$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip" "$ROOT/module/bin/oplus-sidekey" || true
```

注意：`NDK` 的路径在 WSL 中是 `/mnt/l/...`。`prebuilt` 目录名在 Windows 上是 `windows-x86_64`，WSL 下若调用的是 Windows 版 clang 则路径需改。**执行前先确认**：在 WSL 中运行 `ls /mnt/l/CodeProgram/Android/Sdk/ndk/28.2.13676358/toolchains/llvm/prebuilt/`，若只有 `windows-x86_64`，则改用 Windows 版 clang，此时应在 PowerShell 中构建而非 WSL。这一点在 Step 2 验证时决定。

- [ ] **Step 2: 验证 NDK 工具链在 WSL 中是否可用**

Run: `ls /mnt/l/CodeProgram/Android/Sdk/ndk/28.2.13676358/toolchains/llvm/prebuilt/`
Expected:
- 若输出 `linux-x86_64`：使用 WSL 构建，脚本无需改动。
- 若只有 `windows-x86_64`：NDK 的 clang 是 Windows 可执行文件，WSL 无法直接用于构建。此时改为 PowerShell 构建，把 `build-daemon.sh` 改写为 `build-daemon.ps1`，Task 5 的其余步骤不变。

**不要在未确认前继续。**

- [ ] **Step 3: 写 `main.c` 的失败烟雾测试（主机编译，不运行设备逻辑）**

先写一个只检查「缺少参数时返回非 0」的最小测试，确保入口存在：

```c
/* daemon/tests/test_main_args.c */
#include <stdio.h>
#include <stdlib.h>
int main(void) {
    /* 由 CMake 测试命令调用 oplus-sidekey 无参数，期望退出码 2 */
    return system("./oplus-sidekey >/dev/null 2>&1") == 0x0200 ? 0 : 1;
}
```

此测试需要主机版 `oplus-sidekey`。在 CMake 中为主机构建一个 `oplus-sidekey-host` 目标用于测试。

Run: `bash scripts/test-host.sh`
Expected: FAIL（`main.c` 尚未存在）。

- [ ] **Step 4: 实现 `main.c`**

按「主循环职责」1–7 实现。关键约束：
- 所有路径通过 `<moddir>` 拼接，不写死 `/data/adb/...`。
- 日志追加到 `<moddir>/log.txt`，每行带时间戳（`time` 单调或墙钟均可，只用于排查）。
- `EVIOCGRAB` 失败、节点未找到、配置致命错误：均写日志后 `exit(1)`，不 grab。
- 参数缺失：`exit(2)`。
- 不调用 `setprop`（spec 要求：post-fs-data 阶段禁止，此处 service 阶段也不需要）。

- [ ] **Step 5: 运行主机测试，确认参数校验通过**

Run: `bash scripts/test-host.sh`
Expected: `test_main_args` PASS。

- [ ] **Step 6: 运行 NDK 交叉编译**

Run: `bash scripts/build-daemon.sh`（或 Step 2 决定的 PowerShell 版本）
Expected: `module/bin/oplus-sidekey` 生成，`file` 显示 `ELF 64-bit LSB executable, ARM aarch64`。

验证产物架构：

Run（WSL）: `file module/bin/oplus-sidekey`
Expected: 包含 `ARM aarch64`。

- [ ] **Step 7: 提交**

```bash
git add daemon/src/main.c daemon/CMakeLists.txt scripts/build-daemon.sh module/bin/oplus-sidekey
git commit -m "feat: daemon main loop and arm64 NDK build"
```

注意：`module/bin/oplus-sidekey` 是二进制产物，已确认需要进仓库，因为打包 zip 时需要它，且真机安装不应依赖构建环境。

---

### Task 6: 模块脚本与元数据

**Files:**
- Create: `module/module.prop`
- Create: `module/customize.sh`
- Create: `module/service.sh`
- Create: `module/uninstall.sh`
- Create: `module/config.conf.default`

**Interfaces:**
- Consumes: `module/bin/oplus-sidekey`（Task 5）；`<moddir>/config.conf`（Task 3 的格式）
- Produces: 可安装的 KSU 模块目录结构

- [ ] **Step 1: 写 `module.prop`**

```
id=oplus-sidekey
name=OnePlus Side Key
version=0.1.0
versionCode=1
author=rlin
description=独占接管 OnePlus Ace 6 侧键，按单击/长按序列执行 shell
```

注意：`id` 必须匹配 `^[a-zA-Z][a-zA-Z0-9._-]+$`（KSU 文档要求）。`versionCode` 必须为整数。

- [ ] **Step 2: 写 `customize.sh`（安装时检查与权限）**

```sh
#!/system/bin/sh
# KSU 会 source 本文件。
ui_print "- 检查设备"
if [ "$KSU" != "true" ]; then
  abort "此模块仅支持 KernelSU"
fi
set_perm "$MODPATH/bin/oplus-sidekey" 0 0 0755
set_perm "$MODPATH/service.sh" 0 0 0755
set_perm "$MODPATH/uninstall.sh" 0 0 0755
if [ ! -f "$MODPATH/config.conf" ]; then
  cp "$MODPATH/config.conf.default" "$MODPATH/config.conf"
fi
ui_print "- 安装完成，重启后生效"
```

注意：`config.conf` 仅在不存在时从默认值复制。这里仍是模块目录内，卸载即删，符合 spec。

- [ ] **Step 3: 写 `service.sh`（启动守护进程）**

```sh
#!/system/bin/sh
MODDIR=${0%/*}
# 确保只启动一个实例
if [ -f "$MODDIR/daemon.pid" ]; then
  OLD=$(cat "$MODDIR/daemon.pid" 2>/dev/null)
  if [ -n "$OLD" ] && [ -d "/proc/$OLD" ]; then
    exit 0
  fi
  rm -f "$MODDIR/daemon.pid"
fi
"$MODDIR/bin/oplus-sidekey" "$MODDIR" >>"$MODDIR/log.txt" 2>&1 &
```

注意：`service.sh` 以 late_start 运行，spec 要求守护进程在此启动（非 post-fs-data）。pid 由守护进程自己写入，`service.sh` 不写。

- [ ] **Step 4: 写 `uninstall.sh`（结束守护进程，兜底清理）**

```sh
#!/system/bin/sh
MODDIR=${0%/*}
# 1) 优先按 pid 文件结束
if [ -f "$MODDIR/daemon.pid" ]; then
  PID=$(cat "$MODDIR/daemon.pid" 2>/dev/null)
  [ -n "$PID" ] && kill -TERM "$PID" 2>/dev/null
  sleep 1
fi
# 2) 兜底：按可执行路径查找残留进程
for p in /proc/[0-9]*; do
  exe=$(readlink "$p/exe" 2>/dev/null) || continue
  case "$exe" in
    "$MODDIR/bin/oplus-sidekey") kill -TERM "${p#/proc/}" 2>/dev/null ;;
  esac
done
exit 0
```

注意：spec 第 7 节要求「pid 文件缺失或失效时，再按可执行文件路径查找」，此脚本已覆盖。`uninstall.sh` 不删除模块目录本身，删除由 KSU 完成（真机验证项）。

- [ ] **Step 5: 写 `config.conf.default`**

```
keycode=735
long_press_ms=300
window_ms=300
```

不预置任何绑定，避免默认执行命令。

- [ ] **Step 6: 验证所有 shell 脚本为 LF**

Run（PowerShell）:

```powershell
Get-ChildItem module -Recurse -Filter *.sh | ForEach-Object {
  $bytes = [IO.File]::ReadAllBytes($_.FullName)
  $hasCR = $bytes -contains 13
  "$($_.Name): " + $(if ($hasCR) { "CRLF FOUND - FIX" } else { "LF ok" })
}
```

Expected: 全部 `LF ok`。出现 `CRLF FOUND` 时，用 `(Get-Content -Raw f) -replace "`r`n","`n" | Set-Content -NoNewline f`（注意保持 UTF-8 无 BOM）修正后再验证。

- [ ] **Step 7: 在 WSL 中做 shell 语法检查**

Run（WSL）: `for f in module/*.sh; do sh -n "$f" && echo "ok $f"; done`
Expected: 每个文件都输出 `ok`。

- [ ] **Step 8: 提交**

```bash
git add module/module.prop module/customize.sh module/service.sh module/uninstall.sh module/config.conf.default
git commit -m "feat: module scripts and metadata"
```

---

### Task 7: KSU WebUI

**Files:**
- Create: `module/webroot/index.html`

**Interfaces:**
- Consumes: `kernelsu@3.0.2` 的 `exec(command): Promise<{errno, stdout, stderr}>`；模块目录 `/data/adb/modules/oplus-sidekey/`
- Produces: 单文件 WebUI，无构建步骤。

WebUI 功能（严格对应 spec 第 4 节）：
- 读取 `config.conf`，展示并允许修改 `long_press_ms`、`window_ms`（范围 100–800）。
- 绑定列表：14 个序列（`0`、`1`、`00`、`01`、`10`、`11`、`000`…`111`），每个可填一条命令。
- 写回时用 base64 传入，避免命令注入。
- 启停守护进程按钮；查看 `log.txt` 末尾若干行。
- 页面顶部明确提示：命令以 root 执行，无沙箱。

- [ ] **Step 1: 确认 `kernelsu` 的加载方式**

WebUI 是纯静态页面，不能直接 `import 'kernelsu'`（无打包器）。需要把 `kernelsu@3.0.2` 的 `index.js` 作为本地模块随页面一起打包。

Run（PowerShell）: `npm pack kernelsu@3.0.2` 后解压，读 `package/index.js` 前 40 行。
Expected: 确认其导出为 ES module，且不依赖 Node 内置模块。
- 若依赖 Node 内置模块：改用 `window.ksu` 或 WebUI 提供的全局 API，并在 Step 3 中注明。
- 若为纯 ES module：复制为 `module/webroot/vendor/kernelsu.js`，页面用 `<script type="module">` 引用。

**此步骤结果决定 Step 2 的写法，不要跳过。**

- [ ] **Step 2: 写 `index.html` 的失败检查**

用一个最小 Node 脚本检查 `index.html` 包含必需元素（在主机上用 node 运行，不需要浏览器）：

```js
// scripts/check-webui.mjs
import { readFileSync } from 'node:fs';
const html = readFileSync('module/webroot/index.html', 'utf8');
const required = ['data-test="warning-root"', 'data-test="daemon-toggle"', 'data-test="binding-000"', 'btoa('];
const missing = required.filter(s => !html.includes(s));
if (missing.length) { console.error('MISSING:', missing); process.exit(1); }
console.log('webui check ok');
```

Run: `node scripts/check-webui.mjs`
Expected: FAIL，`MISSING`（文件尚不存在）。

- [ ] **Step 3: 写 `index.html`**

实现要点：
- 顶部警告块 `data-test="warning-root"`：「命令以 root 执行，无沙箱。请勿输入不信任的命令。」
- 参数表单：`long_press_ms`、`window_ms`，`<input type="number" min="100" max="800">`，提交前校验范围。
- 14 个绑定输入框，`data-test="binding-<seq>"`，序列按 `0,00,000,1,...` 顺序排列。
- 保存：生成 `config.conf` 文本，`btoa(unescape(encodeURIComponent(text)))` 编码，然后：
  ```js
  const r = await exec(`echo '${b64}' | base64 -d > /data/adb/modules/oplus-sidekey/config.conf`);
  ```
  注意：`b64` 只含 `A-Za-z0-9+/=`，单引号包裹是安全的。
- 启停守护进程：`data-test="daemon-toggle"`，启动 `sh /data/adb/modules/oplus-sidekey/service.sh`，停止读 `daemon.pid` 后 `kill -TERM`。
- 日志：`tail -n 50 /data/adb/modules/oplus-sidekey/log.txt`。
- 保存后提示「需重启守护进程生效」，并允许一键重启守护进程（不是系统重启）。

- [ ] **Step 4: 运行检查，确认通过**

Run: `node scripts/check-webui.mjs`
Expected: `webui check ok`。

- [ ] **Step 5: 语法检查 HTML 中的 JS**

在 WSL 中把 `<script>` 内容抽出来用 `node --check`：

```bash
node -e "const h=require('fs').readFileSync('module/webroot/index.html','utf8'); const m=[...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n'); require('fs').writeFileSync('/tmp/webui.check.js', m);" && node --check /tmp/webui.check.js && echo "js syntax ok"
```

Expected: `js syntax ok`。

- [ ] **Step 6: 提交**

```bash
git add module/webroot/index.html scripts/check-webui.mjs module/webroot/vendor 2>/dev/null
git commit -m "feat: KSU WebUI for config and daemon control"
```

---

### Task 8: 打包与结构验证

**Files:**
- Create: `scripts/package-module.sh`

**Interfaces:**
- Consumes: `module/` 全部内容
- Produces: `dist/oplus-sidekey-<version>.zip`，可被 KSU 管理器安装

- [ ] **Step 1: 写打包脚本**

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER=$(grep '^version=' "$ROOT/module/module.prop" | cut -d= -f2)
OUT="$ROOT/dist/oplus-sidekey-$VER.zip"
rm -rf "$ROOT/dist" && mkdir -p "$ROOT/dist"
( cd "$ROOT/module" && zip -r "$OUT" . -x '*.DS_Store' )
echo "$OUT"
```

- [ ] **Step 2: 运行打包**

Run（WSL）: `bash scripts/package-module.sh`
Expected: 输出 `dist/oplus-sidekey-0.1.0.zip`。

- [ ] **Step 3: 验证 zip 结构**

Run: `unzip -l dist/oplus-sidekey-0.1.0.zip`
Expected: 包含 `module.prop`、`customize.sh`、`service.sh`、`uninstall.sh`、`config.conf.default`、`bin/oplus-sidekey`、`webroot/index.html`。`module.prop` 位于根目录（不在子目录）。

- [ ] **Step 4: 验证 zip 内所有 shell 为 LF**

Run:
```bash
rm -rf /tmp/pkgcheck && mkdir /tmp/pkgcheck && cd /tmp/pkgcheck && unzip -q "$OLDPWD/dist/oplus-sidekey-0.1.0.zip"
for f in *.sh; do grep -q $'\r' "$f" && echo "CRLF in $f" || echo "ok $f"; done
cd -
```
Expected: 全部 `ok`。

- [ ] **Step 5: 提交**

```bash
git add scripts/package-module.sh
git commit -m "chore: package module zip"
```

---

### Task 9: 本地 WebUI 验证（临时端口，结束即关）

**Files:** 无新增。

**Interfaces:**
- Consumes: `module/webroot/index.html`
- Produces: 验证记录

**约束（来自 AGENTS.md）：** 不修改或关闭用户已有服务器。只在其他端口临时起静态服务，结束前关闭。

- [ ] **Step 1: 选择一个未占用端口并启动静态服务**

选 `18765`（非用户已知端口）。在后台临时运行：

```bash
cd module/webroot && python3 -m http.server 18765 --bind 127.0.0.1 &
echo $! > /tmp/webui-server.pid
```

若 WSL 无 python3，改用 `npx --yes http-server -p 18765 -a 127.0.0.1 module/webroot`。

- [ ] **Step 2: 确认端口可访问**

Run: `curl -sf http://127.0.0.1:18765/index.html | head -c 200`
Expected: 返回 HTML 开头。

- [ ] **Step 3: 页面 DOM 检查（不依赖真机 KSU）**

用 chrome-devtools 打开 `http://127.0.0.1:18765/index.html`，检查 `data-test="warning-root"`、14 个 `binding-*` 元素存在。KSU `exec` 在普通浏览器不可用，页面应能优雅降级（显示「非 KSU 环境」而不是报错）。

- [ ] **Step 4: 结束前关闭临时服务**

```bash
kill "$(cat /tmp/webui-server.pid)" && rm -f /tmp/webui-server.pid
```

Run: `curl -sf http://127.0.0.1:18765/ || echo "stopped ok"`
Expected: 输出 `stopped ok`。

---

## 执行前置条件（已核实，未满足前不得开始 Task 1）

- WSL（Ubuntu-26.04）当前缺失：`gcc`、`cmake`、`ninja`、`meson`、`pkg-config`、`zip`、`unzip`。仅有 `python3`。
  - 需用户在 WSL 中安装：`sudo apt-get install -y build-essential cmake ninja-build meson pkg-config zip unzip`
  - 安装前不执行 Task 1，否则 `scripts/test-host.sh` 必然失败。
- NDK `28.2.13676358` 的 `toolchains/llvm/prebuilt/` 只有 `windows-x86_64`，**WSL 中的 clang 无法直接使用**。Task 5 因此默认改用 PowerShell 构建（即 Task 5 Step 2 的第二个分支），`build-daemon.sh` 需替换为 `build-daemon.ps1`。
- `kernelsu@3.0.2` 的 `index.js` 为 ES module，导出 `exec`，依赖全局 `ksu`。Task 7 可直接复制为 `module/webroot/vendor/kernelsu.js` 引用，无需 Node 内置模块。

## 真机验证清单（由用户执行，不在自动化范围内）

这些项目无法在主机上验证，必须在 Ace 6 标准版上执行：

1. **安装**：在 KSU 管理器中刷入 `dist/oplus-sidekey-0.1.0.zip`，重启。
2. **守护进程启动**：`su -c "cat /data/adb/modules/oplus-sidekey/daemon.pid"` 有输出；`su -c "tail /data/adb/modules/oplus-sidekey/log.txt"` 显示扫描到 `/dev/input/event0`。
3. **独占生效**：按侧键，系统原生动作（如智能助手）不再触发。
4. **绑定命令执行**：在 WebUI 绑定 `0=echo single >> /data/local/tmp/sk.log`，单击后检查该文件。
5. **三种序列**：分别测试单击、双击、长按、三击，每个绑定到不同命令，确认互不串扰。
6. **守护进程被杀后释放独占**：`su -c "kill -TERM $(cat ...daemon.pid)"` 后，侧键恢复系统原生行为。
7. **卸载残留**：KSU 管理器中卸载模块，重启，检查：
   - `/data/adb/modules/oplus-sidekey` 不存在（**这是未经官方文档确认的项，需实测**）；
   - `ps -A | grep oplus-sidekey` 无输出；
   - `/data/adb` 下无残留。
8. **禁用行为**：在管理器中禁用模块，确认重启后守护进程不启动。

## Self-Review

**1. Spec 覆盖检查**

| Spec 要求 | 实现位置 |
|---|---|
| 独占 `/dev/input/event0`，键码 735 | Task 4（扫描）、Task 5（EVIOCGRAB） |
| 按压分类 0/1，长按阈值 | Task 2 |
| 窗口期，松开后开始 | Task 2 |
| 序列上限 3，第 3 次立即结束 | Task 2 |
| 14 个序列，每个一个动作 | Task 3（`SIDEKEY_MAX_BINDINGS=14`）、Task 7（14 个输入框） |
| 无绑定丢弃并写日志 | Task 5（主循环第 6 条，需确保未命中时写日志） |
| 多设备只 grab 第一个 | Task 4（`sidekey_scan_find_candidates` 取第一个并计数） |
| 配置在模块目录内 | Task 6（`config.conf` 在 `$MODDIR`） |
| 守护进程 pid 在模块目录 | Task 5（写 `daemon.pid`）、Task 6（`uninstall.sh` 读取） |
| `uninstall.sh` 结束进程并兜底 | Task 6 Step 4 |
| 禁用仅重启后生效 | Task 6（不轮询 `disable`），Task 9 真机清单第 8 项 |
| shell 脚本 LF | Task 0（`.gitattributes`）、Task 6 Step 6、Task 8 Step 4 |
| WebUI base64 写配置 | Task 7 Step 3 |
| WebUI 启停守护进程、看日志 | Task 7 Step 3 |
| 无绑定时保持独占 | Task 5（不因无绑定而释放 grab） |
| 不写模块目录之外 | Task 5 Step 4（全部路径经 `<moddir>` 拼接） |

**2. 占位符扫描**：已检查。Task 5 Step 2 与 Task 7 Step 1 是「先确认再决定」的分支步骤，已明确两种结果的处理方式，不是占位符。

**3. 类型一致性**：`sidekey_fsm_cfg_t` 在 Task 2 定义，Task 3 引用；`sidekey_probe_fn` 在 Task 4 头文件定义；`sidekey_config_t.fsm` 类型与 Task 2 一致。

**已知风险（实施中需处理）：**
- Task 5 Step 1：NDK 的 `prebuilt` 目录若只有 `windows-x86_64`，WSL 构建不可用。Step 2 设了判断点，不能跳过。
- Task 7 Step 1：`kernelsu` 包的加载方式取决于其 `index.js` 是否依赖 Node 内置模块，需先核实。
- Task 6：`uninstall.sh` 按路径查进程用 `readlink /proc/<pid>/exe`，在 Android 上需 root，KSU 执行时满足。
- 真机清单第 7 项「卸载后目录是否被删」未经官方文档确认，是本计划唯一明确标注为未知的验收项。
