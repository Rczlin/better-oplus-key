package io.github.rczlin.sidekey.island;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.view.KeyEvent;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Looper;
import android.os.SystemClock;
import java.util.List;

/**
 * 没有可控播放器时拉起音乐（media.sh 调用，root，app_process）：
 *   MediaLaunch --recent          与控制中心空卡片的播放键相同：解冻并继续最近的历史播放器
 *   MediaLaunch <包名> [等待毫秒] 拉起指定应用：在历史里就按控制中心方式继续；否则对它的会话 play()；
 *                                 再不行把“播放”媒体键显式发给它的接收器，后台起播。全程不打开界面。
 *   MediaLaunch --list            列出系统记录的历史播放器（诊断用）
 * 每一步发出“播放”后都会确认会话真的进入播放状态，确认不了返回 1，由 media.sh 再交给系统媒体按键兜底。
 * 输出：media.launch=history|session|button|timeout|none|error，media.app=…，media.via=event|token|button，media.error=…
 */
public final class MediaLaunch {
    private MediaLaunch() {}

    private static final long CONFIRM_MS = 3000;

    public static void main(String[] argv) {
        int status;
        try {
            MediaLaunchArgs a = MediaLaunchArgs.parse(argv);
            if (Looper.myLooper() == null) Looper.prepareMainLooper();
            Context ctx = Poster.systemContext();
            MediaSessionManager msm = null;
            try {
                msm = ctx.getSystemService(MediaSessionManager.class);
            } catch (Throwable t) {
                // 拿不到会话服务：仍可走控制中心的事件方式，只是无法确认播放状态
                out("media.warn", "no MediaSessionManager: " + t);
            }
            int userId = android.os.Process.myUid() / 100000;
            switch (a.mode) {
                case LIST:
                    for (OplusMedia.Player p : OplusMedia.history()) out("player", p.pkg + "\t" + p.playerId);
                    status = 0;
                    break;
                case RECENT:
                    status = recent(ctx, msm, userId) ? 0 : 1;
                    break;
                default:
                    status = app(ctx, msm, userId, a) ? 0 : 1;
            }
        } catch (Throwable t) {
            Throwable root = t;
            while (root.getCause() != null) root = root.getCause();
            out("media.launch", "error");
            out("media.error", root.getClass().getSimpleName() + ": " + root.getMessage());
            status = 1;
        }
        System.out.flush();
        System.exit(status);
    }

    private static boolean recent(Context ctx, MediaSessionManager msm, int userId) throws Exception {
        if (!OplusMedia.available()) {
            out("media.launch", "none");
            out("media.error", "not ColorOS media center");
            return false;
        }
        List<OplusMedia.Player> history = OplusMedia.history();
        if (history.isEmpty()) {
            out("media.launch", "none");
            out("media.error", "no history player");
            return false;
        }
        return resumeHistory(ctx, msm, userId, history.get(0));
    }

    private static boolean resumeHistory(Context ctx, MediaSessionManager msm, int userId, OplusMedia.Player p) throws Exception {
        OplusMedia.unfreeze(ctx, p.pkg, userId);
        out("media.app", p.pkg);
        try {
            out("media.via", OplusMedia.resume(ctx, p));
            if (waitPlaying(msm, p.pkg, CONFIRM_MS)) {
                out("media.launch", "history");
                return true;
            }
        } catch (Throwable t) {
            out("media.warn", "history event: " + t);
        }
        // 事件没让它播起来：直接把“播放”媒体键发给它自己的接收器（后台启动，不打开界面）
        return button(ctx, msm, p.pkg, WAIT_BUTTON_MS);
    }

    private static final long WAIT_BUTTON_MS = 5000;

    /** 指定应用：全程不打开应用界面，与控制中心一致只在后台让它播放。 */
    private static boolean app(Context ctx, MediaSessionManager msm, int userId, MediaLaunchArgs a) throws Exception {
        out("media.app", a.pkg);
        if (OplusMedia.available()) {
            try {
                for (OplusMedia.Player p : OplusMedia.history()) {
                    if (a.pkg.equals(p.pkg)) return resumeHistory(ctx, msm, userId, p);
                }
            } catch (Throwable ignored) {
                // 历史接口不可用：继续下面的方式
            }
        }
        OplusMedia.unfreeze(ctx, a.pkg, userId);
        if (play(msm, a.pkg) && waitPlaying(msm, a.pkg, CONFIRM_MS)) {
            out("media.launch", "session");
            return true;
        }
        return button(ctx, msm, a.pkg, Math.max(a.waitMs, 1000));
    }

