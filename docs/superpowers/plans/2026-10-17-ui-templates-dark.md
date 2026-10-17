# 深色多视图界面与 Shell 模板实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将当前单页侧键设置改造成深色四视图界面，加入持久化 Shell 模板，并让长命令与长日志局部展开或滚动而不撑破页面。

**Architecture:** 保留单个 Vite/React 应用和现有 KernelSU bridge，通过 `activeView` 在概览、绑定、Shell 模板、诊断四个视图间切换，不引入路由依赖。新增模板格式模块与 bridge 命令，模板写入模块目录下的 `templates.json`；共享命令预览和日志行组件负责所有长文本布局。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、Testing Library、Tailwind CSS v4、Radix UI、Lucide、Sonner、现有 KernelSU `exec` bridge。

**Spec:** `docs/superpowers/specs/2026-10-17-ui-templates-dark-design.md`

## Global Constraints

- 不引入 React Router 或新的运行时依赖；使用受控 `activeView`。
- 模板文件固定为 `/data/adb/modules/oplus-sidekey/templates.json`，UTF-8 JSON 数组，文件上限 64 KiB。
- Shell 命令保持单行、无 NUL、最多 511 个 UTF-8 字节；模板名称拒绝换行/NUL，最多 128 个 UTF-8 字节。
- 相同命令只保留一个模板；保存配置成功后才自动收录，模板失败不回滚已保存配置。
- `config.conf`、守护进程输入协议、日志文件格式和服务脚本行为保持兼容。
- 桌面使用左侧导航，390px 窄屏使用底部导航；所有长文本容器必须有 `min-width: 0` 和局部溢出策略。
- 不执行用户 Shell 命令；浏览器测试使用假的 `ksu.exec`。

## Review Focus

- 模板文件损坏或缺失时，页面不能清空已有内存模板；测试 `parseTemplates` 错误保护和首次缺失视为空数组。
- 自动收录发生在配置保存成功之后；测试配置保存失败和模板写入失败不会误报为完整成功。
- 两个模板编辑成同一命令时必须拒绝第二个 ID；测试去重和名称/ID保留规则。
- 511 字节命令、128 字节名称、长日志动作和长 JSON 都不能造成页面级横向溢出；测试边界输入和容器类名。
- 模板写入 Shell bridge 必须使用临时文件后 `mv`，测试生成命令包含 base64、临时文件和失败清理路径。

---

### Task 1: 模板数据模型与安全读写命令

**Files:**
- Create: `webui/src/lib/templates.ts`
- Create: `webui/tests/templates.test.ts`
- Modify: `webui/src/lib/daemon.ts`
- Modify: `webui/tests/daemon.test.ts`

**Interfaces:**
- Produces `ShellTemplate`, `parseTemplates(text: string): ShellTemplate[]` (throws a user-readable validation error), `serializeTemplates(templates: ShellTemplate[]): string`, `mergeCommands(templates: ShellTemplate[], commands: string[], now: number): ShellTemplate[]`, `upsertTemplate(templates: ShellTemplate[], input: ShellTemplate): ShellTemplate[]` (throws on another-ID command collision), and `removeTemplate(templates: ShellTemplate[], id: string): ShellTemplate[]`.
- Produces `templatesReadCmd(moddir: string): string`, `templatesSaveCmd(moddir: string, base64: string): string`, and `parseTemplateSaveResult(stdout: string): "templates-saved" | "templates-failed" | null`.
- `ShellTemplate` fields are `{ id: string; name: string; command: string; updatedAt: number }`.

- [ ] **Step 1: Write failing template tests**
  - Cover JSON round-trip, missing file text `""` as empty list, malformed JSON rejection, field validation, command byte limit, name byte limit, NUL/newline rejection, 64 KiB serialized limit, duplicate command last-entry behavior, automatic merge preserving an existing ID/name, collision rejection, and deletion.

- [ ] **Step 2: Run the focused test file and verify it fails**

Run: `npm test -- --run tests/templates.test.ts` from `webui/`  
Expected: FAIL because the template module does not exist.

- [ ] **Step 3: Implement the template module**
  - Reuse `validateCommand` and UTF-8 byte counting from `config.ts`.
  - Generate IDs with `crypto.randomUUID()` and use a deterministic timestamp/counter fallback in tests.
  - Keep the last occurrence of duplicate commands when parsing; `upsertTemplate` rejects a command collision with another ID.
  - Make `serializeTemplates` throw a user-readable error when the encoded JSON exceeds 64 KiB.

