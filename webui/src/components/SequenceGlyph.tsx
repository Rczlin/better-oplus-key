import { cn } from "@/lib/utils";

/** 用图形表示按压组合：短按为圆点，长按为横条，读者一眼就能看出节奏。 */
export function SequenceGlyph({ seq, className, size = "md" }: { seq: string; className?: string; size?: "sm" | "md" }) {
  const dot = size === "sm" ? "h-1.5 w-1.5" : "h-2.5 w-2.5";
  const bar = size === "sm" ? "h-1.5 w-4" : "h-2.5 w-7";
  return <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center", size === "sm" ? "gap-1" : "gap-1.5", className)}>
    {[...seq].map((s, i) => <span key={i} className={cn("rounded-full bg-primary", s === "0" ? dot : bar)} />)}
  </span>;
}
