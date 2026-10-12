import { describe, it, expect } from "vitest";
import { SEQUENCES, parseConfig, serializeConfig, validateTiming } from "../src/lib/config";

describe("SEQUENCES", () => {
  it("lists exactly the 14 bindable sequences in display order", () => {
    expect(SEQUENCES).toEqual([
      "0", "1",
      "00", "01", "10", "11",
      "000", "001", "010", "011", "100", "101", "110", "111",
    ]);
  });
});

describe("parseConfig", () => {
  it("reads timing and bindings from config.conf text", () => {
    const text = "keycode=735\nlong_press_ms=300\nwindow_ms=250\n0=echo single\n00=echo double\n";
    const c = parseConfig(text);
    expect(c.longPressMs).toBe(300);
    expect(c.windowMs).toBe(250);
    expect(c.bindings["0"]).toBe("echo single");
    expect(c.bindings["00"]).toBe("echo double");
    expect(c.bindings["1"]).toBe("");
  });

  it("ignores CRLF and comment lines", () => {
    const c = parseConfig("# c\r\n0=echo x\r\n");
    expect(c.bindings["0"]).toBe("echo x");
  });

  it("keeps everything after the first '=' as the command", () => {
    const c = parseConfig("0=sh -c 'a=1; echo $a'\n");
    expect(c.bindings["0"]).toBe("sh -c 'a=1; echo $a'");
  });
});

describe("parseConfig invalid timing", () => {
  it("reports a non-numeric timing value instead of silently defaulting", () => {
    const c = parseConfig("long_press_ms=abc\n");
    expect(c.errors).toContain("long_press_ms");
  });
  it("reports an out-of-range timing value so save can be blocked", () => {
    const c = parseConfig("window_ms=5\n");
    expect(c.errors).toContain("window_ms");
  });
  it("has no errors for a valid config", () => {
    const c = parseConfig("long_press_ms=300\nwindow_ms=300\n");
    expect(c.errors).toEqual([]);
  });
});

describe("serializeConfig", () => {
  it("round-trips through parseConfig", () => {
    const original = {
      longPressMs: 300,
      windowMs: 300,
      bindings: { ...Object.fromEntries(SEQUENCES.map((s) => [s, ""])), "0": "echo x" },
    };
    const back = parseConfig(serializeConfig(original));
    expect(back.longPressMs).toBe(300);
    expect(back.bindings["0"]).toBe("echo x");
  });

  it("omits empty bindings so the daemon sees no action", () => {
    const text = serializeConfig({
      longPressMs: 300,
      windowMs: 300,
      bindings: Object.fromEntries(SEQUENCES.map((s) => [s, ""])),
    });
    expect(text).not.toMatch(/^0=/m);
  });
});

describe("validateTiming", () => {
  it("accepts 100..800 inclusive", () => {
    expect(validateTiming(100)).toBe(true);
    expect(validateTiming(800)).toBe(true);
  });
  it("rejects values outside the range or non-integers", () => {
    expect(validateTiming(99)).toBe(false);
    expect(validateTiming(801)).toBe(false);
    expect(validateTiming(300.5)).toBe(false);
  });
});
