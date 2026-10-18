import type { RefObject } from "react";
import { Plus, Pencil, Trash2, SlidersHorizontal, Save, Keyboard, ChevronDown, Sparkles, BellRing, Send, Wrench } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { CommandPreview } from "./CommandPreview";
import { sequenceLabel, type IslandNotifyMode, type ParsedConfig } from "@/lib/config";
import { ISLAND_STATE_TEXT, type IslandState } from "@/lib/island";
import type { Binding } from "./BindingEditor";
import { describeCommand } from "@/lib/presets";
import type { ShellTemplate } from "@/lib/templates";

// 时间预设：普通用户不必理解毫秒数。
const TIMING_PRESETS = [
  { name: "灵敏", longPressMs: 250, windowMs: 220, help: "适合按键熟练、追求快速响应" },
  { name: "标准", longPressMs: 300, windowMs: 300, help: "默认值，适合大多数人" },
  { name: "从容", longPressMs: 450, windowMs: 400, help: "按得慢或经常误判时使用" },
] as const;

const ISLAND_MODES: { value: IslandNotifyMode; label: string; help: string }[] = [
  { value: 0, label: "关闭", help: "不显示提示" },
  { value: 1, label: "每次执行", help: "每次侧键命令结束都提示结果" },
  { value: 2, label: "仅失败", help: "只在命令出错时提示" },
];

export interface IslandProps {
  /** null：尚未读取或读取失败 */
  state: IslandState | null;
  busy: boolean;
  onInstall(): void;
  onTest(): void;
}

