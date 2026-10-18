import { memo } from "react";
import { ArrowRight, Plus, Power, RefreshCw, Keyboard, Terminal, Activity, Zap, Sparkles, CircleHelp, Cpu, MemoryStick, Clock, BatteryCharging, Hash, Check, CircleAlert, CircleDashed, HardDrive } from "lucide-react";
import { Button } from "./ui/button";
import { formatExplainRow, type ExplainRow } from "@/lib/log";
import { describeCommand } from "@/lib/presets";
import { sequenceLabel } from "@/lib/config";
import { formatMs, outputResultLabel, type OutputRecord } from "@/lib/output";
import { formatBytes, formatDuration, formatPercent, type ServiceMetrics, type ServiceSnapshot, type TodayStats } from "@/lib/service";
import type { ShellTemplate } from "@/lib/templates";
import { cn } from "@/lib/utils";

const FAQ: [string, string][] = [
  ["短按和长按怎么区分？", "按下后马上松开是短按；按住超过“长按时长”（默认 300 毫秒）再松开是长按。可以在“绑定 → 时间设置”中选择灵敏、标准或从容。"],
  ["为什么单击有时要等一下才执行？", "如果同时设置了单击和双击，单击后需要等“连按间隔”确认你不再按第二下，才会执行单击。只设置单击时，松开立即执行。"],
  ["设置好了为什么没反应？", "先确认已点“保存配置”，并在本页看到服务“运行中”。再到“诊断”页刷新记录：显示“未匹配”说明按法和设置的组合不一致；显示“执行失败”说明命令本身出错，可在“命令输出”里看到命令打印的错误信息。"],
  ["怎么看命令的执行结果？", "每次侧键触发的命令，其输出（含错误输出）、退出码和耗时都会记录在“诊断 → 命令输出”，最近一次也显示在本页。每次最多保留 4 KB 输出。"],
  ["能写长命令或多行脚本吗？", "可以。命令最多 4095 字节；在编辑器里直接换行写多行脚本，保存时会自动编码为一行，编辑时自动还原。"],
  ["服务会很耗电吗？", "不会。服务没按侧键时在内核中休眠等待按键事件，不持有唤醒锁、不轮询。本页的“耗电评估”根据 CPU 时间和唤醒次数估算；真正耗电的是你绑定的命令本身。"],
  ["为什么显示“执行失败（2）”？", "通常是命令把输出写进了 /data/adb 下的文件：input、am、cmd 等命令会把输出交给系统服务，系统无权访问该目录，于是报 Failed transaction。去掉重定向即可，服务会自动收集命令输出。"],
  ["内置动作安全吗？", "内置动作只调用系统自带命令（模拟按键、打开相机、切换开关等）。所有命令都以 root 权限运行，自己填写或从网上复制的命令请确认来源可信。"],
  ["侧键原来的功能去哪了？", "服务运行时会接管侧键；停止服务后，侧键恢复系统原有功能。"],
];

interface Props {
  running: boolean | null;
  bindingCount: number;
  templateCount: number;
  latest?: ExplainRow;
  latestOutput?: OutputRecord;
  snapshot?: ServiceSnapshot | null;
  metrics?: ServiceMetrics | null;
  today?: TodayStats;
  templates?: ShellTemplate[];
  autoRefresh?: boolean;
  busy: boolean;
  statusBusy: boolean;
  enabled: boolean;
  canEdit: boolean;
  onToggle(): void;
  onRefresh(): void;
  onAdd(trigger: HTMLElement): void;
  onPacks?(): void;
  onBindings(): void;
  onDiagnostics(): void;
}

