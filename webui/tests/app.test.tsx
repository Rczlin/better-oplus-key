import { describe, it, expect, afterEach, vi } from "vitest";
import * as kernelsu from "kernelsu";
import { render, fireEvent, waitFor, screen, cleanup, act, within } from "@testing-library/react";
import { toast } from "sonner";
import "@testing-library/jest-dom/vitest";
import App from "../src/App";

const callbacks = new Set<string>();
const configRead = "cat /data/adb/modules/oplus-sidekey/config.conf";
const persistedConfig = "keycode=767\nlong_press_ms=450\nwindow_ms=220\n0=  echo '中=a'  \n0000=echo four\n";
function reply(cb: string, errno: number, stdout: string, stderr = "") {
  callbacks.add(cb);
  (window as unknown as Record<string, (errno: number, stdout: string, stderr: string) => void>)[cb](errno, stdout, stderr);
}
function bridge(handler?: (command: string, cb: string) => void, rawTemplates = false) {
  (globalThis as { ksu?: unknown }).ksu = { exec: (command: string, _options: string, cb: string) => {
    callbacks.add(cb);
    if (!rawTemplates && command.includes("templates.json")) reply(cb, 0, command.includes("base64 -d") ? "templates-saved\n" : "[]");
    else if (handler) handler(command, cb);
    else reply(cb, 0, command === configRead ? persistedConfig : "stopped\n");
  } };
}
function navigate(name: string) { fireEvent.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name })); }
async function loaded() {
  await waitFor(() => expect(screen.getByRole("button", { name: "新增绑定" })).toBeEnabled());
  navigate("绑定");
}
function click(name: string) { fireEvent.click(screen.getByRole("button", { name, exact: true })); }
function command(value: string) { fireEvent.change(screen.getByLabelText("Shell 命令"), { target: { value } }); }
afterEach(() => {
  cleanup(); toast.dismiss(); vi.restoreAllMocks(); delete (globalThis as { ksu?: unknown }).ksu;
  for (const cb of callbacks) delete (window as unknown as Record<string, unknown>)[cb]; callbacks.clear();
});

