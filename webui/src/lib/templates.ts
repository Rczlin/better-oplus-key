import { MAX_COMMAND_BYTES, validateCommand } from "./config";

export interface ShellTemplate {
  id: string;
  name: string;
  command: string;
  updatedAt: number;
}

const MAX_NAME_BYTES = 128;
const MAX_TEMPLATES_BYTES = 65536;
const encoder = new TextEncoder();
let fallbackIdCounter = 0;

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `template-${Date.now()}-${fallbackIdCounter++}`;
}

function generatedName(index: number): string {
  return `模板 ${index + 1}`;
}

function validateTemplate(value: unknown, index = 0): ShellTemplate {
  if (!value || typeof value !== "object") throw new Error(`模板 ${index + 1} 格式无效`);
  const item = value as Partial<ShellTemplate>;
  if (typeof item.id !== "string" || item.id.length === 0 || /[\r\n\0]/.test(item.id)) throw new Error(`模板 ${index + 1} 的 ID 无效`);
  if (typeof item.command !== "string" || !validateCommand(item.command)) throw new Error(`模板 ${index + 1} 的命令须为单行，最多 ${MAX_COMMAND_BYTES} 个 UTF-8 字节，不能含 NUL`);
  if (typeof item.updatedAt !== "number" || !Number.isFinite(item.updatedAt)) throw new Error(`模板 ${index + 1} 的更新时间无效`);
  const name = item.name === "" ? generatedName(index) : item.name;
  if (typeof name !== "string" || /[\r\n\0]/.test(name) || encoder.encode(name).length > MAX_NAME_BYTES) throw new Error(`模板 ${index + 1} 的名称最多 ${MAX_NAME_BYTES} 个 UTF-8 字节且不能含换行或 NUL`);
  return { id: item.id, name, command: item.command, updatedAt: item.updatedAt };
}

function dedupe(templates: ShellTemplate[]): ShellTemplate[] {
  const byCommand = new Map<string, ShellTemplate>();
  for (const template of templates) {
    if (byCommand.has(template.command)) byCommand.delete(template.command);
    byCommand.set(template.command, template);
  }
  return [...byCommand.values()];
}

export function parseTemplates(text: string): ShellTemplate[] {
  if (text === "") return [];
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("模板 JSON 格式无效"); }
  if (!Array.isArray(parsed)) throw new Error("模板 JSON 必须是数组");
  return dedupe(parsed.map((item, index) => validateTemplate(item, index)));
}

export function serializeTemplates(templates: ShellTemplate[]): string {
  const normalized = dedupe(templates.map((item, index) => validateTemplate(item, index)));
  const text = JSON.stringify(normalized, null, 2) + "\n";
  if (encoder.encode(text).length > MAX_TEMPLATES_BYTES) throw new Error("模板超过 64 KiB，请减少模板或缩短名称、命令");
  return text;
}

export function mergeCommands(templates: ShellTemplate[], commands: string[], now: number): ShellTemplate[] {
  const merged = dedupe(templates.map((item, index) => validateTemplate(item, index))).map(item => ({ ...item }));
  const byCommand = new Map(merged.map(item => [item.command, item]));
  for (const command of commands) {
    if (!validateCommand(command)) throw new Error(`命令须为单行，最多 ${MAX_COMMAND_BYTES} 个 UTF-8 字节，不能含 NUL`);
    const existing = byCommand.get(command);
    if (existing) existing.updatedAt = now;
    else {
      const item = { id: newId(), name: generatedName(merged.length), command, updatedAt: now };
      merged.push(item);
      byCommand.set(command, item);
    }
  }
  return merged;
}

export function upsertTemplate(templates: ShellTemplate[], input: ShellTemplate): ShellTemplate[] {
  const current = dedupe(templates.map((item, index) => validateTemplate(item, index)));
  const item = validateTemplate(input);
  const collision = current.find(existing => existing.command === item.command && existing.id !== item.id);
  if (collision) throw new Error("该命令已存在于其他模板，不能重复");
  const index = current.findIndex(existing => existing.id === item.id);
  if (index < 0) return [...current, item];
  const next = [...current];
  next[index] = item;
  return next;
}

export function removeTemplate(templates: ShellTemplate[], id: string): ShellTemplate[] {
  return templates.filter(template => template.id !== id);
}