function Metric({ icon: Icon, label, value, sub, testId }: { icon: typeof Cpu; label: string; value: string; sub?: string; testId?: string }) {
  return <div data-testid={testId} className="min-w-0 rounded-xl border border-white/5 bg-black/15 p-3">
    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className="size-3.5 shrink-0 text-primary/80" />{label}</p>
    <p className="mt-1.5 text-base font-semibold tabular-nums [overflow-wrap:anywhere]">{value}</p>
    {sub && <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">{sub}</p>}
  </div>;
}

function ServiceDetails({ snapshot, metrics }: { snapshot: ServiceSnapshot; metrics: ServiceMetrics }) {
  const p = snapshot.proc!;
  const powerTone = metrics.power === "偏高" ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
  return <div data-testid="service-details" className="relative mt-6 grid min-w-0 gap-3 border-t border-white/10 pt-5">
    <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Metric icon={Hash} label="进程 PID" value={String(p.pid)} sub={`状态 ${p.state === "S" ? "休眠等待" : p.state === "R" ? "运行中" : p.state}`} />
      <Metric icon={Clock} label="运行时长" value={formatDuration(metrics.runSec)} />
      <Metric testId="metric-cpu" icon={Cpu} label="CPU 占用" value={formatPercent(metrics.recentCpuPercent ?? metrics.avgCpuPercent)} sub={`平均 ${formatPercent(metrics.avgCpuPercent)} · 累计 ${metrics.cpuSec.toFixed(2)} 秒`} />
      <Metric icon={MemoryStick} label="内存" value={formatBytes(p.rssKb * 1024)} sub={`峰值 ${formatBytes(p.peakRssKb * 1024)}`} />
      <Metric icon={Activity} label="唤醒" value={`${Math.round(metrics.wakeupsPerHour)} 次/时`} sub={`共 ${p.voluntary} 次 · 线程 ${p.threads} · 句柄 ${p.fds}`} />
      <Metric testId="metric-power" icon={BatteryCharging} label="耗电评估" value={metrics.power} sub="按 CPU 与唤醒估算" />
    </div>
    <p className={cn("rounded-lg border px-3 py-2 text-xs leading-5", powerTone)}>{metrics.powerHint}</p>
    <details className="min-w-0 text-xs text-muted-foreground">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"><HardDrive className="size-3.5" />存储占用</summary>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">{Object.entries(snapshot.sizes).map(([name, size]) => <span key={name} className="flex justify-between gap-2 font-mono"><span>{name}</span><span className="tabular-nums">{formatBytes(size)}</span></span>)}</div>
      <p className="mt-2 leading-5">日志、原始事件各自上限 512 KB，命令输出上限 512 KB，超过后自动保留最近一半。</p>
    </details>
  </div>;
}

function LatestRun({ record, row, templates, onDiagnostics }: { record?: OutputRecord; row?: ExplainRow; templates: ShellTemplate[]; onDiagnostics(): void }) {
  // 优先展示带输出的记录；旧守护进程没有 output.jsonl 时退回解释日志。
  const code = record ? record.code : row?.result === "dropped" ? null : row?.result !== undefined ? Number(row.result) : undefined;
  const label = record ? outputResultLabel(record.code) : row ? formatExplainRow(row).resultLabel : "";
  const action = record?.action ?? (row?.action && row.action !== "none" ? row.action : "");
  const seq = record?.seq ?? row?.seq ?? "";
  const ok = code === 0, dropped = code === null;
  const Icon = ok ? Check : dropped ? CircleDashed : CircleAlert;
  return <section data-testid="latest-run" className="min-w-0 rounded-2xl border bg-card p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-semibold"><Terminal className="size-4 text-primary" />最近一次执行</h2><Button size="sm" variant="ghost" onClick={onDiagnostics}>全部记录<ArrowRight /></Button></div>
    {record || row ? <div className="mt-4 grid min-w-0 gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1", ok ? "bg-emerald-400/10 text-emerald-300" : dropped ? "bg-amber-400/10 text-amber-200" : "bg-red-400/10 text-red-300")}><Icon className="size-3" />{label}</span>
        <time className="text-muted-foreground">{record?.time ?? row?.time}</time>
        {seq && <span className="text-muted-foreground">{sequenceLabel(seq)}</span>}
        {action && <span className="rounded-full bg-primary/10 px-2 py-1 text-primary [overflow-wrap:anywhere]">{describeCommand(action, templates).name}</span>}
        {record && <span className="text-muted-foreground">耗时 {formatMs(record.duration_ms)}</span>}
      </div>
      {record ? <pre data-testid="latest-output" className="max-h-40 min-w-0 max-w-full overflow-auto whitespace-pre-wrap rounded-lg border border-white/5 bg-black/25 p-3 font-mono text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{record.output.trimEnd() || "（命令没有输出）"}{record.truncated ? "\n…输出过长，已截断" : ""}</pre>
        : dropped ? <p className="text-sm text-muted-foreground">这个按法没有绑定动作。</p>
        : <p className="text-xs text-muted-foreground">更新到 0.4.0 守护进程后可在这里看到命令输出。</p>}
    </div> : <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">还没有执行记录，按一下侧键试试。</p>}
  </section>;
}

