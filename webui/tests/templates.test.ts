import { describe, expect, it } from "vitest";
import {
  mergeCommands,
  parseTemplates,
  removeTemplate,
  serializeTemplates,
  upsertTemplate,
  type ShellTemplate,
} from "../src/lib/templates";

const template = (overrides: Partial<ShellTemplate> = {}): ShellTemplate => ({
  id: "id-1",
  name: "返回桌面",
  command: "input keyevent 3",
  updatedAt: 1,
  ...overrides,
});

describe("shell templates", () => {
  it("round trips JSON and treats missing file text as empty", () => {
    const input = [template(), template({ id: "id-2", command: "input keyevent 4" })];
    expect(parseTemplates(serializeTemplates(input))).toEqual(input);
    expect(parseTemplates("")).toEqual([]);
  });

  it("rejects malformed JSON and invalid fields", () => {
    expect(() => parseTemplates("{")) .toThrow(/JSON|格式/);
    expect(() => parseTemplates(JSON.stringify([{ ...template(), command: "a\nb" }]))).toThrow(/命令/);
    expect(() => parseTemplates(JSON.stringify([{ ...template(), name: "a\0b" }]))).toThrow(/名称/);
    expect(() => parseTemplates(JSON.stringify([{ ...template(), name: "a".repeat(129) }]))).toThrow(/名称/);
    expect(() => parseTemplates(JSON.stringify([{ ...template(), command: "x".repeat(512) }]))).toThrow(/命令/);
  });

  it("keeps the last entry for duplicate commands", () => {
    const result = parseTemplates(JSON.stringify([
      template({ id: "first", name: "旧" }),
      template({ id: "last", name: "新", updatedAt: 2 }),
    ]));
    expect(result).toEqual([template({ id: "last", name: "新", updatedAt: 2 })]);
  });

  it("rejects a serialized collection over 64 KiB", () => {
    expect(() => serializeTemplates([template({ command: "x".repeat(511), name: "n".repeat(128) }), ...Array.from({ length: 2000 }, (_, i) => template({ id: `id-${i}`, command: `command-${i}` }))])).toThrow(/64 KiB/);
  });

  it("rejects an oversized file before parsing and honors UTF-8 field boundaries", () => {
    expect(() => parseTemplates(" ".repeat(65537))).toThrow(/64 KiB/);
    expect(parseTemplates(JSON.stringify([template({ command: "中".repeat(170) + "x", name: "中".repeat(42) + "xx" })]))).toHaveLength(1);
    expect(() => parseTemplates(JSON.stringify([template({ name: "中".repeat(43) })]))).toThrow(/名称/);
  });

  it("merges commands while preserving existing identity and name", () => {
    const existing = [template({ updatedAt: 1 })];
    const result = mergeCommands(existing, ["input keyevent 3", "input keyevent 4"], 99);
    expect(result[0]).toEqual(template({ updatedAt: 99 }));
    expect(result[1]).toMatchObject({ command: "input keyevent 4", name: "模板 2", updatedAt: 99 });
    expect(result[1].id).toEqual(expect.any(String));
  });

  it("upserts and rejects command collisions with another ID", () => {
    const existing = [template(), template({ id: "id-2", command: "input keyevent 4" })];
    expect(upsertTemplate(existing, template({ updatedAt: 2 }))).toEqual([template({ updatedAt: 2 }), existing[1]]);
    expect(() => upsertTemplate(existing, template({ id: "new", command: "input keyevent 4" }))).toThrow(/已有|重复/);
  });

  it("deletes by ID", () => {
    expect(removeTemplate([template(), template({ id: "id-2" })], "id-1")).toEqual([template({ id: "id-2" })]);
  });
});

describe("named automatic collection", () => {
  it("uses a suggested display name for new commands and keeps existing names", () => {
    const merged = mergeCommands([template()], ["input keyevent 3", "input keyevent 120", "echo x"], 5,
      command => command === "input keyevent 120" ? "截屏" : command === "input keyevent 3" ? "不应覆盖" : undefined);
    expect(merged.map(t => t.name)).toEqual(["返回桌面", "截屏", "模板 3"]);
    expect(mergeCommands([], ["echo y"], 1, () => "a\nb")[0].name).toBe("模板 1");
  });
});
