import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, waitFor, screen, cleanup, within } from "@testing-library/react";
import { toast } from "sonner";
import "@testing-library/jest-dom/vitest";
import App from "../src/App";
import { islandCmd, islandState, parseIslandResult, parseIslandStatus } from "../src/lib/island";

const MODDIR = "/data/adb/modules/oplus-sidekey";
const callbacks = new Set<string>();
const configRead = `cat ${MODDIR}/config.conf`;
const persistedConfig = "keycode=735\nlong_press_ms=300\nwindow_ms=300\n0=echo old\n";
const shells: string[] = [];
let configPayload = "";
type Handler = (command: string, cb: string) => boolean | void;
function reply(cb: string, errno: number, stdout: string, stderr = "") {
  callbacks.add(cb);
  (window as unknown as Record<string, (errno: number, stdout: string, stderr: string) => void>)[cb](errno, stdout, stderr);
}
function decode(shell: string) { return Buffer.from(shell.match(/printf '%s' '([^']+)'/)![1], "base64").toString("utf8"); }
const READY = "island.apk=1\nisland.installed=1\nisland.granted=1\nisland.sdk=36\n";
function bridge(handler?: Handler, config = persistedConfig) {
  shells.length = 0; configPayload = "";
  (globalThis as { ksu?: unknown }).ksu = { exec: (command: string, _options: string, cb: string) => {
    callbacks.add(cb); shells.push(command);
    if (handler?.(command, cb)) return;
    if (command === islandCmd(MODDIR, "status")) reply(cb, 0, READY);
    else if (command.includes("templates.json")) reply(cb, 0, command.includes("base64 -d") ? "templates-saved\n" : "[]");
    else if (command.includes("base64 -d")) { configPayload = decode(command); reply(cb, 0, "saved-hup-requested\n"); }
    else reply(cb, 0, command === configRead ? config : "running\n");
  } };
}
function navigate(name: string) { fireEvent.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name })); }
async function ready() { await waitFor(() => expect(screen.getByRole("button", { name: "新增绑定" })).toBeEnabled()); }
afterEach(() => {
  cleanup(); toast.dismiss(); vi.restoreAllMocks(); delete (globalThis as { ksu?: unknown }).ksu;
  for (const cb of callbacks) delete (window as unknown as Record<string, unknown>)[cb]; callbacks.clear();
});

describe("island helpers", () => {
  it("builds module script commands", () => {
    expect(islandCmd(MODDIR, "status")).toBe(`sh ${MODDIR}/island.sh status 2>&1`);
    expect(islandCmd(MODDIR, "install")).toBe(`sh ${MODDIR}/island.sh install 2>&1`);
    expect(islandCmd(MODDIR, "test")).toBe(`sh ${MODDIR}/island.sh test 2>&1`);
  });
  it("parses status and derives a state", () => {
    const s = parseIslandStatus(READY);
    expect(s).toEqual({ apk: true, installed: true, granted: true, sdk: 36 });
    expect(islandState(s!)).toBe("ready");
    expect(islandState({ apk: true, installed: true, granted: false, sdk: 36 })).toBe("no-permission");
    expect(islandState({ apk: true, installed: false, granted: false, sdk: 36 })).toBe("not-installed");
    expect(islandState({ apk: false, installed: false, granted: false, sdk: 36 })).toBe("missing-apk");
    expect(islandState({ apk: true, installed: true, granted: true, sdk: 35 })).toBe("unsupported");
    expect(islandState({ apk: true, installed: true, granted: true, sdk: 0 })).toBe("ready");
    expect(parseIslandStatus("")).toBeNull();
    expect(parseIslandStatus("sh: island.sh: not found\n")).toBeNull();
  });
  it("parses install and test results", () => {
    expect(parseIslandResult("island=installed\n")).toEqual({ kind: "installed" });
    expect(parseIslandResult("island=sent\n")).toEqual({ kind: "sent" });
    expect(parseIslandResult("island=missing-apk\n")).toEqual({ kind: "missing-apk" });
    expect(parseIslandResult("island=failed\nisland.error=Failure [X]\n")).toEqual({ kind: "failed", error: "Failure [X]" });
    expect(parseIslandResult("garbage")).toEqual({ kind: "failed", error: "garbage" });
  });
});

describe("fluid cloud setting", () => {
  it("defaults to off, saves the selected mode and shows component status", async () => {
    bridge();
    render(<App />); await ready(); navigate("绑定");
    const group = screen.getByRole("radiogroup", { name: "流体云提示" });
    expect(within(group).getByRole("radio", { name: "关闭" })).toBeChecked();
    expect(await screen.findByTestId("island-status")).toHaveTextContent("组件已就绪");
    fireEvent.click(within(group).getByRole("radio", { name: "仅失败" }));
    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));
    await waitFor(() => expect(configPayload).toContain("island_notify=2"));
    fireEvent.click(within(group).getByRole("radio", { name: "每次执行" }));
    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));
    await waitFor(() => expect(configPayload).toContain("island_notify=1"));
    fireEvent.click(within(group).getByRole("radio", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: /保存配置/ }));
    await waitFor(() => expect(configPayload).not.toContain("island_notify"));
  });

  it("loads an existing mode from config", async () => {
    bridge(undefined, persistedConfig + "island_notify=2\n");
    render(<App />); await ready(); navigate("绑定");
    expect(within(screen.getByRole("radiogroup", { name: "流体云提示" })).getByRole("radio", { name: "仅失败" })).toBeChecked();
  });

  it("sends a test notification", async () => {
    bridge((shell, cb) => { if (shell === islandCmd(MODDIR, "test")) { reply(cb, 0, "island=sent\n"); return true; } });
    const success = vi.spyOn(toast, "success");
    render(<App />); await ready(); navigate("绑定");
    await screen.findByText("组件已就绪");
    fireEvent.click(screen.getByRole("button", { name: "发送测试" }));
    await waitFor(() => expect(shells).toContain(islandCmd(MODDIR, "test")));
    await waitFor(() => expect(success).toHaveBeenCalledWith(expect.stringContaining("已发送测试提示")));
  });

  it("offers install when the component is missing and refreshes afterwards", async () => {
    let installed = false;
    bridge((shell, cb) => {
      if (shell === islandCmd(MODDIR, "status")) { reply(cb, 0, installed ? READY : "island.apk=1\nisland.installed=0\nisland.granted=0\nisland.sdk=36\n"); return true; }
      if (shell === islandCmd(MODDIR, "install")) { installed = true; reply(cb, 0, "island=installed\n"); return true; }
    });
    render(<App />); await ready(); navigate("绑定");
    expect(await screen.findByTestId("island-status")).toHaveTextContent("组件未安装");
    fireEvent.click(screen.getByRole("button", { name: "安装组件" }));
    await waitFor(() => expect(screen.getByTestId("island-status")).toHaveTextContent("组件已就绪"));
    expect(screen.queryByRole("button", { name: "安装组件" })).not.toBeInTheDocument();
  });

  it("explains an unsupported system", async () => {
    bridge((shell, cb) => { if (shell === islandCmd(MODDIR, "status")) { reply(cb, 0, "island.apk=1\nisland.installed=1\nisland.granted=1\nisland.sdk=35\n"); return true; } });
    render(<App />); await ready(); navigate("绑定");
    expect(await screen.findByTestId("island-status")).toHaveTextContent("需要 ColorOS 16");
  });
});
