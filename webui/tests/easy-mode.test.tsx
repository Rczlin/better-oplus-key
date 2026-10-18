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
let configPayload = "", templatePayload = "";
function decode(shell: string) { return Buffer.from(shell.match(/printf '%s' '([^']+)'/)![1], "base64").toString("utf8"); }
function bridge(handler?: Handler, templatesJson = "[]") {
  shells.length = 0; configPayload = ""; templatePayload = "";
  (globalThis as { ksu?: unknown }).ksu = { exec: (command: string, _options: string, cb: string) => {
    callbacks.add(cb); shells.push(command);
    if (handler?.(command, cb)) return;
    if (command.includes("templates.json")) {
      if (command.includes("base64 -d")) { templatePayload = decode(command); reply(cb, 0, "templates-saved\n"); }
      else reply(cb, 0, templatesJson);
    } else if (command.includes("base64 -d")) { configPayload = decode(command); reply(cb, 0, "saved-hup-requested\n"); }
    else reply(cb, 0, command === configRead ? persistedConfig : "running\n");
  } };
}
function navigate(name: string) { fireEvent.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name })); }
async function ready() { await waitFor(() => expect(screen.getByRole("button", { name: "新增绑定" })).toBeEnabled()); }
function click(name: string | RegExp) { fireEvent.click(screen.getByRole("button", { name, exact: typeof name === "string" ? true : undefined } as never)); }
function inDialog() { return within(screen.getByRole("dialog")); }
afterEach(() => {
  cleanup(); toast.dismiss(); vi.restoreAllMocks(); delete (globalThis as { ksu?: unknown }).ksu;
  for (const cb of callbacks) delete (window as unknown as Record<string, unknown>)[cb]; callbacks.clear();
});

