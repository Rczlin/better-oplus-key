package io.github.rczlin.sidekey.island;

import android.content.Context;
import android.media.session.MediaController;
import android.media.session.MediaSession;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

/**
 * ColorOS 控制中心“继续播放”同款（反编译系统界面 17.99.02 得到）：
 *   OplusQsMediaUtil.getHistoryPlayList()  ← OplusMediaControlManager.getHistoryMediaPlayerInfoList()
 *   OplusQsMediaUtil.handleResumeApp(card)：
 *     QsUtil.getAndUnFreezePackage(pkg)   ← OplusPackageManager 解冻被“应用冻结”的播放器
 *     OplusMediaControlManager.sendEvent(new OplusMediaEvent.Builder(1)
 *         .setData(new OplusPlaybackCommandData(1)).setPlayerId(playerId).build())
 * 卡片没有内容时点播放，就是对历史播放器里的这一项发“播放”。系统框架类只在 ColorOS 上存在，全部反射调用。
 */
final class OplusMedia {
    private OplusMedia() {}

    static final class Player {
        final String pkg;
        final String playerId;
        final Object token;
        Player(String pkg, String playerId, Object token) {
            this.pkg = pkg;
            this.playerId = playerId;
            this.token = token;
        }
    }

    private static Object manager() throws Exception {
        return Class.forName("com.oplus.media.OplusMediaControlManager").getMethod("getInstance").invoke(null);
    }

    /** 系统记录的历史播放器，顺序与控制中心卡片一致（最近的在前）。 */
    static List<Player> history() throws Exception {
        Object list = manager().getClass().getMethod("getHistoryMediaPlayerInfoList").invoke(manager());
        List<Player> out = new ArrayList<>();
        if (!(list instanceof List)) return out;
        for (Object info : (List<?>) list) {
            Class<?> c = info.getClass();
            String pkg = (String) c.getMethod("getPackageName").invoke(info);
            String id = (String) c.getMethod("getPlayerId").invoke(info);
            Object token = null;
            try {
                token = c.getMethod("getToken").invoke(info);
            } catch (Throwable ignored) {
                // 旧版本没有 token
            }
            if (pkg != null && !pkg.isEmpty()) out.add(new Player(pkg, id, token));
        }
        return out;
    }

    /** 与 QsUtil.getAndUnFreezePackage 相同：被冻结（状态 2）时解冻。返回是否做了解冻。 */
    static boolean unfreeze(Context ctx, String pkg, int userId) {
        try {
            Class<?> c = Class.forName("android.content.pm.OplusPackageManager");
            Object opm = c.getConstructor(Context.class).newInstance(ctx);
            int state = (Integer) c.getMethod("getOplusFreezePackageState", String.class, int.class).invoke(opm, pkg, userId);
            if (state != 2) return false;
            c.getMethod("oplusUnFreezePackage", String.class, int.class, int.class, int.class, String.class)
                    .invoke(opm, pkg, userId, 1, 0, "com.android.systemui");
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** 对历史播放器发“播放”：先走 ColorOS 媒体中心事件，失败再用它的会话令牌直接 play()。 */
    static String resume(Context ctx, Player p) throws Exception {
        try {
            Class<?> b = Class.forName("com.oplus.media.OplusMediaEvent$Builder");
            Class<?> dataCls = Class.forName("com.oplus.media.OplusMediaEventData");
            Object data = Class.forName("com.oplus.media.OplusPlaybackCommandData").getConstructor(int.class).newInstance(1);
            Object builder = b.getConstructor(int.class).newInstance(1);
            builder = b.getMethod("setData", dataCls).invoke(builder, data);
            if (p.playerId != null && !p.playerId.isEmpty()) builder = b.getMethod("setPlayerId", String.class).invoke(builder, p.playerId);
            Object event = b.getMethod("build").invoke(builder);
            Object m = manager();
            Method send = null;
            for (Method x : m.getClass().getMethods()) {
                if (x.getName().equals("sendEvent") && x.getParameterCount() == 1) send = x;
            }
            if (send == null) throw new NoSuchMethodException("sendEvent");
            send.invoke(m, event);
            return "event";
        } catch (Throwable eventError) {
            if (p.token instanceof MediaSession.Token) {
                new MediaController(ctx, (MediaSession.Token) p.token).getTransportControls().play();
                return "token";
            }
            if (eventError instanceof Exception) throw (Exception) eventError;
            throw new RuntimeException(eventError);
        }
    }

    static boolean available() {
        try {
            Class.forName("com.oplus.media.OplusMediaControlManager");
            return true;
        } catch (Throwable t) {
            return false;
        }
    }
}
