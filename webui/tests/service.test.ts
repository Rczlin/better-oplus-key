import { describe, expect, it } from "vitest";
import { computeMetrics, dashboardCmd, formatBytes, formatDuration, formatPercent, parseDashboard, parseProcStat, todayStats } from "@/lib/service";
import { outputResultLabel, parseOutputJsonl } from "@/lib/output";

// comm 含空格与括号；utime=120 stime=30 starttime=50000（tick=100 → 500 秒）
const stat = "4321 (oplus (side) key) S 1 4321 4321 0 -1 4194560 100 0 0 0 120 30 0 0 20 0 1 0 50000 12000000 300 18446744073709551615";
const sample = (uptime: string, statLine = stat, vol = 360) => [
  "state=running", "pid=4321", `stat=${statLine}`, "VmRSS=1536 kB", "VmHWM=2048 kB", "Threads=1",
  `voluntary_ctxt_switches=${vol}`, "nonvoluntary_ctxt_switches=4", "fds=7", `uptime=${uptime}`, "clk=100",
  "size.log.txt=2048", "size.events.jsonl=0", "size.output.jsonl=512", "size.config.conf=80",
  "today.presses=9", "today.success=6", "today.dropped=2",
  "@@sidekey-log@@",
  "2026-10-17 10:00:00 INFO daemon starting",
  "2026-10-17 10:01:00 INFO seq=0 action=input keyevent 3 result=0",
  "2026-10-17 10:02:00 INFO seq=00 action=none result=dropped",
  "2026-10-16 23:59:59 INFO seq=1 action=false result=1",
  "2026-10-17 10:03:00 INFO seq=1 action=false result=1",
  "@@sidekey-output@@",
  '{"time":"2026-10-17 10:03:00","wall_ms":1,"seq":"1","action":"false","code":1,"duration_ms":12,"truncated":false,"output":"err\\n"}',
  '{"time":"broken',
].join("\n");

describe("service dashboard", () => {
  it("builds one shell command with sections and exe check", () => {
    const cmd = dashboardCmd("/m");
    expect(cmd).toContain('readlink /proc/$P/exe 2>/dev/null)" = "/m/bin/oplus-sidekey"');
    expect(cmd).toContain('!= "-1" ]; then echo @@sidekey-log@@; tail -n 200 /m/log.txt');
    expect(cmd).toContain('!= "-1" ]; then echo @@sidekey-output@@; tail -n 20 /m/output.jsonl');
    expect(cmd).toContain('grep -c "^$T [0-9:]* INFO seq=" /m/log.txt');
    // 已知大小时只在文件变化后才传输尾部
    expect(dashboardCmd("/m", { log: 2048, output: 7 })).toContain('/m/log.txt 2>/dev/null || echo 0)" != "2048" ]');
  });
  it("parses /proc stat with spaces and parentheses in comm", () => {
    expect(parseProcStat(stat)).toEqual({ state: "S", cpuTicks: 150, startTicks: 50000 });
    expect(parseProcStat("garbage")).toBeNull();
  });
  it("parses snapshot, logs and outputs", () => {
    const snap = parseDashboard(sample("3500.00 100.0"));
    expect(snap.running).toBe(true);
    expect(snap.proc).toMatchObject({ pid: 4321, cpuTicks: 150, startSec: 500, rssKb: 1536, peakRssKb: 2048, threads: 1, fds: 7, voluntary: 360 });
    expect(snap.sizes["output.jsonl"]).toBe(512);
    expect(snap.log).toHaveLength(5);
    expect(snap.outputs).toHaveLength(1);
    expect(snap.today).toEqual({ presses: 9, success: 6, dropped: 2, failed: 1 });
    const headOnly = parseDashboard(sample("1").split("@@sidekey-log@@")[0]);
    expect(headOnly.log).toBeNull();
    expect(headOnly.outputs).toBeNull();
  });
  it("computes run time, average and recent CPU, wakeups and power rating", () => {
    const first = parseDashboard(sample("3500"));
    const m = computeMetrics(first)!;
    expect(m.runSec).toBe(3000);
    expect(m.cpuSec).toBe(1.5);
    expect(m.avgCpuPercent).toBeCloseTo(0.05);
    expect(m.recentCpuPercent).toBeNull();
    expect(m.wakeupsPerHour).toBeCloseTo(432);
    expect(m.power).toBe("极低");
    const later = parseDashboard(sample("3510", stat.replace(" 120 30 ", " 125 30 "), 400));
    expect(computeMetrics(later, first)!.recentCpuPercent).toBeCloseTo(0.5);
    const busy = parseDashboard(sample("3500", stat.replace(" 120 30 ", " 3000 0 ")));
    expect(computeMetrics(busy)!.power).toBe("偏高");
  });
  it("handles stopped service", () => {
    const snap = parseDashboard("state=stopped\nuptime=10\nclk=100\n@@sidekey-log@@\n@@sidekey-output@@\n");
    expect(snap.running).toBe(false);
    expect(snap.proc).toBeNull();
    expect(computeMetrics(snap)).toBeNull();
    expect(parseDashboard("running\n").running).toBeNull();
  });
  it("counts today's presses by result", () => {
    expect(todayStats(parseDashboard(sample("1")).log!, "2026-10-17")).toEqual({ presses: 3, success: 1, failed: 1, dropped: 1 });
  });
  it("formats values", () => {
    expect(formatDuration(59)).toBe("59 秒");
    expect(formatDuration(3725)).toBe("1 小时 2 分");
    expect(formatDuration(90000)).toBe("1 天 1 小时");
    expect(formatBytes(1536 * 1024)).toBe("1.5 MB");
    expect(formatPercent(0.004)).toBe("<0.01%");
    expect(formatPercent(0.25)).toBe("0.25%");
  });
});

describe("output records", () => {
  it("parses valid lines and ignores broken ones", () => {
    const rows = parseOutputJsonl('{"time":"t","wall_ms":1,"seq":"01","action":"a","code":0,"duration_ms":3,"truncated":true,"output":"x"}\n{"seq":"2"}\nnot json');
    expect(rows).toHaveLength(1);
    expect(rows[0].truncated).toBe(true);
  });
  it("labels exit codes", () => {
    expect(outputResultLabel(0)).toBe("执行成功");
    expect(outputResultLabel(127)).toBe("命令不存在（127）");
    expect(outputResultLabel(2)).toBe("执行失败（2）");
  });
});
