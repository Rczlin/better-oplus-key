import { useState } from "react";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { sequenceLabel, validateCommand, MAX_COMMAND_BYTES } from "@/lib/config";
import type { ShellTemplate } from "@/lib/templates";

export interface Binding { sequence: string; command: string }
interface Props {
  open: boolean;
  initial: Binding | null;
  initialCommand?: string;
  templates?: ShellTemplate[];
  onUseTemplate?(command: string): void;
  bindings: Record<string, string>;
  disabled: boolean;
  onOpenChange(open: boolean): void;
  onSubmit(binding: Binding): void;
  onCloseFocus(): void;
}

export function BindingEditor({ open, initial, initialCommand, templates = [], onUseTemplate, bindings, disabled, onOpenChange, onSubmit, onCloseFocus }: Props) {
  const [sequence, setSequence] = useState(initial?.sequence ?? "");
  const [command, setCommand] = useState(initial?.command ?? initialCommand ?? "");
  const [error, setError] = useState("");
  const updateSequence = (s: string) => { setSequence(s); setError(""); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || !sequence || !command) return;
    if (sequence !== initial?.sequence && Object.hasOwn(bindings, sequence)) {
      setError("这个按压组合已存在，请编辑原绑定或更换组合"); return;
    }
    if (!validateCommand(command)) {
      setError(`命令须为单行，最多 ${MAX_COMMAND_BYTES} 个 UTF-8 字节，不能含 NUL`); return;
    }
    try { onSubmit({ sequence, command }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
      <Dialog.Content onCloseAutoFocus={e => { e.preventDefault(); onCloseFocus(); }}
        className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] min-w-0 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-5 shadow-2xl sm:p-6">
        <Dialog.Title className="text-lg font-semibold">{initial ? "编辑绑定" : "新增绑定"}</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-muted-foreground">按实际顺序添加短按或长按，再填写要执行的命令。</Dialog.Description>
        <form onSubmit={submit} className="mt-5 grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={disabled} onClick={() => updateSequence(sequence + "0")}>短按</Button>
            <Button type="button" disabled={disabled} onClick={() => updateSequence(sequence + "1")}>长按</Button>
            <Button type="button" variant="outline" disabled={disabled || !sequence} onClick={() => updateSequence(sequence.slice(0, -1))}>撤回一步</Button>
            <Button type="button" variant="ghost" disabled={disabled || !sequence} onClick={() => updateSequence("")}>清空组合</Button>
          </div>
          <div data-testid="sequence-preview" aria-live="polite" className="max-h-48 min-w-0 overflow-auto rounded-lg bg-muted p-3 text-sm [overflow-wrap:anywhere]">
            {sequence ? <><p>{sequenceLabel(sequence)}</p><p className="mt-2 font-mono text-xs text-muted-foreground">编码 {sequence} · {sequence.length} 次按压</p></> : "点击上方按钮组成按压顺序"}
          </div>
          <p className="text-xs text-muted-foreground">短按：轻按后松开。长按：按住达到设置的长按时长后松开。</p>
          <div className="grid gap-2">
            {templates.length > 0 && <><Label htmlFor="binding-template">从模板填入</Label><select id="binding-template" value="" disabled={disabled} className="h-10 min-w-0 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={e => { const selected = templates.find(t => t.id === e.target.value); if (selected) { setCommand(selected.command); setError(""); onUseTemplate?.(selected.command); } }}><option value="">选择已保存的 Shell 模板…</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></>}
            <Label htmlFor="binding-command">Shell 命令</Label>
            <textarea id="binding-command" rows={3} className="w-full resize-y rounded-lg border bg-background p-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" value={command} disabled={disabled} placeholder="例如：input keyevent 3"
              onChange={e => { setCommand(e.target.value); setError(""); }} aria-describedby="command-help" />
            <p id="command-help" data-test="warning-root" className="text-xs text-muted-foreground">命令以 root 权限执行，请确认内容可信。仅支持单行，最多 511 个 UTF-8 字节；中文通常占 3 字节。</p>
            <p className="text-xs text-muted-foreground">{new TextEncoder().encode(command).length} / 511 字节</p>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Dialog.Close asChild><Button type="button" variant="outline" disabled={disabled}>取消</Button></Dialog.Close>
            <Button type="submit" disabled={disabled || !sequence || !command}>{initial ? "更新绑定" : "添加绑定"}</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