export const OverviewView = memo(function OverviewView({ running, bindingCount, templateCount, latest, latestOutput, snapshot, metrics, today, templates = [], autoRefresh, busy, statusBusy, enabled, canEdit, onToggle, onRefresh, onAdd, onPacks, onBindings, onDiagnostics }: Props) {
  const stats = [
    { icon: Activity, label: "今日按压", value: today ? String(today.presses) : "—", unit: today ? `成功 ${today.success} · 失败 ${today.failed} · 未匹配 ${today.dropped}` : "读取记录后显示" },
    { icon: Keyboard, label: "已配置绑定", value: String(bindingCount), unit: "个组合" },
    { icon: Terminal, label: "我的模板", value: String(templateCount), unit: "条命令（另有内置动作）" },
  ];
  return <>
    <header><p className="mb-2 text-xs font-medium tracking-widest text-primary">你的快捷操作中心</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">侧键控制台</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">轻按、长按，串起你的日常操作。</p></header>
    <section className="service-panel relative min-w-0 overflow-hidden rounded-2xl border p-5 sm:p-7">
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-4"><span className="rounded-2xl border border-primary/20 bg-primary/10 p-3.5 text-primary"><Zap className="size-7" /></span><div className="min-w-0">
          <p className="mb-2 text-sm text-muted-foreground">侧键服务</p><h2 className="flex items-center gap-2.5 text-xl font-semibold"><span className={`size-2 rounded-full ${running ? "bg-emerald-400 shadow-[0_0_12px_#34d39966]" : running === null ? "bg-amber-300" : "bg-slate-500"}`} />{running === null ? "状态未知" : running ? "运行中" : "已停止"}</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{running ? "服务正在监听侧键，按已保存的组合执行操作。" : running === false ? "启动服务，让已保存的快捷操作随时待命。" : "查询服务状态后，即可启动或停止侧键服务。"}</p>
          {autoRefresh && running && <p className="mt-1 text-[11px] text-muted-foreground">详情每 5 秒自动刷新（页面在后台时暂停）</p>}
        </div></div>
        <div className="flex flex-wrap gap-2 self-center">
          {running !== null && <Button data-test="daemon-toggle" size="lg" variant={running ? "outline" : "default"} onClick={onToggle} disabled={!enabled || busy}><Power />{running ? "停止服务" : "启动服务"}</Button>}
          <Button size="lg" variant="outline" onClick={onRefresh} disabled={!enabled || busy}><RefreshCw className={statusBusy ? "animate-spin" : ""} />{statusBusy ? "查询中…" : "查询状态"}</Button>
        </div>
      </div>
      {running && snapshot?.proc && metrics && <ServiceDetails snapshot={snapshot} metrics={metrics} />}
    </section>
    <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
      {stats.map(({ icon: Icon, label, value, unit }) =>
        <div key={label} className="min-w-0 rounded-2xl border bg-card p-4 first:col-span-2 sm:p-5 sm:first:col-span-1"><div className="mb-3 flex items-center justify-between text-sm text-muted-foreground"><span>{label}</span><Icon className="size-4 shrink-0 text-primary/80" /></div><p className="text-2xl font-semibold tabular-nums [overflow-wrap:anywhere]">{value}</p><p className="mt-1.5 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{unit}</p></div>)}
    </div>
    <LatestRun record={latestOutput} row={latest} templates={templates} onDiagnostics={onDiagnostics} />
    <section className="min-w-0 rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold">{bindingCount ? "下一个操作，一按即达" : "三步上手"}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{bindingCount ? "选择按压方式和动作，保存后即可使用。" : "不会写命令也没关系：套用推荐方案，或从内置动作里点选。"}</p></div><div className="flex flex-wrap gap-2">{onPacks && <Button size="lg" variant={bindingCount ? "outline" : "default"} onClick={onPacks} disabled={!canEdit}><Sparkles />一键方案</Button>}<Button size="lg" variant={bindingCount || !onPacks ? "default" : "outline"} onClick={e => onAdd(e.currentTarget)} disabled={!canEdit}><Plus />新增绑定</Button></div></div>
      {!bindingCount && <div className="mt-6 grid gap-4 border-t pt-5 sm:grid-cols-3">{["选择按压方式（单击、双击、长按…）", "选择动作，如截屏、播放/暂停", "点“保存配置”，立即生效"].map((label, i) => <div key={label} className="flex items-center gap-3 text-sm text-muted-foreground"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs text-foreground">0{i + 1}</span>{label}</div>)}</div>}
    </section>
    <div className="flex flex-wrap gap-3"><Button variant="ghost" onClick={onBindings}>管理我的绑定<ArrowRight /></Button><Button variant="ghost" onClick={onDiagnostics}>查看诊断记录<ArrowRight /></Button></div>
    <section aria-labelledby="faq-title" className="min-w-0 rounded-2xl border bg-card p-5 sm:p-6">
      <h2 id="faq-title" className="flex items-center gap-2 font-semibold"><CircleHelp className="size-4 text-primary" />常见问题</h2>
      <div className="mt-4 grid gap-2">{FAQ.map(([q, a]) => <details key={q} className="group min-w-0 rounded-xl border bg-background/40 px-4 py-3"><summary className="cursor-pointer list-none text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">{q}</summary><p className="mt-2 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{a}</p></details>)}</div>
    </section>
  </>;
});
