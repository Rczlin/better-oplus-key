import { describe, expect, it } from "vitest";
import { MEDIA_DEFAULT, mediaWriteCmd, parseMediaConf, serializeMediaConf } from "../src/lib/media";

describe("media idle settings", () => {
  it("defaults to resuming the recent player", () => {
    expect(parseMediaConf("")).toEqual(MEDIA_DEFAULT);
    expect(MEDIA_DEFAULT.idle).toBe("recent");
  });
  it("parses and round-trips valid values, dropping invalid ones", () => {
    expect(parseMediaConf("idle=app\napp=com.netease.cloudmusic\n")).toEqual({ idle: "app", app: "com.netease.cloudmusic" });
    expect(parseMediaConf("idle=boom\napp=bad;rm\n")).toEqual(MEDIA_DEFAULT);
    const s = { idle: "none" as const, app: "com.a.b" };
    expect(parseMediaConf(serializeMediaConf(s))).toEqual(s);
    expect(serializeMediaConf({ idle: "app", app: "x" })).toBe("idle=app\napp=\n");
  });
  it("writes with a quoted payload", () => {
    expect(mediaWriteCmd("/m", { idle: "app", app: "com.a.b" })).toBe("printf '%s' 'idle=app\napp=com.a.b\n' > /m/media.conf && echo media-saved");
  });
});

import { filterApps, parseAppList } from "../src/lib/apps";
describe("app list", () => {
  it("parses, puts music apps first and filters", () => {
    const apps = parseAppList("app\tcom.b\tB 浏览器\t0\napp\tcom.m\t音乐\t1\tAAAA\nnoise\n");
    expect(apps.map(a => a.pkg)).toEqual(["com.m", "com.b"]);
    expect(apps[0].icon).toBe("data:image/png;base64,AAAA");
    expect(filterApps(apps, "浏览").map(a => a.pkg)).toEqual(["com.b"]);
  });
});
