import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheck, Info, TriangleAlert, OctagonX, Loader2 } from "lucide-react"

// 顶部居中的毛玻璃胶囊提示，跟随系统深浅色。
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      position="top-center"
      offset={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 10px)", left: "12px", right: "12px" }}
      gap={8}
      className="toaster group"
      icons={{
        success: <CircleCheck className="size-5 text-ios-green" />,
        info: <Info className="size-5 text-ios-blue" />,
        warning: <TriangleAlert className="size-5 text-ios-orange" />,
        error: <OctagonX className="size-5 text-ios-red" />,
        loading: <Loader2 className="size-5 animate-spin text-muted-foreground" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "material flex w-full items-center gap-3 rounded-[22px] px-4 py-3 text-[15px] font-medium leading-5 text-foreground shadow-[0_8px_32px_rgb(0_0_0/0.18)] ring-1 ring-black/5 dark:ring-white/10 [overflow-wrap:anywhere]",
          title: "min-w-0",
          description: "text-[13px] font-normal text-muted-foreground",
          icon: "shrink-0",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
