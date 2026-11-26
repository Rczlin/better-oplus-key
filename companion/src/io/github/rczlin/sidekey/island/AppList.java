package io.github.rczlin.sidekey.island;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Looper;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 列出桌面上能打开的应用，供 WebUI 选择（root，app_process）：
 *   app_process -Djava.class.path=island.apk /system/bin io.github.rczlin.sidekey.island.AppList [--icons]
 * 每行：app<TAB>包名<TAB>名称<TAB>是否音乐应用(0/1)[<TAB>图标 PNG base64]
 * 音乐应用：声明了 MediaBrowserService 或媒体按键接收器（控制中心恢复卡片与耳机按键靠的就是它们）。
 */
public final class AppList {
    private AppList() {}

    static final int ICON_PX = 72;

    public static void main(String[] argv) {
        boolean icons = argv.length > 0 && "--icons".equals(argv[0]);
        try {
            if (Looper.myLooper() == null) Looper.prepareMainLooper();
            Context ctx = Poster.systemContext();
            PackageManager pm = ctx.getPackageManager();
            Set<String> music = musicPackages(pm);
            Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> list = pm.queryIntentActivities(main, PackageManager.MATCH_ALL);
            Set<String> seen = new HashSet<>();
            StringBuilder sb = new StringBuilder();
            for (ResolveInfo r : list) {
                String pkg = r.activityInfo.packageName;
                if (!seen.add(pkg)) continue;
                ApplicationInfo ai = r.activityInfo.applicationInfo;
                String label = String.valueOf(ai.loadLabel(pm)).replace('\t', ' ').replace('\n', ' ');
                sb.setLength(0);
                sb.append("app\t").append(pkg).append('\t').append(label).append('\t').append(music.contains(pkg) ? '1' : '0');
                if (icons) {
                    try {
                        sb.append('\t').append(png(ai.loadIcon(pm)));
                    } catch (Throwable ignored) {
                        sb.append('\t');
                    }
                }
                System.out.println(sb);
            }
            System.out.flush();
            System.exit(0);
        } catch (Throwable t) {
            System.out.println("apps.error=" + t);
            System.exit(1);
        }
    }

    static Set<String> musicPackages(PackageManager pm) {
        Set<String> out = new HashSet<>();
        for (ResolveInfo r : pm.queryIntentServices(new Intent("android.media.browse.MediaBrowserService"), PackageManager.MATCH_ALL)) {
            out.add(r.serviceInfo.packageName);
        }
        for (ResolveInfo r : pm.queryBroadcastReceivers(new Intent(Intent.ACTION_MEDIA_BUTTON), PackageManager.MATCH_ALL)) {
            out.add(r.activityInfo.packageName);
        }
        return out;
    }

    private static String png(Drawable d) {
        Bitmap b = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        d.setBounds(0, 0, ICON_PX, ICON_PX);
        d.draw(c);
        ByteArrayOutputStream os = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.PNG, 100, os);
        return Base64.encodeToString(os.toByteArray(), Base64.NO_WRAP);
    }
}
