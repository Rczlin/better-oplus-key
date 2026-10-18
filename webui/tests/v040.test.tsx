import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, waitFor, screen, cleanup, act, within } from "@testing-library/react";
import { toast } from "sonner";
import "@testing-library/jest-dom/vitest";
import App from "../src/App";

const callbacks = new Set<string>();
const configRead = "cat /data/adb/modules/oplus-sidekey/config.conf";
const persistedConfig = "keycode=735\nlong_press_ms=300\nwindow_ms=300\n0=echo old\n0000=echo four\n";
type Handler = (command: string, cb: string) => boolean | void;
function reply(cb: string, errno: number, stdout: string, stderr = "") {
  callbacks.add(cb);
  (window as unknown as Record<string, (errno: number, stdout: string, stderr: string) => void>)[cb](errno, stdout, stderr);
}
const shells: string[] = [];
let configPayload = "";
function decode(shell: string) { return Buffer.from(shell.match(/printf '%s' '([^']+)'/)![1], "base64").toString("utf8"); }
function bridge(handler?: Handler, templatesJson = "[]") {
  shells.length = 0; configPayload = "";
  (globalThis as { ksu?: unknown }).ksu = { exec: (command: string, _options: string, cb: string) => {
    callbacks.add(cb); shells.push(command);
    if (handler?.(command, cb)) return;
    if (command.includes("templates.json")) {
      if (command.includes("base64 -d")) reply(cb, 0, "templates-saved\n");
      else reply(cb, 0, templatesJson);
    } else if (command.includes("base64 -d")) { configPayload = decode(command); reply(cb, 0, "saved-hup-requested\n"); }
    else reply(cb, 0, command === configRead ? persistedConfig : "running\n");
  } };
}
function navigate(name: string) { fireEvent.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name })); }
async function ready() { await waitFor(() => expect(screen.getByRole("button", { name: "新增绑定" })).toBeEnabled()); }
function click(name: string | RegExp) { fireEvent.click(screen.getByRole("button", { name, exact: typeof name === "string" ? true : undefined } as never)); }
afterEach(() => {
  cleanup(); toast.dismiss(); vi.restoreAllMocks(); delete (globalThis as { ksu?: unknown }).ksu;
  for (const cb of callbacks) delete (window as unknown as Record<string, unknown>)[cb]; callbacks.clear();
});

