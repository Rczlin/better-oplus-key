# 动态按压绑定与操作体验改进 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户按需创建长短按组合并获得清楚的保存、运行和诊断反馈，同时修复基线审查确认的六项问题。

**Architecture:** 保留 config.conf、KernelSU 桥和 libevdev 输入链路。配置使用 uthash 按实际绑定分配内存，状态机通过匹配回调判断完整组合和后续组合；配置与状态机资源准备完成后整体切换。WebUI 复用现有组件和 Radix Dialog，采用绑定列表、组合编辑器和页面草稿。

**Tech Stack:** C11、libevdev 1.14.0、uthash 2.4.0、React 19、TypeScript、Radix UI、Tailwind CSS、Sonner、Vitest、CTest、Android NDK r28c。

**Spec:** [已确认设计](../specs/2026-10-17-dynamic-bindings-design.md)。用户已在上一聊天确认设计并要求继续制定实施计划；本计划待审阅和选择执行方式。

## Global Constraints

- 保留单行 Shell 命令配置；命令以 root 权限执行，界面在编辑处说明。
- 短按、长按分别编码为 `0`、`1`；组合按需存储，整份配置最多 64 KiB（65536 字节）。
- 每条命令最多 511 个 UTF-8 字节；保留引号、等号、空格和中文，拒绝换行和 NUL。
- 时间参数默认 300 毫秒，必须为 100–800 的整数；键码必须为 1–767 的整数。
- 重复组合以末条为准，末条空命令解除绑定；任何致命解析错误都保留原有整份配置。
- 完整组合还有更长后续时等待，否则松开立即执行；不完整或失配输入不执行较短命令，不重新解释尾部。
- 输入使用 CLOCK_MONOTONIC 事件时间；继续排空队列后检查到期、过滤重复边沿并处理 SYN_DROPPED。
- 运行期间改变键码需要重启；热加载拒绝此类变更并保留整份活动配置。
- 使用固定上游提交 `a49bed0b4abb7dff16c73906dcdc8a9718d582d2` 的 uthash v2.4.0，保留许可证，启用可恢复分配失败处理。
- 只修改本需求涉及的文件，保留工作区已有改动；测试只能关闭本次创建的临时服务，不能操作用户现有服务器。
- 保存信号发送成功仅说明应用请求已发出；设备实测结果与主机验证分开报告。

## Review Focus

1. 配置末尾存在无效重复条目、嵌入 NUL、读取不完整或分配失败时，旧配置和识别资源必须保持可用——Task 1、3。
2. 输入失配后继续按键、叶子执行后继续按键、按住时跨越间隔边界，不得误触发其他命令——Task 2。
3. 热加载发生在半个手势或子命令运行期间，新识别使用新配置，已有子进程记录仍拥有旧组合和命令——Task 3。
4. 双击保存／启停、读取失败、未知运行状态、保存成功但应用请求失败时，界面不得覆盖配置或误报成功——Task 5。
5. 长组合在窄屏、解释日志和安装包中必须完整可用；不能仅让编辑器支持长度而留下底层截断——Task 3、5、6。

## 起点与文件边界

业务基线为 `a327ebc` 加当前已有未提交修改；HEAD `00c1f6f` 另包含已确认设计与旧代码审查。执行开始时保存 `git status --short` 和 `git diff --stat`，对照已有改动识别本轮增量，不重置工作区。

2026-10-17 本次续接复测：WebUI 99/99、CTest 9/9、TypeScript 与 Vite 构建通过；lint 0 错误、4 条已有警告。临时 WebUI 构建位于 `build/ux-resume-baseline-webui/`，没有启动预览服务。

主要边界：`sidekey_config` 拥有绑定内存；`sidekey_fsm` 拥有输入缓冲；`main.c` 拥有活动资源、进程锁与子进程记录；`BindingEditor.tsx` 只处理单个绑定草稿；`App.tsx` 负责配置读取、页面草稿、保存和服务状态。

---

### Task 1: C 配置动态存储与严格解析

**Files:** 新增 `third_party/uthash/uthash.h`、`third_party/uthash/LICENSE`、`third_party/uthash/README.md`；修改 `daemon/include/sidekey_config.h`、`daemon/src/sidekey_config.c`、`daemon/src/sidekey_runtime.c`、`daemon/src/main.c` 的配置初始化／释放、`daemon/CMakeLists.txt`；迁移 `daemon/tests/test_config.c`、`test_runtime.c`、`test_daemon_config.c` 中的配置初始化、访问和释放。

