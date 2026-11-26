import type { CSSProperties, RefObject } from "react";
import { Plus, Pencil, Trash2, SlidersHorizontal, Keyboard, ChevronRight, Sparkles, BellRing, Send, Wrench, RotateCcw, ScrollText, Music } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { CommandPreview } from "./CommandPreview";
import { SequenceGlyph } from "./SequenceGlyph";
import { Group, IconTile, LargeTitle, Notice } from "./ui/ios";
import { cn } from "@/lib/utils";
import { ISLAND_SECONDS_DEFAULT, TIMING_MAX, TIMING_MIN, sequenceLabel, validateTiming, type IslandNotifyMode, type ParsedConfig } from "@/lib/config";
import { ISLAND_STATE_TEXT, type IslandState } from "@/lib/island";
import type { Binding } from "./BindingEditor";
import { describeCommand, validatePackageName } from "@/lib/presets";
import { MEDIA_IDLE_MODES, type MediaSettings } from "@/lib/media";
import { useEffect, useState } from "react";
import { AppIcon, AppPicker } from "@/components/AppPicker";
import type { AppInfo } from "@/lib/apps";
import type { ShellTemplate } from "@/lib/templates";

// 时间预设：普通用户不必理解毫秒数。
const TIMING_PRESETS = [
  { name: "灵敏", longPressMs: 250, windowMs: 220, help: "适合按键熟练、追求快速响应" },
  { name: "标准", longPressMs: 300, windowMs: 300, help: "默认值，适合大多数人" },
  { name: "从容", longPressMs: 450, windowMs: 400, help: "按得慢或经常误判时使用" },
  { name: "宽松", longPressMs: 700, windowMs: 600, help: "手速较慢、戴手套或经常连不上双击时使用" },
] as const;

const TIMING_DEFAULT = { longPressMs: 300, windowMs: 300 } as const;
const TIMING_FIELDS = [
  { key: "longPressMs", label: "长按时长", help: "按住达到该时长后松开，计为长按；调小更容易判为长按" },
  { key: "windowMs", label: "连按间隔", help: "间隔内再次按下会继续组合；调大更容易连上双击，但单击会晚一点执行" },
] as const;
const ISLAND_SECONDS = [3, 5, 8, 10, 15];

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

export interface MediaProps {
  /** null：尚未读取 */
  settings: MediaSettings | null;
  busy: boolean;
  onChange(next: MediaSettings): void;
  /** 读取可选应用（带名称与图标） */
  onListApps?(): Promise<AppInfo[]>;
}

/** 媒体动作在没有播放器时怎么做；改完立即写入 media.conf，不需要保存配置。 */
function MediaIdleGroup({ media }: { media: MediaProps }) {
  const s = media.settings;
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [appsError, setAppsError] = useState<string>();
  const [picking, setPicking] = useState(false);
  const load = async () => {
    if (!media.onListApps || apps) return;
    setAppsError(undefined);
    try { setApps(await media.onListApps()); } catch (e) { setAppsError("读取应用失败：" + (e instanceof Error ? e.message : String(e))); }
  };
  // 显示已选应用的名称与图标：异步读取，回调里再更新状态
  useEffect(() => { if (s?.idle === "app" && s.app && !apps) { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); } }, [s?.idle, s?.app]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = s?.app ? apps?.find(a => a.pkg === s.app) ?? { pkg: s.app, label: s.app, music: false } : undefined;
  return <Group aria-labelledby="media-idle-title" header={<span id="media-idle-title">媒体：没有播放时</span>} plain footer="用于“播放 / 暂停”。有播放器（控制中心显示媒体卡片）时始终直接控制它；上一首、下一首在没有播放器时不做任何事。改动立即生效。">
    <div className="grid min-w-0 gap-4 p-4">
      <div className="flex min-w-0 items-start gap-3"><IconTile icon={Music} color="pink" /><p className="min-w-0 text-[14px] leading-[1.5] text-muted-foreground">{s ? MEDIA_IDLE_MODES.find(m => m.value === s.idle)?.help : "正在读取…"}</p></div>
      <div role="radiogroup" aria-label="没有播放时" className="segmented">{MEDIA_IDLE_MODES.map(m => <label key={m.value} title={m.help} className="segmented-item"><input type="radio" name="media-idle" className="sr-only" value={m.value} checked={s?.idle === m.value} disabled={!s || media.busy} onChange={() => { if (!s) return; media.onChange({ ...s, idle: m.value }); if (m.value === "app" && !s.app) { setPicking(true); void load(); } }} />{m.label}</label>)}</div>
    </div>
    {s?.idle === "app" && <button type="button" data-testid="media-app-row" className="flex min-h-14 w-full min-w-0 items-center gap-3 border-t border-border/70 px-4 py-2.5 text-left active:bg-muted disabled:opacity-50" disabled={media.busy} onClick={() => { setPicking(true); void load(); }}>
      <AppIcon app={chosen} />
      <span className="min-w-0 flex-1"><span className="block truncate text-[16px]">{chosen ? chosen.label : "选择音乐应用"}</span><span className="block truncate text-[12px] text-muted-foreground">{chosen ? chosen.pkg : "还没选：暂时按“继续最近”处理"}</span></span>
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground/60" />
    </button>}
    <AppPicker open={picking} onOpenChange={setPicking} apps={apps} error={appsError} selected={s?.app} onPick={pkg => { if (s && validatePackageName(pkg)) media.onChange({ ...s, idle: "app", app: pkg }); }} />
  </Group>;
}