interface Props {
  cfg: ParsedConfig;
  canEdit: boolean;
  dirty: boolean;
  stateText: string;
  saveBusy: boolean;
  addButton: RefObject<HTMLButtonElement | null>;
  templates?: ShellTemplate[];
  onPacks?(): void;
  onEdit(initial: Binding | null, trigger: HTMLElement): void;
  onDelete(sequence: string): void;
  onTiming(key: "longPressMs" | "windowMs", value: number): void;
  onCaptureOutput?(value: boolean): void;
  onIslandNotify?(value: IslandNotifyMode): void;
  island?: IslandProps;
  onSave(): void;
}
export function BindingsView({ cfg, canEdit, dirty, stateText, saveBusy, addButton, templates = [], onPacks, onEdit, onDelete, onTiming, onCaptureOutput, onIslandNotify, island, onSave }: Props) {
  const entries = Object.entries(cfg.bindings).sort(([a], [b]) => a.length - b.length || a.localeCompare(b));
  return <>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-xs tracking-widest text-primary">按压组合</p><h1 className="text-2xl font-semibold sm:text-3xl">我的绑定 <span className="align-middle text-sm font-normal text-muted-foreground">{entries.length} 个</span></h1><p className="mt-2 text-sm leading-6 text-muted-foreground">用短按与长按，定义适合你的快捷操作。</p></div><div className="flex flex-wrap gap-2">{onPacks && <Button size="lg" variant="outline" disabled={!canEdit} onClick={onPacks}><Sparkles />一键方案</Button>}<Button ref={addButton} size="lg" disabled={!canEdit} onClick={e => onEdit(null, e.currentTarget)}><Plus />新增绑定</Button></div></header>
    {!entries.length && <div className="rounded-2xl border border-dashed bg-card p-10 text-center"><Keyboard className="mx-auto mb-4 size-8 text-primary" /><h2 className="font-medium">还没有绑定</h2><p className="mt-2 text-sm text-muted-foreground">点“新增绑定”自己挑选，或用“一键方案”套用一组推荐设置。</p></div>}
    <div className="grid min-w-0 gap-4">{entries.map(([seq, cmd], i) => <article key={seq} data-test={`binding-${seq}`} className="min-w-0 max-w-full rounded-2xl border bg-card p-4 sm:p-5">
      <div className="mb-4 flex min-w-0 flex-wrap items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 font-mono text-xs text-primary">{String(i + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><h2 className="max-h-32 overflow-auto text-sm font-medium leading-6 [overflow-wrap:anywhere]">{sequenceLabel(seq)}<span className="mx-2 text-muted-foreground">→</span><span data-testid="binding-action" className="text-primary">{describeCommand(cmd, templates).name}</span></h2><p className="mt-1 max-h-16 overflow-auto font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{seq} · {seq.length} 次按压</p></div><div className="flex w-full shrink-0 justify-end gap-1 sm:w-auto"><Button size="sm" variant="ghost" disabled={!canEdit} onClick={e => onEdit({ sequence: seq, command: cmd }, e.currentTarget)}><Pencil />编辑</Button><Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={!canEdit} onClick={() => onDelete(seq)}><Trash2 />删除</Button></div></div>
      <CommandPreview command={cmd} />
    </article>)}</div>
    <p className="text-xs leading-6 text-muted-foreground">完整组合还有后续时等待下一次按压；没有后续时，松开立即执行。</p>
    <details className="group rounded-2xl border bg-card"><summary className="flex cursor-pointer list-none items-center gap-3 p-5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"><SlidersHorizontal className="size-4 text-muted-foreground" />时间设置<span className="ml-auto text-xs text-muted-foreground">高级</span><ChevronDown className="size-4 transition-transform group-open:rotate-180" /></summary><div className="grid min-w-0 gap-5 px-5 pb-5 sm:grid-cols-2"><div role="group" aria-label="时间预设" className="grid min-w-0 gap-2 sm:col-span-2"><p className="text-xs text-muted-foreground">不确定怎么调？选一个预设：</p><div className="flex flex-wrap gap-2">{TIMING_PRESETS.map(p => { const active = cfg.longPressMs === p.longPressMs && cfg.windowMs === p.windowMs; return <Button key={p.name} type="button" size="sm" variant={active ? "secondary" : "outline"} aria-pressed={active} title={p.help} disabled={!canEdit} onClick={() => { onTiming("longPressMs", p.longPressMs); onTiming("windowMs", p.windowMs); }}>{p.name}<span className="text-muted-foreground">{p.longPressMs}/{p.windowMs}</span></Button>; })}</div></div>
      {([["longPressMs", "长按时长", "按住达到该时长后松开，计为长按"], ["windowMs", "连按间隔", "间隔内再次按下会继续组合，超时则结束上一组合"]] as const).map(([key, label, help]) => <div key={key} className="grid min-w-0 content-start gap-2"><Label htmlFor={key}>{label}（毫秒）</Label><Input id={key} type="number" min={100} max={800} step={1} value={Number.isNaN(cfg[key]) ? "" : cfg[key]} disabled={!canEdit} onChange={e => onTiming(key, e.target.value === "" ? NaN : Number(e.target.value))} /><p className="text-xs leading-5 text-muted-foreground">{help}。默认 300，范围 100–800。</p></div>)}
      {onCaptureOutput && <label className="flex min-w-0 items-start gap-3 rounded-xl border bg-background/40 p-3 text-sm sm:col-span-2"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={cfg.captureOutput !== false} disabled={!canEdit} onChange={e => onCaptureOutput(e.target.checked)} aria-describedby="capture-help" /><span className="min-w-0"><span className="font-medium">收集命令输出</span><span id="capture-help" className="mt-1 block text-xs leading-5 text-muted-foreground">在“诊断 → 命令输出”中查看每次执行打印的内容。若某条 input/am/cmd 命令仅在开启时报“执行失败（2）”，可关闭此项（输出改为丢弃）。</span></span></label>}
    </div></details>
    {onIslandNotify && <section aria-labelledby="island-title" className="grid min-w-0 gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex min-w-0 items-start gap-3"><BellRing className="mt-0.5 size-4 shrink-0 text-primary" /><div className="min-w-0"><h2 id="island-title" className="text-sm font-medium">流体云提示</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">侧键命令执行结束后，在屏幕顶部的流体云（灵动岛）短暂显示结果，约 4 秒后自动消失。</p></div></div>
      <div role="radiogroup" aria-label="流体云提示" className="flex flex-wrap gap-2">{ISLAND_MODES.map(m => { const active = (cfg.islandNotify ?? 0) === m.value; return <label key={m.value} title={m.help} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${active ? "border-primary bg-primary/10" : "bg-background/40"}`}><input type="radio" name="island-notify" className="size-4 accent-primary" value={m.value} checked={active} disabled={!canEdit} onChange={() => onIslandNotify(m.value)} />{m.label}</label>; })}</div>
      {island && <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/40 p-3"><p data-testid="island-status" role="status" className={`min-w-0 text-xs leading-5 ${island.state === "ready" ? "text-muted-foreground" : "text-amber-200"}`}>{island.state ? ISLAND_STATE_TEXT[island.state] : "正在检查流体云组件…"}</p><div className="flex flex-wrap gap-2">{(island.state === "not-installed" || island.state === "no-permission") && <Button size="sm" variant="outline" disabled={island.busy} onClick={island.onInstall}><Wrench />{island.state === "not-installed" ? "安装组件" : "修复组件"}</Button>}<Button size="sm" variant="outline" disabled={island.busy || island.state !== "ready"} onClick={island.onTest}><Send />发送测试</Button></div></div>}
      <p className="text-xs leading-5 text-muted-foreground">需要 ColorOS 16。若测试提示没有出现在流体云中，请在系统设置里允许“侧键流体云提示”显示通知和流体云（实况通知），并允许其自启动。</p>
    </section>}
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-4 sm:p-5"><div><p role="status" data-testid="save-state" className={`text-sm font-medium ${dirty ? "text-amber-200" : "text-muted-foreground"}`}>{stateText}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{dirty ? "保存后生效，Shell 命令会自动收录到模板库。" : "保存绑定时，Shell 命令自动收录到模板库。"}</p></div><Button size="lg" onClick={onSave} disabled={!canEdit} data-test="save-config"><Save />{saveBusy ? "保存中…" : "保存配置"}</Button></div>
  </>;
}
