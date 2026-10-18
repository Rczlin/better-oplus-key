import type { RefObject } from "react";
import { Plus, Pencil, Trash2, SlidersHorizontal, Save, Keyboard, ChevronDown, Sparkles, BellRing, Send, Wrench, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { CommandPreview } from "./CommandPreview";
import { ISLAND_SECONDS_DEFAULT, sequenceLabel, validateTiming, type IslandNotifyMode, type ParsedConfig } from "@/lib/config";
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

const TIMING_DEFAULT = { longPressMs: 300, windowMs: 300 } as const;
const TIMING_FIELDS = [
  { key: "longPressMs", label: "长按时长", help: "按住达到该时长后松开，计为长按；调小更容易判为长按" },
  { key: "windowMs", label: "连按间隔", help: "间隔内再次按下会继续组合；调大更容易连上双击，但单击会晚一点执行" },
] as const;
const ISLAND_SECONDS = [3, 5, 8, 10, 15] as const;

/** 用一句话说明当前时间设置的效果。 */
function timingSummary(longPressMs: number, windowMs: number): string {
  const lp = validateTiming(longPressMs) ? `按住 ${longPressMs} 毫秒以上记为长按` : "长按时长未设置好";
  const w = validateTiming(windowMs) ? `两次按压间隔不超过 ${windowMs} 毫秒算连按` : "连按间隔未设置好";
  return `${lp}；${w}。`;
}

const ISLAND_MODES: { value: IslandNotifyMode; label: string; help: string }[] = [
  { value: 0, label: "关闭", help: "不显示提示" },
  { value: 1, label: "每次执行", help: "每次侧键命令结束都提示结果" },
  { value: 2, label: "仅失败", help: "只在命令出错时提示" },
];

export interface IslandProps {
  /** null：尚未读取或读取失败 */
  state: IslandState | null;
  busy: boolean;
  /** 最近一次测试的结论 */
  result?: { ok: boolean; text: string } | null;
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
  onIslandSeconds?(value: number): void;
  island?: IslandProps;
  onSave(): void;
}
export function BindingsView({ cfg, canEdit, dirty, stateText, saveBusy, addButton, templates = [], onPacks, onEdit, onDelete, onTiming, onCaptureOutput, onIslandNotify, onIslandSeconds, island, onSave }: Props) {
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
      {TIMING_FIELDS.map(({ key, label, help }) => { const value = cfg[key]; const valid = validateTiming(value); return <div key={key} className="grid min-w-0 content-start gap-2">
        <div className="flex items-center justify-between gap-3"><Label htmlFor={key}>{label}（毫秒）</Label><Input id={key} type="number" inputMode="numeric" min={100} max={800} step={10} className="h-8 w-24 text-right" aria-invalid={!valid} value={Number.isNaN(value) ? "" : value} disabled={!canEdit} onChange={e => onTiming(key, e.target.value === "" ? NaN : Number(e.target.value))} /></div>
        <input type="range" aria-label={label} min={100} max={800} step={10} className="w-full accent-primary" value={valid ? value : TIMING_DEFAULT[key]} disabled={!canEdit} onChange={e => onTiming(key, Number(e.target.value))} />
        <div className="flex justify-between text-[11px] text-muted-foreground"><span>100 更快</span><span>800 更从容</span></div>
        {valid ? <p className="text-xs leading-5 text-muted-foreground">{help}。</p> : <p role="alert" className="text-xs leading-5 text-destructive">{label}需在 100–800 毫秒之间</p>}
      </div>; })}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl bg-background/40 p-3 text-xs leading-5 sm:col-span-2"><p data-testid="timing-summary" className="min-w-0 text-muted-foreground">{timingSummary(cfg.longPressMs, cfg.windowMs)}</p><Button type="button" size="sm" variant="ghost" disabled={!canEdit || (cfg.longPressMs === TIMING_DEFAULT.longPressMs && cfg.windowMs === TIMING_DEFAULT.windowMs)} onClick={() => { onTiming("longPressMs", TIMING_DEFAULT.longPressMs); onTiming("windowMs", TIMING_DEFAULT.windowMs); }}><RotateCcw />恢复默认</Button></div>
      {onCaptureOutput && <label className="flex min-w-0 items-start gap-3 rounded-xl border bg-background/40 p-3 text-sm sm:col-span-2"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={cfg.captureOutput !== false} disabled={!canEdit} onChange={e => onCaptureOutput(e.target.checked)} aria-describedby="capture-help" /><span className="min-w-0"><span className="font-medium">收集命令输出</span><span id="capture-help" className="mt-1 block text-xs leading-5 text-muted-foreground">在“诊断 → 命令输出”中查看每次执行打印的内容。若某条 input/am/cmd 命令仅在开启时报“执行失败（2）”，可关闭此项（输出改为丢弃）。</span></span></label>}
    </div></details>
    {onIslandNotify && <section aria-labelledby="island-title" className="grid min-w-0 gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex min-w-0 items-start gap-3"><BellRing className="mt-0.5 size-4 shrink-0 text-primary" /><div className="min-w-0"><h2 id="island-title" className="text-sm font-medium">流体云提示</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">侧键命令执行结束后，在屏幕顶部的流体云（灵动岛）短暂显示结果，按下方设置的时长后自动消失。</p></div></div>
      <div role="radiogroup" aria-label="流体云提示" className="flex flex-wrap gap-2">{ISLAND_MODES.map(m => { const active = (cfg.islandNotify ?? 0) === m.value; return <label key={m.value} title={m.help} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${active ? "border-primary bg-primary/10" : "bg-background/40"}`}><input type="radio" name="island-notify" className="size-4 accent-primary" value={m.value} checked={active} disabled={!canEdit} onChange={() => onIslandNotify(m.value)} />{m.label}</label>; })}</div>
      {(cfg.islandNotify ?? 0) === 0 && <p data-testid="island-off-hint" className="text-xs leading-5 text-amber-200">当前为“关闭”：“发送测试”只检查组件，实际按侧键不会提示。选择“每次执行”或“仅失败”并保存配置后生效。</p>}
      {onIslandSeconds && <div className="grid min-w-0 gap-2"><p id="island-seconds-label" className="text-xs text-muted-foreground">显示时长</p><div role="radiogroup" aria-labelledby="island-seconds-label" className="flex flex-wrap gap-2">{ISLAND_SECONDS.map(n => { const active = (cfg.islandSeconds ?? ISLAND_SECONDS_DEFAULT) === n; return <label key={n} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm ${active ? "border-primary bg-primary/10" : "bg-background/40"}`}><input type="radio" name="island-seconds" className="size-4 accent-primary" value={n} checked={active} disabled={!canEdit} onChange={() => onIslandSeconds(n)} />{n} 秒</label>; })}</div></div>}
      {island && <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/40 p-3"><p data-testid="island-status" role="status" className={`min-w-0 text-xs leading-5 ${island.state === "ready" ? "text-muted-foreground" : "text-amber-200"}`}>{island.state ? ISLAND_STATE_TEXT[island.state] : "正在检查流体云组件…"}</p><div className="flex flex-wrap gap-2">{(island.state === "not-installed" || island.state === "no-permission") && <Button size="sm" variant="outline" disabled={island.busy} onClick={island.onInstall}><Wrench />{island.state === "not-installed" ? "安装组件" : "修复组件"}</Button>}<Button size="sm" variant="outline" disabled={island.busy || island.state !== "ready"} onClick={island.onTest}><Send />发送测试</Button></div></div>}
      {island?.result && <p data-testid="island-result" role="status" className={`text-xs leading-5 ${island.result.ok ? "text-emerald-300" : "text-amber-200"}`}>{island.result.text}</p>}
      <p className="text-xs leading-5 text-muted-foreground">需要 ColorOS 16。若测试提示没有出现在流体云中，请在系统设置里允许“侧键流体云提示”的通知与“实况通知/流体云”。</p>
    </section>}
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-4 sm:p-5"><div><p role="status" data-testid="save-state" className={`text-sm font-medium ${dirty ? "text-amber-200" : "text-muted-foreground"}`}>{stateText}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{dirty ? "保存后生效，Shell 命令会自动收录到模板库。" : "保存绑定时，Shell 命令自动收录到模板库。"}</p></div><Button size="lg" onClick={onSave} disabled={!canEdit} data-test="save-config"><Save />{saveBusy ? "保存中…" : "保存配置"}</Button></div>
  </>;
}
