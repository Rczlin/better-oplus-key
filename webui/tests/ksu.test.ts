import { describe, it, expect, afterEach } from "vitest";
import { isKsuEnvironment, runShell } from "../src/lib/ksu";

afterEach(() => {
  delete (globalThis as { ksu?: unknown }).ksu;
});

describe("isKsuEnvironment", () => {
  it("is false when the global ksu bridge is absent", () => {
    expect(isKsuEnvironment()).toBe(false);
  });
  it("is true when the global ksu bridge exists", () => {
    (globalThis as { ksu?: unknown }).ksu = { exec: () => {} };
    expect(isKsuEnvironment()).toBe(true);
  });
});

describe("runShell", () => {
  it("rejects without calling exec when not in KSU", async () => {
    await expect(runShell("true")).rejects.toThrow(/非 KSU 环境/);
  });
});