**Interfaces:**

- 保留 `int sidekey_config_parse(const char *text, sidekey_config_t *out)`，调用前须初始化；失败不改变 out，成功释放 out 原有绑定后转移新配置的所有权。
- 新增 `void sidekey_config_init(sidekey_config_t *c)`、`void sidekey_config_destroy(sidekey_config_t *c)`，destroy 后可安全再次 destroy 或 parse。
- 新增 `const char *sidekey_config_lookup(const sidekey_config_t *c, const char *seq)`、`int sidekey_config_has_longer(const sidekey_config_t *c, const char *seq, int len)`；借用指针只在配置存活期间有效。
- `sidekey_config_t` 保留键码、时间与 skipped_lines，使用不透明绑定节点指针及 `size_t n_bindings, max_seq_len`；移除固定容量数组。`SIDEKEY_CMD_MAX=512` 保留，新增 `SIDEKEY_CONFIG_MAX_BYTES=65536`、`SIDEKEY_CONFIG_ERR_NOMEM=-3`。
- 保留 `sidekey_runtime_lookup`，改为委托配置查找函数，避免继续依赖数组布局。

- [ ] **Step 1: 写失败测试。** `test_long_sequences_and_more_than_fourteen_bindings`：四次与 128 次组合能查到完整命令，20 个唯一绑定均存在；`test_duplicate_last_wins_and_empty_removes`：同键两条只占一个条目，末条空命令后 lookup 为 NULL；`test_strict_integer_ranges`：100/800、1/767 接受，0、-1、801、768、4294967596、尾随字符拒绝且旧命令保留。
- [ ] **Step 2: 验证 RED。** 运行 `wsl -d Ubuntu-26.04 -- bash scripts/test-host.sh`，确认新断言针对旧限制／解析行为失败。
- [ ] **Step 3: 实现。** 从固定提交取得上游 header 和许可证；读取 README/API 后使用 `HASH_FIND_STR`、`HASH_ADD_KEYPTR`、`HASH_DEL`、`HASH_ITER`，以 `HASH_NONFATAL_OOM=1` 检查插入失败。解析临时配置，验证原始命令字节后才替换重复项；按输入长度切行，去除原有 1024 字节行缓冲限制，最终所有权只转移一次。数字使用严格十进制格式、errno 和范围检查。
- [ ] **Step 4: 补充并运行 GREEN。** `test_invalid_duplicate_preserves_previous_config`、`test_config_size_boundary`、`test_allocator_failures_preserve_previous_config` 覆盖 65536/65537 字节、普通节点与 uthash 分配失败；用测试编译单元替换分配器，不新增产品配置开关。现有 UTF-8 511/512 边界、等号、CRLF 和未知行诊断继续通过，全部 CTest 通过。
- [ ] **Step 5: 检查本任务差异并建立提交检查点。** 只包含本任务路径，提交说明 `feat: support dynamic sidekey binding configuration`；记录同时包含的既有续接修改。

### Task 2: 按配置前缀智能识别

**Files:** 修改 `daemon/include/sidekey_fsm.h`、`daemon/src/sidekey_fsm.c`、`daemon/include/sidekey_runtime.h`、`daemon/src/sidekey_runtime.c`、`daemon/src/sidekey_input.c`、`daemon/src/main.c` 的初始化调用；更新 `daemon/tests/test_fsm.c`、`test_input.c`、`test_runtime.c`。

**Interfaces:**

- 保留完成回调 `void (*sidekey_on_seq_fn)(const char *seq, int len, void *ctx)`，seq 在回调期间有效。
- 新增 `SIDEKEY_MATCH_EXACT=1`、`SIDEKEY_MATCH_LONGER=2`，以及 `unsigned (*sidekey_match_fn)(const char *seq, int len, void *ctx)`。
- `int sidekey_fsm_init(sidekey_fsm_t *f, const sidekey_fsm_cfg_t *cfg, size_t max_seq_len, sidekey_match_fn match, sidekey_on_seq_fn cb, void *ctx)`：f 须零初始化或已销毁，失败可安全销毁。
- 新增 `void sidekey_fsm_reset(sidekey_fsm_t *f)` 和 `void sidekey_fsm_destroy(sidekey_fsm_t *f)`；reset 只丢弃进行中的输入，不分配或释放缓冲。
- 新增 `unsigned sidekey_runtime_match(const char *seq, int len, void *ctx)`，ctx 是活动 `sidekey_config_t *`，复用 Task 1 的 lookup／has_longer。

