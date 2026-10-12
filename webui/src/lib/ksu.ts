import { exec } from "kernelsu";

// kernelsu 的 exec 直接调用全局 ksu.exec；ksu 不存在时会抛出 ReferenceError。
// 因此先检测全局桥，在普通浏览器中给出明确错误，而不是让异常漏到界面。
export function isKsuEnvironment(): boolean {
  return typeof (globalThis as { ksu?: unknown }).ksu !== "undefined";
}

export async function runShell(command: string) {
  if (!isKsuEnvironment()) {
    throw new Error("非 KSU 环境，无法执行 shell");
  }
  return exec(command);
}
