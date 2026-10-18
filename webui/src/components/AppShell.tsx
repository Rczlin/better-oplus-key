import type { ReactNode } from "react";
import { LayoutDashboard, Keyboard, Terminal, Activity, Command, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewId = "overview" | "bindings" | "templates" | "diagnostics";
const views = [
  { id: "overview", label: "概览", icon: LayoutDashboard },
  { id: "bindings", label: "绑定", icon: Keyboard },
  { id: "templates", label: "模板库", icon: Terminal },
  { id: "diagnostics", label: "诊断", icon: Activity },
] as const;

export function AppShell({ activeView, onViewChange, children }: { activeView: ViewId; onViewChange(view: ViewId): void; children: ReactNode }) {
  return <div className="min-h-dvh min-w-0 max-w-full md:pl-56">
    <nav aria-label="主导航" className="app-navigation fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t bg-sidebar/95 px-2 pt-1.5 shadow-[0_-8px_24px_#0006] backdrop-blur-xl md:shadow-none md:inset-y-0 md:right-auto md:w-56 md:flex-col md:items-stretch md:justify-start md:border-t-0 md:border-r md:px-4 md:pt-8">
      <div className="mb-10 hidden items-center gap-3 px-3 md:flex"><span className="rounded-xl bg-primary/15 p-2.5 text-primary"><Command className="size-6" /></span><div><p className="font-semibold tracking-wide">侧键</p><p className="mt-0.5 text-[10px] tracking-[0.18em] text-muted-foreground">SIDEKEY</p></div></div>
      {views.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={activeView === id ? "page" : undefined} onClick={() => onViewChange(id)}
        className={cn("group flex min-w-0 flex-1 select-none flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:mb-1.5 md:flex-none md:flex-row md:justify-start md:gap-3 md:px-4 md:py-3 md:text-sm", activeView === id ? "text-primary md:bg-primary/12" : "text-muted-foreground hover:text-foreground md:hover:bg-accent")}>
        <span className={cn("flex h-8 w-14 items-center justify-center rounded-full transition-colors md:h-auto md:w-auto md:bg-transparent", activeView === id ? "bg-primary/15" : "group-active:bg-accent")}><Icon className="size-5" /></span><span>{label}</span>{activeView === id && <ChevronRight className="ml-auto hidden size-4 md:block" />}
      </button>)}
      <div className="mt-auto hidden px-3 pb-6 pt-10 text-xs leading-6 text-muted-foreground md:block"><span className="mb-2 block h-px bg-border" />让每一次按压<br />都有自己的用处。</div>
    </nav>
    <main className="mx-auto grid min-w-0 max-w-6xl content-start gap-6 px-4 pt-7 pb-28 sm:px-8 md:py-10 lg:px-12">{children}</main>
  </div>;
}
