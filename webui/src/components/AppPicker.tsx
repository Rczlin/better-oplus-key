import { useMemo, useState } from "react";
import { Dialog } from "radix-ui";
import { Check, Search, AppWindow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sheetContent, sheetOverlay } from "@/components/ui/ios";
import { cn } from "@/lib/utils";
import { filterApps, type AppInfo } from "@/lib/apps";

export function AppIcon({ app, className }: { app?: AppInfo; className?: string }) {
  if (app?.icon) return <img src={app.icon} alt="" className={cn("size-10 shrink-0 rounded-[10px]", className)} />;
  return <span aria-hidden="true" className={cn("flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground", className)}><AppWindow className="size-5" /></span>;
}

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  apps: AppInfo[] | null;
  error?: string;
  selected?: string;
  onPick(pkg: string): void;
}

/** 底部弹出的应用选择：图标、名称、搜索，音乐应用排在最前。 */
export function AppPicker({ open, onOpenChange, apps, error, selected, onPick }: Props) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterApps(apps ?? [], query), [apps, query]);
  const music = shown.filter(a => a.music), other = shown.filter(a => !a.music);
  const section = (title: string, list: AppInfo[]) => list.length > 0 && <section aria-label={title}>
    <h3 className="px-5 pt-4 pb-1.5 text-[13px] font-medium text-muted-foreground">{title}</h3>
    <ul className="mx-4 overflow-hidden rounded-xl bg-card">{list.map(a => <li key={a.pkg} className="border-b border-border/70 last:border-b-0">
      <button type="button" className="flex min-h-14 w-full min-w-0 items-center gap-3 px-3 py-2 text-left active:bg-muted" onClick={() => { onPick(a.pkg); setQuery(""); onOpenChange(false); }}>
        <AppIcon app={a} />
        <span className="min-w-0 flex-1"><span className="block truncate text-[16px]">{a.label}</span><span className="block truncate font-mono text-[12px] text-muted-foreground">{a.pkg}</span></span>
        {a.pkg === selected && <Check aria-label="已选择" className="size-5 shrink-0 text-primary" />}
      </button>
    </li>)}</ul>
  </section>;
  return <Dialog.Root open={open} onOpenChange={o => { if (!o) setQuery(""); onOpenChange(o); }}>
    <Dialog.Portal>
      <Dialog.Overlay className={sheetOverlay} />
      <Dialog.Content className={sheetContent} aria-describedby={undefined}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pt-3 pb-2">
          <Dialog.Close asChild><Button type="button" variant="ghost" className="justify-self-start text-[16px] font-normal">取消</Button></Dialog.Close>
          <Dialog.Title className="text-[17px] font-semibold">选择音乐应用</Dialog.Title>
          <span />
        </div>
        <div className="relative px-4 pb-2">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="搜索应用" placeholder="搜索名称或包名" className="h-10 rounded-xl bg-muted pl-9" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
          {error ? <p role="alert" className="px-5 py-6 text-[14px] text-destructive">{error}</p>
            : !apps ? <p role="status" className="px-5 py-6 text-[14px] text-muted-foreground">正在读取已安装应用…</p>
            : shown.length === 0 ? <p className="px-5 py-6 text-[14px] text-muted-foreground">没有找到“{query}”</p>
            : <>{section("音乐应用", music)}{section("其他应用", other)}</>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
