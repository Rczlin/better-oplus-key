// 已安装应用列表：由伴生组件 AppList 以 root 读取（名称、是否音乐应用、图标）。
export interface AppInfo { pkg: string; label: string; music: boolean; icon?: string }

export function appListCmd(moddir: string): string {
  const apk = `${moddir}/companion/island.apk`;
  return `app_process -Djava.class.path=${apk} /system/bin --nice-name=sidekey-apps io.github.rczlin.sidekey.island.AppList --icons 2>&1`;
}

export function parseAppList(text: string): AppInfo[] {
  const out: AppInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    const f = line.split("\t");
    if (f[0] !== "app" || !f[1]) continue;
    out.push({ pkg: f[1], label: f[2] || f[1], music: f[3] === "1", icon: f[4] ? `data:image/png;base64,${f[4]}` : undefined });
  }
  return sortApps(out);
}

/** 音乐应用在前，其余按名称排序（中文按拼音）。 */
export function sortApps(apps: AppInfo[]): AppInfo[] {
  const coll = new Intl.Collator("zh-Hans-CN");
  return [...apps].sort((a, b) => Number(b.music) - Number(a.music) || coll.compare(a.label, b.label));
}

export function filterApps(apps: AppInfo[], query: string): AppInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return apps;
  return apps.filter(a => a.label.toLowerCase().includes(q) || a.pkg.toLowerCase().includes(q));
}
