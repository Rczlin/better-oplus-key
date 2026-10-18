// 内置动作与一键方案：纯数据与纯函数，不读写任何文件，守护进程不感知。
// 所有命令都以 root 身份经 /system/bin/sh -c 执行，仅选用 Android 10+ 通用命令；
// 标注“需真机验证”的动作依赖具体 ROM 或第三方应用版本。
import { validateCommand } from "./config";
import type { ShellTemplate } from "./templates";
import { decodeScript } from "./script";

export type PresetCategory = "system" | "media" | "toggle" | "pages" | "apps" | "advanced";
export type ParamKind = "package" | "url" | "phone" | "path" | "text";
export interface PresetParam {
  key: string;
  label: string;
  placeholder: string;
  example: string;
  kind: ParamKind;
  help: string;
}
export interface Preset {
  id: string;
  name: string;
  description: string;
  category: PresetCategory;
  command?: string;
  params?: PresetParam[];
  /** 带参数动作：由已校验的参数生成命令。 */
  build?(values: Record<string, string>): string;
  /** 带参数动作：从命令反解参数，用于回显与显示名称。 */
  parse?(command: string): Record<string, string> | null;
  /** 带参数动作的显示名称，例如“打开应用：com.tencent.mm”。 */
  label?(values: Record<string, string>): string;
}
export interface PresetPack {
  id: string;
  name: string;
  description: string;
  /** 组合编码 → 内置动作 id */
  bindings: Record<string, string>;
}

export const PRESET_CATEGORIES: { id: PresetCategory; name: string }[] = [
  { id: "system", name: "系统操作" },
  { id: "media", name: "媒体与音量" },
  { id: "toggle", name: "开关切换" },
  { id: "pages", name: "常用页面" },
  { id: "apps", name: "应用与扫码" },
  { id: "advanced", name: "进阶" },
];

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
// 反解 shellQuote 生成的单引号字符串。
const QUOTED = `'((?:[^']|'\\\\'')*)'`;
const unquote = (s: string) => s.replaceAll(`'\\''`, "'");
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const key = (code: number) => `input keyevent ${code}`;
// 按 case 匹配“当前为开”的取值；其他取值（含未设置时的 null）一律按“关”处理并打开。
const onOff = (read: string, onValues: string, turnOff: string, turnOn: string) =>
  `case "$(${read})" in ${onValues}) ${turnOff};; *) ${turnOn};; esac`;
const view = (uri: string) => `am start -a android.intent.action.VIEW -d '${uri}'`;
const ALIPAY = (said: string) => view(`alipays://platformapi/startapp?saId=${said}`);
const action = (name: string) => `am start -a ${name}`;

