package io.github.rczlin.sidekey.island;

/**
 * Poster 的命令行参数（纯 Java，可在主机 JVM 上测试）。
 * 守护进程调用：--seq 00 --label 截屏 --code 0 --duration 42 --show 5
 * WebUI 测试：--test --show 5
 */
public final class PosterArgs {
    public static final int SHOW_MIN = 2;
    public static final int SHOW_MAX = 15;
    public static final int SHOW_DEFAULT = 5;

    public boolean test;
    public String seq = "";
    public String label = "";
    public int code;
    public long durationMs;
    /** 流体云显示时长（秒），已限制在 SHOW_MIN..SHOW_MAX。 */
    public int showSeconds = SHOW_DEFAULT;

    public long showMs() { return showSeconds * 1000L; }

    /** 未知参数与格式错误的数字一律忽略，保证提示总能发出。 */
    public static PosterArgs parse(String[] args) {
        PosterArgs a = new PosterArgs();
        if (args == null) return a;
        for (int i = 0; i < args.length; i++) {
            String k = args[i];
            if ("--test".equals(k)) { a.test = true; continue; }
            if (i + 1 >= args.length) break;
            String v = args[i + 1];
            switch (k) {
                case "--seq": a.seq = v; i++; break;
                case "--label": a.label = v; i++; break;
                case "--code": a.code = (int) parseLong(v, 0); i++; break;
                case "--duration": a.durationMs = Math.max(0, parseLong(v, 0)); i++; break;
                case "--show": a.showSeconds = clampShow(parseLong(v, SHOW_DEFAULT)); i++; break;
                default: break;
            }
        }
        return a;
    }

    public static int clampShow(long s) {
        if (s < SHOW_MIN) return SHOW_MIN;
        if (s > SHOW_MAX) return SHOW_MAX;
        return (int) s;
    }

    private static long parseLong(String v, long fallback) {
        try { return Long.parseLong(v.trim()); } catch (RuntimeException e) { return fallback; }
    }
}
