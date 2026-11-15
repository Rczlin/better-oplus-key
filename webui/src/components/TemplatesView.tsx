import { useState } from "react";
import { Tabs } from "radix-ui";
import { Search, Terminal, Pencil, Trash2, ArrowUpRight, RefreshCw, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { CommandPreview } from "./CommandPreview";
import { Group, IconTile, LargeTitle } from "./ui/ios";
import type { ShellTemplate } from "@/lib/templates";
import { PRESETS, PRESET_CATEGORIES, type Preset } from "@/lib/presets";
import { MAX_COMMAND_BYTES } from "@/lib/config";
import { isMultiline, toEditableCommand, toStoredCommand } from "@/lib/script";

interface Props {
  templates: ShellTemplate[];
  busy: boolean;
  reloadDisabled?: boolean;
  onEdit(id: string): void;
  onDelete(id: string): void;
  onUse(template: ShellTemplate): void;
  onUsePreset?(preset: Preset): void;
  useDisabled?: boolean;
  onSave(template: ShellTemplate): void | Promise<void>;
  onReload(): void;
}
export function TemplatesView({ templates, busy, reloadDisabled = busy, onEdit, onDelete, onUse, onUsePreset, useDisabled = busy, onSave, onReload }: Props) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState(templates.length ? "mine" : "builtin");
  const [draft, setDraft] = useState<ShellTemplate | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const query = search.toLocaleLowerCase();
  const filtered = templates.filter(t => `${t.name}\n${toEditableCommand(t.command)}`.toLocaleLowerCase().includes(query));
  const builtins = PRESETS.filter(p => `${p.name}\n${p.description}\n${p.command ?? ""}`.toLocaleLowerCase().includes(query));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || busy || saving) return;
    setSaving(true); setError("");
    try { await onSave({ ...draft, command: toStoredCommand(draft.command), updatedAt: Date.now() }); setDraft(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  return <>
    <LargeTitle eyebrow="常用命令，随时复用" title="模板库" subtitle="内置常用动作开箱即用；你保存过的命令会自动收进“我的模板”。" actions={<Button variant="outline" onClick={onReload} disabled={reloadDisabled}><RefreshCw />重新读取模板</Button>} />
    <div className="relative min-w-0"><Search className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-muted-foreground" /><Input type="search" aria-label="搜索模板" placeholder="搜索动作、模板名称或命令" value={search} onChange={e => setSearch(e.target.value)} className="h-10 rounded-[11px] pl-10" /></div>
    {draft && <form onSubmit={submit} className="grid min-w-0 gap-4 rounded-[22px] bg-card p-4 ring-2 ring-primary/40">
      <div className="flex items-center justify-between"><h2 className="text-[17px] font-semibold">编辑模板</h2><Button type="button" size="icon-sm" variant="outline" aria-label="关闭编辑" disabled={saving} onClick={() => setDraft(null)}><X /></Button></div>
      <div className="grid gap-1.5"><Label htmlFor="template-name" className="px-1 text-[13px] text-muted-foreground">模板名称</Label><Input id="template-name" value={draft.name} disabled={busy || saving} onChange={e => setDraft({ ...draft, name: e.target.value })} /><p className="px-1 text-[12px] text-muted-foreground">{new TextEncoder().encode(draft.name).length} / 128 字节</p></div>
      <div className="grid min-w-0 gap-1.5"><Label htmlFor="template-command" className="px-1 text-[13px] text-muted-foreground">模板命令</Label><textarea id="template-command" rows={4} value={draft.command} disabled={busy || saving} onChange={e => setDraft({ ...draft, command: e.target.value })} className="min-w-0 w-full resize-y rounded-xl bg-secondary p-3 font-mono text-[13px] leading-5 outline-none focus-visible:ring-3 focus-visible:ring-ring [overflow-wrap:anywhere]" /><p className="px-1 text-[12px] text-muted-foreground">{new TextEncoder().encode(toStoredCommand(draft.command)).length} / {MAX_COMMAND_BYTES} 字节{isMultiline(draft.command) ? " · 多行脚本，保存时自动编码为一行" : " · 支持多行脚本"}</p><p className="px-1 text-[12px] leading-5 text-warning">命令以 root 权限执行，请确认内容可信。</p></div>
      {error && <p role="alert" className="text-[14px] text-destructive [overflow-wrap:anywhere]">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setDraft(null)}>取消</Button><Button type="submit" disabled={busy || saving || !draft.command}>{saving ? "保存中…" : "保存模板"}</Button></div>
    </form>}
    <Tabs.Root value={tab} onValueChange={setTab} className="grid min-w-0 max-w-full gap-6">
      <Tabs.List aria-label="模板类型" className="segmented">
        {[{ id: "builtin", name: `内置动作 ${PRESETS.length}` }, { id: "mine", name: `我的模板 ${templates.length}` }].map(({ id, name }) => <Tabs.Trigger key={id} value={id} className="segmented-item">{name}</Tabs.Trigger>)}
      </Tabs.List>
      <Tabs.Content value="builtin" className="grid min-w-0 max-w-full gap-6 outline-none">
        {PRESET_CATEGORIES.map(category => { const items = builtins.filter(p => p.category === category.id); return items.length ? <Group key={category.id} header={category.name}>{items.map(preset => <article key={preset.id} data-testid={`preset-${preset.id}`} className="grid min-w-0 content-start gap-2.5 px-4 py-3.5">
          <div className="flex min-w-0 items-start gap-3"><div className="min-w-0 flex-1"><h3 className="text-[16px] font-semibold leading-6">{preset.name}</h3><p className="text-[13px] leading-5 text-muted-foreground">{preset.description}</p></div>
          {onUsePreset && <Button size="sm" variant="secondary" className="shrink-0" disabled={useDisabled} onClick={() => onUsePreset(preset)}>使用此动作</Button>}</div>
          {preset.command ? <CommandPreview command={preset.command} /> : <p className="rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">使用时填写{preset.params?.map(p => p.label).join("、")}</p>}
        </article>)}</Group> : null; })}
        {!builtins.length && <p className="rounded-[22px] bg-card px-5 py-12 text-center text-[15px] text-muted-foreground">没有匹配的内置动作，试试其他关键词。</p>}
      </Tabs.Content>
      <Tabs.Content value="mine" className="grid min-w-0 max-w-full gap-4 outline-none">
        {filtered.length > 0 && <Group header="我的模板">{filtered.map(template => <article key={template.id} className="grid min-w-0 content-start gap-2.5 px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-3"><IconTile icon={Terminal} color="gray" /><h3 className="min-w-0 flex-1 text-[16px] font-semibold leading-6 [overflow-wrap:anywhere]">{template.name}</h3></div>
          <CommandPreview command={template.command} />
          <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={busy || saving} onClick={() => { onEdit(template.id); setDraft({ ...template, command: toEditableCommand(template.command) }); setError(""); }}><Pencil />编辑模板</Button><Button size="sm" variant="destructive" disabled={busy || saving} onClick={() => onDelete(template.id)}><Trash2 />删除模板</Button><Button size="sm" variant="secondary" className="ml-auto" disabled={busy || saving} onClick={() => onUse(template)}>应用到绑定<ArrowUpRight /></Button></div>
        </article>)}</Group>}
        {!filtered.length && <section className="grid justify-items-center gap-3 rounded-[22px] bg-card px-6 py-10 text-center"><IconTile icon={Terminal} color="gray" className="size-14 rounded-[16px] [&_svg]:size-7" /><h2 className="text-[19px] font-semibold">{search ? "没有匹配的模板" : "还没有自己的模板"}</h2><p className="max-w-sm text-[15px] leading-[1.5] text-muted-foreground">{search ? "试试其他名称或命令关键词。" : "成功保存绑定后，用到的命令会自动出现在这里，也可以随时重命名。"}</p></section>}
      </Tabs.Content>
    </Tabs.Root>
  </>;
}
