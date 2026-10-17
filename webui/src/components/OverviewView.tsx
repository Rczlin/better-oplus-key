import { ArrowRight, Plus, Power, RefreshCw, Keyboard, Terminal, Activity, Zap } from "lucide-react";
import { Button } from "./ui/button";
import { formatExplainRow, type ExplainRow } from "@/lib/log";

interface Props {
  running: boolean | null;
  bindingCount: number;
  templateCount: number;
  latest?: ExplainRow;
  busy: boolean;
  statusBusy: boolean;
  enabled: boolean;
  canEdit: boolean;
  onToggle(): void;
  onRefresh(): void;
  onAdd(trigger: HTMLElement): void;
  onBindings(): void;
  onDiagnostics(): void;
}
export function OverviewView({ running, bindingCount, templateCount, latest, busy, statusBusy, enabled, canEdit, onToggle, onRefresh, onAdd, onBindings, onDiagnostics }: Props) {
  return <>
    <header><p className="mb-2 text-xs font-medium tracking-widest text-primary">你的快捷操作中心</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">侧键控制台</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">轻按、长按，串起你的日常操作。</p></header>
    <section className="service-panel relative min-w-0 overflow-hidden rounded-2xl border p-5 sm:p-7">
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-4"><span className="rounded-2xl border border-primary/20 bg-primary/10 p-3.5 text-primary"><Zap className="size-7" /></span><div>
          <p className="mb-2 text-sm text-muted-foreground">侧键服务</p><h2 className="flex items-center gap-2.5 text-xl font-semibold"><span className={`size-2 rounded-full ${running ? "bg-emerald-400 shadow-[0_0_12px_#34d39966]" : running === null ? "bg-amber-300" : "bg-slate-500"}`} />{running === null ? "状态未知" : running ? "运行中" : "已停止"}</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{running ? "服务正在监听侧键，按已保存的组合执行操作。" : running === false ? "启动服务，让已保存的快捷操作随时待命。" : "查询服务状态后，即可启动或停止侧键服务。"}</p>
        </div></div>
        <div className="flex flex-wrap gap-2 self-center">
          {running !== null && <Button data-test="daemon-toggle" size="lg" variant={running ? "outline" : "default"} onClick={onToggle} disabled={!enabled || busy}><Power />{running ? "停止服务" : "启动服务"}</Button>}
          <Button size="lg" variant="outline" onClick={onRefresh} disabled={!enabled || busy}><RefreshCw className={statusBusy ? "animate-spin" : ""} />{statusBusy ? "查询中…" : "查询状态"}</Button>
        </div>
      </div>
    </section>
    <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
      {[{ icon: Keyboard, label: "已配置绑定", value: bindingCount, unit: "个组合" }, { icon: Terminal, label: "Shell 模板", value: templateCount, unit: "条命令" }, { icon: Activity, label: "最近执行", value: latest ? formatExplainRow(latest).resultLabel : "等待记录", unit: latest?.time ?? "在诊断页刷新后显示" }].map(({ icon: Icon, label, value, unit }) =>
        <div key={label} className="min-w-0 rounded-2xl border bg-card p-5 last:col-span-2 sm:last:col-span-1"><div className="mb-5 flex items-center justify-between text-sm text-muted-foreground"><span>{label}</span><Icon className="size-4 shrink-0 text-primary/80" /></div><p className="text-2xl font-semibold [overflow-wrap:anywhere]">{value}</p><p className="mt-2 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{unit}</p></div>)}
    </div>
    <section className="min-w-0 rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold">下一个操作，一按即达</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">选择按压顺序，填入命令，保存后即可使用。</p></div><Button size="lg" onClick={e => onAdd(e.currentTarget)} disabled={!canEdit}><Plus />新增绑定</Button></div>
      <div className="mt-6 grid gap-4 border-t pt-5 sm:grid-cols-3">{["添加短按或长按", "填写或选择 Shell 命令", "保存配置并开始使用"].map((label, i) => <div key={label} className="flex items-center gap-3 text-sm text-muted-foreground"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs text-foreground">0{i + 1}</span>{label}</div>)}</div>
    </section>
    <div className="flex flex-wrap gap-3"><Button variant="ghost" onClick={onBindings}>管理我的绑定<ArrowRight /></Button><Button variant="ghost" onClick={onDiagnostics}>查看诊断记录<ArrowRight /></Button></div>
  </>;
}
