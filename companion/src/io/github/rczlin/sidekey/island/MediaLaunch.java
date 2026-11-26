package io.github.rczlin.sidekey.island;

import android.content.Context;
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
 *                                 再不行就打开应用，等它建立会话后 play()
 *   MediaLaunch --list            列出系统记录的历史播放器（诊断用）
 * 每一步发出“播放”后都会确认会话真的进入播放状态，确认不了返回 1，由 media.sh 再交给系统媒体按键兜底。
 * 输出：media.launch=history|session|app|timeout|none|error，media.app=…，media.via=event|token，media.error=…
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
            MediaSessionManager msm = ctx.getSystemService(MediaSessionManager.class);
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
        String via = OplusMedia.resume(ctx, p);
        out("media.app", p.pkg);
        out("media.via", via);
        boolean ok = waitPlaying(msm, p.pkg, CONFIRM_MS);
        out("media.launch", ok ? "history" : "timeout");
        return ok;
    }

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
        launch(a.pkg);
        long deadline = SystemClock.elapsedRealtime() + a.waitMs;
        while (SystemClock.elapsedRealtime() < deadline) {
            SystemClock.sleep(200);
            if (play(msm, a.pkg) && waitPlaying(msm, a.pkg, CONFIRM_MS)) {
                out("media.launch", "app");
                return true;
            }
        }
        out("media.launch", "timeout");
        return false;
    }

    private static MediaController find(MediaSessionManager msm, String pkg) {
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
        long deadline = SystemClock.elapsedRealtime() + ms;
        do {
            if (isPlaying(find(msm, pkg))) return true;
            SystemClock.sleep(150);
        } while (SystemClock.elapsedRealtime() < deadline);
        return false;
    }

    private static void launch(String pkg) throws Exception {
        Process p = new ProcessBuilder("monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1")
                .redirectErrorStream(true).start();
        p.getInputStream().readAllBytes();
        p.waitFor();
    }

    private static void out(String k, String v) {
        System.out.println(k + "=" + (v == null ? "" : v.replace('\n', ' ')));
    }
}
