import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { BindingEditor, type Binding } from "@/components/BindingEditor";
import { AppShell, type ViewId } from "@/components/AppShell";
import { OverviewView } from "@/components/OverviewView";
import { BindingsView } from "@/components/BindingsView";
import { TemplatesView } from "@/components/TemplatesView";
import { DiagnosticsView } from "@/components/DiagnosticsView";
import { toast } from "sonner";
import { parseConfig, serializeConfig, type ParsedConfig } from "@/lib/config";
import { isKsuEnvironment, runShell } from "@/lib/ksu";
import { parseEventsJsonl, parseExplainLog, type ExplainRow, type EventRow } from "@/lib/log";
import { startCmd, statusCmd, stopCmd, saveCmd, parseDaemonResult, templatesReadCmd, templatesSaveCmd, parseTemplateSaveResult } from "@/lib/daemon";
import { mergeCommands, parseTemplates, serializeTemplates, upsertTemplate, removeTemplate, type ShellTemplate } from "@/lib/templates";

const MODDIR = "/data/adb/modules/oplus-sidekey";
function encodeBase64(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}
function fingerprint(c: ParsedConfig): string {
  return JSON.stringify([c.keycode, c.longPressMs, c.windowMs, Object.entries(c.bindings).sort(([a], [b]) => a.localeCompare(b))]);
}
function message(e: unknown): string { return e instanceof Error ? e.message : String(e); }