- [ ] **Step 4: Add and test bridge commands**
  - `templatesReadCmd` prints `[]` when the file does not exist and otherwise cats it.
  - `templatesSaveCmd` decodes a base64 payload into `templates.json.XXXXXX`, moves it atomically, prints `templates-saved`, and removes the temporary file on failure.
  - Keep the existing daemon result parser unchanged for service/config markers; parse template markers separately.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- --run tests/templates.test.ts tests/daemon.test.ts`  
Expected: all focused tests pass.  
Commit: `feat: add persistent shell template storage`.

### Task 2: Shared command and log presentation components

**Files:**
- Create: `webui/src/components/CommandPreview.tsx`
- Create: `webui/src/components/LogRows.tsx`
- Modify: `webui/src/lib/log.ts`
- Create: `webui/tests/log-view.test.tsx`

**Interfaces:**
- `CommandPreview` props: `{ command: string; testId?: string; className?: string }`; renders a bounded summary, an expand/collapse control, and the full command inside a local wrapping container.
- `LogRows` props: `{ rows: ExplainRow[]; logsRead: boolean; onOpen?: (row: ExplainRow) => void }`; renders structured rows with local expansion and empty state.
- `formatExplainRow(row: ExplainRow): { resultLabel: string; summary: string }` is a pure helper exported from `log.ts`.

- [ ] **Step 1: Write failing component tests**
  - Render commands longer than 511 bytes and assert the page container keeps `min-w-0`, the summary is bounded, and the full command is hidden until expansion.
  - Render a long action and malformed/empty log rows; assert local expansion, result labels, and empty state.

- [ ] **Step 2: Implement bounded layout components**
  - Use `min-w-0`, `max-w-full`, `overflow-wrap:anywhere`, and local `overflow-auto`; never put raw command text directly in a flex row.
  - Keep raw event JSON outside this component in a fixed-height `<pre>` with internal horizontal scrolling.

- [ ] **Step 3: Run the focused tests and commit**

Run: `npm test -- --run tests/log-view.test.tsx`  
Expected: all focused tests pass.  
Commit: `feat: contain long commands and log rows`.

### Task 3: Four-view application shell and template workflow

**Files:**
- Create: `webui/src/components/AppShell.tsx`
- Create: `webui/src/components/OverviewView.tsx`
- Create: `webui/src/components/BindingsView.tsx`
- Create: `webui/src/components/TemplatesView.tsx`
- Create: `webui/src/components/DiagnosticsView.tsx`
- Modify: `webui/src/App.tsx`
- Modify: `webui/src/components/BindingEditor.tsx`
- Modify: `webui/tests/app.test.tsx`
- Create: `webui/tests/templates-view.test.tsx`

**Interfaces:**
- `AppShell` props: `{ activeView: ViewId; onViewChange(view: ViewId): void; children: React.ReactNode }` where `ViewId` is `"overview" | "bindings" | "templates" | "diagnostics"`.
- `TemplatesView` consumes `templates`, `busy`, `onEdit(id: string)`, `onDelete(id: string)`, `onUse(template: ShellTemplate)`, `onSave(template: ShellTemplate)`, and `onReload()` callbacks; it never calls `runShell` directly.
- `BindingEditor` accepts optional `templates: ShellTemplate[]` and `onUseTemplate(command: string): void` without changing existing sequence validation.

- [ ] **Step 1: Add failing navigation and template workflow tests**
  - Assert desktop/mobile navigation switches the four views and preserves the current config draft.
  - Assert successful config save calls template merge/write with every configured command.
  - Assert config save failure does not write templates; template write failure reports a separate warning while retaining saved config.
  - Assert selecting a template fills the binding command, editing/deleting a template updates the library, and duplicate commands are rejected.

- [ ] **Step 2: Extract shared state from `App.tsx`**
  - Keep config/service/log operation locks in `App`; expose callbacks to views.
  - Load templates once after config initialization; treat missing file as empty and malformed data as a recoverable template error.
  - Add `activeView` state with overview as the initial view and no URL dependency.

- [ ] **Step 3: Implement the four views and shell**
  - Overview shows service status, counts, latest result and primary actions.
  - Bindings owns binding cards, editor launch, save status and advanced timing controls.
  - Templates owns search, edit/name/command form, delete and apply-to-editor behavior; `onUse` navigates to Bindings and opens the editor with the selected command prefilled.
  - Diagnostics owns the two tabs, `LogRows`, bounded raw JSON panel, refresh state and errors.

- [ ] **Step 4: Integrate template persistence after successful config save**
  - Serialize current templates after the daemon returns `saved`, `saved-hup-requested`, or `saved-hup-failed`.
  - Show “配置已保存，但模板同步失败” when the config succeeded and template write failed; do not mark the config save as failed.

- [ ] **Step 5: Run focused UI tests and commit**

Run: `npm test -- --run tests/app.test.tsx tests/templates-view.test.tsx`  
Expected: navigation, save ordering, template operations and error states pass.  
Commit: `feat: add multi-view shell and template workflow`.

### Task 4: Dark theme and responsive layout

**Files:**
- Modify: `webui/src/index.css`
- Modify: `webui/src/components/ui/sonner.tsx`
- Modify: `webui/index.html`
- Modify: view/component files from Task 3 as needed for layout classes

**Interfaces:**
- `document.documentElement` receives the permanent `dark` class before the React tree renders.
- Sonner uses `theme="dark"` and the same popover/border variables as the fixed theme.

- [ ] **Step 1: Write responsive assertions**
  - Extend UI tests to assert navigation labels remain available at 390px and long command/log containers include local overflow classes.

- [ ] **Step 2: Implement dark tokens and responsive shell**
  - Use deep blue-black background, layered cards, blue-purple primary, green success, amber warning and red error tokens.
  - Use desktop rail and narrow-screen bottom navigation with shared active state; preserve visible focus rings and text labels.

- [ ] **Step 3: Run frontend checks and commit**

Run: `npm test -- --run`; `npm run lint`; `npx tsc -b --pretty false`; `npm run build`  
Expected: all tests pass, TypeScript/build succeed, lint has no new errors.  
Commit: `feat: apply dark responsive interface`.

### Task 5: Full verification, browser acceptance and independent review

**Files:**
- Modify: `module/webroot/` generated assets through `npm run build`
- Modify: `.superpowers/sdd/2026-10-17-dynamic-bindings/progress.md` with final evidence

- [ ] **Step 1: Run C and sanitizer regression suites**

Run in the existing WSL build paths:
`wsl.exe bash -lc 'cd /mnt/l/C/better-oplus-key && cmake --build build/host --parallel 4 && ctest --test-dir build/host --output-on-failure'`  
`wsl.exe bash -lc 'cd /mnt/l/C/better-oplus-key && cmake --build build/host-sanitize --parallel 4 && ASAN_OPTIONS=detect_leaks=1 ctest --test-dir build/host-sanitize --output-on-failure'`  
Expected: all C tests pass in both builds.

- [ ] **Step 2: Run shell syntax and Android build checks**

Run: `sh -n module/service.sh && sh -n module/customize.sh && sh -n module/uninstall.sh`; `scripts/build-daemon.ps1`  
Expected: syntax checks and Android ARM64 build pass; module binary matches the build output.

- [ ] **Step 3: Perform browser acceptance**

Start a temporary preview server on a non-service port. Verify desktop and 390px layouts, long command/log containment, all four views, template auto-save after config save, template edit/delete/apply, status feedback, and empty/error states. Record browser console errors and stop only the temporary server before completion.

- [ ] **Step 4: Package and inspect**

Run `scripts/package-module.ps1`; verify ZIP root entries, forward slashes, `templates`-free module compatibility, file hashes against `module/`, and SHA256. Do not touch any user server or device service.

- [ ] **Step 5: Request independent review and resolve findings**

Review focus: template write atomicity, save ordering, duplicate handling, log overflow boundaries, mobile navigation and dark-theme contrast. Resolve any Critical/Important/Minor findings before claiming completion.

- [ ] **Step 6: Update the SDD ledger and final report**

Record test counts, browser result, package hash, temporary server shutdown and remaining device-only acceptance boundaries. Leave the user's pre-existing worktree changes intact unless explicitly requested otherwise.
