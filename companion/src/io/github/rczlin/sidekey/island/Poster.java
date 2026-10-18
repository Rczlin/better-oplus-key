package io.github.rczlin.sidekey.island;

import android.app.Notification;
import android.content.Context;
import android.os.IBinder;
import android.os.Looper;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.List;

/**
 * 以 root 身份（app_process）直接替伴生应用发布流体云通知：
 *   app_process -Djava.class.path=island.apk /system/bin io.github.rczlin.sidekey.island.Poster --seq 00 ...
 *
 * 不再依赖伴生应用进程被广播唤醒——ColorOS 会冻结/拦截后台应用，广播只有第一次能送达。
 * NotificationManagerService 允许 uid 0 以 opPkg="android" 代任意已安装包发布通知
 * （resolveNotificationUid → isCallerAndroid），通知的归属、图标与权限仍是伴生应用的。
 *
 * 输出 key=value（供 island.sh / WebUI 解析）；失败时退回广播给 IslandReceiver。
 */
public final class Poster {
    static final String PKG = "io.github.rczlin.sidekey.island";

    private Poster() {}

    public static void main(String[] argv) {
        PosterArgs a = PosterArgs.parse(argv);
        if (a.serve) {
            serve();
            return;
        }
        int status = 0;
        try {
            post(a);
        } catch (Throwable t) {
            Throwable root = t;
            while (root.getCause() != null) root = root.getCause();
            out("island.error", root.getClass().getSimpleName() + ": " + root.getMessage());
            status = fallbackBroadcast(a) ? 0 : 1;
            if (status == 0) out("island", "sent");
            out("island.path", status == 0 ? "broadcast" : "none");
        }
        System.out.flush();
        System.exit(status);
    }

    /** 一次性准备好的发布环境：上下文、通知服务、渠道与晋升开关。 */
    private static final class Session {
        final Context ctx;
        final int uid;
        final int userId;
        final Object nm;
        final boolean allowed;

        Session() throws Exception {
            if (Looper.myLooper() == null) Looper.prepareMainLooper();
            ctx = systemContext().createPackageContext(PKG, Context.CONTEXT_IGNORE_SECURITY);
            uid = ctx.getApplicationInfo().uid;
            userId = uid / 100000;
            nm = notificationService();
            invoke(nm, "createNotificationChannelsForPackage", PKG, uid,
                    parceledList(Collections.singletonList(IslandNotification.channel(ctx))));
            try {
                invoke(nm, "deleteNotificationChannel", PKG, IslandNotification.LEGACY_CHANNEL);
            } catch (Throwable ignored) {
                // 旧渠道删不掉不影响发布
            }
            allowed = enablePromotion(nm, uid);
        }

        Notification enqueue(PosterArgs a) throws Exception {
            Notification n = IslandNotification.build(ctx, a);
            invoke(nm, "enqueueNotificationWithTag", PKG, "android", IslandNotification.TAG,
                    IslandNotification.ID, n, userId);
            return n;
        }
    }

    /**
     * 常驻模式：守护进程每条提示写一行请求，读到 EOF（守护进程退出或关闭提示）时结束。
     * 虚拟机与通知服务连接只初始化一次，提示几毫秒内送达。
     * island.log 只记录启动与失败，长期运行也不会增长。
     */
    private static void serve() {
        Session session = null;
        try {
            session = new Session();
            out("island", "ready");
        } catch (Throwable t) {
            out("island.error", describe(t));
        }
        System.out.flush();
        startIdleWatchdog();
        java.io.BufferedReader in = new java.io.BufferedReader(
                new java.io.InputStreamReader(System.in, java.nio.charset.StandardCharsets.UTF_8));
        int failures = 0;
        for (;;) {
            String line;
            try {
                line = in.readLine();
            } catch (java.io.IOException e) {
                break;
            }
            if (line == null) break;
            lastActive = android.os.SystemClock.elapsedRealtime();
            PosterArgs a = PosterArgs.parseLine(line);
            if (a == null) continue;
            try {
                if (session == null) session = new Session();
                session.enqueue(a);
                failures = 0;
            } catch (Throwable t) {
                out("island.error", describe(t));
                session = null;   // 下一条重新连接（例如 system_server 重启）
                if (!fallbackBroadcast(a)) out("island.path", "none");
                if (++failures >= 20) break;   // 持续失败：退出，守护进程下次提示再拉起
            }
            System.out.flush();
        }
        System.out.flush();
        System.exit(0);
    }

    /** 空闲超过该时长自动退出，归还内存；守护进程在下一次提示时再拉起。 */
    static final long IDLE_EXIT_MS = 10 * 60 * 1000L;
    private static volatile long lastActive = android.os.SystemClock.elapsedRealtime();

    /** 阻塞读管道时不占 CPU；看门狗每分钟醒一次（不持唤醒锁，休眠时随系统一起停）。 */
    private static void startIdleWatchdog() {
        Thread t = new Thread(() -> {
            for (;;) {
                try {
                    Thread.sleep(60 * 1000L);
                } catch (InterruptedException e) {
                    return;
                }
                if (android.os.SystemClock.elapsedRealtime() - lastActive >= IDLE_EXIT_MS) {
                    System.out.flush();
                    System.exit(0);
                }
            }
        }, "idle-watchdog");
        t.setDaemon(true);
        t.start();
    }

    private static String describe(Throwable t) {
        Throwable root = t;
        while (root.getCause() != null) root = root.getCause();
        return root.getClass().getSimpleName() + ": " + root.getMessage();
    }