- [ ] **Step 1: 写失败测试。** `test_leaf_executes_on_release`、`test_shared_prefix_waits`、`test_four_and_long_mixed_sequence` 分别验证仅配 0 时松开立即执行、0/00 在 299ms 等待且 300ms 到期、0000 与 01001 完整触发；`test_incomplete_does_not_fallback` 验证配置 0/001 而输入 00 超时后只报告未匹配。
- [ ] **Step 2: 验证 RED。** 运行主机测试，确认失败来自三次上限或旧触发规则；旧测试按已确认规则更新，继续保留全部 14 个旧组合的识别覆盖。
- [ ] **Step 3: 实现。** 初始化分配 `max(max_seq_len, 1)+1` 字节缓冲；松开后查询匹配标志，完整叶子立即回调，其余等窗口到期。失配后置标记并停止增长缓冲，直到间隔结束；不解析其尾部。同步丢失调用 reset，避免重复初始化泄漏。
- [ ] **Step 4: 验证 GREEN。** 补 `test_mismatch_tail_is_not_reinterpreted`、`test_leaf_followed_by_new_gesture`、`test_held_press_crosses_gap`、`test_empty_config_and_init_oom`；保留长按和连按 299/300/301、重复边沿、72 条批量事件、时钟切换及 SYN_DROPPED 测试。检查内存初始化／销毁后所有 CTest 通过。
- [ ] **Step 5: 检查差异并建立提交检查点。** 提交说明 `feat: recognize configured sidekey prefixes`。

### Task 3: 原子热加载、进程生命周期与完整诊断

**Files:** 修改 `daemon/src/main.c`、`daemon/src/sidekey_log.c`、`daemon/tests/test_daemon_config.c`、`daemon/tests/test_log.c`、`daemon/CMakeLists.txt`、`module/service.sh`；新增 `daemon/tests/test_daemon_lifecycle.c`。

**Interfaces:** 保留生产入口和 `static int load_config(void)`；load_config 在运行期间准备临时 config 与 FSM，成功后整体转移到 g_cfg/g_fsm。新增内部 `static int acquire_instance_lock(void)`；锁路径为模块目录内 `daemon.lock`，使用 `flock(LOCK_EX|LOCK_NB)`、O_CLOEXEC，并持有至进程退出。保留现有日志格式函数与命令退出码，未匹配为 dropped，执行失败保留负数结果。

- [ ] **Step 1: 写失败测试。** `test_reload_preserves_config_and_fsm_on_failure`：解析、短读、NUL、分配失败后旧查找与半个手势保持可用；`test_reload_rejects_keycode_change`：运行态改变键码后整份旧配置仍有效且日志提示重启；`test_reload_resets_partial_input`：成功切换后旧半个手势不参与新组合。
- [ ] **Step 2: 验证 RED。** 测试继续采用 include 生产 main.c 并重命名入口的现有做法；对 fread／waitpid／ppoll 边界使用测试替身，不启动设备守护进程，不执行用户配置命令。确认各项暴露旧行为。
- [ ] **Step 3: 实现配置切换。** 检查 fseek/ftell/fread/ferror、实际读取长度及 NUL；全部资源准备后才销毁旧 FSM／配置并转移所有权。match 的 ctx 始终指向全局 g_cfg，不保留临时栈地址。成功重载重置输入同步状态并丢弃旧队列；失败保持旧资源。
- [ ] **Step 4: 补生命周期 RED 并修复。** `test_signal_between_check_and_wait` 在检查后注入 HUP/TERM，验证使用信号掩码与 ppoll 原子等待及时返回：仅在最终标记检查前屏蔽相关信号，ppoll 使用之前的掩码，返回后恢复；输入排空阶段正常交付信号，不能让持续输入饿死停止／重载。fork 子进程在 exec 前恢复原掩码。`test_sigchld_during_reap_is_retained` 验证回收前清标志、waitpid 遇 EINTR 重试，回收期间的新通知不被覆盖。
- [ ] **Step 5: 补实例与日志 RED 并修复。** `test_second_instance_preserves_owner_pid` 和 `test_failed_start_preserves_other_pid` 用临时目录与测试子进程验证锁和 PID 所有权；只在本实例成功写入且内容仍属于本实例时删除 PID。service.sh 复用身份检查但不抢先删除其他实例的 PID，后台子进程标准流定向至现有日志文件或 /dev/null。`test_inflight_owns_long_sequence_across_reload`、`test_long_sequence_log_is_complete` 验证子进程记录拥有组合／命令副本，退出时释放；日志缓冲按实际长度准备，避免固定 4／1024 字节截断。分配失败记录错误并放弃本次派发。
- [ ] **Step 6: 验证 GREEN 并建立提交检查点。** 主机全套通过；三个模块脚本 `sh -n` 通过；以 `-fsanitize=address,undefined -fno-omit-frame-pointer` 在单独 `build/host-sanitize/` 构建并执行 CTest，要求无泄漏、越界和未定义行为。提交说明 `fix: preserve sidekey state across reload and lifecycle races`。

