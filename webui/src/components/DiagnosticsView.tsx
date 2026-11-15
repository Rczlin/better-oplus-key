import { useMemo, useState } from "react";
import { Tabs } from "radix-ui";
import { RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { LogRows } from "./LogRows";
import { Group, LargeTitle, Notice } from "./ui/ios";
import { OutputRows } from "./OutputRows";
import type { OutputRecord } from "@/lib/output";
import type { EventRow, ExplainRow } from "@/lib/log";
import type { ShellTemplate } from "@/lib/templates";

export function DiagnosticsView({ explain, events, outputs = [], outputAvailable = false, errors, logsRead, busy, enabled, onRefresh, templates = [] }: { explain: ExplainRow[]; events: EventRow[]; outputs?: OutputRecord[]; outputAvailable?: boolean; errors: string[]; logsRead: boolean; busy: boolean; enabled: boolean; onRefresh(): void; templates?: ShellTemplate[] }) {
  const [tab, setTab] = useState("explain");
  const reversed = useMemo(() => [...explain].reverse(), [explain]);
  return <>
    <LargeTitle eyebrow="了解每一次按压" title="诊断记录" subtitle="按了侧键没反应？“未匹配”表示按法与设置不一致，“执行失败”表示命令出错，具体错误见“命令输出”。" actions={<Button data-test="log-refresh" variant="outline" disabled={!enabled || busy} onClick={onRefresh}><RefreshCw className={busy ? "animate-spin" : ""} />{busy ? "读取中…" : "刷新记录"}</Button>} />
    {errors.map(error => <Notice key={error} role="alert" tone="danger" className="text-destructive">{error}</Notice>)}
    <Tabs.Root value={tab} onValueChange={setTab} className="grid min-w-0 max-w-full gap-5">
      <Tabs.List aria-label="记录类型" className="segmented">
        {[{ id: "explain", name: "解释记录" }, { id: "output", name: "命令输出" }, { id: "events", name: "原始事件" }].map(({ id, name }) => <Tabs.Trigger key={id} value={id} className="segmented-item">{name}</Tabs.Trigger>)}
      </Tabs.List>
      <Tabs.Content value="explain" className="min-w-0 max-w-full outline-none"><LogRows rows={reversed} logsRead={logsRead} templates={templates} /></Tabs.Content>
      <Tabs.Content value="output" className="min-w-0 max-w-full outline-none"><OutputRows records={outputs} logsRead={logsRead} available={outputAvailable} templates={templates} /></Tabs.Content>
      <Tabs.Content value="events" className="min-w-0 max-w-full outline-none"><Group header={`原始按压数据 · ${events.length} 条可用事件`}><pre data-testid="log-events" className="h-80 min-w-0 max-w-full overflow-auto p-4 font-mono text-[12px] leading-6 text-muted-foreground">{events.length ? events.map(e => JSON.stringify(e)).join("\n") : logsRead ? "暂无可用记录" : "点击刷新读取"}</pre></Group></Tabs.Content>
    </Tabs.Root>
  </>;
}
