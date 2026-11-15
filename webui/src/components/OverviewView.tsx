import { memo } from "react";
import { Plus, Power, RefreshCw, Keyboard, Activity, Sparkles, Cpu, MemoryStick, Clock, BatteryCharging, Hash, Check, CircleAlert, CircleDashed, HardDrive, ChevronRight, ListChecks, Stethoscope } from "lucide-react";
import { Button } from "./ui/button";
import { Group, IconTile, LargeTitle, Row } from "./ui/ios";
import { formatExplainRow, type ExplainRow } from "@/lib/log";
import { describeCommand } from "@/lib/presets";
import { sequenceLabel } from "@/lib/config";
import { formatMs, outputResultLabel, type OutputRecord } from "@/lib/output";
import { formatBytes, formatDuration, formatPercent, type ServiceMetrics, type ServiceSnapshot, type TodayStats } from "@/lib/service";
import type { ShellTemplate } from "@/lib/templates";
import { cn } from "@/lib/utils";

const FAQ: [string, string][] = [
  ["短按和长按怎么区分？", "按下后马上松开是短按；按住达到“长按时长”（默认 300 毫秒）就是长按，没有更长组合时到点立即执行。可以在“绑定 → 时间设置”中选择预设，或在 100–1200 毫秒之间自由调整。"],
  ["为什么单击有时要等一下才执行？", "如果同时设置了单击和双击，单击后需要等“连按间隔”确认你不再按第二下，才会执行单击。只设置单击时，松开立即执行。"],
  ["设置好了为什么没反应？", "先确认已点“保存配置”，并在本页看到服务“运行中”。再到“诊断”页刷新记录：显示“未匹配”说明按法和设置的组合不一致；显示“执行失败”说明命令本身出错，可在“命令输出”里看到命令打印的错误信息。"],
  ["怎么看命令的执行结果？", "每次侧键触发的命令，其输出（含错误输出）、退出码和耗时都会记录在“诊断 → 命令输出”，最近一次也显示在本页。每次最多保留 4 KB 输出。"],
  ["能写长命令或多行脚本吗？", "可以。命令最多 4095 字节；在编辑器里直接换行写多行脚本，保存时会自动编码为一行，编辑时自动还原。"],
  ["服务会很耗电吗？", "不会。服务没按侧键时在内核中休眠等待按键事件，不持有唤醒锁、不轮询。本页的“耗电评估”根据 CPU 时间和唤醒次数估算；真正耗电的是你绑定的命令本身。"],
  ["为什么显示“执行失败（2）”？", "通常是命令把输出写进了 /data/adb 下的文件：input、am、cmd 等命令会把输出交给系统服务，系统无权访问该目录，于是报 Failed transaction。去掉重定向即可，服务会自动收集命令输出。"],
  ["内置动作安全吗？", "内置动作只调用系统自带命令（模拟按键、打开相机、切换开关等）。所有命令都以 root 权限运行，自己填写或从网上复制的命令请确认来源可信。"],
  ["侧键原来的功能去哪了？", "服务运行时会接管侧键；停止服务后，侧键恢复系统原有功能。"],
  ["开机会自动启动吗？", "会。开机后服务自动启动；如果意外退出，会在几秒内自动重新拉起。只有你在本页点“停止服务”后才会保持停止，直到再次启动或重启手机。"],
  ["按键要打开 Root 管理器才生效？", "这是旧版本的问题：从管理器里启动的服务会被 ColorOS 随管理器一起冻结，按键积压到打开管理器时一次性执行。0.5.6 起服务会脱离管理器独立运行，积压超过 5 秒的按键也会直接丢弃，不会突然连续执行。"],
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

function ServiceDetails({ snapshot, metrics }: { snapshot: ServiceSnapshot; metrics: ServiceMetrics }) {
  const p = snapshot.proc!;
  const high = metrics.power === "偏高";
  return <Group data-testid="service-details" header="运行详情" icons footer={<p className={cn(high && "text-warning")}>{metrics.powerHint}</p>}>
    <Row icon={Hash} color="gray" title="进程 PID" subtitle={`状态 ${p.state === "S" ? "休眠等待" : p.state === "R" ? "正在处理" : p.state}`} value={String(p.pid)} />
    <Row icon={Clock} color="indigo" title="运行时长" value={formatDuration(metrics.runSec)} />
    <Row testId="metric-cpu" icon={Cpu} color="blue" title="CPU 占用" subtitle={`平均 ${formatPercent(metrics.avgCpuPercent)} · 累计 ${metrics.cpuSec.toFixed(2)} 秒`} value={formatPercent(metrics.recentCpuPercent ?? metrics.avgCpuPercent)} />
    <Row icon={MemoryStick} color="purple" title="内存" subtitle={`峰值 ${formatBytes(p.peakRssKb * 1024)}`} value={formatBytes(p.rssKb * 1024)} />
    <Row icon={Activity} color="orange" title="唤醒" subtitle={`共 ${p.voluntary} 次 · 线程 ${p.threads} · 句柄 ${p.fds}`} value={`${Math.round(metrics.wakeupsPerHour)} 次/时`} />
    <Row testId="metric-power" icon={BatteryCharging} color={high ? "orange" : "green"} title="耗电评估" subtitle="按 CPU 与唤醒估算" value={<span className={cn("font-medium", high ? "text-warning" : "text-success")}>{metrics.power}</span>} />
    <details className="group min-w-0">
      <summary className="pressable flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2.5 outline-none focus-visible:bg-accent"><IconTile icon={HardDrive} color="gray" /><span className="flex-1 text-[16px]">存储占用</span><ChevronRight className="size-[18px] text-tertiary-foreground transition-transform group-open:rotate-90" strokeWidth={2.5} /></summary>
      <div className="grid gap-1 pr-4 pb-3 pl-[3.75rem] text-[13px] text-muted-foreground">
        {Object.entries(snapshot.sizes).map(([name, size]) => <span key={name} className="flex justify-between gap-2"><span className="font-mono">{name}</span><span className="tabular-nums">{formatBytes(size)}</span></span>)}
        <p className="mt-1 leading-5">日志、原始事件、命令输出各自上限 512 KB，超过后自动保留最近一半。</p>
      </div>
    </details>
  </Group>;
}

function LatestRun({ record, row, templates, onDiagnostics }: { record?: OutputRecord; row?: ExplainRow; templates: ShellTemplate[]; onDiagnostics(): void }) {
  // 优先展示带输出的记录；旧守护进程没有 output.jsonl 时退回解释日志。
  const code = record ? record.code : row?.result === "dropped" ? null : row?.result !== undefined ? Number(row.result) : undefined;
  const label = record ? outputResultLabel(record.code) : row ? formatExplainRow(row).resultLabel : "";
  const action = record?.action ?? (row?.action && row.action !== "none" ? row.action : "");
  const seq = record?.seq ?? row?.seq ?? "";
  const ok = code === 0, dropped = code === null;
  const Icon = ok ? Check : dropped ? CircleDashed : CircleAlert;
  return <Group data-testid="latest-run" header="最近一次执行" headerAction={<Button size="xs" variant="ghost" className="-mr-2" onClick={onDiagnostics}>全部记录</Button>}>
    {record || row ? <div className="grid min-w-0 gap-3 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", ok ? "bg-success/15 text-success" : dropped ? "bg-ios-orange/15 text-warning" : "bg-destructive/15 text-destructive")}><Icon className="size-5" strokeWidth={2.4} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold leading-6 [overflow-wrap:anywhere]">{action ? describeCommand(action, templates).name : seq ? sequenceLabel(seq) : label}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground"><span className={cn("font-medium", ok ? "text-success" : dropped ? "text-warning" : "text-destructive")}>{label}</span>{seq && action && <span>{sequenceLabel(seq)}</span>}{record && <span>耗时 {formatMs(record.duration_ms)}</span>}<time>{record?.time ?? row?.time}</time></p>
        </div>
      </div>
      {record ? <pre data-testid="latest-output" className="max-h-40 min-w-0 max-w-full overflow-auto rounded-xl bg-code p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{record.output.trimEnd() || "（命令没有输出）"}{record.truncated ? "\n…输出过长，已截断" : ""}</pre>
        : dropped ? <p className="text-[14px] text-muted-foreground">这个按法没有绑定动作。</p>
        : <p className="text-[13px] text-muted-foreground">更新到 0.4.0 守护进程后可在这里看到命令输出。</p>}
    </div> : <p className="px-4 py-8 text-center text-[15px] text-muted-foreground">还没有执行记录，按一下侧键试试。</p>}
  </Group>;
}