### Task 4: 前端动态配置与格式一致性

**Files:** 修改 `webui/src/lib/config.ts`、`webui/src/lib/log.ts`、`webui/tests/config.test.ts`、`webui/tests/log.test.ts`、`webui/src/App.tsx`、`webui/tests/app.test.tsx`；同步迁移固定集合引用和旧 DOM 契约测试，使其按读取到的绑定数量断言，保持测试与编译可用。

**Interfaces:**

- `Sequence` 改为 `string`，实际输入由 `validateSequence(seq: string): boolean` 校验非空 `[01]+`；删除预生成序列集合。
- `ParsedConfig` 新增 `keycode: number`，`bindings: Record<string, string>` 只存实际非空绑定，其余字段沿用。
- 保留 parseConfig／serializeConfig／validateTiming／validateCommand 的入口；导出 `MAX_CONFIG_BYTES=65536` 和 `sequenceLabel(seq: string): string`，后者生成“短按 → 长按”等可读名称。
- serializeConfig 在写出前校验键码、时间、组合、单行命令和整份 UTF-8 大小；解释日志正则接受 `[01]+`，执行失败负数保持可解析。

- [ ] **Step 1: 写失败测试。** 4/128 次组合、20 条绑定、重复键末条覆盖／空命令删除、键码 1/767 回读保存、引号／等号／中文和前后空格逐字保留；数值异常及 65536/65537 字节边界必须报错；NUL／命令换行不得序列化。
- [ ] **Step 2: 验证 RED。** 在 webui 运行 `npm test -- --reporter=dot`，确认新增配置／日志断言失败。
- [ ] **Step 3: 实现。** 使用 TextEncoder 统一字节计数，前后端数字格式与失败规则一致；旧一至三次绑定直接回读；不 trim 命令。只需存储实际绑定，不生成所有组合。
- [ ] **Step 4: 验证 GREEN。** 前端全套测试通过；使用 Task 1 相同配置文本核对两端重复键、空值、超长项和时间校验；运行 TypeScript 检查确保迁移完整。
- [ ] **Step 5: 检查差异并建立提交检查点。** 提交说明 `feat: align web configuration with dynamic sidekey bindings`。

### Task 5: 绑定编辑器与清晰操作反馈

**Files:** 新增 `webui/src/components/BindingEditor.tsx`、`webui/tests/binding-editor.test.tsx`；修改 `webui/src/App.tsx`、`webui/tests/app.test.tsx`，仅在需要布局调整时修改 `webui/src/index.css`。复用现有 `webui/src/lib/daemon.ts` 和其脚本测试。

**Interfaces:** `BindingEditor` 接收 `{ open: boolean; initial: { sequence: string; command: string } | null; bindings: Record<string, string>; disabled: boolean; onOpenChange(open: boolean): void; onSubmit(binding: { sequence: string; command: string }): void }`。编辑只改变对话框草稿，提交才更新页面草稿；保存配置才写磁盘。

