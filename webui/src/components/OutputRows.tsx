import { memo, useState } from "react";
import { Check, CircleAlert, Copy } from "lucide-react";
import { CommandPreview } from "./CommandPreview";
import { sequenceLabel } from "@/lib/config";
import { describeCommand } from "@/lib/presets";
import { formatMs, outputResultLabel, type OutputRecord } from "@/lib/output";
import type { ShellTemplate } from "@/lib/templates";

function OutputRow({ record, templates }: { record: OutputRecord; templates: ShellTemplate[] }) {
  const [copied, setCopied] = useState(false);
  const ok = record.code === 0;
  const text = record.output.trimEnd();
  const lines = text ? text.split("\n").length : 0;
  const copy = async () => {
    try { await navigator.clipboard.writeText(record.output); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setCopied(false); }
  };
  return <article data-testid="output-row" className="grid min-w-0 max-w-full gap-3 rounded-xl border bg-card p-4">
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 ${ok ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"}`}>{ok ? <Check className="size-3" /> : <CircleAlert className="size-3" />}{outputResultLabel(record.code)}</span>
      <time className="text-muted-foreground">{record.time}</time>
      <span className="text-muted-foreground">{sequenceLabel(record.seq)}</span>
      <span className="rounded-full bg-primary/10 px-2 py-1 text-primary [overflow-wrap:anywhere]">{describeCommand(record.action, templates).name}</span>
      <span className="text-muted-foreground">耗时 {formatMs(record.duration_ms)}</span>
    </div>
    <CommandPreview command={record.action} />
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>输出{lines ? ` · ${lines} 行` : ""}{record.truncated ? " · 已截断（最多保留 4 KB）" : ""}</span>
        {text && <button type="button" className="inline-flex items-center gap-1 rounded text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void copy()}><Copy className="size-3" />{copied ? "已复制" : "复制输出"}</button>}</div>
      <pre className="max-h-64 min-w-0 max-w-full overflow-auto whitespace-pre-wrap rounded-lg border border-white/5 bg-black/25 p-3 font-mono text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{text || "（命令没有输出）"}</pre>
    </div>
  </article>;
}

export const OutputRows = memo(function OutputRows({ records, logsRead, available, templates = [] }: { records: OutputRecord[]; logsRead: boolean; available: boolean; templates?: ShellTemplate[] }) {
  if (!records.length) return <div data-testid="log-output" className="rounded-xl border border-dashed p-10 text-center text-sm leading-6 text-muted-foreground">{!logsRead ? "点击刷新读取" : available ? "暂无命令输出记录，按一下侧键试试。" : "还没有命令输出记录。需要 0.4.0 及以上的守护进程：触发一次侧键动作后会自动生成。"}</div>;
  return <div data-testid="log-output" className="grid min-w-0 max-w-full gap-3">{[...records].reverse().map((r, i) => <OutputRow key={`${r.wall_ms}-${i}`} record={r} templates={templates} />)}</div>;
});