interface Props {
  media?: MediaProps;
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
export function BindingsView({ media, cfg, canEdit, dirty, stateText, saveBusy, addButton, templates = [], onPacks, onEdit, onDelete, onTiming, onCaptureOutput, onIslandNotify, onIslandSeconds, island, onSave }: Props) {
  const entries = Object.entries(cfg.bindings).sort(([a], [b]) => a.length - b.length || a.localeCompare(b));
  const islandMode = cfg.islandNotify ?? 0;
  const islandSeconds = cfg.islandSeconds ?? ISLAND_SECONDS_DEFAULT;
  return <>
    <LargeTitle eyebrow="按压组合" title={<>我的绑定 <span className="align-middle text-[17px] font-semibold text-muted-foreground tabular-nums">{entries.length}</span></>} subtitle="用短按与长按，定义适合你的快捷操作。"
      actions={<>{onPacks && <Button variant="outline" disabled={!canEdit} onClick={onPacks}><Sparkles />一键方案</Button>}<Button ref={addButton} disabled={!canEdit} onClick={e => onEdit(null, e.currentTarget)}><Plus />新增绑定</Button></>} />

    {entries.length ? <Group header="绑定列表" footer="组合还有后续时会等待下一次按压；没有后续时，松开立即执行。">
      {entries.map(([seq, cmd], i) => <article key={seq} data-test={`binding-${seq}`} className="grid min-w-0 max-w-full gap-2.5 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span title={`第 ${i + 1} 个`} className="flex h-11 min-w-11 max-w-[45%] shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-primary/12 px-2.5"><SequenceGlyph seq={seq.length > 8 ? seq.slice(0, 8) : seq} /></span>
          <div className="min-w-0 flex-1">
            <h3 className="max-h-32 overflow-auto text-[16px] font-semibold leading-6 [overflow-wrap:anywhere]"><span data-testid="binding-action">{describeCommand(cmd, templates).name}</span></h3>
            <p className="max-h-16 overflow-auto text-[13px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">{sequenceLabel(seq)}<span className="mx-1.5 text-tertiary-foreground">·</span><span className="font-mono">{seq}</span></p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="icon-sm" variant="outline" aria-label="编辑" title="编辑" disabled={!canEdit} onClick={e => onEdit({ sequence: seq, command: cmd }, e.currentTarget)}><Pencil /></Button>
            <Button size="icon-sm" variant="destructive" aria-label="删除" title="删除" disabled={!canEdit} onClick={() => onDelete(seq)}><Trash2 /></Button>
          </div>
        </div>
        <CommandPreview command={cmd} />
      </article>)}
    </Group> : <section className="grid justify-items-center gap-3 rounded-[22px] bg-card px-6 py-10 text-center">
      <IconTile icon={Keyboard} color="blue" className="size-14 rounded-[16px] [&_svg]:size-7" />
      <h2 className="text-[19px] font-semibold">还没有绑定</h2>
      <p className="max-w-sm text-[15px] leading-[1.5] text-muted-foreground">点“新增绑定”自己挑选，或用“一键方案”套用一组推荐设置。</p>
    </section>}

    <Group header="按键手感" plain>
      <details className="group min-w-0">
        <summary className="pressable flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2.5 outline-none focus-visible:bg-accent"><IconTile icon={SlidersHorizontal} color="gray" /><span className="flex-1 text-[16px]">时间设置</span><span className="text-[15px] text-muted-foreground tabular-nums">{validateTiming(cfg.longPressMs) && validateTiming(cfg.windowMs) ? `${cfg.longPressMs} / ${cfg.windowMs}` : "高级"}</span><ChevronRight className="size-[18px] text-tertiary-foreground transition-transform duration-200 group-open:rotate-90" strokeWidth={2.5} /></summary>
        <div className="grid min-w-0 gap-5 border-t border-border/70 px-4 pt-4 pb-4">
          <div role="group" aria-label="时间预设" className="grid min-w-0 gap-2">
            <p className="text-[13px] text-muted-foreground">不确定怎么调？选一个预设：</p>
            <div className="segmented">{TIMING_PRESETS.map(p => { const active = cfg.longPressMs === p.longPressMs && cfg.windowMs === p.windowMs; return <button key={p.name} type="button" className="segmented-item flex-col gap-0 py-1 disabled:opacity-45" aria-pressed={active} title={p.help} disabled={!canEdit} onClick={() => { onTiming("longPressMs", p.longPressMs); onTiming("windowMs", p.windowMs); }}>{p.name}<span className="text-[11px] font-normal text-muted-foreground tabular-nums">{p.longPressMs}/{p.windowMs}</span></button>; })}</div>
          </div>
          {TIMING_FIELDS.map(({ key, label, help }) => { const value = cfg[key]; const valid = validateTiming(value); return <div key={key} className="grid min-w-0 content-start gap-1">
            <div className="flex items-center justify-between gap-3"><Label htmlFor={key} className="text-[15px] font-medium">{label}（毫秒）</Label><Input id={key} type="number" inputMode="numeric" min={TIMING_MIN} max={TIMING_MAX} step={10} className="h-9 w-24 rounded-lg text-right font-medium tabular-nums" aria-invalid={!valid} value={Number.isNaN(value) ? "" : value} disabled={!canEdit} onChange={e => onTiming(key, e.target.value === "" ? NaN : Number(e.target.value))} /></div>
            <input type="range" aria-label={label} min={TIMING_MIN} max={TIMING_MAX} step={10} className="range-input" style={{ "--fill": `${(((valid ? value : TIMING_DEFAULT[key]) - TIMING_MIN) / (TIMING_MAX - TIMING_MIN)) * 100}%` } as CSSProperties} value={valid ? value : TIMING_DEFAULT[key]} disabled={!canEdit} onChange={e => onTiming(key, Number(e.target.value))} />
            <div className="flex justify-between text-[12px] text-muted-foreground"><span>{TIMING_MIN} 更快</span><span>{TIMING_MAX} 更从容</span></div>
            {valid ? <p className="text-[13px] leading-5 text-muted-foreground">{help}。</p> : <p role="alert" className="text-[13px] leading-5 text-destructive">{label}需在 {TIMING_MIN}–{TIMING_MAX} 毫秒之间</p>}
          </div>; })}
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl bg-muted px-3.5 py-2.5"><p data-testid="timing-summary" className="min-w-0 flex-1 text-[13px] leading-5 text-muted-foreground">{timingSummary(cfg.longPressMs, cfg.windowMs)}</p><Button type="button" size="sm" variant="ghost" disabled={!canEdit || (cfg.longPressMs === TIMING_DEFAULT.longPressMs && cfg.windowMs === TIMING_DEFAULT.windowMs)} onClick={() => { onTiming("longPressMs", TIMING_DEFAULT.longPressMs); onTiming("windowMs", TIMING_DEFAULT.windowMs); }}><RotateCcw />恢复默认</Button></div>
        </div>
      </details>
      {onCaptureOutput && <label className="flex min-h-12 min-w-0 cursor-pointer items-center gap-3 border-t border-border/70 px-4 py-2.5"><IconTile icon={ScrollText} color="teal" /><span className="min-w-0 flex-1 text-[16px]">收集命令输出</span><input type="checkbox" className="ios-switch" checked={cfg.captureOutput !== false} disabled={!canEdit} onChange={e => onCaptureOutput(e.target.checked)} aria-describedby="capture-help" /></label>}
    </Group>
    {onCaptureOutput && <p id="capture-help" className="-mt-5 px-4 text-[13px] leading-[1.45] text-muted-foreground">在“诊断 → 命令输出”中查看每次执行打印的内容。若某条 input/am/cmd 命令仅在开启时报“执行失败（2）”，可关闭此项（输出改为丢弃）。</p>}

    {media && <MediaIdleGroup media={media} />}

    {onIslandNotify && <Group aria-labelledby="island-title" header={<span id="island-title">流体云提示</span>} plain footer="需要 ColorOS 16 及以上。若测试提示没有出现在流体云中，请在系统设置里允许“侧键流体云提示”的通知与“实况通知/流体云”。">
      <div className="grid min-w-0 gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3"><IconTile icon={BellRing} color="red" /><p className="min-w-0 text-[14px] leading-[1.5] text-muted-foreground">命令执行结束后，在屏幕顶部的流体云短暂显示结果，到时自动消失。</p></div>
        <div role="radiogroup" aria-label="流体云提示" className="segmented">{ISLAND_MODES.map(m => <label key={m.value} title={m.help} className="segmented-item"><input type="radio" name="island-notify" className="sr-only" value={m.value} checked={islandMode === m.value} disabled={!canEdit} onChange={() => onIslandNotify(m.value)} />{m.label}</label>)}</div>
        {islandMode === 0 && <Notice data-testid="island-off-hint" tone="warning" className="text-[13px]">当前为“关闭”：“发送测试”只检查组件，实际按侧键不会提示。选择“每次执行”或“仅失败”并保存配置后生效。</Notice>}
        {onIslandSeconds && <div className="grid min-w-0 gap-2"><p id="island-seconds-label" className="text-[13px] text-muted-foreground">显示时长</p><div role="radiogroup" aria-labelledby="island-seconds-label" className="segmented">{(ISLAND_SECONDS.includes(islandSeconds) ? ISLAND_SECONDS : [...ISLAND_SECONDS, islandSeconds].sort((a, b) => a - b)).map(n => <label key={n} className="segmented-item tabular-nums"><input type="radio" name="island-seconds" className="sr-only" value={n} checked={islandSeconds === n} disabled={!canEdit} onChange={() => onIslandSeconds(n)} />{n} 秒</label>)}</div></div>}
      </div>
      {island && <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-3">
        <p data-testid="island-status" role="status" className={cn("min-w-0 flex-1 text-[14px] leading-5", island.state === "ready" ? "text-muted-foreground" : "text-warning")}>{island.state ? ISLAND_STATE_TEXT[island.state] : "正在检查流体云组件…"}</p>
        <div className="flex flex-wrap gap-2">{(island.state === "not-installed" || island.state === "no-permission") && <Button size="sm" variant="outline" disabled={island.busy} onClick={island.onInstall}><Wrench />{island.state === "not-installed" ? "安装组件" : "修复组件"}</Button>}<Button size="sm" variant="secondary" disabled={island.busy || island.state !== "ready"} onClick={island.onTest}><Send />发送测试</Button></div>
      </div>}
      {island?.result && <p data-testid="island-result" role="status" className={cn("border-t border-border/70 px-4 py-3 text-[14px] leading-5", island.result.ok ? "text-success" : "text-warning")}>{island.result.text}</p>}
    </Group>}

    <div className={cn("material sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4.75rem)] z-20 flex min-w-0 items-center justify-between gap-3 rounded-[22px] py-2.5 pr-2.5 pl-4 shadow-[0_8px_30px_rgb(0_0_0/0.16)] ring-1 ring-black/5 transition-colors md:bottom-4 dark:ring-white/10", dirty && "ring-ios-orange/40 dark:ring-ios-orange/40")}>
      <div className="min-w-0">
        <p role="status" data-testid="save-state" className={cn("flex items-center gap-1.5 text-[15px] font-semibold", dirty ? "text-warning" : "text-muted-foreground")}>{dirty && <span aria-hidden="true" className="size-2 rounded-full bg-ios-orange" />}{stateText}</p>
        <p className="text-[12px] leading-4 text-muted-foreground">{dirty ? "保存后生效，命令自动收录到模板库" : "Shell 命令会自动收录到模板库"}</p>
      </div>
      <Button className="shrink-0 px-5" onClick={onSave} disabled={!canEdit} data-test="save-config">{saveBusy ? "保存中…" : "保存配置"}</Button>
    </div>
  </>;
}
