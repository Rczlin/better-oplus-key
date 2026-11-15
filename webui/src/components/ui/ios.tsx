import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** 大标题：iOS 导航栏的 Large Title，副标题与右侧操作可选。 */
export function LargeTitle({ eyebrow, title, subtitle, actions, className }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return <header className={cn("flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-3 px-1", className)}>
    <div className="min-w-0">
      {eyebrow && <p className="mb-0.5 text-[13px] font-semibold text-muted-foreground">{eyebrow}</p>}
      <h1 className="text-[32px] leading-[1.15] font-bold tracking-[-0.025em] sm:text-[34px]">{title}</h1>
      {subtitle && <p className="mt-1.5 max-w-xl text-[15px] leading-[1.45] text-muted-foreground">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>;
}

/** 分组：小标题 + 圆角卡片 + 脚注，对应 iOS 的 inset grouped 列表。 */
export function Group({ header, headerAction, footer, children, className, listClassName, icons, plain, ...props }: Omit<ComponentProps<"section">, "children"> & { header?: ReactNode; headerAction?: ReactNode; footer?: ReactNode; children: ReactNode; listClassName?: string; icons?: boolean; plain?: boolean }) {
  return <section className={cn("grid min-w-0 gap-1.5", className)} {...props}>
    {(header || headerAction) && <div className="flex min-h-6 min-w-0 items-end justify-between gap-3 px-4">
      {header && <h2 className="text-[13px] font-medium text-muted-foreground">{header}</h2>}
      {headerAction}
    </div>}
    <div className={cn("min-w-0 overflow-hidden rounded-2xl bg-card", !plain && "ios-list", icons && "with-icons", listClassName)}>{children}</div>
    {footer && <div className="px-4 text-[13px] leading-[1.45] text-muted-foreground [overflow-wrap:anywhere]">{footer}</div>}
  </section>;
}

const TILE: Record<string, string> = {
  blue: "bg-ios-blue", green: "bg-ios-green", orange: "bg-ios-orange", red: "bg-ios-red", purple: "bg-ios-purple",
  indigo: "bg-ios-indigo", teal: "bg-ios-teal", pink: "bg-ios-pink", gray: "bg-ios-gray",
};
export type TileColor = keyof typeof TILE;

/** 设置页风格的彩色图标方块。 */
export function IconTile({ icon: Icon, color = "blue", className }: { icon: LucideIcon; color?: TileColor; className?: string }) {
  return <span aria-hidden="true" className={cn("flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-white", TILE[color], className)}><Icon className="size-[18px]" strokeWidth={2.2} /></span>;
}

interface RowBase { icon?: LucideIcon; color?: TileColor; title: ReactNode; subtitle?: ReactNode; value?: ReactNode; chevron?: boolean; className?: string; testId?: string }

/** 列表行：左侧图标与标题，右侧数值或箭头。传 onClick 时整行可点。 */
export function Row({ icon, color, title, subtitle, value, chevron, className, testId, onClick, disabled, ...rest }: RowBase & Omit<ComponentProps<"button">, "title" | "value">) {
  const body = <>
    {icon && <IconTile icon={icon} color={color} />}
    <span className="min-w-0 flex-1">
      <span className="block text-[16px] leading-6 [overflow-wrap:anywhere]">{title}</span>
      {subtitle && <span className="block text-[13px] leading-[1.35] text-muted-foreground [overflow-wrap:anywhere]">{subtitle}</span>}
    </span>
    {value !== undefined && <span className="min-w-0 max-w-[55%] text-right text-[16px] text-muted-foreground tabular-nums [overflow-wrap:anywhere]">{value}</span>}
    {chevron && <ChevronRight aria-hidden="true" className="size-[18px] shrink-0 text-tertiary-foreground" strokeWidth={2.5} />}
  </>;
  const cls = cn("flex min-h-12 w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left", className);
  if (onClick) return <button type="button" data-testid={testId} className={cn(cls, "pressable outline-none focus-visible:bg-accent disabled:opacity-45")} onClick={onClick} disabled={disabled} {...rest}>{body}</button>;
  return <div data-testid={testId} className={cls}>{body}</div>;
}

/** 状态胶囊：成功 / 警告 / 失败 / 中性。 */
export function Pill({ tone = "neutral", className, children }: { tone?: "success" | "warning" | "danger" | "neutral" | "tint"; className?: string; children: ReactNode }) {
  const tones = {
    success: "bg-success/12 text-success", warning: "bg-ios-orange/12 text-warning", danger: "bg-destructive/12 text-destructive",
    neutral: "bg-secondary text-muted-foreground", tint: "bg-primary/12 text-primary",
  };
  return <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium leading-5 [overflow-wrap:anywhere]", tones[tone], className)}>{children}</span>;
}

/** 提示条：用于错误、警告与说明。 */
export function Notice({ tone = "info", className, children, ...props }: ComponentProps<"div"> & { tone?: "info" | "warning" | "danger" | "success" }) {
  const tones = {
    info: "bg-primary/10 text-foreground", warning: "bg-ios-orange/12 text-foreground", danger: "bg-destructive/12 text-foreground", success: "bg-success/12 text-foreground",
  };
  return <div className={cn("min-w-0 rounded-2xl px-4 py-3 text-[14px] leading-[1.5] [overflow-wrap:anywhere]", tones[tone], className)} {...props}>{children}</div>;
}

export const sheetOverlay = "fixed inset-0 z-40 bg-black/40 duration-300 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out";
/** 弹层：手机上是底部 sheet，宽屏上是居中卡片。 */
export const sheetContent = "sheet-content fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] min-w-0 flex-col overflow-hidden rounded-t-[22px] bg-background shadow-[0_-10px_40px_rgb(0_0_0/0.25)] outline-none duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88dvh] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[22px] sm:shadow-2xl sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:slide-in-from-bottom-2 sm:data-[state=closed]:slide-out-to-bottom-2 sm:data-[state=open]:fade-in sm:data-[state=closed]:fade-out";