- [ ] **Step 1: 写交互失败测试。** 点击“新增绑定”后用“短按”“长按”组成 01001、撤回、清空；填写命令、添加后出现在列表。编辑可变更组合和命令，取消不修改原值；重复组合明确报错，编辑自身同一组合允许保存；删除后只移除对应项。空组合／空命令不能提交，超长命令和配置超限有明确错误。
- [ ] **Step 2: 验证 RED。** 运行组件与 App 测试，确认缺失的新行为导致失败。
- [ ] **Step 3: 实现布局与编辑器。** 直接复用已安装 `radix-ui` 的 Dialog、现有 Button/Input/Label/Card/Badge、Lucide 和 Sonner，不手写焦点陷阱。页面依次是“侧键服务”状态、“我的绑定”列表、可展开的“时间设置”和“诊断记录”；时间名称为“长按时长”“连按间隔”，说明默认值、范围和边界。绑定以可读按压顺序为主，编码供对照；长内容允许换行。空列表提供新建入口，命令编辑处说明单行格式和 root 执行。
- [ ] **Step 4: 加状态测试并实现。** 保存状态明确区分未保存、保存中、已保存、保存失败、已保存但应用请求失败。仅收到 saved／saved-hup-requested／saved-hup-failed 才更新磁盘快照；文案使用“已发送应用请求”，不声称底层已加载。重入保护同时使用同步 ref 锁与禁用按钮，阻止同一事件轮内并发保存／启停，finally 解锁；进行操作时禁用冲突编辑。读取失败阻止覆盖且可重试；未知状态只显示查询／重试，不显示启动操作。
- [ ] **Step 5: 加异常与无障碍测试并验证 GREEN。** 覆盖 cat 失败、未知标记、异常、保存后 HUP 失败、未保存标记、连续点击、日志 errno 非零和部分失败；日志失败显示原因且可重试。验证 Dialog 标题、描述、Escape 取消、打开与关闭焦点恢复；非 KSU 环境不发 shell 调用。`npm test -- --reporter=dot`、`npm run lint`、`npx tsc -b --pretty false` 通过，lint 不新增警告。
- [ ] **Step 6: 检查差异并建立提交检查点。** 提交说明 `feat: simplify sidekey binding setup and feedback`。

### Task 6: 全链路审查、构建与安装包核对

**Files:** 更新旧续接记录 `docs/superpowers/plans/2026-10-12-oplus-sidekey-status.md`；新增 `docs/superpowers/reviews/2026-10-17-dynamic-bindings-review.md`；构建更新 `module/bin/oplus-sidekey`、`module/webroot/` 和忽略目录中的 dist ZIP。只有打包确需修复时修改 `scripts/package-module.ps1`，避免无关脚本重构。

**Interfaces:** 保持模块 ID、版本来源、service.sh、config.conf 与 KernelSU 加载方式；沿用 `scripts/build-daemon.ps1`、WebUI build、`scripts/package-module.ps1` 的入口。

- [ ] **Step 1: 运行最终自动化验收。** 前端测试／lint／TypeScript／生产构建、主机 CTest、ASan+UBSan、三个脚本语法检查、`git diff --check`；修复后只在有代码变化或未解疑点时重跑相关检查。
- [ ] **Step 2: 独立代码审查。** 按 requesting-code-review 技能让新 reviewer 同时读取设计、此计划、旧审查报告与全部业务增量，重点检查所有权、信号掩码、短读、PID 锁、配置一致性和操作状态。逐项复现重要反馈，补对应回归后修复，再审查最终差异。
- [ ] **Step 3: 浏览器验证。** 使用自有临时端口（例如 18766，先确认空闲；占用则更换）检查桌面及 390px 窄屏。普通环境核对禁用态；测试页面桥只返回固定测试配置、模拟保存／状态结果，不执行 Shell。完成新增长组合→编辑→保存→诊断流程，检查长文本、焦点和浏览器异常。记录本次服务 PID，在 finally 中只关闭该 PID，并确认端口释放。
- [ ] **Step 4: Android 与 WebUI 产物。** 运行 `./scripts/build-daemon.ps1`；在 webui 运行 `npm run build`。核对 ARM64、Android 29、相对资源路径、本地 CSS 与 LF。不把主机测试通过写成设备输入已验证。
- [ ] **Step 5: 打包与逐字节核对。** 调用打包脚本前解析并检查其递归删除目标必须正好为当前仓库的 dist 目录，且不含需要保留的其他文件；若存在其他产物只替换本次同名 ZIP。ZIP 根目录有 module.prop，条目正斜杠且与全部 module 文件逐字节一致；记录大小和 SHA256。
- [ ] **Step 6: 交付检查点。** 审查报告列出六项旧问题的修复／测试证据、新代码审查结论、残余警告和设备待验项；更新计划复选框与续接记录。给出安装包、测试结果和未验证边界；不自动合并或推送。

## 计划自检

- 已将设计 1–7 节映射到配置、识别、生命周期、前端和最终交付六个任务；六项旧缺陷分别落在 Task 1／3。
- 所有权初始化／释放、空配置、失败事务、同步丢失重置、子进程跨重载记录均有对应测试。
- 新接口名称和参数在生产入口、输入接入、运行层和测试迁移任务中一致；原有外部配置与脚本入口保持。
- 执行方式由用户审阅计划时选择；本文件的存在不代表业务实现已完成。
