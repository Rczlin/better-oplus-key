import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { BindingEditor, type Binding, type TestRunResult } from "@/components/BindingEditor";
import { PacksDialog } from "@/components/PacksDialog";
import { AppShell, type ViewId } from "@/components/AppShell";
import { OverviewView } from "@/components/OverviewView";
import { BindingsView } from "@/components/BindingsView";
import { TemplatesView } from "@/components/TemplatesView";
import { DiagnosticsView } from "@/components/DiagnosticsView";
import { toast } from "sonner";
import { parseConfig, serializeConfig, type ParsedConfig } from "@/lib/config";
import { isKsuEnvironment, runShell } from "@/lib/ksu";
import { islandCmd, islandState, parseIslandResult, parseIslandStatus, type IslandState } from "@/lib/island";
import { parseEventsJsonl, parseExplainLog, type ExplainRow, type EventRow } from "@/lib/log";
import { parseOutputJsonl, type OutputRecord } from "@/lib/output";
import { computeMetrics, dashboardCmd, localDate, parseDashboard, todayStats, type KnownSizes, type ServiceMetrics, type ServiceSnapshot, type TodayStats } from "@/lib/service";
import { startCmd, statusCmd, stopCmd, saveCmd, parseDaemonResult, templatesReadCmd, templatesSaveCmd, parseTemplateSaveResult } from "@/lib/daemon";
import { describeCommand, matchPreset, parsePackageList, shellQuote, type Preset, type PresetPack } from "@/lib/presets";
import { mergeCommands, parseTemplates, serializeTemplates, upsertTemplate, removeTemplate, type ShellTemplate } from "@/lib/templates";

const MODDIR = "/data/adb/modules/oplus-sidekey";
const DASHBOARD_INTERVAL_MS = 5000;
const TEST_OUTPUT_LIMIT = 16 * 1024;
function encodeBase64(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}
function fingerprint(c: ParsedConfig): string {
  return JSON.stringify([c.keycode, c.longPressMs, c.windowMs, c.captureOutput !== false, c.islandNotify ?? 0, Object.entries(c.bindings).sort(([a], [b]) => a.localeCompare(b))]);
}
function message(e: unknown): string { return e instanceof Error ? e.message : String(e); }
// 自动收录时，内置动作用动作名称命名，自定义命令沿用“模板 N”。
// 无参数的内置动作已在“内置动作”中，不重复收录进“我的模板”。
function isFixedBuiltin(command: string): boolean {
  return !!matchPreset(command)?.preset.command;
}
function autoTemplateName(command: string): string | undefined {
  const described = describeCommand(command);
  return described.builtin ? described.name : undefined;
}