const stat = "4321 (oplus-sidekey) S 1 4321 4321 0 -1 4194560 100 0 0 0 120 30 0 0 20 0 1 0 50000 12000000 300 0";
const today = (() => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
const dashboard = [
  "state=running", "pid=4321", `stat=${stat}`, "VmRSS=1536 kB", "VmHWM=2048 kB", "Threads=1",
  "voluntary_ctxt_switches=360", "nonvoluntary_ctxt_switches=2", "fds=6", "uptime=3500.5 10.0", "clk=100",
  "size.log.txt=4096", "size.events.jsonl=100", "size.output.jsonl=300", "size.config.conf=90",
  "today.presses=3", "today.success=1", "today.dropped=1",
  "@@sidekey-log@@",
  `${today} 10:00:00 INFO seq=0 action=echo old result=0`,
  `${today} 10:00:05 INFO seq=0000 action=echo four result=3`,
  `${today} 10:00:09 INFO seq=11 action=none result=dropped`,
  "@@sidekey-output@@",
  JSON.stringify({ time: `${today} 10:00:00`, wall_ms: 1, seq: "0", action: "echo old", code: 0, duration_ms: 8, truncated: false, output: "old\n" }),
  JSON.stringify({ time: `${today} 10:00:05`, wall_ms: 2, seq: "0000", action: "echo four", code: 3, duration_ms: 1520, truncated: true, output: "four\nsh: boom: not found\n" }),
].join("\n");
const isDashboard = (shell: string) => shell.includes("@@sidekey-log@@");

describe("0.4.0 overview, output and long commands", () => {
  it("shows process details, power estimate, today's stats and the latest output on the overview", async () => {
    bridge((shell, cb) => { if (isDashboard(shell)) { reply(cb, 0, dashboard); return true; } });
    render(<App />); await ready();
    const details = await screen.findByTestId("service-details");
    expect(details).toHaveTextContent("4321");
    expect(details).toHaveTextContent("50 分 0 秒");          // 3500.5 - 500 秒
    expect(screen.getByTestId("metric-cpu")).toHaveTextContent("0.05%");
    expect(screen.getByTestId("metric-power")).toHaveTextContent("极低");
    expect(details).toHaveTextContent("1.5 MB");
    expect(screen.getByText("成功 1 · 失败 1 · 未匹配 1")).toBeInTheDocument();
    const latest = screen.getByTestId("latest-run");
    // 最新一条是未匹配，覆盖输出记录
    expect(latest).toHaveTextContent("未匹配");
    expect(shells.filter(isDashboard)).toHaveLength(1);
  });

  it("lists captured command output with exit code, duration and truncation in diagnostics", async () => {
    bridge((shell, cb) => {
      if (shell.includes("output.jsonl") && shell.startsWith("if [ -e")) { reply(cb, 0, dashboard.split("@@sidekey-output@@\n")[1]); return true; }
      if (shell.startsWith("tail -n")) { reply(cb, 0, ""); return true; }
    });
    render(<App />); await ready(); navigate("诊断"); click("刷新记录");
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "命令输出" }), { button: 0, ctrlKey: false });
    const rows = await screen.findAllByTestId("output-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("执行失败（3）");
    expect(rows[0]).toHaveTextContent("1.52 秒");
    expect(rows[0]).toHaveTextContent("已截断");
    expect(rows[0]).toHaveTextContent("sh: boom: not found");
    expect(rows[1]).toHaveTextContent("执行成功");
  });

  it("explains when the daemon has not produced output yet", async () => {
    bridge((shell, cb) => {
      if (shell.startsWith("if [ -e")) { reply(cb, 0, "@@missing\n"); return true; }
      if (shell.startsWith("tail -n")) { reply(cb, 0, ""); return true; }
    });
    render(<App />); await ready(); navigate("诊断"); click("刷新记录");
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "命令输出" }), { button: 0, ctrlKey: false });
    await waitFor(() => expect(screen.getByTestId("log-output")).toHaveTextContent("0.4.0"));
  });

  it("saves a multi-line script as one encoded config line and restores it for editing", async () => {
    bridge();
    render(<App />); await ready(); navigate("绑定"); click("新增绑定"); click("单次长按");
    const script = "input keyevent 3\nsleep 1\necho '完成'";
    fireEvent.change(screen.getByLabelText("Shell 命令"), { target: { value: script } });
    expect(screen.getByTestId("script-badge")).toHaveTextContent("多行脚本 · 3 行");
    click("添加绑定");
    const row = document.querySelector('[data-test="binding-1"]') as HTMLElement;
    expect(row).toHaveTextContent("多行脚本");
    click("保存配置");
    await waitFor(() => expect(configPayload).toContain("1=: sidekey-script; S=$(printf %s"));
    const line = configPayload.split("\n").find(l => l.startsWith("1="))!;
    expect(line).not.toContain("sleep");
    const b64 = line.match(/printf %s '([^']+)'/)![1];
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(script + "\n#");
    fireEvent.click(within(row).getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("Shell 命令")).toHaveValue(script);
  });

  it("accepts long single-line commands up to 4095 bytes", async () => {
    bridge();
    render(<App />); await ready(); navigate("绑定"); click("新增绑定"); click("双击");
    fireEvent.change(screen.getByLabelText("Shell 命令"), { target: { value: "echo " + "x".repeat(4090) } });
    expect(screen.getByText("4095 / 4095 字节")).toBeInTheDocument();
    click("添加绑定");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    click("保存配置");
    await waitFor(() => expect(configPayload).toContain("00=echo " + "x".repeat(4090)));
  });

  it("shows the full test-run output in a scrollable block", async () => {
    const long = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
    bridge((shell, cb) => { if (shell.startsWith("timeout 10")) { reply(cb, 0, long); return true; } });
    render(<App />); await ready(); navigate("绑定"); click("新增绑定"); click("三击");
    fireEvent.change(screen.getByLabelText("Shell 命令"), { target: { value: "seq 50" } });
    click("试运行");
    const out = await screen.findByTestId("test-run-output");
    expect(out).toHaveTextContent("line 1");
    expect(out).toHaveTextContent("line 50");
    expect(screen.getByTestId("test-run-result")).toHaveTextContent("输出 50 行");
  });

  it("discards a dashboard result that was in flight when the service was toggled", async () => {
    let first = "", calls = 0;
    bridge((shell, cb) => {
      if (isDashboard(shell)) { if (++calls === 1) first = cb; return true; }   // 后续刷新保持挂起
      if (shell.includes("kill -TERM")) { reply(cb, 0, "stopped\n"); return true; }
    });
    render(<App />); await ready();
    await waitFor(() => expect(first).toBeTruthy());
    click("停止服务");
    await waitFor(() => expect(screen.getByText("已停止")).toBeInTheDocument());
    await act(async () => reply(first, 0, dashboard));   // 晚到的旧结果：仍是 running
    expect(screen.getByText("已停止")).toBeInTheDocument();
    expect(screen.queryByTestId("service-details")).toBeNull();
  });

  it("keeps capture_output=0 when saving and lets the user toggle it", async () => {
    bridge((shell, cb) => { if (shell === configRead) { reply(cb, 0, persistedConfig + "capture_output=0\n"); return true; } });
    render(<App />); await ready(); navigate("绑定");
    const box = screen.getByRole("checkbox", { name: /收集命令输出/ });
    expect(box).not.toBeChecked();
    click("保存配置");
    await waitFor(() => expect(configPayload).toContain("capture_output=0"));
    fireEvent.click(box);
    click("保存配置");
    await waitFor(() => expect(configPayload).not.toContain("capture_output"));
  });
});