export default function App() {
  const ksu = isKsuEnvironment();
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [cfg, setCfg] = useState<ParsedConfig>(() => parseConfig(""));
  const [disk, setDisk] = useState("");
  const [configState, setConfigState] = useState<"loading" | "ready" | "error">("loading");
  const [configError, setConfigError] = useState("");
  const [running, setRunning] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"config" | "save" | "service" | "status" | "templates" | null>(null);
  const operation = useRef(false);
  const [saveResult, setSaveResult] = useState<"saved" | "error" | "apply-error">("saved");
  const [editor, setEditor] = useState<{ initial: Binding | null; command?: string } | null>(null);
  const focusTarget = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [templates, setTemplates] = useState<ShellTemplate[]>([]);
  const [templateState, setTemplateState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [templateReadError, setTemplateReadError] = useState("");
  const [templateWriteError, setTemplateWriteError] = useState("");
  const [explain, setExplain] = useState<ExplainRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [logErrors, setLogErrors] = useState<string[]>([]);
  const [logsRead, setLogsRead] = useState(false);
  const [logsBusy, setLogsBusy] = useState(false);
  const logsLock = useRef(false);
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
      if (loaded.errors.length) throw new Error("无效配置：" + loaded.errors.join("、") + "；时间须为 100–800 整数，命令须为单行且最多 511 个 UTF-8 字节");
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
  const initialised = useRef(false);
  useEffect(() => {
    if (!ksu || initialised.current) return;
    initialised.current = true;
    void refreshStatus().then(async () => { if (await loadConfig()) await loadTemplates(true); });
  }, [ksu, loadConfig, refreshStatus, loadTemplates]);

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
        if (templateState !== "ready") throw new Error("请先在 Shell 模板页重新读取模板库");
        await persistTemplates(mergeCommands(templates, Object.values(cfg.bindings), Date.now()));
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
    operation.current = true; setBusy("service");
    try {
      const r = await runShell(running ? stopCmd(MODDIR) : startCmd(MODDIR)); const result = parseDaemonResult(r.stdout);
      if (result === "stopped" || result === "not-running") { setRunning(false); toast.success("侧键服务已停止"); }
      else if (result === "started" || result === "running") { setRunning(true); toast.success("侧键服务已启动"); }
      else toast.error("服务操作失败，状态未改变，请查询状态后重试");
    } catch (e) { toast.error("服务操作失败：" + message(e)); }
    finally { operation.current = false; setBusy(null); }
  };
  const refreshLogs = async () => {
    if (!ksu || logsLock.current) return;
    logsLock.current = true; setLogsBusy(true);
    try {
      const results = await Promise.allSettled([runShell(`tail -n 200 ${MODDIR}/log.txt`), runShell(`tail -n 200 ${MODDIR}/events.jsonl`)]);
      const errors: string[] = [];
      results.forEach((result, i) => {
        const label = i === 0 ? "解释记录" : "原始按压记录";
        if (result.status === "rejected") errors.push(`${label}读取失败：${message(result.reason)}`);
        else if (result.value.errno !== 0) errors.push(`${label}读取失败：${result.value.stderr || result.value.errno}`);
        else if (i === 0) setExplain(parseExplainLog(result.value.stdout)); else setEvents(parseEventsJsonl(result.value.stdout));
      });
      setLogErrors(errors); setLogsRead(true);
    } finally { logsLock.current = false; setLogsBusy(false); }
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
  const stateText = configState !== "ready" ? "配置待加载" : busy === "save" ? "保存中…" : saveResult === "error" ? "保存失败，请重试" : dirty ? "未保存" : saveResult === "apply-error" ? "已保存，但应用请求失败" : "已保存";
  return <AppShell activeView={activeView} onViewChange={setActiveView}>
    <Toaster />
    {!ksu && <p data-test="non-ksu-banner" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-6 text-muted-foreground">非 KSU 环境，当前为界面预览；请在 KernelSU 管理器中打开以配置侧键。</p>}
    {ksu && configState === "loading" && <p role="status" className="text-sm text-muted-foreground">正在加载配置…</p>}
    {ksu && configState === "error" && <div role="alert" className="grid min-w-0 gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm [overflow-wrap:anywhere]"><p>配置加载失败：{configError}</p><Button variant="outline" disabled={!!busy} className="justify-self-start" onClick={() => { void loadConfig().then(loaded => { if (loaded && templateState === "idle") void loadTemplates(true); }); }}>重试加载配置</Button></div>}
    {templateWriteError && (activeView === "bindings" || activeView === "templates") && <p role="alert" className="min-w-0 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-6 text-amber-200 [overflow-wrap:anywhere]">{templateWriteError}</p>}
    {activeView === "overview" && <OverviewView running={running} bindingCount={Object.keys(cfg.bindings).length} templateCount={templates.length} latest={explain.filter(row => row.seq).at(-1)} busy={!!busy} statusBusy={busy === "status"} enabled={ksu} canEdit={canEdit} onToggle={() => void toggleDaemon()} onRefresh={() => void refreshStatus()} onAdd={trigger => openEditor(null, trigger)} onBindings={() => setActiveView("bindings")} onDiagnostics={() => setActiveView("diagnostics")} />}
    {activeView === "bindings" && <BindingsView cfg={cfg} canEdit={canEdit} dirty={dirty} stateText={stateText} saveBusy={busy === "save"} addButton={addButton} onEdit={openEditor} onDelete={seq => { if (!canEdit) return; const bindings = { ...cfg.bindings }; delete bindings[seq]; setCfg({ ...cfg, bindings }); }} onTiming={(key, value) => setCfg({ ...cfg, [key]: value })} onSave={() => void save()} />}
    {activeView === "templates" && <>
      {templateReadError && <p role="alert" className="min-w-0 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive [overflow-wrap:anywhere]">模板读取失败：{templateReadError}。重新读取成功后可继续编辑。</p>}
      {templateState === "loading" && <p role="status" className="text-sm text-muted-foreground">正在读取模板…</p>}
      <TemplatesView templates={templates} busy={!canEditTemplates} reloadDisabled={!ksu || !!busy || configState !== "ready"} onEdit={() => setTemplateWriteError("")} onDelete={id => { void changeTemplate(removeTemplate(templates, id)).catch(e => toast.error("删除失败：" + message(e))); }} onUse={template => { if (!canEdit) return; focusTarget.current = null; setActiveView("bindings"); setEditor({ initial: null, command: template.command }); }} onSave={template => changeTemplate(upsertTemplate(templates, template))} onReload={() => void loadTemplates()} />
    </>}
    {activeView === "diagnostics" && <DiagnosticsView explain={explain} events={events} errors={logErrors} logsRead={logsRead} busy={logsBusy} enabled={ksu} onRefresh={() => void refreshLogs()} />}
    {editor && <BindingEditor open initial={editor.initial} initialCommand={editor.command} templates={templates} bindings={cfg.bindings} disabled={!canEdit} onOpenChange={open => { if (!open) setEditor(null); }} onSubmit={submitBinding} onCloseFocus={() => (focusTarget.current?.isConnected ? focusTarget.current : addButton.current)?.focus()} />}
  </AppShell>;
}
