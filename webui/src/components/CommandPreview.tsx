import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { decodeScript } from "@/lib/script";

export function CommandPreview({ command, testId, className }: { command: string; testId?: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  // 多行脚本以编码形式保存，展示时解码；首行作为摘要。
  const script = decodeScript(command);
  const shown = script ?? command;
  const firstLine = script ? script.split("\n")[0] : command;
  const long = script ? script.includes("\n") || script.length > 88 : command.length > 88;
  return <div data-testid={testId} className={cn("min-w-0 max-w-full rounded-lg border border-white/5 bg-black/20 px-3 py-2.5", className)}>
    <code className="block min-w-0 whitespace-pre-wrap font-mono text-xs leading-6 text-muted-foreground [overflow-wrap:anywhere]">{script && <span className="mr-2 rounded bg-primary/15 px-1.5 py-0.5 font-sans text-[10px] text-primary">多行脚本 · {script.split("\n").length} 行</span>}{long ? firstLine.slice(0, 88) + "…" : shown}</code>
    {long && <>
      <button type="button" aria-expanded={expanded} className="mt-1 inline-flex items-center gap-1 rounded text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}{expanded ? "收起命令" : script ? "展开完整脚本" : "展开完整命令"}
      </button>
      {expanded && <pre className="mt-2 max-h-60 min-w-0 max-w-full overflow-auto whitespace-pre-wrap border-t pt-2 font-mono text-xs leading-6 [overflow-wrap:anywhere]">{shown}</pre>}
    </>}
  </div>;
}
