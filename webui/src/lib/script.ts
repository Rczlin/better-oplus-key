// 多行脚本：config.conf 按行解析，多行内容保存时编码为单行命令，读取时解码回多行。
// 编码后的命令由 /system/bin/sh 执行：解码出完整脚本后在当前 shell 中 eval。
// 解码失败时以 126 退出，避免 eval 空串被误判为成功。
// 脚本末尾追加一行注释 “#”：$(...) 会去掉结尾换行，追加后最后一行（如 heredoc 结束标记）仍以换行结束，
// 且注释不改变退出码。
const PREFIX = ": sidekey-script; S=$(printf %s '";
const SUFFIX = "' | base64 -d) || exit 126; eval \"$S\"";
const TAIL = "\n#";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function toBase64(text: string): string {
  let bin = "";
  for (const b of encoder.encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** 统一换行并去掉首尾空行。 */
export function normalizeScript(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
}

export function isMultiline(text: string): boolean {
  return normalizeScript(text).includes("\n");
}

export function encodeScript(text: string): string {
  return PREFIX + toBase64(normalizeScript(text) + TAIL) + SUFFIX;
}

/** 解码 encodeScript 生成的命令；不是脚本格式或内容无效时返回 null。 */
export function decodeScript(command: string): string | null {
  if (!command.startsWith(PREFIX) || !command.endsWith(SUFFIX)) return null;
  const b64 = command.slice(PREFIX.length, command.length - SUFFIX.length);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) return null;
  try {
    const bin = atob(b64);
    const text = decoder.decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
    return text.endsWith(TAIL) ? text.slice(0, -TAIL.length) : text;
  } catch { return null; }
}

/** 编辑器文本 → 写入配置的命令：多行编码，单行原样。 */
export function toStoredCommand(text: string): string {
  return isMultiline(text) ? encodeScript(text) : text.replace(/\r?\n$/, "");
}

/** 配置中的命令 → 编辑器文本。 */
export function toEditableCommand(command: string): string {
  return decodeScript(command) ?? command;
}
