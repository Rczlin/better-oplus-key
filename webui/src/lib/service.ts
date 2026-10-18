// 服务详情：一次 shell 调用读取守护进程 /proc 信息、日志尾部与命令输出尾部。
// 输出按 “@@段名” 分段，第一段为 key=value。
import { parseExplainLog, type ExplainRow } from "./log";
import { parseOutputJsonl, type OutputRecord } from "./output";

export interface ProcSample {
  pid: number;
  /** utime + stime，单位 clock tick */
  cpuTicks: number;
  /** 进程启动时刻（系统启动后的秒数） */
  startSec: number;
  rssKb: number;
  peakRssKb: number;
  threads: number;
  fds: number;
  voluntary: number;
  involuntary: number;
  state: string;
}
export interface ServiceSnapshot {
  /** null：输出中没有状态行（例如命令被截断或环境异常），不应覆盖已知状态 */
  running: boolean | null;
  /** 系统已运行秒数（/proc/uptime） */
  uptimeSec: number;
  clkTck: number;
  proc: ProcSample | null;
  sizes: Record<string, number>;
  /** 设备上统计的今日按压；旧输出没有时为 null */
  today: TodayStats | null;
  /** 日志/输出未变化时命令不返回尾部，此时为 null，应沿用上次的数据 */
  log: ExplainRow[] | null;
  outputs: OutputRecord[] | null;
}
export interface ServiceMetrics {
  runSec: number;
  cpuSec: number;
  avgCpuPercent: number;
  /** 两次采样之间的 CPU 占用；首次采样为 null */
  recentCpuPercent: number | null;
  wakeupsPerHour: number;
  power: "极低" | "低" | "偏高";
  powerHint: string;
}

const FILES = ["log.txt", "events.jsonl", "output.jsonl", "config.conf"];
export const LOG_MARK = "@@sidekey-log@@";
export const OUTPUT_MARK = "@@sidekey-output@@";
export interface KnownSizes { log: number; output: number }

/** 概览命令。knownSizes 与文件当前大小相同时不重复传输日志/输出尾部（每 5 秒刷新时只取进程信息）。
 *  今日统计在设备上用 grep 计算，不受尾部行数限制。 */
export function dashboardCmd(moddir: string, knownSizes: KnownSizes = { log: -1, output: -1 }, logLines = 200, outputLines = 20): string {
  const exe = `${moddir}/bin/oplus-sidekey`;
  const log = `${moddir}/log.txt`, output = `${moddir}/output.jsonl`;
  return [
    `P=$(cat ${moddir}/daemon.pid 2>/dev/null)`,
    `if [ -n "$P" ] && [ "$(readlink /proc/$P/exe 2>/dev/null)" = "${exe}" ]; then echo state=running; echo pid=$P; echo "stat=$(cat /proc/$P/stat 2>/dev/null)"; grep -E '^(VmRSS|VmHWM|Threads|voluntary_ctxt_switches|nonvoluntary_ctxt_switches):' /proc/$P/status 2>/dev/null | sed 's/:[[:space:]]*/=/'; echo "fds=$(ls /proc/$P/fd 2>/dev/null | wc -l)"; else echo state=stopped; fi`,
    `echo "uptime=$(cut -d' ' -f1 /proc/uptime)"`,
    `echo "clk=$(getconf CLK_TCK 2>/dev/null || echo 100)"`,
    `for f in ${FILES.join(" ")}; do echo "size.$f=$(stat -c %s ${moddir}/$f 2>/dev/null || echo 0)"; done`,
    `T=$(date +%Y-%m-%d)`,
    `echo "today.presses=$(grep -c "^$T [0-9:]* INFO seq=" ${log} 2>/dev/null)"`,
    `echo "today.success=$(grep -c "^$T [0-9:]* INFO seq=.* result=0$" ${log} 2>/dev/null)"`,
    `echo "today.dropped=$(grep -c "^$T [0-9:]* INFO seq=.* result=dropped$" ${log} 2>/dev/null)"`,
    `if [ "$(stat -c %s ${log} 2>/dev/null || echo 0)" != "${knownSizes.log}" ]; then echo ${LOG_MARK}; tail -n ${logLines} ${log} 2>/dev/null; fi`,
    `if [ "$(stat -c %s ${output} 2>/dev/null || echo 0)" != "${knownSizes.output}" ]; then echo ${OUTPUT_MARK}; tail -n ${outputLines} ${output} 2>/dev/null; fi`,
    `true`,
  ].join("; ");
}

const int = (v: string | undefined) => { const n = Number.parseInt(v ?? "", 10); return Number.isFinite(n) ? n : 0; };