    /**
     * 把 KEYCODE_MEDIA_PLAY 显式发给应用声明的媒体按键接收器（androidx MediaButtonReceiver 等），
     * 它会在后台启动自己的播放服务并开始播放，和耳机按键唤起一样，不会打开界面。
     * 之后若出现会话但没在播放，再补一次 play()。
     */
    private static boolean button(Context ctx, MediaSessionManager msm, String pkg, long waitMs) {
        Intent q = new Intent(Intent.ACTION_MEDIA_BUTTON).setPackage(pkg);
        List<ResolveInfo> receivers = ctx.getPackageManager().queryBroadcastReceivers(q, PackageManager.MATCH_ALL);
        if (receivers.isEmpty()) {
            out("media.launch", "none");
            out("media.error", pkg + " has no media button receiver");
            return false;
        }
        long now = SystemClock.uptimeMillis();
        for (ResolveInfo r : receivers) {
            for (int action : new int[] {KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP}) {
                Intent i = new Intent(Intent.ACTION_MEDIA_BUTTON)
                        .setComponent(new ComponentName(r.activityInfo.packageName, r.activityInfo.name))
                        .addFlags(Intent.FLAG_RECEIVER_FOREGROUND | Intent.FLAG_INCLUDE_STOPPED_PACKAGES)
                        .putExtra(Intent.EXTRA_KEY_EVENT, new KeyEvent(now, now, action, KeyEvent.KEYCODE_MEDIA_PLAY, 0));
                ctx.sendBroadcast(i);
            }
        }
        out("media.via", "button");
        long deadline = SystemClock.elapsedRealtime() + waitMs;
        boolean nudged = false;
        while (SystemClock.elapsedRealtime() < deadline) {
            MediaController c = find(msm, pkg);
            if (isPlaying(c)) {
                out("media.launch", "button");
                return true;
            }
            if (c != null && !nudged && SystemClock.elapsedRealtime() > deadline - waitMs + 1500) {
                c.getTransportControls().play();
                nudged = true;
            }
            if (msm == null) {
                out("media.confirm", "skip");
                out("media.launch", "button");
                return true;
            }
            SystemClock.sleep(200);
        }
        out("media.launch", "timeout");
        return false;
    }

    private static MediaController find(MediaSessionManager msm, String pkg) {
        if (msm == null) return null;
        for (MediaController c : msm.getActiveSessions(null)) {
            if (pkg.equals(c.getPackageName())) return c;
        }
        return null;
    }

    private static boolean play(MediaSessionManager msm, String pkg) {
        MediaController c = find(msm, pkg);
        if (c == null) return false;
        c.getTransportControls().play();
        return true;
    }

    private static boolean isPlaying(MediaController c) {
        PlaybackState s = c == null ? null : c.getPlaybackState();
        if (s == null) return false;
        int st = s.getState();
        return st == PlaybackState.STATE_PLAYING || st == PlaybackState.STATE_BUFFERING
                || st == PlaybackState.STATE_CONNECTING || st == PlaybackState.STATE_FAST_FORWARDING
                || st == PlaybackState.STATE_REWINDING;
    }

    private static boolean waitPlaying(MediaSessionManager msm, String pkg, long ms) {
        if (msm == null) {
            // 无法确认：事件已发出，按成功处理，避免再补一次播放键
            SystemClock.sleep(Math.min(ms, 1000));
            out("media.confirm", "skip");
            return true;
        }
        long deadline = SystemClock.elapsedRealtime() + ms;
        do {
            if (isPlaying(find(msm, pkg))) return true;
            SystemClock.sleep(150);
        } while (SystemClock.elapsedRealtime() < deadline);
        return false;
    }

    private static void out(String k, String v) {
        System.out.println(k + "=" + (v == null ? "" : v.replace('\n', ' ')));
    }
}
