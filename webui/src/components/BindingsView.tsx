import type { RefObject } from "react";
import { Plus, Pencil, Trash2, SlidersHorizontal, Save, Keyboard, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { CommandPreview } from "./CommandPreview";
import { sequenceLabel, type ParsedConfig } from "@/lib/config";
import type { Binding } from "./BindingEditor";

interface Props {
  cfg: ParsedConfig;
  canEdit: boolean;
  dirty: boolean;
  stateText: string;
  saveBusy: boolean;
  addButton: RefObject<HTMLButtonElement | null>;
  onEdit(initial: Binding | null, trigger: HTMLElement): void;
  onDelete(sequence: string): void;
  onTiming(key: "longPressMs" | "windowMs", value: number): void;
  onSave(): void;
}
export function BindingsView({ cfg, canEdit, dirty, stateText, saveBusy, addButton, onEdit, onDelete, onTiming, onSave }: Props) {
  const entries = Object.entries(cfg.bindings).sort(([a], [b]) => a.length - b.length || a.localeCompare(b));
  return <>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-xs tracking-widest text-primary">按压组合</p><h1 className="text-2xl font-semibold sm:text-3xl">我的绑定 <span className="align-middle text-sm font-normal text-muted-foreground">{entries.length} 个</span></h1><p className="mt-2 text-sm leading-6 text-muted-foreground">用短按与长按，定义适合你的快捷操作。</p></div><Button ref={addButton} size="lg" disabled={!canEdit} onClick={e => onEdit(null, e.currentTarget)}><Plus />新增绑定</Button></header>
    {!entries.length && <div className="rounded-2xl border border-dashed bg-card p-10 text-center"><Keyboard className="mx-auto mb-4 size-8 text-primary" /><h2 className="font-medium">还没有绑定</h2><p className="mt-2 text-sm text-muted-foreground">从一次短按开始，添加你的第一个快捷操作。</p></div>}
    <div className="grid min-w-0 gap-4">{entries.map(([seq, cmd], i) => <article key={seq} data-test={`binding-${seq}`} className="min-w-0 max-w-full rounded-2xl border bg-card p-4 sm:p-5">
      <div className="mb-4 flex min-w-0 flex-wrap items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-mono text-xs text-primary">{String(i + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><h2 className="max-h-32 overflow-auto text-sm font-medium leading-6 [overflow-wrap:anywhere]">{sequenceLabel(seq)}</h2><p className="mt-1 max-h-16 overflow-auto font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{seq} · {seq.length} 次按压</p></div><div className="flex w-full shrink-0 justify-end gap-1 sm:w-auto"><Button size="sm" variant="ghost" disabled={!canEdit} onClick={e => onEdit({ sequence: seq, command: cmd }, e.currentTarget)}><Pencil />编辑</Button><Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={!canEdit} onClick={() => onDelete(seq)}><Trash2 />删除</Button></div></div>
      <CommandPreview command={cmd} />
    </article>)}</div>
    <p className="text-xs leading-6 text-muted-foreground">完整组合还有后续时等待下一次按压；没有后续时，松开立即执行。</p>
    <details className="group rounded-2xl border bg-card"><summary className="flex cursor-pointer list-none items-center gap-3 p-5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"><SlidersHorizontal className="size-4 text-muted-foreground" />时间设置<span className="ml-auto text-xs text-muted-foreground">高级</span><ChevronDown className="size-4 transition-transform group-open:rotate-180" /></summary><div className="grid min-w-0 gap-5 px-5 pb-5 sm:grid-cols-2">
      {([["longPressMs", "长按时长", "按住达到该时长后松开，计为长按"], ["windowMs", "连按间隔", "间隔内再次按下会继续组合，超时则结束上一组合"]] as const).map(([key, label, help]) => <div key={key} className="grid min-w-0 content-start gap-2"><Label htmlFor={key}>{label}（毫秒）</Label><Input id={key} type="number" min={100} max={800} step={1} value={Number.isNaN(cfg[key]) ? "" : cfg[key]} disabled={!canEdit} onChange={e => onTiming(key, e.target.value === "" ? NaN : Number(e.target.value))} /><p className="text-xs leading-5 text-muted-foreground">{help}。默认 300，范围 100–800。</p></div>)}
    </div></details>
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-4 sm:p-5"><div><p role="status" data-testid="save-state" className={`text-sm font-medium ${dirty ? "text-amber-200" : "text-muted-foreground"}`}>{stateText}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{dirty ? "保存后生效，Shell 命令会自动收录到模板库。" : "保存绑定时，Shell 命令自动收录到模板库。"}</p></div><Button size="lg" onClick={onSave} disabled={!canEdit} data-test="save-config"><Save />{saveBusy ? "保存中…" : "保存配置"}</Button></div>
  </>;
}
