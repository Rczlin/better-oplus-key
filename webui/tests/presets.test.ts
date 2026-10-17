import { describe, expect, it } from "vitest";
import { validateCommand } from "../src/lib/config";
import {
  PRESETS, PACKS, PRESET_CATEGORIES, buildPresetCommand, describeCommand, findPreset, matchPreset,
  shellQuote, validatePackageName, applyPack, parsePackageList, prefixConflicts,
} from "../src/lib/presets";

describe("built-in presets", () => {
  it("have unique ids, known categories and valid single-line commands", () => {
    const ids = new Set<string>();
    for (const preset of PRESETS) {
      expect(ids.has(preset.id)).toBe(false); ids.add(preset.id);
      expect(PRESET_CATEGORIES.map(c => c.id)).toContain(preset.category);
      const sample = preset.params?.length ? buildPresetCommand(preset, Object.fromEntries(preset.params.map(p => [p.key, p.example]))) : buildPresetCommand(preset, {});
      expect(validateCommand(sample)).toBe(true);
    }
    expect(PRESETS.length).toBeGreaterThanOrEqual(50);
  });
  it("builds parameterised commands with validation and quoting", () => {
    const app = findPreset("open-app")!;
    expect(buildPresetCommand(app, { package: "com.tencent.mm" })).toBe("monkey -p com.tencent.mm -c android.intent.category.LAUNCHER 1");
    expect(() => buildPresetCommand(app, { package: "com.x; reboot" })).toThrow(/包名/);
    expect(() => buildPresetCommand(app, { package: "" })).toThrow(/包名/);
    const url = findPreset("open-url")!;
    expect(buildPresetCommand(url, { url: "https://example.com/?a=1&b='x'" })).toBe("am start -a android.intent.action.VIEW -d 'https://example.com/?a=1&b='\\''x'\\'''");
    expect(() => buildPresetCommand(url, { url: "not a url" })).toThrow(/网址/);
    expect(() => buildPresetCommand(url, { url: "https://a\nb" })).toThrow(/网址/);
  });
  it("quotes shell values and validates package names", () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
    expect(validatePackageName("com.example.app_2")).toBe(true);
    for (const bad of ["com", "1com.x", "com..x", "com.x/y", "com.x y"]) expect(validatePackageName(bad)).toBe(false);
  });
  it("describes commands by preset, parameter pattern, template name or custom", () => {
    expect(describeCommand("input keyevent 120").name).toBe("截屏");
    expect(describeCommand("monkey -p com.tencent.mm -c android.intent.category.LAUNCHER 1").name).toBe("打开微信");
    expect(describeCommand("monkey -p tv.danmaku.bili -c android.intent.category.LAUNCHER 1").name).toBe("打开应用：tv.danmaku.bili");
    expect(describeCommand("am start -a android.intent.action.VIEW -d 'https://a.cn'").name).toBe("打开网址：https://a.cn");
    expect(describeCommand("echo hi", [{ id: "1", name: "问好", command: "echo hi", updatedAt: 0 }]).name).toBe("问好");
    expect(describeCommand("echo hi")).toEqual({ name: "自定义命令", builtin: false });
    expect(matchPreset("monkey -p tv.danmaku.bili -c android.intent.category.LAUNCHER 1")).toEqual({ preset: findPreset("open-app"), values: { package: "tv.danmaku.bili" } });
  });
  it("packs reference existing presets and report replaced combinations", () => {
    for (const pack of PACKS) for (const id of Object.values(pack.bindings)) expect(findPreset(id)).toBeDefined();
    const pack = PACKS.find(p => p.id === "media")!;
    const { bindings, replaced } = applyPack({ "0": "echo old", "01": "echo keep", "00": buildPresetCommand(findPreset("media-next")!, {}) }, pack);
    expect(replaced).toEqual(["0"]);
    expect(bindings["01"]).toBe("echo keep");
    expect(bindings["0"]).toBe("input keyevent 85");
    expect(bindings["000"]).toBe("input keyevent 88");
  });
  it("parses pm package listings", () => {
    expect(parsePackageList("package:com.b\npackage:com.a\r\nbogus\npackage:com.a\n")).toEqual(["com.a", "com.b"]);
  });
  it("finds prefix relations that delay execution", () => {
    expect(prefixConflicts("0", { "00": "x", "1": "y" })).toEqual({ longer: ["00"], shorter: [] });
    expect(prefixConflicts("001", { "0": "x", "00": "y", "001": "z" }, "001")).toEqual({ longer: [], shorter: ["0", "00"] });
  });
});

describe("toggle commands", () => {
  it("treat airplane-mode on states as on and fall back to svc", () => {
    const wifi = findPreset("toggle-wifi")!.command!;
    expect(wifi).toContain('in 1|2) cmd wifi set-wifi-enabled disabled 2>/dev/null || svc wifi disable;;');
    expect(wifi).toContain("*) cmd wifi set-wifi-enabled enabled 2>/dev/null || svc wifi enable;; esac");
    expect(findPreset("toggle-bluetooth")!.command).toContain("cmd bluetooth_manager enable 2>/dev/null || svc bluetooth enable");
  });
});

describe("more parameterised presets", () => {
  it("build and round-trip every parameterised preset", () => {
    for (const preset of PRESETS.filter(p => p.params?.length)) {
      const values = Object.fromEntries(preset.params!.map(p => [p.key, p.example]));
      const command = buildPresetCommand(preset, values);
      expect(matchPreset(command)).toEqual({ preset, values });
    }
    expect(buildPresetCommand(findPreset("call")!, { phone: "+86 10086".replace(" ", "") })).toBe("am start -a android.intent.action.CALL -d tel:+8610086");
    expect(() => buildPresetCommand(findPreset("call")!, { phone: "10086;reboot" })).toThrow(/电话/);
    expect(buildPresetCommand(findPreset("run-script")!, { path: "/sdcard/it's.sh" })).toBe("sh '/sdcard/it'\\''s.sh'");
    expect(() => buildPresetCommand(findPreset("run-script")!, { path: "sdcard/x.sh" })).toThrow(/路径/);
    expect(describeCommand("sh '/sdcard/it'\\''s.sh'").name).toBe("运行脚本：/sdcard/it's.sh");
  });
  it("matches fixed commands before parameter patterns", () => {
    expect(matchPreset("monkey -p com.tencent.mm -c android.intent.category.LAUNCHER 1")?.preset.id).toBe("wechat");
  });
  it("every category has actions and toggles read state before switching", () => {
    for (const c of PRESET_CATEGORIES) expect(PRESETS.some(p => p.category === c.id)).toBe(true);
    for (const p of PRESETS.filter(p => p.category === "toggle")) expect(p.command).toMatch(/^case "\$\(.+\)" in .+\) .+;; \*\) .+;; esac$/);
  });
});
