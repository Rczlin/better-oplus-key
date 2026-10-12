// 配置的纯函数：解析、序列化、校验。与守护进程的 config.conf 格式一致。

export const SEQUENCES = [
  "0", "1",
  "00", "01", "10", "11",
  "000", "001", "010", "011", "100", "101", "110", "111",
] as const;

export type Sequence = (typeof SEQUENCES)[number];

export interface ParsedConfig {
  longPressMs: number;
  windowMs: number;
  bindings: Record<Sequence, string>;
  /** 解析或校验失败的时间参数键名（非数字或越界）。非空时不应保存。 */
  errors: string[];
}

const BIND_KEY = /^[01]{1,3}$/;
const DEFAULT_TIMING = 300;
const TIMING_KEYS = ["long_press_ms", "window_ms"] as const;

function emptyBindings(): Record<Sequence, string> {
  return Object.fromEntries(SEQUENCES.map((s) => [s, ""])) as Record<Sequence, string>;
}

export function validateTiming(n: number): boolean {
  return Number.isInteger(n) && n >= 100 && n <= 800;
}

export function parseConfig(text: string): ParsedConfig {
  const out: ParsedConfig = {
    longPressMs: DEFAULT_TIMING,
    windowMs: DEFAULT_TIMING,
    bindings: emptyBindings(),
    errors: [],
  };

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line === "" || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq < 0) continue;

    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);

    if ((TIMING_KEYS as readonly string[]).includes(key)) {
      // 不静默回退默认值：非数字或越界都记为错误，由调用方阻止保存。
      const n = /^-?\d+$/.test(value) ? Number.parseInt(value, 10) : Number.NaN;
      if (Number.isNaN(n) || !validateTiming(n)) {
        out.errors.push(key);
      } else if (key === "long_press_ms") {
        out.longPressMs = n;
      } else {
        out.windowMs = n;
      }
    } else if (BIND_KEY.test(key) && (SEQUENCES as readonly string[]).includes(key)) {
      out.bindings[key as Sequence] = value;
    }
  }
  return out;
}

export function serializeConfig(c: Omit<ParsedConfig, "errors">): string {
  const lines = [
    "keycode=735",
    `long_press_ms=${c.longPressMs}`,
    `window_ms=${c.windowMs}`,
  ];
  for (const s of SEQUENCES) {
    const cmd = c.bindings[s];
    if (cmd !== "") lines.push(`${s}=${cmd}`);
  }
  return lines.join("\n") + "\n";
}
