import { useState } from "react";
import { Tabs } from "radix-ui";
import { RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { LogRows } from "./LogRows";
import type { EventRow, ExplainRow } from "@/lib/log";

export function DiagnosticsView({ explain, events, errors, logsRead, busy, enabled, onRefresh }: { explain: ExplainRow[]; events: EventRow[]; errors: string[]; logsRead: boolean; busy: boolean; enabled: boolean; onRefresh(): void }) {
  const [tab, setTab] = useState("explain");
  return <>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-xs tracking-widest text-primary">了解每一次按压</p><h1 className="text-2xl font-semibold sm:text-3xl">诊断记录</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">查看识别与执行结果，按需读取最近 200 行。</p></div><Button data-test="log-refresh" size="lg" variant="outline" disabled={!enabled || busy} onClick={onRefresh}><RefreshCw className={busy ? "animate-spin" : ""} />{busy ? "读取中…" : "刷新记录"}</Button></header>
    {errors.map(error => <p key={error} role="alert" className="min-w-0 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive [overflow-wrap:anywhere]">{error}</p>)}
    <Tabs.Root value={tab} onValueChange={setTab} className="min-w-0 max-w-full">
      <Tabs.List aria-label="记录类型" className="mb-5 inline-flex max-w-full gap-1 rounded-xl border bg-card p-1">
        {[{ id: "explain", name: "解释记录" }, { id: "events", name: "原始事件" }].map(({ id, name }) => <Tabs.Trigger key={id} value={id} className="rounded-lg px-4 py-2.5 text-sm text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-primary/15 data-[state=active]:text-primary">{name}</Tabs.Trigger>)}
      </Tabs.List>
      <Tabs.Content value="explain" className="min-w-0 max-w-full outline-none"><LogRows rows={[...explain].reverse()} logsRead={logsRead} /></Tabs.Content>
      <Tabs.Content value="events" className="min-w-0 max-w-full outline-none"><div className="min-w-0 max-w-full overflow-hidden rounded-xl border bg-card"><div className="border-b px-4 py-3 text-xs text-muted-foreground">原始按压数据 · {events.length} 条可用事件</div><pre data-testid="log-events" className="h-80 min-w-0 max-w-full overflow-auto p-4 font-mono text-xs leading-6">{events.length ? events.map(e => JSON.stringify(e)).join("\n") : logsRead ? "暂无可用记录" : "点击刷新读取"}</pre></div></Tabs.Content>
    </Tabs.Root>
  </>;
}
