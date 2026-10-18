// 流体云提示伴生应用：通过模块目录下的 island.sh 查询状态、安装与发送测试。
export const ISLAND_PACKAGE = "io.github.rczlin.sidekey.island";
export type IslandAction = "status" | "install" | "test";
export interface IslandStatus { apk: boolean; installed: boolean; granted: boolean; sdk: number }
export type IslandState = "ready" | "no-permission" | "not-installed" | "missing-apk" | "unsupported";
/** path：root 为直接发布（可靠），broadcast 为兜底广播；promoted：系统是否把通知升级为实况通知（流体云）。 */
export type IslandResult =
  | { kind: "installed" | "missing-apk" }
  | { kind: "sent"; path?: "root" | "broadcast"; promoted?: boolean; error?: string }
  | { kind: "failed"; error: string };

/** 流体云依赖 Android 16 Live Updates（ColorOS 16）。 */
export const ISLAND_MIN_SDK = 36;

export const ISLAND_STATE_TEXT: Record<IslandState, string> = {
  ready: "组件已就绪",
  "no-permission": "组件未获得通知权限，点“修复组件”重新授权",
  "not-installed": "组件未安装",
  "missing-apk": "当前模块包不含流体云组件，请安装 0.5.0 及以上的完整版本",
  unsupported: "需要 ColorOS 16（Android 16）及以上",
};

export function islandCmd(moddir: string, action: IslandAction, seconds?: number): string {
  const arg = action === "test" && seconds !== undefined && Number.isInteger(seconds) ? ` ${seconds}` : "";
  return `sh ${moddir}/island.sh ${action}${arg} 2>&1`;
}

/** 测试结果的说明文字；ok 为 false 时界面以提醒色显示。 */
export function islandResultText(r: Extract<IslandResult, { kind: "sent" }>): { ok: boolean; text: string } {
  if (r.path === "broadcast") return { ok: false, text: "root 直接发布失败，已改用备用广播，可能只显示普通通知。" + (r.error ? `原因：${r.error}` : "请把模块更新到最新版本。") };
  if (r.promoted === true) return { ok: true, text: "已显示在流体云（实况通知）中。" };
  if (r.promoted === false) return { ok: false, text: "通知已发出，但系统没有把它升级为流体云。请在 设置 › 通知与状态栏 › 侧键流体云提示 中打开“实况通知/流体云”，再测试一次。" };
  return { ok: true, text: "已发送测试提示，请看屏幕顶部的流体云。" };
}

function keyValues(stdout: string): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) kv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return kv;
}

export function parseIslandStatus(stdout: string): IslandStatus | null {
  const kv = keyValues(stdout);
  if (!("island.installed" in kv)) return null;
  const sdk = Number.parseInt(kv["island.sdk"] ?? "", 10);
  return { apk: kv["island.apk"] === "1", installed: kv["island.installed"] === "1", granted: kv["island.granted"] === "1", sdk: Number.isFinite(sdk) ? sdk : 0 };
}

export function islandState(s: IslandStatus): IslandState {
  if (s.sdk > 0 && s.sdk < ISLAND_MIN_SDK) return "unsupported";
  if (!s.installed) return s.apk ? "not-installed" : "missing-apk";
  if (!s.granted) return "no-permission";
  return "ready";
}

export function parseIslandResult(stdout: string): IslandResult {
  const kv = keyValues(stdout);
  const kind = kv.island;
  if (kind === "installed" || kind === "missing-apk") return { kind };
  if (kind === "sent") {
    const r: IslandResult = { kind };
    const path = kv["island.path"];
    if (path === "root" || path === "broadcast") r.path = path;
    const promoted = kv["island.promoted"];
    if (promoted === "1" || promoted === "0") r.promoted = promoted === "1";
    if (r.path === "broadcast" && kv["island.error"]) r.error = kv["island.error"];
    return r;
  }
  return { kind: "failed", error: kv["island.error"] || stdout.trim() || "未知错误" };
}