    private static void post(PosterArgs a) throws Exception {
        Session s = new Session();
        Object nm = s.nm;
        int userId = s.userId;
        boolean allowed = s.allowed;
        Notification n = s.enqueue(a);
        out("island", "sent");
        out("island.path", "root");
        if (!a.test) return;

        out("island.promotable", n.hasPromotableCharacteristics() ? "1" : "0");
        out("island.colorized", n.extras.getBoolean(Notification.EXTRA_COLORIZED) ? "1" : "0");
        out("island.allowed", allowed ? "1" : "0");
        out("island.promoted", promotedFlag(nm, userId));
    }

    /** 用户没有关掉时，替伴生应用打开“实况通知/流体云”开关（等同用户在设置里打开）。 */
    private static boolean enablePromotion(Object nm, int uid) {
        try {
            Object can = invoke(nm, "appCanBePromoted", PKG, uid);
            if (Boolean.TRUE.equals(can)) return true;
            invoke(nm, "setCanBePromoted", PKG, uid, true, true);
            return Boolean.TRUE.equals(invoke(nm, "appCanBePromoted", PKG, uid));
        } catch (Throwable t) {
            return false;
        }
    }

    /** 发布是异步的：轮询最多约 1.5 秒，读系统实际给出的 FLAG_PROMOTED_ONGOING。 */
    private static String promotedFlag(Object nm, int userId) {
        for (int i = 0; i < 15; i++) {
            try {
                Thread.sleep(100);
                Object slice = invoke(nm, "getAppActiveNotifications", PKG, userId);
                List<?> list = (List<?>) slice.getClass().getMethod("getList").invoke(slice);
                for (Object o : list) {
                    android.service.notification.StatusBarNotification sbn =
                            (android.service.notification.StatusBarNotification) o;
                    if (sbn.getId() != IslandNotification.ID
                            || !IslandNotification.TAG.equals(sbn.getTag())) continue;
                    return (sbn.getNotification().flags & IslandNotification.FLAG_PROMOTED_ONGOING) != 0 ? "1" : "0";
                }
            } catch (Throwable t) {
                return "unknown";
            }
        }
        return "missing";
    }

    private static boolean fallbackBroadcast(PosterArgs a) {
        try {
            Process p = new ProcessBuilder("/system/bin/cmd", "activity", "broadcast", "--user", "0",
                    "-f", "0x10000020", "-a", IslandReceiver.ACTION, "-n", PKG + "/.IslandReceiver",
                    "--es", "seq", a.seq, "--es", "label", a.label, "--ei", "code", String.valueOf(a.code),
                    "--el", "duration_ms", String.valueOf(a.durationMs), "--ei", "show", String.valueOf(a.showSeconds),
                    "--ez", "test", String.valueOf(a.test))
                    .redirectErrorStream(true).redirectOutput(new java.io.File("/dev/null")).start();
            return p.waitFor() == 0;
        } catch (Throwable t) {
            return false;
        }
    }

    // ---- 隐藏 API（app_process 不受隐藏 API 限制） ----

    private static Context systemContext() throws Exception {
        Class<?> at = Class.forName("android.app.ActivityThread");
        Constructor<?> c = at.getDeclaredConstructor();
        c.setAccessible(true);
        Object thread = c.newInstance();
        Field cur = at.getDeclaredField("sCurrentActivityThread");
        cur.setAccessible(true);
        cur.set(null, thread);
        Field sys = at.getDeclaredField("mSystemThread");
        sys.setAccessible(true);
        sys.setBoolean(thread, true);
        fillConfigurationController(at, thread);
        return (Context) at.getMethod("getSystemContext").invoke(thread);
    }

    /**
     * Android 13 起 ActivityThread 的配置由 ConfigurationController 管理，正常由 attach() 创建。
     * 这里只调用了构造函数，getSystemContext() 读取配置时会因它为 null 抛 NullPointerException，
     * 因此手动补上（与 scrcpy 的做法一致）。旧系统没有该类时忽略。
     */
    private static void fillConfigurationController(Class<?> at, Object thread) {
        try {
            Field f = at.getDeclaredField("mConfigurationController");
            f.setAccessible(true);
            if (f.get(thread) != null) return;
            Class<?> cc = Class.forName("android.app.ConfigurationController");
            Class<?> internal = Class.forName("android.app.ActivityThreadInternal");
            Constructor<?> k = cc.getDeclaredConstructor(internal);
            k.setAccessible(true);
            f.set(thread, k.newInstance(thread));
        } catch (Throwable ignored) {
            // 没有该字段或构造函数签名不同：交给 getSystemContext() 自行处理
        }
    }

    private static Object notificationService() throws Exception {
        IBinder b = (IBinder) Class.forName("android.os.ServiceManager")
                .getMethod("getService", String.class).invoke(null, "notification");
        if (b == null) throw new IllegalStateException("notification service unavailable");
        return Class.forName("android.app.INotificationManager$Stub")
                .getMethod("asInterface", IBinder.class).invoke(null, b);
    }

    private static Object parceledList(List<?> items) throws Exception {
        return Class.forName("android.content.pm.ParceledListSlice")
                .getConstructor(List.class).newInstance(items);
    }

    /** 按名称与参数个数查找 AIDL 方法（各版本签名一致，避免写死参数类型）。 */
    private static Object invoke(Object target, String name, Object... args) throws Exception {
        for (Method m : target.getClass().getMethods()) {
            if (m.getName().equals(name) && m.getParameterCount() == args.length) {
                try {
                    return m.invoke(target, args);
                } catch (java.lang.reflect.InvocationTargetException e) {
                    Throwable cause = e.getCause();
                    if (cause instanceof Exception) throw (Exception) cause;
                    throw e;
                }
            }
        }
        throw new NoSuchMethodException(name + "/" + args.length);
    }

    private static void out(String k, String v) {
        System.out.println(k + "=" + (v == null ? "" : v.replace('\n', ' ')));
    }
}