export const OverviewView = memo(function OverviewView({ running, bindingCount, templateCount, latest, latestOutput, snapshot, metrics, today, templates = [], autoRefresh, busy, statusBusy, enabled, canEdit, onToggle, onRefresh, onAdd, onPacks, onBindings, onDiagnostics }: Props) {
  const statusText = running === null ? "状态未知" : running ? "运行中" : "已停止";
  return <>
    <LargeTitle eyebrow="你的快捷操作中心" title="侧键控制台" subtitle="轻按、长按，串起你的日常操作。" />

    <section aria-label="侧键服务" className="relative min-w-0 overflow-hidden rounded-[22px] bg-card p-5">
      <div className="flex min-w-0 items-center gap-4">
        <span className={cn("relative flex size-14 shrink-0 items-center justify-center rounded-[16px] text-white transition-colors", running ? "bg-gradient-to-b from-[#4cd964] to-[#28b446] shadow-[0_4px_14px_rgb(52_199_89/0.35)]" : running === null ? "bg-gradient-to-b from-[#ffb340] to-[#ff9500]" : "bg-gradient-to-b from-[#aeaeb2] to-[#8e8e93]")}>
          <Power className="size-7" strokeWidth={2.4} />
          {running && <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-3.5 rounded-full border-2 border-card bg-ios-green" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-muted-foreground">侧键服务</p>
          <h2 className="text-[22px] leading-7 font-bold tracking-[-0.02em]">{statusText}</h2>
        </div>
      </div>
      <p className="mt-3 text-[14px] leading-[1.5] text-muted-foreground">{running ? "正在监听侧键，按已保存的组合执行操作。开机自动启动，意外退出会自动恢复。" : running === false ? "启动服务，让已保存的快捷操作随时待命。" : "查询服务状态后，即可启动或停止侧键服务。"}</p>
      {autoRefresh && running && <p className="mt-1 text-[12px] text-tertiary-foreground">详情每 5 秒自动刷新，页面在后台时暂停</p>}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {running !== null && <Button data-test="daemon-toggle" size="lg" variant={running ? "outline" : "default"} className={cn(running && "text-destructive")} onClick={onToggle} disabled={!enabled || busy}><Power />{running ? "停止服务" : "启动服务"}</Button>}
        <Button size="lg" variant="outline" className={cn(running === null && "col-span-2")} onClick={onRefresh} disabled={!enabled || busy}><RefreshCw className={statusBusy ? "animate-spin" : ""} />{statusBusy ? "查询中…" : "查询状态"}</Button>
      </div>
    </section>

    <section aria-label="统计" className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="col-span-2 min-w-0 rounded-[22px] bg-card p-4 sm:col-span-1">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ios-orange"><Activity className="size-4" strokeWidth={2.4} />今日按压</p>
        <p className="mt-1 text-[34px] leading-10 font-bold tracking-[-0.03em] tabular-nums">{today ? today.presses : "—"}</p>
        <p className="text-[13px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">{today ? `成功 ${today.success} · 失败 ${today.failed} · 未匹配 ${today.dropped}` : "读取记录后显示"}</p>
      </div>
      <button type="button" onClick={onBindings} className="pressable min-w-0 rounded-[22px] bg-card p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ios-blue"><Keyboard className="size-4" strokeWidth={2.4} />已配置绑定</p>
        <p className="mt-1 text-[34px] leading-10 font-bold tracking-[-0.03em] tabular-nums">{bindingCount}</p>
        <p className="text-[13px] leading-5 text-muted-foreground">个组合</p>
      </button>
      <div className="min-w-0 rounded-[22px] bg-card p-4">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ios-purple"><ListChecks className="size-4" strokeWidth={2.4} />我的模板</p>
        <p className="mt-1 text-[34px] leading-10 font-bold tracking-[-0.03em] tabular-nums">{templateCount}</p>
        <p className="text-[13px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">条命令，另有内置动作</p>
      </div>
    </section>

    {running && snapshot?.proc && metrics && <ServiceDetails snapshot={snapshot} metrics={metrics} />}

    <LatestRun record={latestOutput} row={latest} templates={templates} onDiagnostics={onDiagnostics} />

    {!bindingCount && <Group header="三步上手" footer="不会写命令也没关系：套用推荐方案，或从内置动作里点选。">
      {["选择按压方式（单击、双击、长按…）", "选择动作，如截屏、播放/暂停", "点“保存配置”，立即生效"].map((label, i) => <div key={label} className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-[15px]"><span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground">{i + 1}</span>{label}</div>)}
    </Group>}

    <Group header="快捷入口" icons>
      <Row icon={Plus} color="blue" title="新增绑定" chevron disabled={!canEdit} onClick={e => onAdd(e.currentTarget)} />
      {onPacks && <Row icon={Sparkles} color="purple" title="一键方案" chevron disabled={!canEdit} onClick={onPacks} />}
      <Row icon={Keyboard} color="indigo" title="管理我的绑定" chevron onClick={onBindings} />
      <Row icon={Stethoscope} color="teal" title="查看诊断记录" chevron onClick={onDiagnostics} />
    </Group>

    <Group aria-labelledby="faq-title" header={<span id="faq-title">常见问题</span>}>
      {FAQ.map(([q, a]) => <details key={q} className="group min-w-0">
        <summary className="pressable flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-[15px] outline-none focus-visible:bg-accent">{q}<ChevronRight className="size-[18px] shrink-0 text-tertiary-foreground transition-transform duration-200 group-open:rotate-90" strokeWidth={2.5} /></summary>
        <p className="px-4 pb-4 text-[14px] leading-[1.6] text-muted-foreground [overflow-wrap:anywhere]">{a}</p>
      </details>)}
    </Group>
  </>;
});