export default function App() {
  const ksu = isKsuEnvironment();
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [cfg, setCfg] = useState<ParsedConfig>(() => parseConfig(""));
  const [disk, setDisk] = useState("");
  const [configState, setConfigState] = useState<"loading" | "ready" | "error">("loading");
  const [configError, setConfigError] = useState("");
  const [running, setRunning] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"config" | "save" | "service" | "status" | "templates" | "test" | null>(null);
  const operation = useRef(false);
  const [saveResult, setSaveResult] = useState<"saved" | "error" | "apply-error">("saved");
  const [editor, setEditor] = useState<{ initial: Binding | null; command?: string; presetId?: string } | null>(null);
  const [packsOpen, setPacksOpen] = useState(false);
  const focusTarget = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [templates, setTemplates] = useState<ShellTemplate[]>([]);
  const [islandStatus, setIslandStatus] = useState<IslandState | null>(null);
  const [islandBusy, setIslandBusy] = useState(false);
  const islandChecked = useRef(false);
  const [templateState, setTemplateState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [templateReadError, setTemplateReadError] = useState("");
  const [templateWriteError, setTemplateWriteError] = useState("");
  const [explain, setExplain] = useState<ExplainRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [logErrors, setLogErrors] = useState<string[]>([]);
  const [logsRead, setLogsRead] = useState(false);
  const [logsBusy, setLogsBusy] = useState(false);
  const logsLock = useRef(false);
  const [outputs, setOutputs] = useState<OutputRecord[]>([]);
  const [outputAvailable, setOutputAvailable] = useState(false);
  const [snapshot, setSnapshot] = useState<ServiceSnapshot | null>(null);
  const [metrics, setMetrics] = useState<ServiceMetrics | null>(null);
  const dashLock = useRef(false);
  const lastSnapshot = useRef<ServiceSnapshot | null>(null);
  const knownSizes = useRef<KnownSizes>({ log: -1, output: -1 });
  const dashGen = useRef(0);
  const dashQueued = useRef(false);
  const [deviceToday, setDeviceToday] = useState<TodayStats | null>(null);
  const [ready, setReady] = useState(false);
  const canEdit = ksu && configState === "ready" && !busy && templateState !== "idle" && templateState !== "loading";
  const canEditTemplates = canEdit && templateState === "ready";
  const dirty = configState === "ready" && fingerprint(cfg) !== disk;

  const loadConfig = useCallback(async () => {
    if (!ksu || operation.current) return false;
    operation.current = true; setBusy("config"); setConfigState("loading");
    try {
      const r = await runShell(`cat ${MODDIR}/config.conf`);
      if (r.errno !== 0) throw new Error(r.stderr || `读取配置失败：${r.errno}`);
      const loaded = parseConfig(r.stdout);
      if (loaded.errors.length) throw new Error("无效配置：" + loaded.errors.join("、") + "；时间须为 100–800 整数，命令须为单行且最多 4095 个 UTF-8 字节");
      setCfg(loaded); setDisk(fingerprint(loaded)); setConfigState("ready"); setConfigError(""); return true;
    } catch (e) { setConfigError(message(e)); setConfigState("error"); return false; }
    finally { operation.current = false; setBusy(null); }
  }, [ksu]);
  const refreshStatus = useCallback(async () => {
    if (!ksu || operation.current) return;
    operation.current = true; setBusy("status");
    try {
      const r = await runShell(statusCmd(MODDIR)); const result = parseDaemonResult(r.stdout);
      setRunning(result === "running" ? true : result === "stopped" ? false : null);
    } catch { setRunning(null); }
    finally { operation.current = false; setBusy(null); }
  }, [ksu]);
  const loadTemplates = useCallback(async (allowMissing = false) => {
    if (!ksu || operation.current) return;
    operation.current = true; setBusy("templates"); setTemplateState("loading");
    try {
      const r = await runShell(templatesReadCmd(MODDIR));
      if (r.errno !== 0) throw new Error(r.stderr || `读取失败：${r.errno}`);
      const marker = r.stderr.trim();
      if (marker === "templates-empty" || (marker === "templates-missing" && !allowMissing)) {
        throw new Error(marker === "templates-missing" ? "模板文件不存在" : "模板文件为空");
      }
      const loaded = parseTemplates(r.stdout);
      setTemplates(loaded); setTemplateState("ready"); setTemplateReadError("");
    } catch (e) { setTemplateReadError(message(e)); setTemplateState("error"); }
    finally { operation.current = false; setBusy(null); }
  }, [ksu]);
  // 概览数据：一次 shell 调用取回进程详情与今日统计；日志/输出文件大小未变时不重复传输尾部。
  // 独立于 operation 锁，不禁用按钮；状态行缺失时不覆盖已知的运行状态。
  // 启停会使 dashGen 递增，丢弃此前发出、晚到的结果，避免旧状态覆盖新状态。
  const refreshDashboardRef = useRef<() => Promise<void>>(async () => {});
  const refreshDashboard = useCallback(async () => {
    if (!ksu) return;
    if (dashLock.current) { dashQueued.current = true; return; }
    dashLock.current = true;
    const gen = dashGen.current;
    try {
      const r = await runShell(dashboardCmd(MODDIR, knownSizes.current));
      if (r.errno !== 0 || gen !== dashGen.current) return;
      const snap = parseDashboard(r.stdout);
      if (snap.running !== null) setRunning(snap.running);
      setMetrics(computeMetrics(snap, lastSnapshot.current));
      lastSnapshot.current = snap.proc ? snap : null;
      setSnapshot(snap);
      if (snap.today) setDeviceToday(snap.today);
      if (snap.log) { setExplain(snap.log); setLogsRead(true); knownSizes.current.log = snap.sizes["log.txt"]; }
      if (snap.outputs) { setOutputs(snap.outputs); knownSizes.current.output = snap.sizes["output.jsonl"]; }
      if (snap.running !== null) setOutputAvailable(snap.sizes["output.jsonl"] > 0);
    } catch { /* 概览详情读取失败不影响其他功能 */ }
    finally {
      dashLock.current = false;
      if (dashQueued.current) { dashQueued.current = false; void refreshDashboardRef.current(); }
    }
  }, [ksu]);
  useEffect(() => { refreshDashboardRef.current = refreshDashboard; }, [refreshDashboard]);
  const invalidateDashboard = () => { dashGen.current++; lastSnapshot.current = null; };
  const initialised = useRef(false);
  useEffect(() => {
    if (!ksu || initialised.current) return;
    initialised.current = true;
    void refreshStatus().then(async () => { if (await loadConfig()) await loadTemplates(true); }).finally(() => setReady(true));
  }, [ksu, loadConfig, refreshStatus, loadTemplates]);
  // 概览可见且页面在前台时定时刷新；切到后台或其他页面时停止，避免无谓的 root shell 调用。
  useEffect(() => {
    if (!ksu || !ready || activeView !== "overview") return;
    const tick = () => { if (document.visibilityState !== "hidden" && !operation.current) void refreshDashboard(); };
    tick();
    const timer = window.setInterval(tick, DASHBOARD_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [ksu, ready, activeView, refreshDashboard]);

  const persistTemplates = async (next: ShellTemplate[]) => {
    const r = await runShell(templatesSaveCmd(MODDIR, encodeBase64(serializeTemplates(next))));
    if (r.errno !== 0 || parseTemplateSaveResult(r.stdout) !== "templates-saved") throw new Error(r.stderr || "未收到模板保存成功标记");
    setTemplates(next); setTemplateWriteError("");
  };
  const save = async () => {
    if (!canEdit || operation.current) return;
    operation.current = true; setBusy("save");
    try {
      const r = await runShell(saveCmd(MODDIR, encodeBase64(serializeConfig(cfg))));
      const result = parseDaemonResult(r.stdout);
      if (result !== "saved" && result !== "saved-hup-requested" && result !== "saved-hup-failed") throw new Error(r.stderr || String(r.errno || "未收到保存成功标记"));
      setDisk(fingerprint(cfg)); setSaveResult(result === "saved-hup-failed" ? "apply-error" : "saved");
      try {
        if (templateState !== "ready") throw new Error("请先在“模板库”页重新读取模板");
        await persistTemplates(mergeCommands(templates, Object.values(cfg.bindings), Date.now(), autoTemplateName, isFixedBuiltin));
        if (result === "saved-hup-failed") toast.error("配置已保存，但应用请求失败");
        else toast.success(result === "saved" ? "配置已保存，服务未运行" : "配置已保存，已发送应用请求");
      } catch (e) {
        const warning = "配置已保存，但模板同步失败：" + message(e);
        setTemplateWriteError(warning); toast.warning(warning);
        if (result === "saved-hup-failed") toast.error("配置已保存，但应用请求失败");
      }
    } catch (e) { setSaveResult("error"); toast.error("保存失败：" + message(e)); }
    finally { operation.current = false; setBusy(null); }
  };
  const changeTemplate = async (next: ShellTemplate[]) => {
    if (!canEditTemplates || operation.current) throw new Error("请等待当前操作完成，并确保模板库已读取成功");
    operation.current = true; setBusy("templates");
    try { await persistTemplates(next); toast.success("模板库已保存"); }
    catch (e) { setTemplateWriteError("模板保存失败：" + message(e)); throw e; }
    finally { operation.current = false; setBusy(null); }
  };
  const toggleDaemon = async () => {
    if (!ksu || running === null || operation.current) return;
    operation.current = true; setBusy("service"); invalidateDashboard();
    try {
      const r = await runShell(running ? stopCmd(MODDIR) : startCmd(MODDIR)); const result = parseDaemonResult(r.stdout);
      if (result === "stopped" || result === "not-running") { setRunning(false); toast.success("侧键服务已停止"); }
      else if (result === "started" || result === "running") { setRunning(true); toast.success("侧键服务已启动"); }
      else toast.error("服务操作失败，状态未改变，请查询状态后重试");
    } catch (e) { toast.error("服务操作失败：" + message(e)); }
    finally { operation.current = false; setBusy(null); invalidateDashboard(); void refreshDashboard(); }
  };
  const refreshLogs = async () => {
    if (!ksu || logsLock.current) return;
    logsLock.current = true; setLogsBusy(true);
    try {
      const outputFile = `${MODDIR}/output.jsonl`;
      const results = await Promise.allSettled([
        runShell(`tail -n 300 ${MODDIR}/log.txt`),
        runShell(`tail -n 200 ${MODDIR}/events.jsonl`),
        runShell(`if [ -e ${outputFile} ]; then tail -n 100 ${outputFile}; else echo @@missing; fi`),
      ]);
      const errors: string[] = [];
      const labels = ["解释记录", "原始按压记录", "命令输出"];
      results.forEach((result, i) => {
        const label = labels[i];
        if (result.status === "rejected") errors.push(`${label}读取失败：${message(result.reason)}`);
        else if (result.value.errno !== 0) errors.push(`${label}读取失败：${result.value.stderr || result.value.errno}`);
        else if (i === 0) { setExplain(parseExplainLog(result.value.stdout)); knownSizes.current.log = -1; }
        else if (i === 1) setEvents(parseEventsJsonl(result.value.stdout));
        else { const missing = result.value.stdout.trim() === "@@missing"; setOutputAvailable(!missing); setOutputs(missing ? [] : parseOutputJsonl(result.value.stdout)); knownSizes.current.output = -1; }
      });
      setLogErrors(errors); setLogsRead(true);
    } finally { logsLock.current = false; setLogsBusy(false); }
  };
  // 流体云组件：进入“绑定”页时检查一次状态；安装、测试由用户点击触发。
  const refreshIsland = useCallback(async () => {
    try {
      const status = parseIslandStatus((await runShell(islandCmd(MODDIR, "status"))).stdout);
      setIslandStatus(status ? islandState(status) : null);
    } catch { setIslandStatus(null); }
  }, []);
  useEffect(() => {
    if (!ksu || activeView !== "bindings" || islandChecked.current) return;
    islandChecked.current = true;
    void refreshIsland();
  }, [ksu, activeView, refreshIsland]);
  const installIsland = async () => {
    setIslandBusy(true);
    try {
      const result = parseIslandResult((await runShell(islandCmd(MODDIR, "install"))).stdout);
      if (result.kind === "installed") toast.success("流体云组件已就绪");
      else if (result.kind === "missing-apk") toast.error("当前模块包不含流体云组件");
      else toast.error("组件安装失败：" + (result.kind === "failed" ? result.error : result.kind));
    } catch (e) { toast.error("组件安装失败：" + message(e)); }
    finally { await refreshIsland(); setIslandBusy(false); }
  };
  const testIsland = async () => {
    setIslandBusy(true);
    try {
      const result = parseIslandResult((await runShell(islandCmd(MODDIR, "test"))).stdout);
      if (result.kind === "sent") toast.success("已发送测试提示，请看屏幕顶部的流体云");
      else toast.error("测试提示发送失败：" + (result.kind === "failed" ? result.error : result.kind));
    } catch (e) { toast.error("测试提示发送失败：" + message(e)); }
    finally { setIslandBusy(false); }
  };
  const listPackages = async () => {
    const r = await runShell("pm list packages -3");
    if (r.errno !== 0) throw new Error(r.stderr || `读取失败：${r.errno}`);
    return parsePackageList(r.stdout);
  };
  // 试运行：由用户主动点击，真实执行一次命令；输出截断后展示。
  // 限时 10 秒，避免常驻命令卡住界面；与保存、启停互斥。am 等命令失败时退出码仍为 0，需检查输出。
  const testRun = async (command: string): Promise<TestRunResult> => {
    if (operation.current) return { ok: false, message: "请等待当前操作完成后再试运行" };
    operation.current = true; setBusy("test");
    try {
      // stderr 合并到 stdout，保持与侧键触发时相同的输出顺序；完整输出最多展示 16 KB。
      const r = await runShell(`timeout 10 sh -c ${shellQuote(command)} 2>&1`);
      const raw = (r.stdout + (r.stderr ? (r.stdout ? "\n" : "") + r.stderr : "")).trimEnd();
      // 截断时避免切开代理对（emoji 等）
      let cut = TEST_OUTPUT_LIMIT;
      if (raw.length > cut && /[\uD800-\uDBFF]/.test(raw[cut - 1])) cut--;
      const output = raw.length > TEST_OUTPUT_LIMIT ? raw.slice(0, cut) + "\n…输出过长，已截断" : raw;
      const lines = raw ? raw.split("\n").length : 0;
      const summary = lines ? `输出 ${lines} 行，见下方。` : "命令没有输出。";
      if (r.errno === 124 || r.errno === 143) return { ok: false, message: "命令超过 10 秒仍未结束，已停止。绑定后由侧键触发时不受此限制。", output };
      if (r.errno !== 0) return { ok: false, message: `执行失败，退出码 ${r.errno}。${summary}`, output };
      if (/\bError\b|Exception/.test(raw)) return { ok: false, message: "命令返回成功，但输出包含错误。", output };
      return { ok: true, message: "已执行，退出码 0。" + (lines ? summary : "请看手机上是否出现预期效果。"), output };
    } finally { operation.current = false; setBusy(null); }
  };
  const applyPackDraft = (bindings: Record<string, string>, pack: PresetPack) => {
    if (!canEdit) return;
    setCfg(c => ({ ...c, bindings })); setPacksOpen(false); setActiveView("bindings");
    toast.success(`已套用“${pack.name}”，点“保存配置”后生效`);
  };
  const startWithPreset = (preset: Preset) => {
    if (!canEdit) return;
    focusTarget.current = null; setActiveView("bindings");
    setEditor({ initial: null, command: preset.command, presetId: preset.id });
  };
  const openEditor = (initial: Binding | null, trigger: HTMLElement) => {
    if (!canEdit) return;
    focusTarget.current = trigger; setEditor({ initial }); setActiveView("bindings");
  };
  const submitBinding = (binding: Binding) => {
    if (!canEdit) return;
    const bindings = { ...cfg.bindings };
    if (editor?.initial) delete bindings[editor.initial.sequence];
    bindings[binding.sequence] = binding.command;
    const next = { ...cfg, bindings }; serializeConfig(next); setCfg(next); setEditor(null);
  };
  const today = useMemo(() => deviceToday ?? (logsRead ? todayStats(explain, localDate()) : undefined), [deviceToday, explain, logsRead]);
  const latestRow = useMemo(() => explain.filter(row => row.seq).at(-1), [explain]);
  const latestOutput = outputs.at(-1);
  const stateText = configState !== "ready" ? "配置待加载" : busy === "save" ? "保存中…" : saveResult === "error" ? "保存失败，请重试" : dirty ? "未保存" : saveResult === "apply-error" ? "已保存，但应用请求失败" : "已保存";
  return <AppShell activeView={activeView} onViewChange={setActiveView}>
    <Toaster />
    {!ksu && <p data-test="non-ksu-banner" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-6 text-muted-foreground">非 KSU 环境，当前为界面预览；请在 KernelSU 管理器中打开以配置侧键。</p>}
    {ksu && configState === "loading" && <p role="status" className="text-sm text-muted-foreground">正在加载配置…</p>}
    {ksu && configState === "error" && <div role="alert" className="grid min-w-0 gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm [overflow-wrap:anywhere]"><p>配置加载失败：{configError}</p><Button variant="outline" disabled={!!busy} className="justify-self-start" onClick={() => { void loadConfig().then(loaded => { if (loaded && templateState === "idle") void loadTemplates(true); }); }}>重试加载配置</Button></div>}
    {templateWriteError && (activeView === "bindings" || activeView === "templates") && <p role="alert" className="min-w-0 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-6 text-amber-200 [overflow-wrap:anywhere]">{templateWriteError}</p>}
    {dirty && activeView !== "bindings" && <div role="status" data-testid="unsaved-banner" className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-200"><span>有未保存的修改，保存后才会生效。</span><Button size="sm" disabled={!canEdit} onClick={() => void save()}>{busy === "save" ? "保存中…" : "立即保存"}</Button></div>}
    {activeView === "overview" && <OverviewView running={running} bindingCount={Object.keys(cfg.bindings).length} templateCount={templates.length} latest={latestRow} latestOutput={latestOutput && (!latestRow || latestOutput.time >= latestRow.time) ? latestOutput : undefined} snapshot={snapshot} metrics={metrics} today={today} templates={templates} autoRefresh={ksu} busy={!!busy} statusBusy={busy === "status"} enabled={ksu} canEdit={canEdit} onToggle={() => void toggleDaemon()} onRefresh={() => { void refreshStatus().then(() => refreshDashboard()); }} onAdd={trigger => openEditor(null, trigger)} onPacks={() => setPacksOpen(true)} onBindings={() => setActiveView("bindings")} onDiagnostics={() => setActiveView("diagnostics")} />}
    {activeView === "bindings" && <BindingsView cfg={cfg} templates={templates} onPacks={() => setPacksOpen(true)} canEdit={canEdit} dirty={dirty} stateText={stateText} saveBusy={busy === "save"} addButton={addButton} onEdit={openEditor} onDelete={seq => { if (!canEdit) return; const bindings = { ...cfg.bindings }; delete bindings[seq]; setCfg({ ...cfg, bindings }); }} onTiming={(key, value) => setCfg(c => ({ ...c, [key]: value }))} onCaptureOutput={value => setCfg(c => ({ ...c, captureOutput: value }))} onIslandNotify={value => setCfg(c => ({ ...c, islandNotify: value }))} island={ksu ? { state: islandStatus, busy: islandBusy, onInstall: () => void installIsland(), onTest: () => void testIsland() } : undefined} onSave={() => void save()} />}
    {activeView === "templates" && <>
      {templateReadError && <p role="alert" className="min-w-0 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive [overflow-wrap:anywhere]">模板读取失败：{templateReadError}。重新读取成功后可继续编辑。</p>}
      {templateState === "loading" && <p role="status" className="text-sm text-muted-foreground">正在读取模板…</p>}
      <TemplatesView templates={templates} busy={!canEditTemplates} useDisabled={!canEdit} onUsePreset={startWithPreset} reloadDisabled={!ksu || !!busy || configState !== "ready"} onEdit={() => setTemplateWriteError("")} onDelete={id => { void changeTemplate(removeTemplate(templates, id)).catch(e => toast.error("删除失败：" + message(e))); }} onUse={template => { if (!canEdit) return; focusTarget.current = null; setActiveView("bindings"); setEditor({ initial: null, command: template.command }); }} onSave={template => changeTemplate(upsertTemplate(templates, template))} onReload={() => void loadTemplates()} />
    </>}
    {activeView === "diagnostics" && <DiagnosticsView templates={templates} explain={explain} events={events} outputs={outputs} outputAvailable={outputAvailable} errors={logErrors} logsRead={logsRead} busy={logsBusy} enabled={ksu} onRefresh={() => void refreshLogs()} />}
    {editor && <BindingEditor open initial={editor.initial} initialCommand={editor.command} initialPresetId={editor.presetId} windowMs={cfg.windowMs} longPressMs={cfg.longPressMs} onListPackages={listPackages} onTestRun={testRun} templates={templates} bindings={cfg.bindings} disabled={!canEdit} onOpenChange={open => { if (!open) setEditor(null); }} onSubmit={submitBinding} onCloseFocus={() => (focusTarget.current?.isConnected ? focusTarget.current : addButton.current)?.focus()} />}
    <PacksDialog open={packsOpen} bindings={cfg.bindings} disabled={!canEdit} onOpenChange={setPacksOpen} onApply={applyPackDraft} />
  </AppShell>;
}
