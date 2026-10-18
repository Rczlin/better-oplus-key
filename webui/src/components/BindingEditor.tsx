import { useState } from "react";
import { Dialog } from "radix-ui";
import { Play, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ActionPicker } from "./ActionPicker";
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
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55" />
      <Dialog.Content onCloseAutoFocus={e => { e.preventDefault(); onCloseFocus(); }}
        className="fixed left-1/2 top-1/2 z-50 max-h-[92dvh] min-w-0 w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-4 shadow-2xl sm:p-6">
        <Dialog.Title className="text-lg font-semibold">{initial ? "编辑绑定" : "新增绑定"}</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-muted-foreground">两步完成：先选按压方式，再选要执行的动作。</Dialog.Description>
        <form onSubmit={submit} className="mt-5 grid min-w-0 gap-5">
          <section className="grid min-w-0 gap-3">
            <h3 className="text-sm font-semibold"><span className="mr-2 text-primary">1</span>按压方式</h3>
            <div role="group" aria-label="常用组合" className="flex flex-wrap gap-2">
              {QUICK_SEQUENCES.map(q => <Button key={q.seq} type="button" size="sm" variant={sequence === q.seq ? "secondary" : "outline"} aria-pressed={sequence === q.seq} disabled={disabled} onClick={() => updateSequence(q.seq)}>{q.label}</Button>)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">或逐步组合：</span>
              <Button type="button" disabled={disabled} onClick={() => updateSequence(sequence + "0")}>短按</Button>
              <Button type="button" disabled={disabled} onClick={() => updateSequence(sequence + "1")}>长按</Button>
              <Button type="button" variant="outline" disabled={disabled || !sequence} onClick={() => updateSequence(sequence.slice(0, -1))}>撤回一步</Button>
              <Button type="button" variant="ghost" disabled={disabled || !sequence} onClick={() => updateSequence("")}>清空组合</Button>
            </div>
            <div data-testid="sequence-preview" aria-live="polite" className="max-h-40 min-w-0 overflow-auto rounded-lg bg-muted p-3 text-sm [overflow-wrap:anywhere]">
              {sequence ? <><p>{sequenceLabel(sequence)}</p><p className="mt-2 font-mono text-xs text-muted-foreground">编码 {sequence} · {sequence.length} 次按压</p></> : "选择常用组合，或点击“短按”“长按”组成按压顺序"}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">短按：轻按后马上松开。长按：按住超过 {longPressMs} 毫秒再松开。时长可在“时间设置”中调整。</p>
            {(conflicts.longer.length > 0 || conflicts.shorter.length > 0) && <p data-testid="prefix-hint" className="flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-2.5 text-xs leading-5 text-amber-200 [overflow-wrap:anywhere]"><Info className="mt-0.5 size-3.5 shrink-0" />
              <span>{conflicts.longer.length > 0
                ? `已有以它开头的更长组合（${conflicts.longer.map(sequenceLabel).join("；")}），这个组合会多等约 ${windowMs} 毫秒确认你不再继续按，然后执行。`
                : `已有较短组合（${conflicts.shorter.map(sequenceLabel).join("；")}）。添加后，它们会多等约 ${windowMs} 毫秒再执行，以便区分。`}</span></p>}
          </section>
          <section className="grid min-w-0 gap-3">
            <h3 className="text-sm font-semibold"><span className="mr-2 text-primary">2</span>要执行的动作</h3>
            <ActionPicker initialCommand={startCommand} initialPresetId={initialPresetId} command={stored} disabled={disabled} onCommand={updateCommand} onListPackages={onListPackages} />
            {templates.length > 0 && <div className="grid gap-2"><Label htmlFor="binding-template">从我的模板填入</Label><select id="binding-template" value="" disabled={disabled} className="h-10 min-w-0 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={e => { const selected = templates.find(t => t.id === e.target.value); if (selected) { updateCommand(toEditableCommand(selected.command)); onUseTemplate?.(selected.command); } }}><option value="">选择已保存的模板…</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>}
            <div className="grid min-w-0 gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor="binding-command">Shell 命令</Label>{multiline && <span data-testid="script-badge" className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary">多行脚本 · {lineCount} 行</span>}</div>
              <textarea id="binding-command" rows={Math.min(14, Math.max(3, lineCount + 1))} spellCheck={false} autoCapitalize="off" autoCorrect="off" className="w-full min-w-0 resize-y rounded-lg border bg-background p-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [overflow-wrap:anywhere]" value={command} disabled={disabled} placeholder={"选择上方动作会自动填写；也可以直接输入命令或多行脚本，例如：\ninput keyevent 3"}
                onChange={e => updateCommand(e.target.value)} aria-describedby="command-help" />
              <p id="command-help" data-test="warning-root" className="text-xs leading-5 text-muted-foreground">命令以 root 权限执行，请确认内容可信。支持多行脚本（自动编码为一行保存），最多 {MAX_COMMAND_BYTES} 个 UTF-8 字节；中文通常占 3 字节。</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={cn("text-xs", bytes > MAX_COMMAND_BYTES ? "text-destructive" : "text-muted-foreground")}>{bytes} / {MAX_COMMAND_BYTES} 字节{multiline ? "（编码后）" : ""}</p>
                {onTestRun && <Button type="button" size="sm" variant="outline" disabled={disabled || testing || !command} onClick={() => void testRun()} title="立即执行一次这条命令，用来确认效果"><Play />{testing ? "运行中…" : "试运行"}</Button>}
              </div>
              {onTestRun && <p className="text-xs leading-5 text-amber-200/90">“试运行”会以 root 立即真实执行一次命令。</p>}
              {testResult && <div data-testid="test-run-result" aria-live="polite" className={cn("grid min-w-0 gap-2 rounded-lg p-2.5 text-xs leading-5 [overflow-wrap:anywhere]", testResult.ok ? "bg-emerald-400/10 text-emerald-300" : "bg-destructive/10 text-destructive")}>
                <p>{testResult.message}</p>
                {testResult.output && <pre data-testid="test-run-output" className="max-h-60 min-w-0 max-w-full overflow-auto whitespace-pre-wrap rounded-md bg-black/30 p-2 font-mono text-[11px] leading-5 text-foreground/90 [overflow-wrap:anywhere]">{testResult.output}</pre>}
              </div>}
            </div>
          </section>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 sm:-bottom-6 flex justify-end gap-2 border-t bg-card px-4 py-3 sm:-mx-6 sm:-mb-6 sm:px-6">
            <Dialog.Close asChild><Button type="button" variant="outline" disabled={disabled}>取消</Button></Dialog.Close>
            <Button type="submit" disabled={disabled || !sequence || !command}>{initial ? "更新绑定" : "添加绑定"}</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
