package io.github.rczlin.sidekey.island;

import android.content.Context;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.os.Looper;
import android.os.SystemClock;
import java.util.List;

/**
 * 没有可控播放器时，拉起指定音乐应用并开始播放（media.sh 在“打开指定应用”模式下调用）：
 *   app_process -Djava.class.path=island.apk /system/bin io.github.rczlin.sidekey.island.MediaLaunch <包名> [等待毫秒]
 *
 * 与控制中心媒体卡片相同，直接调用该应用媒体会话的 TransportControls.play()：
 * 1. 应用已有会话（例如停止后仍保留）时直接播放，不打开界面；
 * 2. 否则打开应用，等它建立媒体会话后再播放（多数音乐应用启动时会恢复上次的歌曲）。
 * root（uid 0）可读取全部活动会话；只使用 binder 调用，不需要绑定服务。
 * 输出：media.launch=session|app|timeout|error，以及 media.error=…
 */
public final class MediaLaunch {
    private MediaLaunch() {}

    public static void main(String[] argv) {
        int status;
        try {
            MediaLaunchArgs a = MediaLaunchArgs.parse(argv);
            if (Looper.myLooper() == null) Looper.prepareMainLooper();
            Context ctx = Poster.systemContext();
            MediaSessionManager msm = ctx.getSystemService(MediaSessionManager.class);
            if (play(msm, a.pkg)) {
                out("media.launch", "session");
                status = 0;
            } else {
                launch(a.pkg);
                long deadline = SystemClock.elapsedRealtime() + a.waitMs;
                boolean played = false;
                while (!played && SystemClock.elapsedRealtime() < deadline) {
                    SystemClock.sleep(200);
                    played = play(msm, a.pkg);
                }
                out("media.launch", played ? "app" : "timeout");
                status = played ? 0 : 1;
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

    /** 找到该应用的媒体会话就播放；同一应用有多个会话时取系统排序靠前（最近活跃）的一个。 */
    private static boolean play(MediaSessionManager msm, String pkg) {
        List<MediaController> sessions = msm.getActiveSessions(null);
        for (MediaController c : sessions) {
            if (pkg.equals(c.getPackageName())) {
                c.getTransportControls().play();
                return true;
            }
        }
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
