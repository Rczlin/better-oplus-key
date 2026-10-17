import { useState } from "react";
import { Tabs } from "radix-ui";
import { Search, Terminal, Pencil, Trash2, ArrowUpRight, RefreshCw, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { CommandPreview } from "./CommandPreview";
import type { ShellTemplate } from "@/lib/templates";
import { PRESETS, PRESET_CATEGORIES, type Preset } from "@/lib/presets";

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
  const filtered = templates.filter(t => `${t.name}\n${t.command}`.toLocaleLowerCase().includes(query));
  const builtins = PRESETS.filter(p => `${p.name}\n${p.description}\n${p.command ?? ""}`.toLocaleLowerCase().includes(query));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || busy || saving) return;
    setSaving(true); setError("");
    try { await onSave({ ...draft, updatedAt: Date.now() }); setDraft(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  return <>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-xs tracking-widest text-primary">常用命令，随时复用</p><h1 className="text-2xl font-semibold sm:text-3xl">模板库</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">内置常用动作开箱即用；你保存过的命令会自动收进“我的模板”。</p></div><Button variant="outline" size="lg" onClick={onReload} disabled={reloadDisabled}><RefreshCw />重新读取模板</Button></header>
    <div className="relative min-w-0"><Search className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input aria-label="搜索模板" placeholder="搜索动作、模板名称或命令…" value={search} onChange={e => setSearch(e.target.value)} className="h-10 pl-10" /></div>
    {draft && <form onSubmit={submit} className="grid min-w-0 gap-4 rounded-2xl border border-primary/40 bg-card p-5">
      <div className="flex items-center justify-between"><h2 className="font-medium">编辑模板</h2><Button type="button" size="icon" variant="ghost" aria-label="关闭编辑" disabled={saving} onClick={() => setDraft(null)}><X /></Button></div>
      <div className="grid gap-2"><Label htmlFor="template-name">模板名称</Label><Input id="template-name" value={draft.name} disabled={busy || saving} onChange={e => setDraft({ ...draft, name: e.target.value })} /><p className="text-xs text-muted-foreground">{new TextEncoder().encode(draft.name).length} / 128 字节</p></div>
      <div className="grid min-w-0 gap-2"><Label htmlFor="template-command">模板命令</Label><textarea id="template-command" rows={4} value={draft.command} disabled={busy || saving} onChange={e => setDraft({ ...draft, command: e.target.value })} className="min-w-0 w-full resize-y rounded-lg border bg-background p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]" /><p className="text-xs text-muted-foreground">{new TextEncoder().encode(draft.command).length} / 511 字节 · 仅支持单行命令</p><p className="text-xs leading-5 text-amber-200/90">命令以 root 权限执行，请确认内容可信。</p></div>
      {error && <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => setDraft(null)}>取消</Button><Button type="submit" disabled={busy || saving || !draft.command}>{saving ? "保存中…" : "保存模板"}</Button></div>
    </form>}
    <Tabs.Root value={tab} onValueChange={setTab} className="grid min-w-0 max-w-full gap-5">
      <Tabs.List aria-label="模板类型" className="inline-flex max-w-full justify-self-start gap-1 rounded-xl border bg-card p-1">
        {[{ id: "builtin", name: `内置动作 ${PRESETS.length}` }, { id: "mine", name: `我的模板 ${templates.length}` }].map(({ id, name }) => <Tabs.Trigger key={id} value={id} className="rounded-lg px-4 py-2.5 text-sm text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-primary/15 data-[state=active]:text-primary">{name}</Tabs.Trigger>)}
      </Tabs.List>
      <Tabs.Content value="builtin" className="grid min-w-0 max-w-full gap-6 outline-none">
        {PRESET_CATEGORIES.map(category => { const items = builtins.filter(p => p.category === category.id); return items.length ? <section key={category.id} className="grid min-w-0 gap-3"><h2 className="text-sm font-medium text-muted-foreground">{category.name}</h2><div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map(preset => <article key={preset.id} data-testid={`preset-${preset.id}`} className="grid min-w-0 content-start gap-3 rounded-2xl border bg-card p-4">
          <div className="min-w-0"><h3 className="text-sm font-medium">{preset.name}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{preset.description}</p></div>
          {preset.command ? <CommandPreview command={preset.command} /> : <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">使用时填写{preset.params?.map(p => p.label).join("、")}</p>}
          {onUsePreset && <Button size="sm" variant="secondary" className="justify-self-end" disabled={useDisabled} onClick={() => onUsePreset(preset)}>使用此动作<ArrowUpRight /></Button>}
        </article>)}</div></section> : null; })}
        {!builtins.length && <div className="rounded-2xl border border-dashed bg-card px-5 py-12 text-center text-sm text-muted-foreground">没有匹配的内置动作，试试其他关键词。</div>}
      </Tabs.Content>
      <Tabs.Content value="mine" className="grid min-w-0 max-w-full gap-4 outline-none">
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">{filtered.map(template => <article key={template.id} className="grid min-w-0 content-start gap-4 rounded-2xl border bg-card p-5">
      <div className="flex min-w-0 items-start gap-3"><span className="rounded-xl bg-primary/10 p-2.5 text-primary"><Terminal className="size-4" /></span><div className="min-w-0 flex-1"><h2 className="text-sm font-medium leading-6 [overflow-wrap:anywhere]">{template.name}</h2><p className="mt-1 text-xs text-muted-foreground">可复用命令</p></div></div>
      <CommandPreview command={template.command} />
      <div className="flex flex-wrap items-center gap-1 border-t pt-3"><Button size="sm" variant="ghost" disabled={busy || saving} onClick={() => { onEdit(template.id); setDraft({ ...template }); setError(""); }}><Pencil />编辑模板</Button><Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={busy || saving} onClick={() => onDelete(template.id)}><Trash2 />删除模板</Button><Button size="sm" variant="secondary" className="ml-auto" disabled={busy || saving} onClick={() => onUse(template)}>应用到绑定<ArrowUpRight /></Button></div>
    </article>)}</div>
        {!filtered.length && <div className="rounded-2xl border border-dashed bg-card px-5 py-12 text-center"><Terminal className="mx-auto mb-4 size-8 text-primary" /><h2 className="font-medium">{search ? "没有匹配的模板" : "还没有自己的模板"}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{search ? "试试其他名称或命令关键词。" : "成功保存绑定后，用到的命令会自动出现在这里，也可以随时重命名。"}</p></div>}
      </Tabs.Content>
    </Tabs.Root>
  </>;
}
