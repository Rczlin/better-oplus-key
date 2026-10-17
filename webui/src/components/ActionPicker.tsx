import { useId, useMemo, useState } from "react";
import { Search, Download, Check } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { cn } from "@/lib/utils";
import { PRESETS, PRESET_CATEGORIES, buildPresetCommand, findPreset, matchPreset, type Preset, type PresetCategory } from "@/lib/presets";

interface Props {
  initialCommand: string;
  /** 从模板库选择带参数的动作时，预先选中它。 */
  initialPresetId?: string;
  /** 当前命令；手动改写后不再高亮原动作。 */
  command: string;
  disabled: boolean;
  /** 选中动作并且参数有效时回调生成的命令。 */
  onCommand(command: string): void;
  onListPackages?: () => Promise<string[]>;
}

export function ActionPicker({ initialCommand, initialPresetId, command, disabled, onCommand, onListPackages }: Props) {
  const initial = useMemo(() => {
    const matched = matchPreset(initialCommand);
    if (matched) return matched;
    const preset = initialPresetId ? findPreset(initialPresetId) : undefined;
    return preset ? { preset, values: {} as Record<string, string> } : null;
  }, [initialCommand, initialPresetId]);
  const [selected, setSelected] = useState<Preset | null>(initial?.preset ?? null);
  const [values, setValues] = useState<Record<string, string>>(initial?.values ?? {});
  const [category, setCategory] = useState<PresetCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [paramError, setParamError] = useState("");
  const [packages, setPackages] = useState<string[]>([]);
  const [packagesState, setPackagesState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const listId = useId();
  const safeBuild = (p: Preset, v: Record<string, string>) => { try { return buildPresetCommand(p, v); } catch { return ""; } };
  // 手动改写命令后不再高亮原动作；带参数动作在参数未填完（命令为空）时保持选中。
  const isActive = (p: Preset) => selected?.id === p.id && (p.params?.length ? (!command || safeBuild(p, values) === command) : p.command === command);
  const q = query.trim().toLocaleLowerCase();
  const visible = PRESETS.filter(p => (category === "all" || p.category === category)
    && (!q || `${p.name}\n${p.description}`.toLocaleLowerCase().includes(q)));

  const pick = (preset: Preset) => {
    setSelected(preset); setParamError("");
    const nextValues = preset.params ? (preset.id === selected?.id ? values : {}) : {};
    setValues(nextValues);
    // 带参数动作：参数无效时清空命令，避免沿用上一个动作的命令被误保存。
    onCommand(preset.params?.length ? safeBuild(preset, nextValues) : buildPresetCommand(preset, {}));
  };
  const changeParam = (key: string, value: string) => {
    if (!selected) return;
    const next = { ...values, [key]: value };
    setValues(next);
    try { onCommand(buildPresetCommand(selected, next)); setParamError(""); }
    catch (e) { setParamError(e instanceof Error ? e.message : String(e)); onCommand(""); }
  };
  const loadPackages = async () => {
    if (!onListPackages) return;
    setPackagesState("loading");
    try { setPackages(await onListPackages()); setPackagesState("ready"); }
    catch { setPackagesState("error"); }
  };

  return <fieldset className="grid min-w-0 gap-3 rounded-xl border p-3" disabled={disabled}>
    <legend className="px-1 text-sm font-medium">选择动作 <span className="font-normal text-muted-foreground">（推荐，无需会写命令）</span></legend>
    <div className="relative min-w-0"><Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input aria-label="搜索动作" placeholder="搜索：截屏、音乐、微信…" value={query} onChange={e => setQuery(e.target.value)} className="h-9 pl-9" /></div>
    <div role="group" aria-label="动作类别" className="flex flex-wrap gap-1.5">
      {[{ id: "all" as const, name: "全部" }, ...PRESET_CATEGORIES].map(c => <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}
        className={cn("rounded-full border px-3 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", category === c.id ? "border-primary/50 bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>{c.name}</button>)}
    </div>
    <div data-testid="action-list" className="grid max-h-56 min-w-0 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
      {visible.map(p => <button key={p.id} type="button" aria-pressed={isActive(p)} title={p.description} onClick={() => pick(p)}
        className={cn("flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", isActive(p) ? "border-primary/60 bg-primary/10" : "hover:bg-accent")}>
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{p.name}</span><span className="block text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{p.description}</span></span>
        {isActive(p) && <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />}
      </button>)}
      {!visible.length && <p className="col-span-full py-4 text-center text-xs text-muted-foreground">没有匹配的动作，可直接在下方填写命令。</p>}
    </div>
    {selected && isActive(selected) && selected.params?.map(param => <div key={param.key} className="grid min-w-0 gap-1.5">
      <Label htmlFor={`param-${param.key}`}>{param.label}</Label>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Input id={`param-${param.key}`} value={values[param.key] ?? ""} placeholder={param.placeholder} list={param.kind === "package" ? listId : undefined} inputMode={param.kind === "phone" ? "tel" : undefined}
          autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={e => changeParam(param.key, e.target.value)} className="h-9 min-w-48 flex-1 basis-48 font-mono" />
        {param.kind === "package" && onListPackages && <Button type="button" variant="outline" disabled={packagesState === "loading"} onClick={() => void loadPackages()}><Download />{packagesState === "loading" ? "读取中…" : "读取已安装应用"}</Button>}
      </div>
      {param.kind === "package" && <datalist id={listId}>{packages.map(p => <option key={p} value={p} />)}</datalist>}
      <p className="text-xs leading-5 text-muted-foreground">{param.help}{packagesState === "ready" && param.kind === "package" ? `（已读取 ${packages.length} 个应用，输入关键字即可筛选）` : ""}</p>
      {packagesState === "error" && param.kind === "package" && <p className="text-xs text-destructive">读取应用列表失败，可手动填写包名。</p>}
    </div>)}
    {paramError && <p aria-live="polite" className="text-xs text-destructive">{paramError}</p>}
  </fieldset>;
}
