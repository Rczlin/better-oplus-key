import type { ReactNode } from "react";
import { Gauge, Keyboard, SquareTerminal, Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewId = "overview" | "bindings" | "templates" | "diagnostics";
const views = [
  { id: "overview", label: "概览", icon: Gauge },
  { id: "bindings", label: "绑定", icon: Keyboard },
  { id: "templates", label: "模板库", icon: SquareTerminal },
  { id: "diagnostics", label: "诊断", icon: Stethoscope },
] as const;

/** 手机：底部毛玻璃标签栏；宽屏：左侧边栏。 */
export function AppShell({ activeView, onViewChange, children }: { activeView: ViewId; onViewChange(view: ViewId): void; children: ReactNode }) {
  return <div className="min-h-dvh min-w-0 max-w-full md:pl-64">
    <nav aria-label="主导航" className="app-navigation material fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-border/60 px-2 pt-1 md:inset-y-0 md:right-auto md:w-64 md:flex-col md:items-stretch md:justify-start md:gap-0.5 md:border-t-0 md:border-r md:px-3 md:pt-10">
      <div className="mb-6 hidden items-center gap-3 px-3 md:flex">
        <span className="flex size-10 items-center justify-center rounded-[11px] bg-gradient-to-b from-[#5e9cff] to-[#0a6cff] text-white shadow-[0_2px_6px_rgb(0_122_255/0.35)]"><Keyboard className="size-5" strokeWidth={2.2} /></span>
        <div><p className="text-[17px] font-semibold tracking-[-0.02em]">侧键</p><p className="text-[12px] text-muted-foreground">OnePlus Side Key</p></div>
      </div>
      {views.map(({ id, label, icon: Icon }) => {
        const active = activeView === id;
        return <button key={id} type="button" aria-current={active ? "page" : undefined} onClick={() => onViewChange(id)}
          className={cn("flex min-h-[50px] min-w-0 flex-1 select-none flex-col items-center justify-center gap-0.5 rounded-xl text-[10.5px] font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring md:min-h-10 md:flex-none md:flex-row md:justify-start md:gap-3 md:px-3 md:text-[15px]",
            active ? "text-primary md:bg-primary md:text-primary-foreground" : "text-muted-foreground hover:text-foreground md:text-foreground md:hover:bg-accent")}>
          <Icon className="size-[25px] md:size-5" strokeWidth={active ? 2.3 : 1.9} /><span>{label}</span>
        </button>;
      })}
    </nav>
    <main className="mx-auto grid min-w-0 max-w-3xl content-start gap-7 px-4 pt-[calc(env(safe-area-inset-top,0px)+1.5rem)] pb-32 sm:px-6 md:pt-12 md:pb-16">{children}</main>
  </div>;
}
