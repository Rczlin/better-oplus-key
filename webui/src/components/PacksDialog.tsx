import { useState } from "react";
import { Dialog } from "radix-ui";
import { Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "./ui/button";
import { SequenceGlyph } from "./SequenceGlyph";
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
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] duration-200 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
      <Dialog.Content className="sheet-content fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] min-w-0 overflow-y-auto overscroll-contain rounded-t-3xl border border-b-0 bg-card p-4 pt-6 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] shadow-2xl duration-200 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[92dvh] sm:w-[calc(100%-1.5rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border-b sm:p-6 sm:data-[state=open]:slide-in-from-bottom-4 sm:data-[state=closed]:slide-out-to-bottom-4 sm:data-[state=open]:fade-in sm:data-[state=closed]:fade-out">
        <Dialog.Title className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5 text-primary" />一键方案</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm leading-6 text-muted-foreground">选一套推荐绑定加入当前配置。套用后仍需点“保存配置”才会生效，之后可以随时单独修改。</Dialog.Description>
        {pending ? <div role="alert" className="mt-5 grid gap-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm">
          <p className="flex items-start gap-2 leading-6"><TriangleAlert className="mt-1 size-4 shrink-0 text-amber-300" />套用“{pending.pack.name}”会替换 {pending.replaced.length} 个已有组合：{pending.replaced.map(sequenceLabel).join("；")}。</p>
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" autoFocus onClick={() => setPending(null)}>返回</Button><Button type="button" disabled={disabled} onClick={() => { onApply(pending.next, pending.pack); setPending(null); }}>确认替换</Button></div>
        </div> : <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {PACKS.map(pack => <article key={pack.id} data-testid={`pack-${pack.id}`} className="grid min-w-0 content-start gap-3 rounded-xl border bg-background/40 p-4">
            <div><h3 className="font-medium">{pack.name}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{pack.description}</p></div>
            <ul className="grid gap-1.5 text-xs">{Object.entries(pack.bindings).sort(([a], [b]) => a.length - b.length || a.localeCompare(b)).map(([seq, id]) => <li key={seq} className="flex min-w-0 items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-2 text-muted-foreground"><SequenceGlyph seq={seq} size="sm" className="w-10" />{sequenceLabel(seq)}</span><span className="text-right">{findPreset(id)?.name}</span></li>)}</ul>
            <Button type="button" variant="secondary" disabled={disabled} onClick={() => choose(pack)} aria-label={`套用${pack.name}`}>套用此方案</Button>
          </article>)}
        </div>}
        <div className="mt-5 flex justify-end"><Dialog.Close asChild><Button type="button" variant="ghost">关闭</Button></Dialog.Close></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
