// 流体云提示伴生应用：通过模块目录下的 island.sh 查询状态、安装与发送测试。
export const ISLAND_PACKAGE = "io.github.rczlin.sidekey.island";
export type IslandAction = "status" | "install" | "test";
export interface IslandStatus { apk: boolean; installed: boolean; granted: boolean; sdk: number }
export type IslandState = "ready" | "no-permission" | "not-installed" | "missing-apk" | "unsupported";
export type IslandResult = { kind: "installed" | "sent" | "missing-apk" } | { kind: "failed"; error: string };

/** 流体云依赖 Android 16 Live Updates（ColorOS 16）。 */
export const ISLAND_MIN_SDK = 36;

export const ISLAND_STATE_TEXT: Record<IslandState, string> = {
  ready: "组件已就绪",
  "no-permission": "组件未获得通知权限，点“修复组件”重新授权",
  "not-installed": "组件未安装",
  "missing-apk": "当前模块包不含流体云组件，请安装 0.5.0 及以上的完整版本",
  unsupported: "需要 ColorOS 16（Android 16）及以上",
};

export function islandCmd(moddir: string, action: IslandAction): string {
  return `sh ${moddir}/island.sh ${action} 2>&1`;
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
  if (kind === "installed" || kind === "sent" || kind === "missing-apk") return { kind };
  return { kind: "failed", error: kv["island.error"] || stdout.trim() || "未知错误" };
}
