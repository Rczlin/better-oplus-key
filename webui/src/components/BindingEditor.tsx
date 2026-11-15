import { useState } from "react";
import { SequenceGlyph } from "./SequenceGlyph";
import { Dialog } from "radix-ui";
import { Play, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ActionPicker } from "./ActionPicker";
import { sheetContent, sheetOverlay } from "./ui/ios";
import { sequenceLabel, validateCommand, MAX_COMMAND_BYTES } from "@/lib/config";
import { prefixConflicts } from "@/lib/presets";
import { isMultiline, toEditableCommand, toStoredCommand } from "@/lib/script";
import { cn } from "@/lib/utils";
import type { ShellTemplate } from "@/lib/templates";

export interface Binding { sequence: string; command: string }
export interface TestRunResult { ok: boolean; message: string; output?: string }
interface Props {
  open: boolean;
  initial: Binding | null;
  initialCommand?: string;
  initialPresetId?: string;
  templates?: ShellTemplate[];
  onUseTemplate?(command: string): void;
  bindings: Record<string, string>;
  disabled: boolean;
  windowMs?: number;
  longPressMs?: number;
  onListPackages?: () => Promise<string[]>;
  onTestRun?: (command: string) => Promise<TestRunResult>;
  onOpenChange(open: boolean): void;
  onSubmit(binding: Binding): void;
  onCloseFocus(): void;
}

// 常用组合：一键填入，降低“短按/长按”拼装的理解成本。
const QUICK_SEQUENCES = [
  { seq: "0", label: "单击" },
  { seq: "00", label: "双击" },
  { seq: "000", label: "三击" },
  { seq: "1", label: "单次长按" },
  { seq: "01", label: "短按+长按" },
];
const encoder = new TextEncoder();

