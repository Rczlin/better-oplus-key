// 媒体控制的“没有播放时”设置：保存在模块目录的 media.conf，由 media.sh 每次读取，改完立即生效。
import { shellQuote, validatePackageName } from "./presets";

export type MediaIdle = "recent" | "app" | "none";
export interface MediaSettings { idle: MediaIdle; app: string }
export const MEDIA_DEFAULT: MediaSettings = { idle: "recent", app: "" };

export const MEDIA_IDLE_MODES: { value: MediaIdle; label: string; help: string }[] = [
  { value: "recent", label: "继续最近", help: "像耳机按键一样，让最近播放过的应用继续播放" },
  { value: "app", label: "指定应用", help: "打开你选的音乐应用并开始播放" },
  { value: "none", label: "不处理", help: "和控制中心一样，没有播放器时按了没反应" },
];

export function parseMediaConf(text: string): MediaSettings {
  const out = { ...MEDIA_DEFAULT };
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    if (k === "idle" && (v === "recent" || v === "app" || v === "none")) out.idle = v;
    else if (k === "app" && validatePackageName(v)) out.app = v;
  }
  return out;
}

export function serializeMediaConf(s: MediaSettings): string {
  const app = validatePackageName(s.app) ? s.app : "";
  return `idle=${s.idle}\napp=${app}\n`;
}

export function mediaReadCmd(moddir: string): string {
  return `cat ${moddir}/media.conf 2>/dev/null; true`;
}
export function mediaWriteCmd(moddir: string, s: MediaSettings): string {
  return `printf '%s' ${shellQuote(serializeMediaConf(s))} > ${moddir}/media.conf && echo media-saved`;
}
