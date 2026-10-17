import { ArrowRight, Plus, Power, RefreshCw, Keyboard, Terminal, Activity, Zap, Sparkles, CircleHelp } from "lucide-react";
import { Button } from "./ui/button";
import { formatExplainRow, type ExplainRow } from "@/lib/log";

const FAQ: [string, string][] = [
  ["短按和长按怎么区分？", "按下后马上松开是短按；按住超过“长按时长”（默认 300 毫秒）再松开是长按。可以在“绑定 → 时间设置”中选择灵敏、标准或从容。"],
  ["为什么单击有时要等一下才执行？", "如果同时设置了单击和双击，单击后需要等“连按间隔”确认你不再按第二下，才会执行单击。只设置单击时，松开立即执行。"],
  ["设置好了为什么没反应？", "先确认已点“保存配置”，并在本页看到服务“运行中”。再到“诊断”页刷新记录：显示“未匹配”说明按法和设置的组合不一致；显示“执行失败”说明命令本身出错，可在编辑器里点“试运行”检查。"],
  ["为什么显示“执行失败（2）”？", "通常是命令把输出写进了 /data/adb 下的文件：input、am、cmd 等命令会把输出交给系统服务，系统无权访问该目录，于是报 Failed transaction。去掉重定向或改成 >/dev/null 即可。0.3.0 起服务本身已不再触发这个问题。"],
  ["内置动作安全吗？", "内置动作只调用系统自带命令（模拟按键、打开相机、切换开关等）。所有命令都以 root 权限运行，自己填写或从网上复制的命令请确认来源可信。"],
  ["能设置手电筒吗？", "手电筒没有各机型通用的命令，所以没有内置。可以用“打开指定应用”启动一个手电筒或自动化应用作为替代。"],
  ["侧键原来的功能去哪了？", "服务运行时会接管侧键；停止服务后，侧键恢复系统原有功能。"],
];

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
  onPacks?(): void;
  onBindings(): void;
  onDiagnostics(): void;
}
export function OverviewView({ running, bindingCount, templateCount, latest, busy, statusBusy, enabled, canEdit, onToggle, onRefresh, onAdd, onPacks, onBindings, onDiagnostics }: Props) {
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
      {[{ icon: Keyboard, label: "已配置绑定", value: bindingCount, unit: "个组合" }, { icon: Terminal, label: "我的模板", value: templateCount, unit: "条命令（另有内置动作可直接用）" }, { icon: Activity, label: "最近执行", value: latest ? formatExplainRow(latest).resultLabel : "等待记录", unit: latest?.time ?? "在诊断页刷新后显示" }].map(({ icon: Icon, label, value, unit }) =>
        <div key={label} className="min-w-0 rounded-2xl border bg-card p-5 last:col-span-2 sm:last:col-span-1"><div className="mb-5 flex items-center justify-between text-sm text-muted-foreground"><span>{label}</span><Icon className="size-4 shrink-0 text-primary/80" /></div><p className="text-2xl font-semibold [overflow-wrap:anywhere]">{value}</p><p className="mt-2 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{unit}</p></div>)}
    </div>
    <section className="min-w-0 rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold">{bindingCount ? "下一个操作，一按即达" : "三步上手"}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{bindingCount ? "选择按压方式和动作，保存后即可使用。" : "不会写命令也没关系：套用推荐方案，或从内置动作里点选。"}</p></div><div className="flex flex-wrap gap-2">{onPacks && <Button size="lg" variant={bindingCount ? "outline" : "default"} onClick={onPacks} disabled={!canEdit}><Sparkles />一键方案</Button>}<Button size="lg" variant={bindingCount || !onPacks ? "default" : "outline"} onClick={e => onAdd(e.currentTarget)} disabled={!canEdit}><Plus />新增绑定</Button></div></div>
      <div className="mt-6 grid gap-4 border-t pt-5 sm:grid-cols-3">{["选择按压方式（单击、双击、长按…）", "选择动作，如截屏、播放/暂停", "点“保存配置”，立即生效"].map((label, i) => <div key={label} className="flex items-center gap-3 text-sm text-muted-foreground"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs text-foreground">0{i + 1}</span>{label}</div>)}</div>
    </section>
    <div className="flex flex-wrap gap-3"><Button variant="ghost" onClick={onBindings}>管理我的绑定<ArrowRight /></Button><Button variant="ghost" onClick={onDiagnostics}>查看诊断记录<ArrowRight /></Button></div>
    <section aria-labelledby="faq-title" className="min-w-0 rounded-2xl border bg-card p-5 sm:p-6">
      <h2 id="faq-title" className="flex items-center gap-2 font-semibold"><CircleHelp className="size-4 text-primary" />常见问题</h2>
      <div className="mt-4 grid gap-2">{FAQ.map(([q, a]) => <details key={q} className="group min-w-0 rounded-xl border bg-background/40 px-4 py-3"><summary className="cursor-pointer list-none text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">{q}</summary><p className="mt-2 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{a}</p></details>)}</div>
    </section>
  </>;
}
