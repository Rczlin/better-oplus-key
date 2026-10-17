import { Check, CircleAlert, CircleDashed } from "lucide-react";
import { CommandPreview } from "./CommandPreview";
import { formatExplainRow, type ExplainRow } from "@/lib/log";

export function LogRows({ rows, logsRead, onOpen }: { rows: ExplainRow[]; logsRead: boolean; onOpen?: (row: ExplainRow) => void }) {
  return <div data-testid="log-explain" className="grid min-w-0 max-w-full gap-3">
    {rows.length ? rows.map((row, i) => {
      const { resultLabel, summary } = formatExplainRow(row);
      const success = row.result === "0", failure = row.level === "ERROR" || (!!row.result && !success && row.result !== "dropped");
      const Icon = success ? Check : failure ? CircleAlert : CircleDashed;
      return <article key={i} className="min-w-0 max-w-full rounded-xl border bg-card p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 ${success ? "bg-emerald-400/10 text-emerald-300" : failure ? "bg-red-400/10 text-red-300" : "bg-amber-400/10 text-amber-200"}`}><Icon className="size-3" />{resultLabel}</span>
          <time className="text-muted-foreground">{row.time}</time>
        </div>
        {summary.length > 140 ? <details className="my-3 min-w-0 text-sm leading-6"><summary className="cursor-pointer rounded [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring">{summary.slice(0, 140)}… <span className="text-xs text-primary">展开完整记录</span></summary><p className="mt-2 max-h-48 min-w-0 overflow-auto [overflow-wrap:anywhere]">{summary}</p></details> : <p className="my-3 min-w-0 text-sm leading-6 [overflow-wrap:anywhere]">{summary}</p>}
        {row.action && row.action !== "none" && <CommandPreview command={row.action} />}
        {onOpen && <button type="button" className="mt-2 text-xs text-primary" onClick={() => onOpen(row)}>查看详情</button>}
      </article>;
    }) : <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{logsRead ? "暂无可用记录" : "点击刷新读取"}</div>}
  </div>;
}