describe("binding workflow", () => {
  it("loads only persisted bindings, creates a long combination and preserves disk values on save", async () => {
    let saved = "";
    bridge((shell, cb) => {
      if (shell.includes("base64 -d")) {
        saved = Buffer.from(shell.match(/printf '%s' '([^']+)' \| base64 -d/)?.[1] ?? "", "base64").toString("utf8");
        reply(cb, 0, "saved-hup-requested\n");
      } else reply(cb, 0, shell === configRead ? persistedConfig : "stopped\n");
    });
    render(<App />); await loaded();
    expect(document.querySelectorAll('[data-test^="binding-"]')).toHaveLength(2);
    click("新增绑定");
    for (const name of ["短按", "长按", "短按", "短按", "长按"]) click(name);
    expect(screen.getByTestId("sequence-preview")).toHaveTextContent("01001");
    command("echo mixed"); click("添加绑定");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("未保存")).toBeInTheDocument();
    click("保存配置"); await screen.findByText("配置已保存，已发送应用请求");
    expect(saved).toContain("keycode=767\n");
    expect(saved).toContain("0=  echo '中=a'  \n");
    expect(saved).toContain("0000=echo four\n");
    expect(saved).toContain("01001=echo mixed\n");
    expect(screen.getByTestId("save-state")).toHaveTextContent("已保存");
  });
  it("edits, cancels, detects duplicates, undoes, clears and deletes only the chosen binding", async () => {
    bridge(); render(<App />); await loaded();
    const row = document.querySelector('[data-test="binding-0"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "编辑" }));
    command("changed"); click("取消"); expect(row).toHaveTextContent("echo '中=a'");
    fireEvent.click(within(row).getByRole("button", { name: "编辑" }));
    for (let i=0; i<3; i++) click("短按");
    command("changed"); click("更新绑定");
    expect(screen.getByRole("alert")).toHaveTextContent("已存在");
    click("撤回一步"); click("清空组合");
    expect(screen.getByRole("button", { name: "更新绑定" })).toBeDisabled();
    click("长按"); click("更新绑定");
    expect(document.querySelector('[data-test="binding-0"]')).toBeNull();
    const edited = document.querySelector('[data-test="binding-1"]') as HTMLElement;
    expect(edited).toHaveTextContent("changed");
    fireEvent.click(within(edited).getByRole("button", { name: "删除" }));
    expect(document.querySelectorAll('[data-test^="binding-"]')).toHaveLength(1);
  });
  it.each(["x".repeat(512), "中".repeat(171), "a\nb", "a\0b"])("blocks invalid command %# before saving", async value => {
    bridge(); render(<App />); await loaded(); click("新增绑定"); click("长按"); command(value); click("添加绑定");
    expect(screen.getByRole("alert")).toHaveTextContent(/511|单行|NUL/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("keeps empty command disabled and restores focus after Escape", async () => {
    bridge(); render(<App />); await loaded();
    const trigger = screen.getByRole("button", { name: "新增绑定" }); trigger.focus(); click("新增绑定");
    click("长按"); expect(screen.getByRole("button", { name: "添加绑定" })).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

describe("loading and state protection", () => {
  it.each([
    [1, persistedConfig, "Permission denied"], [0, "window_ms=5\n", ""],
    [0, "0=" + "x".repeat(512), ""], [0, "keycode=768\n", ""],
  ] as const)("blocks overwrite after read failure %# and allows retry", async (errno, stdout, stderr) => {
    let reads=0, writes=0, pending="";
    bridge((shell, cb) => {
      if (shell===configRead) { if (++reads===1) reply(cb, errno, stdout, stderr); else pending=cb; }
      else { if(shell.includes("base64 -d")) writes++; reply(cb,0,"stopped\n"); }
    });
    render(<App />); await screen.findByRole("alert");
    navigate("绑定");
    expect(screen.getByRole("button",{name:"保存配置"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"新增绑定"})).toBeDisabled();
    click("重试加载配置"); expect(screen.getByRole("button",{name:"保存配置"})).toBeDisabled();
    await act(async()=>reply(pending,0,persistedConfig)); await loaded(); expect(writes).toBe(0);
  });
  it("does not send shell calls outside KSU", () => {
    const exec=vi.spyOn(kernelsu,"exec"); render(<App />);
    expect(screen.getByText(/非 KSU 环境/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增绑定" })).toBeDisabled();
    navigate("绑定");
    expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();
    expect(exec).not.toHaveBeenCalled();
  });
  it("keeps unknown service status separate from stopped", async () => {
    bridge((shell,cb)=>reply(cb,0,shell===configRead?persistedConfig:"unexpected\n")); render(<App />); await loaded();
    navigate("概览");
    expect(screen.getByText("状态未知")).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"启动服务"})).toBeNull();
    expect(screen.getByRole("button",{name:"查询状态"})).toBeEnabled();
  });
  it("rejects concurrent save and service operations until the request completes", async()=>{
    let pending="",writes=0;
    bridge((shell,cb)=>{ if(shell.includes("base64 -d")){writes++;pending=cb;} else reply(cb,0,shell===configRead?persistedConfig:"stopped\n"); });
    render(<App />);await loaded();
    const save=screen.getByRole("button",{name:"保存配置"});
    act(()=>{fireEvent.click(save);fireEvent.click(save);});
    expect(writes).toBe(1);
    expect(screen.getByRole("button",{name:"新增绑定"})).toBeDisabled();
    expect(screen.getByTestId("save-state")).toHaveTextContent("保存中");
    await act(async()=>reply(pending,0,"saved\n"));expect(screen.getByRole("button",{name:"新增绑定"})).toBeEnabled();
  });
  it.each([
    ["saved", "配置已保存，服务未运行", "已保存"],
    ["saved-hup-requested", "配置已保存，已发送应用请求", "已保存"],
    ["saved-hup-failed", "配置已保存，但应用请求失败", "已保存，但应用请求失败"],
    ["failed", "保存失败", "保存失败"], ["ok", "保存失败", "保存失败"],
  ])("reports save marker %s accurately",async(marker,message,state)=>{
    bridge((shell,cb)=>reply(cb,0,shell===configRead?persistedConfig:shell.includes("base64 -d")?marker+"\n":"stopped\n"));
    render(<App />);await loaded();click("保存配置");
    await waitFor(()=>expect(screen.getByTestId("save-state")).toHaveTextContent(state));
    expect(screen.getAllByText(message,{exact:false}).length).toBeGreaterThan(0);
  });
  it("keeps running state when stop fails and prevents repeat clicks",async()=>{
    let pending="",stops=0;
    bridge((shell,cb)=>{if(shell.includes("kill -TERM")){stops++;pending=cb;}else reply(cb,0,shell===configRead?persistedConfig:"running\n");});
    render(<App />);await loaded();navigate("概览");await screen.findByText("运行中");
    const stop=screen.getByRole("button",{name:"停止服务"});act(()=>{fireEvent.click(stop);fireEvent.click(stop);});expect(stops).toBe(1);
    await act(async()=>reply(pending,0,"failed\n"));expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"停止服务"})).toBeEnabled();
  });
  it("shows log read errors and keeps successful partial data",async()=>{
    let logCalls=0;
    bridge((shell,cb)=>{if(shell.includes("tail -n")){logCalls++;reply(cb,shell.includes("log.txt")?1:0,shell.includes("events.jsonl")?' {"wall_ms":1,"mono_ms":2,"edge":"up","code":735}\n':"","Permission denied");}else reply(cb,0,shell===configRead?persistedConfig:"stopped\n");});
    render(<App />);await loaded();expect(logCalls).toBe(0);navigate("诊断");click("刷新记录");
    await screen.findByText(/解释记录读取失败.*Permission denied/);
    fireEvent.mouseDown(screen.getByRole("tab",{name:"原始事件"}), { button: 0, ctrlKey: false });
    expect(screen.getByTestId("log-events")).toHaveTextContent('"mono_ms":2');
  });
});

describe("navigation and persistent templates", () => {
  const template = { id: "home", name: "返回桌面", command: "input keyevent 3", updatedAt: 1 };
  it("preserves unsaved binding and timing drafts while changing all four views", async () => {
    bridge(); render(<App />); await loaded();
    fireEvent.change(screen.getByLabelText("长按时长（毫秒）"), { target: { value: "500" } });
    navigate("Shell 模板"); expect(screen.getByRole("heading", { name: "Shell 模板" })).toBeInTheDocument();
    navigate("诊断"); expect(screen.getByRole("tab", { name: "解释记录" })).toBeInTheDocument();
    navigate("概览"); expect(screen.getByRole("heading", { name: "侧键控制台" })).toBeInTheDocument();
    navigate("绑定"); expect(screen.getByLabelText("长按时长（毫秒）")).toHaveValue(500);
    expect(screen.getByTestId("save-state")).toHaveTextContent("未保存");
  });
  it("writes every configured command only after config success, preserving existing template names", async () => {
    const order: string[] = []; let pending = "", payload = "";
    bridge((shell, cb) => {
      if (shell.includes("base64 -d")) {
        if (shell.includes("templates.json")) { order.push("templates"); payload = Buffer.from(shell.match(/printf '%s' '([^']+)'/)![1], "base64").toString("utf8"); reply(cb, 0, "templates-saved"); }
        else { order.push("config"); pending = cb; }
      } else reply(cb, 0, shell === configRead ? persistedConfig : shell.includes("templates.json") ? JSON.stringify([template]) : "stopped");
    }, true);
    render(<App />); await loaded(); click("保存配置");
    expect(order).toEqual(["config"]);
    await act(async () => reply(pending, 0, "saved"));
    await waitFor(() => expect(order).toEqual(["config", "templates"]));
    expect(JSON.parse(payload).map((t: { command: string }) => t.command)).toEqual(expect.arrayContaining(["input keyevent 3", "  echo '中=a'  ", "echo four"]));
    expect(JSON.parse(payload)[0].name).toBe("返回桌面");
  });
  it.each(["failed", "saved"])("handles config %s and template failure independently", async marker => {
    let templateWrites = 0;
    bridge((shell, cb) => {
      if (shell.includes("base64 -d")) {
        if (shell.includes("templates.json")) { templateWrites++; reply(cb, 0, "templates-failed"); }
        else reply(cb, 0, marker);
      } else reply(cb, 0, shell === configRead ? persistedConfig : shell.includes("templates.json") ? "[]" : "stopped");
    }, true);
    render(<App />); await loaded(); click("保存配置");
    if (marker === "failed") { await screen.findByText(/保存失败：/); expect(templateWrites).toBe(0); }
    else { await screen.findByText(/配置已保存，但模板同步失败/); expect(templateWrites).toBe(1); expect(screen.getByTestId("save-state")).toHaveTextContent("已保存"); }
  });
  it("applies, edits and deletes a template with persistent writes", async () => {
    let current = [template];
    bridge((shell, cb) => {
      if (shell.includes("templates.json")) {
        if (shell.includes("base64 -d")) { current = JSON.parse(Buffer.from(shell.match(/printf '%s' '([^']+)'/)![1], "base64").toString("utf8")); reply(cb, 0, "templates-saved"); }
        else reply(cb, 0, JSON.stringify(current));
      } else reply(cb, 0, shell === configRead ? persistedConfig : "stopped");
    }, true);
    render(<App />); await loaded(); navigate("Shell 模板"); click("应用到绑定");
    expect(screen.getByLabelText("Shell 命令")).toHaveValue(template.command);
    click("长按"); click("添加绑定"); expect(screen.getByTestId("save-state")).toHaveTextContent("未保存");
    navigate("Shell 模板"); click("编辑模板");
    fireEvent.change(screen.getByLabelText("模板名称"), { target: { value: "我的桌面" } }); click("保存模板");
    await screen.findByText("我的桌面"); expect(current[0].name).toBe("我的桌面");
    click("删除模板"); await waitFor(() => expect(current).toEqual([]));
    expect(screen.queryByText("我的桌面")).toBeNull();
  });
  it("keeps loaded templates after a malformed reload and blocks writes until recovery", async () => {
    let reads = 0, writes = 0;
    bridge((shell, cb) => {
      if (shell.includes("templates.json")) {
        if (shell.includes("base64 -d")) writes++;
        reply(cb, 0, ++reads === 1 ? JSON.stringify([template]) : "{");
      } else reply(cb, 0, shell === configRead ? persistedConfig : "stopped");
    }, true);
    render(<App />); await loaded(); navigate("Shell 模板"); click("重新读取模板");
    await screen.findByText(/模板读取失败/); expect(screen.getByText("返回桌面")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除模板" })).toBeDisabled(); expect(writes).toBe(0);
  });
  it.each(["templates-missing", "templates-empty"]) ("keeps loaded templates when the template file reports %s and blocks writes until recovery", async marker => {
    let reads = 0, writes = 0;
    bridge((shell, cb) => {
      if (shell.includes("templates.json")) {
        if (shell.includes("base64 -d")) writes++;
        if (++reads === 2) reply(cb, 0, "[]", marker);
        else reply(cb, 0, JSON.stringify([template]));
      } else reply(cb, 0, shell === configRead ? persistedConfig : "stopped");
    }, true);
    render(<App />); await loaded(); navigate("Shell 模板"); click("重新读取模板");
    await screen.findByText(/模板读取失败/);
    expect(screen.getByText("返回桌面")).toBeInTheDocument();
    for (const name of ["编辑模板", "删除模板", "应用到绑定"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(writes).toBe(0);
    click("重新读取模板");
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑模板" })).toBeEnabled());
    expect(screen.queryByText(/模板读取失败/)).toBeNull();
  });
  it("accepts a missing template file on first load and creates it when saving bindings", async () => {
    let templateWrites = 0;
    bridge((shell, cb) => {
      if (shell.includes("templates.json")) {
        if (shell.includes("base64 -d")) { templateWrites++; reply(cb, 0, "templates-saved"); }
        else reply(cb, 0, "[]", "templates-missing");
      } else reply(cb, 0, shell === configRead ? persistedConfig : shell.includes("base64 -d") ? "saved" : "stopped");
    }, true);
    render(<App />); await loaded(); click("保存配置");
    await waitFor(() => expect(templateWrites).toBe(1));
    navigate("Shell 模板"); expect(screen.queryByText(/模板读取失败/)).toBeNull();
  });
  it("treats an existing zero-byte template file as a recoverable read error on first load", async () => {
    bridge((shell, cb) => {
      if (shell.includes("templates.json")) reply(cb, 0, "[]", "templates-empty");
      else reply(cb, 0, shell === configRead ? persistedConfig : "stopped");
    }, true);
    render(<App />); await loaded(); navigate("Shell 模板");
    expect(screen.getByText(/模板读取失败/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑模板" })).toBeNull();
  });
  it("finishes template initialization after a delayed config read even if status is requested", async () => {
    let configCb = "", secondStatusCb = "", statusCalls = 0;
    bridge((shell, cb) => {
      if (shell === configRead) configCb = cb;
      else if (shell.includes("daemon.pid")) {
        if (++statusCalls === 1) reply(cb, 0, "stopped"); else secondStatusCb = cb;
      } else if (shell.includes("templates.json")) reply(cb, 0, "[]");
    });
    render(<App />);
    await waitFor(() => expect(configCb).toBeTruthy());
    const query = screen.getByRole("button", { name: "查询状态" });
    if (!query.hasAttribute("disabled")) fireEvent.click(query);
    await act(async () => reply(configCb, 0, persistedConfig));
    if (secondStatusCb) await act(async () => reply(secondStatusCb, 0, "stopped"));
    await waitFor(() => expect(screen.getByRole("button", { name: "新增绑定" })).toBeEnabled());
  });
});