const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
export function validatePackageName(value: string): boolean {
  return PACKAGE.test(value) && value.length <= 255;
}
const VALIDATORS: Record<ParamKind, { test(v: string): boolean; error: string }> = {
  package: { test: validatePackageName, error: "请填写有效的应用包名，例如 com.tencent.mm" },
  url: { test: v => /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(v), error: "请填写完整网址，例如 https://www.example.com" },
  phone: { test: v => /^\+?[0-9*#]{2,20}$/.test(v), error: "请填写电话号码，只能包含数字、+、* 和 #" },
  path: { test: v => /^\/[^\r\n\0]+$/.test(v), error: "请填写以 / 开头的完整路径，例如 /sdcard/sidekey.sh" },
  text: { test: v => v.length > 0 && !/[\r\n\0]/.test(v), error: "请填写内容（单行）" },
};

// 带一个参数的动作：命令 = prefix + 参数 + suffix，参数按种类决定是否加引号。
function oneParam(def: Omit<Preset, "build" | "parse" | "label" | "params"> & { param: PresetParam; prefix: string; suffix?: string; quote: boolean; title: string }): Preset {
  const { param, prefix, suffix = "", quote, title, ...rest } = def;
  const pattern = new RegExp(`^${escapeRegExp(prefix)}${quote ? QUOTED : "([^\\s'\"]+)"}${escapeRegExp(suffix)}$`);
  return {
    ...rest,
    params: [param],
    build: values => prefix + (quote ? shellQuote(values[param.key]) : values[param.key]) + suffix,
    parse: command => {
      const m = pattern.exec(command);
      if (!m) return null;
      const value = quote ? unquote(m[1]) : m[1];
      return VALIDATORS[param.kind].test(value) ? { [param.key]: value } : null;
    },
    label: values => `${title}：${values[param.key]}`,
  };
}

export const PRESETS: Preset[] = [
  // 系统操作
  { id: "home", name: "返回桌面", description: "相当于按下 Home 键", category: "system", command: key(3) },
  { id: "back", name: "返回上一页", description: "相当于返回手势", category: "system", command: key(4) },
  { id: "recents", name: "最近任务", description: "打开多任务界面", category: "system", command: key(187) },
  { id: "screenshot", name: "截屏", description: "调用系统截屏，与电源键+音量下效果相同", category: "system", command: key(120) },
  { id: "sleep", name: "熄屏锁定", description: "立即关闭屏幕并锁定", category: "system", command: key(223) },
  { id: "wakeup", name: "点亮屏幕", description: "亮屏但不解锁", category: "system", command: key(224) },
  { id: "power-menu", name: "电源菜单", description: "弹出关机/重启菜单", category: "system", command: "input keyevent --longpress 26" },
  { id: "notifications", name: "下拉通知栏", description: "展开通知中心", category: "system", command: "cmd statusbar expand-notifications" },
  { id: "quick-settings", name: "打开快捷设置", description: "展开控制中心开关面板", category: "system", command: "cmd statusbar expand-settings" },
  { id: "collapse-panels", name: "收起通知栏", description: "收起已展开的通知栏或控制中心", category: "system", command: "cmd statusbar collapse" },
  { id: "assistant", name: "语音助手", description: "唤起系统默认助手", category: "system", command: key(219) },
  // 媒体与音量
  { id: "media-play-pause", name: "播放 / 暂停", description: "控制正在播放的音乐或视频", category: "media", command: key(85) },
  { id: "media-next", name: "下一首", description: "切换到下一首", category: "media", command: key(87) },
  { id: "media-previous", name: "上一首", description: "切换到上一首", category: "media", command: key(88) },
  { id: "media-stop", name: "停止播放", description: "停止当前媒体播放", category: "media", command: key(86) },
  { id: "media-forward", name: "快进", description: "支持的播放器中快进", category: "media", command: key(90) },
  { id: "media-rewind", name: "快退", description: "支持的播放器中快退", category: "media", command: key(89) },
  { id: "volume-up", name: "音量加", description: "提高当前音量一级", category: "media", command: key(24) },
  { id: "volume-down", name: "音量减", description: "降低当前音量一级", category: "media", command: key(25) },
  { id: "volume-mute", name: "静音切换", description: "切换媒体静音（个别机型只弹出音量面板）", category: "media", command: key(164) },
  // 开关切换
  { id: "toggle-dnd", name: "勿扰模式开关", description: "开启或关闭勿扰（仅允许优先通知）", category: "toggle",
    command: onOff("settings get global zen_mode", "1|2|3", "cmd notification set_dnd off", "cmd notification set_dnd priority") },
  // wifi_on：0 关、1 开、2 飞行模式下开、3 飞行模式下关。
  { id: "toggle-wifi", name: "Wi‑Fi 开关", description: "按当前状态打开或关闭 Wi‑Fi", category: "toggle",
    command: onOff("settings get global wifi_on", "1|2", "cmd wifi set-wifi-enabled disabled 2>/dev/null || svc wifi disable", "cmd wifi set-wifi-enabled enabled 2>/dev/null || svc wifi enable") },
  // bluetooth_on：0 关、1 开、2 飞行模式下开。
  { id: "toggle-bluetooth", name: "蓝牙开关", description: "按当前状态打开或关闭蓝牙", category: "toggle",
    command: onOff("settings get global bluetooth_on", "1|2", "cmd bluetooth_manager disable 2>/dev/null || svc bluetooth disable", "cmd bluetooth_manager enable 2>/dev/null || svc bluetooth enable") },
  { id: "toggle-data", name: "移动数据开关", description: "按当前状态打开或关闭移动数据（双卡为默认数据卡）", category: "toggle",
    command: onOff("settings get global mobile_data", "1", "svc data disable", "svc data enable") },
  { id: "toggle-airplane", name: "飞行模式开关", description: "按当前状态开启或关闭飞行模式", category: "toggle",
    command: onOff("settings get global airplane_mode_on", "1", "cmd connectivity airplane-mode disable", "cmd connectivity airplane-mode enable") },
  { id: "toggle-location", name: "定位开关", description: "按当前状态打开或关闭定位服务", category: "toggle",
    command: onOff("settings get secure location_mode", "1|2|3", "cmd location set-location-enabled false", "cmd location set-location-enabled true") },
  { id: "toggle-dark", name: "深色模式开关", description: "切换系统深色模式", category: "toggle",
    command: onOff("cmd uimode night", "*yes*", "cmd uimode night no", "cmd uimode night yes") },
  { id: "toggle-rotation", name: "自动旋转开关", description: "切换屏幕自动旋转", category: "toggle",
    command: onOff("settings get system accelerometer_rotation", "1", "settings put system accelerometer_rotation 0", "settings put system accelerometer_rotation 1") },
  { id: "toggle-auto-brightness", name: "自动亮度开关", description: "切换屏幕亮度自动调节", category: "toggle",
    command: onOff("settings get system screen_brightness_mode", "1", "settings put system screen_brightness_mode 0", "settings put system screen_brightness_mode 1") },
  // 常用页面
  { id: "camera", name: "打开相机", description: "直接进入拍照", category: "pages", command: action("android.media.action.STILL_IMAGE_CAMERA") },
  { id: "video", name: "打开录像", description: "直接进入录像", category: "pages", command: action("android.media.action.VIDEO_CAMERA") },
  { id: "alarms", name: "闹钟", description: "打开时钟应用的闹钟列表", category: "pages", command: action("android.intent.action.SHOW_ALARMS") },
  { id: "timers", name: "计时器", description: "打开时钟应用的计时器", category: "pages", command: action("android.intent.action.SHOW_TIMERS") },
  { id: "dialer", name: "拨号盘", description: "打开电话拨号界面", category: "pages", command: action("android.intent.action.DIAL") },
  { id: "web-search", name: "搜索", description: "打开默认搜索", category: "pages", command: action("android.intent.action.WEB_SEARCH") },
  { id: "settings", name: "系统设置", description: "打开设置首页", category: "pages", command: action("android.settings.SETTINGS") },
  { id: "wifi-settings", name: "Wi‑Fi 设置", description: "打开 Wi‑Fi 设置页", category: "pages", command: action("android.settings.WIFI_SETTINGS") },
  { id: "bluetooth-settings", name: "蓝牙设置", description: "打开蓝牙设置页", category: "pages", command: action("android.settings.BLUETOOTH_SETTINGS") },
  // 应用与扫码
  { id: "alipay-scan", name: "支付宝扫一扫", description: "需已安装支付宝", category: "apps", command: ALIPAY("10000007") },
  { id: "alipay-pay", name: "支付宝付款码", description: "需已安装支付宝", category: "apps", command: ALIPAY("20000056") },
  { id: "alipay-collect", name: "支付宝收款码", description: "需已安装支付宝", category: "apps", command: ALIPAY("20000123") },
  { id: "alipay-transit", name: "支付宝乘车码", description: "需已安装支付宝，部分城市可用", category: "apps", command: ALIPAY("200011235") },
  { id: "wechat-scan", name: "微信扫一扫", description: "需已安装微信；依赖微信版本，建议先试运行", category: "apps",
    command: "am start -n com.tencent.mm/com.tencent.mm.ui.LauncherUI --ez LauncherUI.From.Scaner.Shortcut true -f 335544320" },
  { id: "wechat", name: "打开微信", description: "启动微信", category: "apps", command: "monkey -p com.tencent.mm -c android.intent.category.LAUNCHER 1" },
  { id: "alipay", name: "打开支付宝", description: "启动支付宝", category: "apps", command: "monkey -p com.eg.android.AlipayGphone -c android.intent.category.LAUNCHER 1" },
  oneParam({ id: "open-app", name: "打开指定应用", description: "填写包名，启动任意已安装应用", category: "apps", title: "打开应用",
    param: { key: "package", label: "应用包名", placeholder: "例如 com.tencent.mm", example: "tv.danmaku.bili", kind: "package", help: "可点“读取已安装应用”从列表中选择；微信为 com.tencent.mm" },
    prefix: "monkey -p ", suffix: " -c android.intent.category.LAUNCHER 1", quote: false }),
  oneParam({ id: "open-url", name: "打开网址", description: "用默认浏览器或对应应用打开链接", category: "apps", title: "打开网址",
    param: { key: "url", label: "网址", placeholder: "https://", example: "https://www.example.com", kind: "url", help: "支持 http(s) 链接，也支持 weixin:// 等应用链接" },
    prefix: "am start -a android.intent.action.VIEW -d ", quote: true }),
  // 进阶
  oneParam({ id: "call", name: "拨打电话", description: "直接拨出指定号码", category: "advanced", title: "拨打电话",
    param: { key: "phone", label: "电话号码", placeholder: "例如 10086", example: "10086", kind: "phone", help: "会立即拨出，请确认号码无误" },
    prefix: "am start -a android.intent.action.CALL -d tel:", quote: false }),
  oneParam({ id: "run-script", name: "运行脚本文件", description: "执行手机上的 Shell 脚本", category: "advanced", title: "运行脚本",
    param: { key: "path", label: "脚本路径", placeholder: "/sdcard/sidekey.sh", example: "/sdcard/sidekey.sh", kind: "path", help: "脚本以 root 执行，请只运行自己信任的脚本" },
    prefix: "sh ", quote: true }),
  oneParam({ id: "open-component", name: "打开应用指定页面", description: "填写“包名/Activity”，直接打开某个界面", category: "advanced", title: "打开页面",
    param: { key: "component", label: "组件名", placeholder: "com.android.settings/.Settings", example: "com.android.settings/.Settings", kind: "text", help: "格式为 包名/Activity，可用开发者工具查看" },
    prefix: "am start -n ", quote: true }),
];

export const PACKS: PresetPack[] = [
  { id: "daily", name: "日常效率", description: "单击截屏，双击打开相机，长按切换勿扰", bindings: { "0": "screenshot", "00": "camera", "1": "toggle-dnd" } },
  { id: "media", name: "音乐控制", description: "单击播放/暂停，双击下一首，三击上一首，长按静音", bindings: { "0": "media-play-pause", "00": "media-next", "000": "media-previous", "1": "volume-mute" } },
  { id: "navigation", name: "单手导航", description: "单击返回，双击最近任务，长按回到桌面", bindings: { "0": "back", "00": "recents", "1": "home" } },
  { id: "pay", name: "扫码支付", description: "单击支付宝扫一扫，双击付款码，长按打开相机", bindings: { "0": "alipay-scan", "00": "alipay-pay", "1": "camera" } },
  { id: "commute", name: "通勤出行", description: "单击乘车码，双击微信扫一扫，长按播放/暂停", bindings: { "0": "alipay-transit", "00": "wechat-scan", "1": "media-play-pause" } },
  { id: "night", name: "睡前模式", description: "单击熄屏，双击深色模式，长按勿扰", bindings: { "0": "sleep", "00": "toggle-dark", "1": "toggle-dnd" } },
  { id: "connectivity", name: "网络开关", description: "单击 Wi‑Fi，双击蓝牙，长按移动数据", bindings: { "0": "toggle-wifi", "00": "toggle-bluetooth", "1": "toggle-data" } },
];

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find(p => p.id === id);
}

/** 生成动作命令；参数无效时抛出可直接展示给用户的错误。 */
export function buildPresetCommand(preset: Preset, values: Record<string, string>): string {
  let command = preset.command ?? "";
  if (preset.params?.length && preset.build) {
    const clean: Record<string, string> = {};
    for (const param of preset.params) {
      const value = (values[param.key] ?? "").trim();
      if (!VALIDATORS[param.kind].test(value)) throw new Error(VALIDATORS[param.kind].error);
      clean[param.key] = value;
    }
    command = preset.build(clean);
  }
  if (!validateCommand(command)) throw new Error("生成的命令超过 4095 个 UTF-8 字节，请缩短参数");
  return command;
}

/** 把命令反查为内置动作（含参数）；用于编辑已有绑定时回显。固定命令优先于参数动作。 */
export function matchPreset(command: string): { preset: Preset; values: Record<string, string> } | null {
  const fixed = PRESETS.find(p => p.command === command);
  if (fixed) return { preset: fixed, values: {} };
  for (const preset of PRESETS) {
    const values = preset.parse?.(command);
    if (values) return { preset, values };
  }
  return null;
}

export function describeCommand(command: string, templates: ShellTemplate[] = []): { name: string; builtin: boolean } {
  const match = matchPreset(command);
  if (match) return { name: match.preset.label && match.preset.params?.length ? match.preset.label(match.values) : match.preset.name, builtin: true };
  const template = templates.find(t => t.command === command);
  if (template) return { name: template.name, builtin: false };
  return { name: decodeScript(command) !== null ? "多行脚本" : "自定义命令", builtin: false };
}

/** 把方案合并进绑定草稿；返回被替换（命令不同）的已有组合。 */
export function applyPack(bindings: Record<string, string>, pack: PresetPack): { bindings: Record<string, string>; replaced: string[] } {
  const next = { ...bindings };
  const replaced: string[] = [];
  for (const [seq, id] of Object.entries(pack.bindings)) {
    const preset = findPreset(id);
    if (!preset) continue;
    const command = buildPresetCommand(preset, {});
    if (Object.hasOwn(next, seq) && next[seq] !== command) replaced.push(seq);
    next[seq] = command;
  }
  return { bindings: next, replaced: replaced.sort((a, b) => a.length - b.length || a.localeCompare(b)) };
}

export function parsePackageList(stdout: string): string[] {
  const set = new Set<string>();
  for (const raw of stdout.split("\n")) {
    const m = /^package:(\S+)$/.exec(raw.trim());
    if (m && validatePackageName(m[1])) set.add(m[1]);
  }
  return [...set].sort();
}

/** 与已有绑定的前缀关系：longer 会让当前组合等待连按间隔，shorter 会让那些组合等待。 */
export function prefixConflicts(seq: string, bindings: Record<string, string>, ignore?: string): { longer: string[]; shorter: string[] } {
  const longer: string[] = [], shorter: string[] = [];
  if (!seq) return { longer, shorter };
  for (const other of Object.keys(bindings).sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    if (other === ignore || other === seq) continue;
    if (other.length > seq.length && other.startsWith(seq)) longer.push(other);
    else if (other.length < seq.length && seq.startsWith(other)) shorter.push(other);
  }
  return { longer, shorter };
}
