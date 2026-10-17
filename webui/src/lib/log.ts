// 日志解析：解释日志（log.txt）与原始结构化记录（events.jsonl）。
// 格式契约见计划 Task 7 与守护进程 sidekey_log.c。
import { sequenceLabel } from "./config";

export interface ExplainRow {
  time: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  /** 仅序列解释行有值 */
  seq?: string;
  action?: string;
  result?: string;
}

export interface EventRow {
  wall_ms: number;
  mono_ms: number;
  edge: "down" | "up";
  code: number;
}

export function formatExplainRow(row: ExplainRow): { resultLabel: string; summary: string } {
  return row.seq ? {
    resultLabel: row.result === "dropped" ? "未匹配" : row.result === "0" ? "执行成功" : `执行失败（${row.result}）`,
    summary: sequenceLabel(row.seq),
  } : { resultLabel: row.level === "ERROR" ? "错误" : row.level === "WARN" ? "提醒" : "服务记录", summary: row.message };
}

const LINE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (INFO|WARN|ERROR) (.*)$/;
// 精确匹配契约格式：seq=<0|1 串> action=<命令或 none> result=<结果>
const SEQ = /^seq=([01]+) action=(.*) result=(dropped|-?\d+)$/;

export function parseExplainLog(text: string): ExplainRow[] {
  const rows: ExplainRow[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const m = LINE.exec(line);
    if (!m) continue;
    const [, time, level, message] = m;
    const row: ExplainRow = { time, level: level as ExplainRow["level"], message };
    const s = SEQ.exec(message);
    if (s) {
      row.seq = s[1];
      row.action = s[2];
      row.result = s[3];
    }
    rows.push(row);
  }
  return rows;
}

function isEventRow(v: unknown): v is EventRow {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.wall_ms === "number" &&
    typeof o.mono_ms === "number" &&
    (o.edge === "down" || o.edge === "up") &&
    typeof o.code === "number"
  );
}

export function parseEventsJsonl(text: string): EventRow[] {
  const rows: EventRow[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // 损坏行丢弃，不影响整个面板
    }
    if (isEventRow(parsed)) rows.push(parsed);
  }
  return rows;
}
