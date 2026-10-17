// 守护进程启停命令。
// 成功与否只由脚本输出的固定标记决定，不依赖退出码：
// 旧实现用 `2>/dev/null; echo ok` 吞掉错误，导致停止失败也显示成功。
// pid 必须经 /proc/<pid>/exe 精确比对为本守护进程，避免误杀复用 pid 的其他进程。

export function statusCmd(moddir: string): string {
  const exe = `${moddir}/bin/oplus-sidekey`;
  const pid = `${moddir}/daemon.pid`;
  return [
    `P=$(cat ${pid} 2>/dev/null)`,
    `if [ -n "$P" ] && [ "$(readlink /proc/$P/exe 2>/dev/null)" = "${exe}" ]; then echo running; else echo stopped; fi`,
  ].join("; ");
}

export function stopCmd(moddir: string): string {
  const exe = `${moddir}/bin/oplus-sidekey`;
  const pid = `${moddir}/daemon.pid`;
  return [
    `P=$(cat ${pid} 2>/dev/null)`,
    `if [ -z "$P" ] || [ "$(readlink /proc/$P/exe 2>/dev/null)" != "${exe}" ]; then echo not-running; exit 0; fi`,
    `kill -TERM "$P" && sleep 1 && [ "$(readlink /proc/$P/exe 2>/dev/null)" != "${exe}" ] && echo stopped || echo failed`,
  ].join("; ");
}

export function startCmd(moddir: string): string {
  return `sh ${moddir}/service.sh && sleep 1 && ${statusCmd(moddir)} | grep -q running && echo started || echo failed`;
}

// 先在同目录完整解码，再替换配置；解码或写入失败不会破坏原配置。
// 只有 exe 精确匹配的 pid 才接收 HUP；成功仅代表信号请求已发送。
export function saveCmd(moddir: string, base64: string): string {
  const exe = `${moddir}/bin/oplus-sidekey`;
  const pid = `${moddir}/daemon.pid`;
  const conf = `${moddir}/config.conf`;
  return [
    `T=$(mktemp "${conf}.XXXXXX") || { echo failed; exit 0; }`,
    `if printf '%s' '${base64}' | base64 -d > "$T" && mv "$T" "${conf}"; then :; else rm -f "$T"; echo failed; exit 0; fi`,
    `P=$(cat "${pid}" 2>/dev/null)`,
    `if [ -z "$P" ] || [ "$(readlink "/proc/$P/exe" 2>/dev/null)" != "${exe}" ]; then echo saved; else kill -HUP "$P" && echo saved-hup-requested || echo saved-hup-failed; fi`,
  ].join("; ");
}

export function templatesReadCmd(moddir: string): string {
  const file = `${moddir}/templates.json`;
  return `if [ -e "${file}" ] || [ -L "${file}" ]; then if [ -s "${file}" ]; then cat "${file}"; else printf 'templates-empty' >&2; printf '[]'; fi; else printf 'templates-missing' >&2; printf '[]'; fi`;
}

export function templatesSaveCmd(moddir: string, base64: string): string {
  const file = `${moddir}/templates.json`;
  return [
    `T=$(mktemp "${file}.XXXXXX") || { echo templates-failed; exit 0; }`,
    `if printf '%s' '${base64}' | base64 -d > "$T" && mv "$T" "${file}"; then echo templates-saved; else rm -f "$T"; echo templates-failed; fi`,
  ].join("; ");
}

export type DaemonResult = "running" | "stopped" | "started" | "failed" | "not-running"
  | "saved" | "saved-hup-requested" | "saved-hup-failed";

// 只接受脚本输出的标记行；其它输出一律视为失败，避免误判成功。
export function parseDaemonResult(stdout: string): DaemonResult | null {
  const last = stdout.trim().split("\n").pop()?.trim() ?? "";
  const known: DaemonResult[] = ["running", "stopped", "started", "failed", "not-running", "saved", "saved-hup-requested", "saved-hup-failed"];
  return (known as string[]).includes(last) ? (last as DaemonResult) : null;
}

export type TemplateSaveResult = "templates-saved" | "templates-failed";

export function parseTemplateSaveResult(stdout: string): TemplateSaveResult | null {
  const last = stdout.trim().split("\n").pop()?.trim() ?? "";
  return last === "templates-saved" || last === "templates-failed" ? last : null;
}