/** 解析 /proc/<pid>/stat；comm 可能含空格与括号，取最后一个 ')' 之后的字段。 */
export function parseProcStat(stat: string): { state: string; cpuTicks: number; startTicks: number } | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const f = stat.slice(close + 1).trim().split(/\s+/);
  // f[0] 为第 3 字段 state；utime=14，stime=15，starttime=22
  if (f.length < 20) return null;
  const utime = Number(f[11]), stime = Number(f[12]), start = Number(f[19]);
  if (![utime, stime, start].every(Number.isFinite)) return null;
  return { state: f[0], cpuTicks: utime + stime, startTicks: start };
}

export function parseDashboard(stdout: string): ServiceSnapshot {
  const sections: Record<"head" | "log" | "output", string[] | null> = { head: [], log: null, output: null };
  let current: "head" | "log" | "output" = "head";
  for (const line of stdout.split("\n")) {
    if (line === LOG_MARK) { current = "log"; sections.log = []; continue; }
    if (line === OUTPUT_MARK) { current = "output"; sections.output = []; continue; }
    sections[current]!.push(line);
  }
  const kv: Record<string, string> = {};
  for (const line of sections.head!) {
    const eq = line.indexOf("=");
    if (eq > 0) kv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const clkTck = int(kv.clk) > 0 ? int(kv.clk) : 100;
  const running = kv.state === "running" ? true : kv.state === "stopped" ? false : null;
  let proc: ProcSample | null = null;
  // running 为 true 但 stat 读不到（进程刚退出）时 proc 为 null。
  const stat = running ? parseProcStat(kv.stat ?? "") : null;
  if (running && stat) {
    proc = {
      pid: int(kv.pid), cpuTicks: stat.cpuTicks, startSec: stat.startTicks / clkTck, state: stat.state,
      rssKb: int(kv.VmRSS), peakRssKb: int(kv.VmHWM), threads: int(kv.Threads), fds: int(kv.fds),
      voluntary: int(kv.voluntary_ctxt_switches), involuntary: int(kv.nonvoluntary_ctxt_switches),
    };
  }
  const sizes: Record<string, number> = {};
  for (const f of FILES) sizes[f] = int(kv[`size.${f}`]);
  let today: TodayStats | null = null;
  if ("today.presses" in kv) {
    const presses = int(kv["today.presses"]), success = int(kv["today.success"]), dropped = int(kv["today.dropped"]);
    today = { presses, success, dropped, failed: Math.max(0, presses - success - dropped) };
  }
  return {
    running, uptimeSec: Number.parseFloat(kv.uptime ?? "") || 0, clkTck, proc, sizes, today,
    log: sections.log && parseExplainLog(sections.log.join("\n")),
    outputs: sections.output && parseOutputJsonl(sections.output.join("\n")),
  };
}

export function computeMetrics(snap: ServiceSnapshot, previous?: ServiceSnapshot | null): ServiceMetrics | null {
  const p = snap.proc;
  if (!p) return null;
  const runSec = Math.max(0, snap.uptimeSec - p.startSec);
  const cpuSec = p.cpuTicks / snap.clkTck;
  const avgCpuPercent = runSec > 0 ? (cpuSec / runSec) * 100 : 0;
  let recentCpuPercent: number | null = null;
  const prev = previous?.proc;
  if (prev && prev.pid === p.pid && snap.uptimeSec > previous!.uptimeSec) {
    recentCpuPercent = Math.max(0, ((p.cpuTicks - prev.cpuTicks) / snap.clkTck) / (snap.uptimeSec - previous!.uptimeSec) * 100);
  }
  const wakeupsPerHour = runSec > 0 ? (p.voluntary / runSec) * 3600 : 0;
  const power = avgCpuPercent < 0.1 && wakeupsPerHour < 2000 ? "极低" : avgCpuPercent < 0.5 ? "低" : "偏高";
  const powerHint = power === "偏高"
    ? "CPU 占用高于预期，可能有绑定命令在后台常驻或频繁触发，请在“诊断 → 命令输出”中检查。"
    : "服务没按侧键时在内核中休眠等待，不持有唤醒锁；耗电主要来自你触发的命令本身。";
  return { runSec, cpuSec, avgCpuPercent, recentCpuPercent, wakeupsPerHour, power, powerHint };
}

export function formatDuration(sec: number): string {
  const s = Math.floor(sec);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s % 60} 秒`;
  return `${s} 秒`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatPercent(n: number): string {
  if (n === 0) return "0%";
  if (n < 0.01) return "<0.01%";
  return `${n < 1 ? n.toFixed(2) : n.toFixed(1)}%`;
}

export interface TodayStats { presses: number; success: number; failed: number; dropped: number }
/** 统计指定日期（YYYY-MM-DD，设备本地时间）的按压结果。 */
export function todayStats(rows: ExplainRow[], date: string): TodayStats {
  const out = { presses: 0, success: 0, failed: 0, dropped: 0 };
  for (const row of rows) {
    if (!row.seq || !row.time.startsWith(date)) continue;
    out.presses++;
    if (row.result === "dropped") out.dropped++;
    else if (row.result === "0") out.success++;
    else out.failed++;
  }
  return out;
}

export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
