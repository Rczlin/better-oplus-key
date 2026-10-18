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
    /** 常驻模式：从标准输入逐行读取请求（守护进程使用）。 */
    public boolean serve;
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
            if ("--serve".equals(k)) { a.serve = true; continue; }
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

    /**
     * 常驻模式的一行请求：seq\tlabel\tcode\tduration_ms\tshow_seconds（守护进程已把摘要里的制表符换成空格）。
     * 空行或字段不足返回 null；数字格式错误按缺省值处理。
     */
    public static PosterArgs parseLine(String line) {
        if (line == null) return null;
        String[] f = line.split("\t", -1);
        if (f.length < 5 || f[0].isEmpty()) return null;
        PosterArgs a = new PosterArgs();
        a.seq = f[0];
        a.label = f[1];
        a.code = (int) parseLong(f[2], 0);
        a.durationMs = Math.max(0, parseLong(f[3], 0));
        a.showSeconds = clampShow(parseLong(f[4], SHOW_DEFAULT));
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
