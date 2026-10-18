import { describe, expect, it } from "vitest";
import { decodeScript, encodeScript, isMultiline, toEditableCommand, toStoredCommand } from "@/lib/script";
import { validateCommand } from "@/lib/config";

describe("multi-line scripts", () => {
  const script = "input keyevent 3\nsleep 1\necho '完成' \"$HOME\"";
  it("round-trips through a single valid config line", () => {
    const stored = toStoredCommand(script);
    expect(stored).not.toContain("\n");
    expect(validateCommand(stored)).toBe(true);
    expect(stored.startsWith(": sidekey-script; S=$(printf %s '")).toBe(true);
    expect(stored.endsWith("' | base64 -d) || exit 126; eval \"$S\"")).toBe(true);
    expect(decodeScript(stored)).toBe(script);
    expect(toEditableCommand(stored)).toBe(script);
  });
  it("normalises CRLF and trims surrounding blank lines", () => {
    expect(decodeScript(encodeScript("\r\na\r\nb\n\n"))).toBe("a\nb");
  });
  it("keeps single-line commands untouched", () => {
    expect(isMultiline("input keyevent 3\n")).toBe(false);
    expect(toStoredCommand("input keyevent 3\n")).toBe("input keyevent 3");
    expect(toEditableCommand("input keyevent 3")).toBe("input keyevent 3");
  });
  it("rejects tampered payloads", () => {
    expect(decodeScript(": sidekey-script; S=$(printf %s 'a;b' | base64 -d) || exit 126; eval \"$S\"")).toBeNull();
    expect(decodeScript(": sidekey-script; S=$(printf %s '/w==' | base64 -d) || exit 126; eval \"$S\"")).toBeNull(); // 非法 UTF-8
    expect(decodeScript("echo hi")).toBeNull();
  });
});
