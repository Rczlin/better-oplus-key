import { useState } from "react";
import { Dialog } from "radix-ui";
import { Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "./ui/button";
import { SequenceGlyph } from "./SequenceGlyph";
import { sheetContent, sheetOverlay } from "./ui/ios";
import { sequenceLabel } from "@/lib/config";
import { PACKS, applyPack, findPreset, type PresetPack } from "@/lib/presets";

interface Props {
  open: boolean;
  bindings: Record<string, string>;
  disabled: boolean;
  onOpenChange(open: boolean): void;
  onApply(bindings: Record<string, string>, pack: PresetPack): void;
}

export function PacksDialog({ open, bindings, disabled, onOpenChange, onApply }: Props) {
  const [pending, setPending] = useState<{ pack: PresetPack; next: Record<string, string>; replaced: string[] } | null>(null);
  const choose = (pack: PresetPack) => {
    const { bindings: next, replaced } = applyPack(bindings, pack);
    if (replaced.length) setPending({ pack, next, replaced });
    else onApply(next, pack);
  };
  return <Dialog.Root open={open} onOpenChange={o => { if (!o) setPending(null); onOpenChange(o); }}>
    <Dialog.Portal>
      <Dialog.Overlay className={sheetOverlay} />
      <Dialog.Content className={sheetContent}>
        <header className="material sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border/60 px-2 pt-4 pb-2.5 sm:pt-3">
          <span />
          <Dialog.Title className="flex items-center gap-1.5 text-[17px] font-semibold"><Sparkles className="size-[18px] text-ios-purple" />一键方案</Dialog.Title>
          <Dialog.Close asChild><Button type="button" variant="ghost" className="justify-self-end text-[16px] font-semibold">关闭</Button></Dialog.Close>
        </header>
        <div className="grid min-h-0 min-w-0 flex-1 content-start gap-5 overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:px-5">
          <Dialog.Description className="px-1 text-[14px] leading-[1.5] text-muted-foreground">选一套推荐绑定加入当前配置。套用后仍需点“保存配置”才会生效，之后可以随时单独修改。</Dialog.Description>
          {pending ? <div role="alert" className="grid gap-4 rounded-2xl bg-card p-4">
            <p className="flex items-start gap-3 text-[15px] leading-[1.5]"><TriangleAlert className="mt-0.5 size-5 shrink-0 text-ios-orange" />套用“{pending.pack.name}”会替换 {pending.replaced.length} 个已有组合：{pending.replaced.map(sequenceLabel).join("；")}。</p>
            <div className="grid grid-cols-2 gap-2"><Button type="button" variant="outline" autoFocus onClick={() => setPending(null)}>返回</Button><Button type="button" disabled={disabled} onClick={() => { onApply(pending.next, pending.pack); setPending(null); }}>确认替换</Button></div>
          </div> : <div className="grid gap-4 sm:grid-cols-2">
            {PACKS.map(pack => <article key={pack.id} data-testid={`pack-${pack.id}`} className="grid min-w-0 content-start gap-3 rounded-2xl bg-card p-4">
              <div><h3 className="text-[17px] font-semibold">{pack.name}</h3><p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{pack.description}</p></div>
              <ul className="ios-list grid rounded-xl bg-muted text-[13px]">{Object.entries(pack.bindings).sort(([a], [b]) => a.length - b.length || a.localeCompare(b)).map(([seq, id]) => <li key={seq} className="flex min-h-10 min-w-0 items-center justify-between gap-3 px-3 py-2"><span className="flex min-w-0 items-center gap-2 text-muted-foreground"><SequenceGlyph seq={seq} size="sm" className="w-10" />{sequenceLabel(seq)}</span><span className="text-right font-medium">{findPreset(id)?.name}</span></li>)}</ul>
              <Button type="button" variant="secondary" disabled={disabled} onClick={() => choose(pack)} aria-label={`套用${pack.name}`}>套用此方案</Button>
            </article>)}
          </div>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