export function BindingEditor({ open, initial, initialCommand, initialPresetId, templates = [], onUseTemplate, bindings, disabled, windowMs = 300, longPressMs = 300, onListPackages, onTestRun, onOpenChange, onSubmit, onCloseFocus }: Props) {
  const [sequence, setSequence] = useState(initial?.sequence ?? "");
  const startCommand = initial?.command ?? initialCommand ?? "";
  // command 为编辑器中的文本（多行脚本已解码）；stored 为实际写入配置的单行命令。
  const [command, setCommand] = useState(() => toEditableCommand(startCommand));
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestRunResult | null>(null);
  const updateSequence = (s: string) => { setSequence(s); setError(""); };
  const updateCommand = (c: string) => { setCommand(c); setError(""); setTestResult(null); };
  const stored = toStoredCommand(command);
  const multiline = isMultiline(command);
  const bytes = encoder.encode(stored).length;
  const lineCount = command.split("\n").length;
  const invalidMessage = `命令最多 ${MAX_COMMAND_BYTES} 个 UTF-8 字节（多行脚本按编码后计算），不能含 NUL`;
  const conflicts = prefixConflicts(sequence, bindings, initial?.sequence);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || !sequence || !command) return;
    if (sequence !== initial?.sequence && Object.hasOwn(bindings, sequence)) {
      setError("这个按压组合已存在，请编辑原绑定或更换组合"); return;
    }
    if (!validateCommand(stored)) { setError(invalidMessage); return; }
    try { onSubmit({ sequence, command: stored }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const testRun = async () => {
    if (!onTestRun || testing || !command) return;
    if (!validateCommand(stored)) { setError(invalidMessage); return; }
    setTesting(true); setTestResult(null);
    try { setTestResult(await onTestRun(stored)); }
    catch (e) { setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) }); }
    finally { setTesting(false); }
  };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className={sheetOverlay} />
      <Dialog.Content onCloseAutoFocus={e => { e.preventDefault(); onCloseFocus(); }} className={sheetContent}>
        <form onSubmit={submit} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="material sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border/60 px-2 pt-4 pb-2.5 sm:pt-3">
            <Dialog.Close asChild><Button type="button" variant="ghost" className="justify-self-start text-[16px] font-normal" disabled={disabled}>取消</Button></Dialog.Close>
            <Dialog.Title className="text-[17px] font-semibold">{initial ? "编辑绑定" : "新增绑定"}</Dialog.Title>
            <Button type="submit" variant="ghost" className="justify-self-end text-[16px] font-semibold" disabled={disabled || !sequence || !command}>{initial ? "更新绑定" : "添加绑定"}</Button>
          </header>
          <div className="grid min-h-0 min-w-0 flex-1 content-start gap-6 overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:px-5">
            <Dialog.Description className="px-1 text-[14px] text-muted-foreground">两步完成：先选按压方式，再选要执行的动作。</Dialog.Description>
            <section className="grid min-w-0 gap-1.5">
              <h3 className="px-4 text-[13px] font-medium text-muted-foreground">① 按压方式</h3>
              <div className="grid min-w-0 gap-4 rounded-2xl bg-card p-4">
                <div role="group" aria-label="常用组合" className="segmented">
                  {QUICK_SEQUENCES.map(q => <button key={q.seq} type="button" className="segmented-item disabled:opacity-45" aria-pressed={sequence === q.seq} disabled={disabled} onClick={() => updateSequence(q.seq)}>{q.label}</button>)}
                </div>
                <div data-testid="sequence-preview" aria-live="polite" className="grid min-h-24 min-w-0 place-items-center gap-2 overflow-auto rounded-xl bg-muted px-3 py-4 text-center text-[15px] [overflow-wrap:anywhere]">
                  {sequence ? <><SequenceGlyph seq={sequence} className="flex-wrap justify-center" /><p className="min-w-0 font-medium">{sequenceLabel(sequence)}</p><p className="font-mono text-[12px] text-muted-foreground">编码 {sequence} · {sequence.length} 次按压</p></> : <span className="text-muted-foreground">选择常用组合，或点击“短按”“长按”组成按压顺序</span>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="secondary" size="lg" disabled={disabled} onClick={() => updateSequence(sequence + "0")}>短按</Button>
                  <Button type="button" variant="secondary" size="lg" disabled={disabled} onClick={() => updateSequence(sequence + "1")}>长按</Button>
                  <Button type="button" variant="outline" disabled={disabled || !sequence} onClick={() => updateSequence(sequence.slice(0, -1))}>撤回一步</Button>
                  <Button type="button" variant="outline" disabled={disabled || !sequence} onClick={() => updateSequence("")}>清空组合</Button>
                </div>
              </div>
              <p className="px-4 text-[13px] leading-[1.45] text-muted-foreground">短按：轻按后马上松开。长按：按住超过 {longPressMs} 毫秒再松开。时长可在“时间设置”中调整。</p>
              {(conflicts.longer.length > 0 || conflicts.shorter.length > 0) && <p data-testid="prefix-hint" className="mt-1 flex gap-2 rounded-2xl bg-ios-orange/12 px-4 py-3 text-[13px] leading-5 [overflow-wrap:anywhere]"><Info className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>{conflicts.longer.length > 0
                  ? `已有以它开头的更长组合（${conflicts.longer.map(sequenceLabel).join("；")}），这个组合会多等约 ${windowMs} 毫秒确认你不再继续按，然后执行。`
                  : `已有较短组合（${conflicts.shorter.map(sequenceLabel).join("；")}）。添加后，它们会多等约 ${windowMs} 毫秒再执行，以便区分。`}</span></p>}
            </section>
            <section className="grid min-w-0 gap-1.5">
              <h3 className="px-4 text-[13px] font-medium text-muted-foreground">② 要执行的动作</h3>
              <ActionPicker initialCommand={startCommand} initialPresetId={initialPresetId} command={stored} disabled={disabled} onCommand={updateCommand} onListPackages={onListPackages} />
            </section>
            <section className="grid min-w-0 gap-1.5">
              <div className="flex flex-wrap items-end justify-between gap-2 px-4"><Label htmlFor="binding-command" className="text-[13px] font-medium text-muted-foreground">Shell 命令</Label>{multiline && <span data-testid="script-badge" className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">多行脚本 · {lineCount} 行</span>}</div>
              <div className="grid min-w-0 gap-3 rounded-2xl bg-card p-3">
                {templates.length > 0 && <div className="grid gap-1.5"><Label htmlFor="binding-template" className="px-1 text-[13px] text-muted-foreground">从我的模板填入</Label><select id="binding-template" value="" disabled={disabled} className="h-11 min-w-0 w-full rounded-xl bg-secondary px-3 text-[15px] outline-none focus-visible:ring-3 focus-visible:ring-ring" onChange={e => { const selected = templates.find(t => t.id === e.target.value); if (selected) { updateCommand(toEditableCommand(selected.command)); onUseTemplate?.(selected.command); } }}><option value="">选择已保存的模板…</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>}
                <textarea id="binding-command" rows={Math.min(14, Math.max(3, lineCount + 1))} spellCheck={false} autoCapitalize="off" autoCorrect="off" className="w-full min-w-0 resize-y rounded-xl bg-code p-3 font-mono text-[13px] leading-5 outline-none placeholder:text-tertiary-foreground focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50 [overflow-wrap:anywhere]" value={command} disabled={disabled} placeholder={"选择上方动作会自动填写；也可以直接输入命令或多行脚本，例如：\ninput keyevent 3"}
                  onChange={e => updateCommand(e.target.value)} aria-describedby="command-help" />
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <p className={cn("text-[12px] tabular-nums", bytes > MAX_COMMAND_BYTES ? "text-destructive" : "text-muted-foreground")}>{bytes} / {MAX_COMMAND_BYTES} 字节{multiline ? "（编码后）" : ""}</p>
                  {onTestRun && <Button type="button" size="sm" variant="secondary" disabled={disabled || testing || !command} onClick={() => void testRun()} title="立即执行一次这条命令，用来确认效果"><Play />{testing ? "运行中…" : "试运行"}</Button>}
                </div>
                {testResult && <div data-testid="test-run-result" aria-live="polite" className={cn("grid min-w-0 gap-2 rounded-xl px-3 py-2.5 text-[13px] leading-5 [overflow-wrap:anywhere]", testResult.ok ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive")}>
                  <p className="font-medium">{testResult.message}</p>
                  {testResult.output && <pre data-testid="test-run-output" className="max-h-60 min-w-0 max-w-full overflow-auto rounded-lg bg-code p-2 font-mono text-[11px] leading-5 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{testResult.output}</pre>}
                </div>}
              </div>
              <p id="command-help" data-test="warning-root" className="px-4 text-[13px] leading-[1.45] text-muted-foreground">命令以 root 权限执行，请确认内容可信。支持多行脚本（自动编码为一行保存），最多 {MAX_COMMAND_BYTES} 个 UTF-8 字节；中文通常占 3 字节。{onTestRun && <span className="text-warning">“试运行”会以 root 立即真实执行一次命令。</span>}</p>
            </section>
            {error && <p role="alert" className="rounded-2xl bg-destructive/12 px-4 py-3 text-[14px] text-destructive">{error}</p>}
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
