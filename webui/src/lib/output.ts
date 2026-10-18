// 命令输出记录（output.jsonl，由 0.4.0 守护进程写入）。
export interface OutputRecord {
  time: string;
  wall_ms: number;
  seq: string;
  action: string;
  code: number;
  duration_ms: number;
  truncated: boolean;
  output: string;
}

function isRecord(v: unknown): v is OutputRecord {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.time === "string" && typeof o.wall_ms === "number" && typeof o.seq === "string" && /^[01]+$/.test(o.seq)
    && typeof o.action === "string" && typeof o.code === "number" && typeof o.duration_ms === "number"
    && typeof o.truncated === "boolean" && typeof o.output === "string";
}

export function parseOutputJsonl(text: string): OutputRecord[] {
  const rows: OutputRecord[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) rows.push(parsed);
    } catch { /* 截尾或损坏的行忽略 */ }
  }
  return rows;
}

export function outputResultLabel(code: number): string {
  if (code === 0) return "执行成功";
  if (code === -3) return "被信号终止";
  if (code === 127) return "命令不存在（127）";
  if (code === 126) return "无法执行（126）";
  return `执行失败（${code}）`;
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} 秒`;
}