describe("easy mode for non-shell users", () => {
  it("builds a binding by picking a quick combination and a built-in action", async () => {
    bridge(); render(<App />); await ready(); navigate("绑定"); click("新增绑定");
    fireEvent.click(inDialog().getByRole("button", { name: "双击" }));
    expect(screen.getByTestId("sequence-preview")).toHaveTextContent("短按 → 短按");
    expect(screen.getByTestId("prefix-hint")).toHaveTextContent("更长组合");
    fireEvent.click(inDialog().getByRole("button", { name: /^截屏/ }));
    expect(screen.getByLabelText("Shell 命令")).toHaveValue("input keyevent 120");
    expect(inDialog().getByRole("button", { name: /^截屏/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("Shell 命令"), { target: { value: "input keyevent 120 # 改" } });
    expect(inDialog().getByRole("button", { name: /^截屏/ })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(inDialog().getByRole("button", { name: /^截屏/ }));
    click("添加绑定");
    const card = document.querySelector('[data-test="binding-00"]') as HTMLElement;
    expect(within(card).getByTestId("binding-action")).toHaveTextContent("截屏");
    expect(screen.getByTestId("save-state")).toHaveTextContent("未保存");
  });

  it("fills an app launcher from the installed package list and rejects unsafe package names", async () => {
    bridge((shell, cb) => { if (shell === "pm list packages -3") { reply(cb, 0, "package:tv.danmaku.bili\npackage:com.eg.android.AlipayGphone\n"); return true; } });
    render(<App />); await ready(); navigate("绑定"); click("新增绑定"); click("单次长按");
    fireEvent.change(inDialog().getByLabelText("搜索动作"), { target: { value: "应用" } });
    fireEvent.click(inDialog().getByRole("button", { name: /^打开指定应用/ }));
    click("读取已安装应用");
    await screen.findByText(/已读取 2 个应用/);
    expect(document.querySelectorAll("datalist option")).toHaveLength(2);
    expect(screen.getByLabelText("Shell 命令")).toHaveValue("");
    expect(screen.getByRole("button", { name: "添加绑定" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("应用包名"), { target: { value: "com.x;reboot" } });
    expect(screen.getByText(/有效的应用包名/)).toBeInTheDocument();
    expect(screen.getByLabelText("Shell 命令")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("应用包名"), { target: { value: "tv.danmaku.bili" } });
    expect(screen.getByLabelText("Shell 命令")).toHaveValue("monkey -p tv.danmaku.bili -c android.intent.category.LAUNCHER 1");
    click("添加绑定");
    const card = document.querySelector('[data-test="binding-1"]') as HTMLElement;
    expect(within(card).getByTestId("binding-action").textContent).toBe("打开应用：tv.danmaku.bili");
  });

  it("applies a pack only after confirming replaced combinations and saves with named templates", async () => {
    bridge(); render(<App />); await ready();
    click("一键方案");
    fireEvent.click(screen.getByRole("button", { name: "套用音乐控制" }));
    expect(screen.getByRole("alert")).toHaveTextContent("替换 1 个已有组合");
    click("确认替换");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.querySelectorAll('[data-test^="binding-"]')).toHaveLength(5);
    expect(within(document.querySelector('[data-test="binding-0"]') as HTMLElement).getByTestId("binding-action")).toHaveTextContent("播放 / 暂停");
    navigate("概览");
    expect(screen.getByTestId("unsaved-banner")).toBeInTheDocument();
    click("立即保存");
    await waitFor(() => expect(templatePayload).not.toBe(""));
    expect(configPayload).toContain("0=input keyevent 85\n");
    expect(configPayload).toContain("0000=echo four\n");
    // 无参数的内置动作不重复收录，只收录自定义命令。
    expect(JSON.parse(templatePayload).map((t: { command: string }) => t.command)).toEqual(["echo four"]);
    expect(screen.queryByTestId("unsaved-banner")).toBeNull();
  });

  it("cancels a pack with conflicts without touching the draft", async () => {
    bridge(); render(<App />); await ready();
    click("一键方案"); fireEvent.click(screen.getByRole("button", { name: "套用日常效率" }));
    click("返回"); click("关闭");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByTestId("unsaved-banner")).toBeNull();
  });

  it("starts a binding from a built-in action in the template library", async () => {
    bridge(); render(<App />); await ready(); navigate("模板库");
    expect(screen.getByRole("tab", { name: /内置动作/ })).toHaveAttribute("data-state", "active");
    fireEvent.click(within(screen.getByTestId("preset-screenshot")).getByRole("button", { name: /使用此动作/ }));
    expect(screen.getByLabelText("Shell 命令")).toHaveValue("input keyevent 120");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    navigate("模板库");
    fireEvent.click(within(screen.getByTestId("preset-open-url")).getByRole("button", { name: /使用此动作/ }));
    expect(screen.getByLabelText("网址")).toBeInTheDocument();
    expect(screen.getByLabelText("Shell 命令")).toHaveValue("");
  });

  it("runs a command once on request and shows the exit status", async () => {
    let pending = "";
    bridge((shell, cb) => { if (shell === "timeout 10 sh -c 'input keyevent 3' 2>&1") { pending = cb; return true; } });
    render(<App />); await ready(); navigate("绑定"); click("新增绑定");
    fireEvent.click(inDialog().getByRole("button", { name: /^返回桌面/ }));
    click("试运行"); click("运行中…");
    expect(shells.filter(s => s.includes("input keyevent 3"))).toHaveLength(1);
    expect(screen.getByRole("button", { name: "保存配置", hidden: true })).toBeDisabled();
    await act(async () => reply(pending, 1, "", "Permission denied"));
    expect(screen.getByTestId("test-run-result")).toHaveTextContent("执行失败，退出码 1。输出 1 行，见下方。");
    expect(screen.getByTestId("test-run-output")).toHaveTextContent("Permission denied");
  });

  it("names collected app launchers and reports am errors despite exit code 0", async () => {
    bridge((shell, cb) => { if (shell.startsWith("timeout 10")) { reply(cb, 0, "Error: Activity not started, unable to resolve Intent"); return true; } });
    render(<App />); await ready(); navigate("绑定"); click("新增绑定"); click("单次长按");
    fireEvent.click(inDialog().getByRole("button", { name: /^支付宝扫一扫/ }));
    click("试运行");
    await waitFor(() => expect(screen.getByTestId("test-run-result")).toHaveTextContent("输出包含错误"));
    fireEvent.click(inDialog().getByRole("button", { name: /^打开指定应用/ }));
    fireEvent.change(screen.getByLabelText("应用包名"), { target: { value: "tv.danmaku.bili" } });
    fireEvent.change(screen.getByLabelText("Shell 命令"), { target: { value: "echo manual" } });
    expect(screen.queryByLabelText("应用包名")).toBeNull();
    fireEvent.change(screen.getByLabelText("Shell 命令"), { target: { value: "monkey -p tv.danmaku.bili -c android.intent.category.LAUNCHER 1" } });
    click("添加绑定"); click("保存配置");
    await waitFor(() => expect(templatePayload).not.toBe(""));
    expect(JSON.parse(templatePayload).map((t: { name: string }) => t.name)).toContain("打开应用：tv.danmaku.bili");
  });
  it("sets both timing values from a preset", async () => {
    bridge(); render(<App />); await ready(); navigate("绑定");
    fireEvent.click(screen.getByRole("button", { name: /^从容/ }));
    expect(screen.getByLabelText("长按时长（毫秒）")).toHaveValue(450);
    expect(screen.getByLabelText("连按间隔（毫秒）")).toHaveValue(400);
    expect(screen.getByRole("button", { name: /^从容/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("adjusts timing with sliders, flags out-of-range values and restores defaults", async () => {
    bridge(); render(<App />); await ready(); navigate("绑定");
    fireEvent.change(screen.getByRole("slider", { name: "长按时长" }), { target: { value: "520" } });
    expect(screen.getByLabelText("长按时长（毫秒）")).toHaveValue(520);
    expect(screen.getByTestId("timing-summary")).toHaveTextContent("按住 520 毫秒");
    fireEvent.change(screen.getByLabelText("连按间隔（毫秒）"), { target: { value: "1300" } });
    expect(screen.getByText("连按间隔需在 100–1200 毫秒之间")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(screen.getByLabelText("长按时长（毫秒）")).toHaveValue(300);
    expect(screen.getByLabelText("连按间隔（毫秒）")).toHaveValue(300);
    expect(screen.getByRole("button", { name: /^标准/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("explains logged actions by name", async () => {
    bridge((shell, cb) => {
      if (shell.includes("tail -n") && shell.includes("log.txt")) { reply(cb, 0, "2026-10-17 10:00:00 INFO seq=0 action=input keyevent 120 result=0\n2026-10-17 10:00:01 INFO seq=11 action=none result=dropped\n"); return true; }
      if (shell.includes("tail -n")) { reply(cb, 0, ""); return true; }
    });
    render(<App />); await ready(); navigate("诊断"); click("刷新记录");
    expect(await screen.findByTestId("log-action-name")).toHaveTextContent("截屏");
    expect(screen.getByText("这个按法没有绑定动作")).toBeInTheDocument();
  });
});
