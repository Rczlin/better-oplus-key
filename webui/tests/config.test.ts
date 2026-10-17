import { describe, it, expect } from "vitest";
import { parseConfig, serializeConfig, validateTiming, validateCommand, validateSequence, sequenceLabel } from "../src/lib/config";
import { parseExplainLog } from "../src/lib/log";

describe("dynamic config", () => {
  it("round-trips arbitrary bindings, keycode and exact command bytes", () => {
    const bindings = Object.fromEntries(Array.from({ length: 20 }, (_, i) => ["0".repeat(i + 1), "  echo '中=a'  "]));
    bindings["01".repeat(64)] = "echo long";
    const c = { keycode: 767, longPressMs: 100, windowMs: 800, bindings };
    expect(parseConfig(serializeConfig(c))).toEqual({ ...c, errors: [] });
    expect(parseConfig("keycode=1\n").keycode).toBe(1);
  });
  it("uses last duplicate and removes empty bindings", () => {
    expect(parseConfig("0=first\r\n0=second\n").bindings).toEqual({ "0": "second" });
    expect(parseConfig("0=first\n0=\n").bindings).toEqual({});
  });
  it("preserves equals, spaces, quotes and Chinese", () => {
    expect(parseConfig("# comment\r\n0= sh -c 'a=中; echo $a'  \r\n").bindings["0"]).toBe(" sh -c 'a=中; echo $a'  ");
  });
  it.each(["keycode=0", "keycode=768", "keycode=4294968031", "keycode=735x", "window_ms=-1", "long_press_ms=801", "window_ms=300.5", "window_ms=+300", "long_press_ms= 300"])("rejects strict numbers: %s", text => {
    expect(parseConfig(text).errors.length).toBeGreaterThan(0);
  });
  it("retains errors even when a later duplicate is valid", () => {
    expect(parseConfig("0=" + "中".repeat(171) + "\n0=valid\n").errors).toContain("0");
  });
  it.each([
    ["x".repeat(510), true], ["x".repeat(511), true], ["x".repeat(512), false],
    ["中".repeat(170), true], ["中".repeat(170) + "x", true], ["中".repeat(170) + "xy", false],
    ["a\nb", false], ["a\rb", false], ["a\0b", false],
  ] as const)("validates command byte/line boundaries %#", (command, accepted) => {
    expect(validateCommand(command)).toBe(accepted);
    const c = { keycode: 735, longPressMs: 300, windowMs: 300, bindings: { "0": command } };
    if (accepted) expect(parseConfig(serializeConfig(c)).bindings["0"]).toBe(command);
    else expect(() => serializeConfig(c)).toThrow();
  });
  it("rejects NUL anywhere and checks the exact config size boundary", () => {
    expect(parseConfig("0=echo\0bad").errors.length).toBeGreaterThan(0);
    expect(parseConfig("#".repeat(65536)).errors).toEqual([]);
    expect(parseConfig("#".repeat(65537)).errors.length).toBeGreaterThan(0);
    const c = parseConfig(""); c.bindings["0".repeat(65536)] = "echo";
    expect(() => serializeConfig(c)).toThrow(/64 KiB/);
  });
  it("validates timing, sequence and serializer inputs", () => {
    for (const v of [100, 300, 800]) expect(validateTiming(v)).toBe(true);
    for (const v of [99, 801, 300.5, NaN]) expect(validateTiming(v)).toBe(false);
    expect(validateSequence("01001")).toBe(true);
    for (const s of ["", "02", "0\n"]) expect(validateSequence(s)).toBe(false);
    expect(sequenceLabel("010")).toBe("短按 → 长按 → 短按");
    expect(() => serializeConfig({ ...parseConfig(""), keycode: 0 })).toThrow();
    expect(() => serializeConfig({ ...parseConfig(""), windowMs: NaN })).toThrow();
    expect(() => serializeConfig({ ...parseConfig(""), bindings: { "02": "echo" } })).toThrow();
  });
  it("parses long explain sequences and negative execution results", () => {
    const rows = parseExplainLog("2026-10-17 10:00:00 INFO seq=01001 action=echo x result=-3\n");
    expect(rows[0]).toMatchObject({ seq: "01001", action: "echo x", result: "-3" });
  });
});
