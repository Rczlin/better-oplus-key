// config.conf 的动态绑定、校验与序列化；与 C 解析器使用相同边界。
export type Sequence = string;
export interface ParsedConfig {
  keycode: number;
  longPressMs: number;
  windowMs: number;
  bindings: Record<string, string>;
  errors: string[];
}
export const MAX_COMMAND_BYTES = 511;
export const MAX_CONFIG_BYTES = 65536;
const encoder = new TextEncoder();

export function validateSequence(seq: string): boolean {
  return seq.length > 0 && !/[^01]/.test(seq);
}
export function sequenceLabel(seq: string): string {
  return [...seq].map(s => s === "0" ? "短按" : "长按").join(" → ");
}
export function validateCommand(command: string): boolean {
  return !/[\r\n\0]/.test(command) && encoder.encode(command).length <= MAX_COMMAND_BYTES;
}
export function validateTiming(n: number): boolean {
  return Number.isInteger(n) && n >= 100 && n <= 800;
}
function validKeycode(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 767;
}
export function parseConfig(text: string): ParsedConfig {
  const out: ParsedConfig = { keycode: 735, longPressMs: 300, windowMs: 300, bindings: {}, errors: [] };
  if (encoder.encode(text).length > MAX_CONFIG_BYTES) out.errors.push("配置超过 64 KiB");
  if (text.includes("\0")) out.errors.push("配置含 NUL 字符");
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq), value = line.slice(eq + 1);
    if (["keycode", "long_press_ms", "window_ms"].includes(key)) {
      const n = value.length > 0 && !/[^0-9]/.test(value) ? Number(value) : NaN;
      if (!(key === "keycode" ? validKeycode(n) : validateTiming(n))) out.errors.push(key);
      else if (key === "keycode") out.keycode = n;
      else if (key === "long_press_ms") out.longPressMs = n;
      else out.windowMs = n;
    } else if (validateSequence(key)) {
      if (!validateCommand(value)) out.errors.push(key);
      else if (value === "") delete out.bindings[key];
      else out.bindings[key] = value;
    }
  }
  return out;
}
export function serializeConfig(c: Omit<ParsedConfig, "errors">): string {
  if (!validKeycode(c.keycode)) throw new Error("键码必须是 1–767 之间的整数");
  if (!validateTiming(c.longPressMs) || !validateTiming(c.windowMs)) throw new Error("时间必须是 100–800 之间的整数");
  const lines = [`keycode=${c.keycode}`, `long_press_ms=${c.longPressMs}`, `window_ms=${c.windowMs}`];
  for (const [seq, cmd] of Object.entries(c.bindings).sort(([a], [b]) => a.length - b.length || a.localeCompare(b))) {
    if (!validateSequence(seq)) throw new Error("组合只能包含短按和长按");
    if (!validateCommand(cmd)) throw new Error(`命令须为单行，最多 ${MAX_COMMAND_BYTES} 个 UTF-8 字节，不能含 NUL`);
    if (cmd !== "") lines.push(`${seq}=${cmd}`);
  }
  const text = lines.join("\n") + "\n";
  if (encoder.encode(text).length > MAX_CONFIG_BYTES) throw new Error("配置超过 64 KiB，请减少绑定或缩短组合、命令");
  return text;
}
