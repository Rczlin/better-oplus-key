package io.github.rczlin.sidekey.island;

import java.util.Locale;

/** 提示文字的纯函数，不依赖 Android，可在主机 JVM 上测试。 */
public final class PressNames {
    private PressNames() {}

    /** 按法名称：0=短按，1=长按。 */
    public static String name(String seq) {
        if (seq == null || seq.isEmpty() || !seq.matches("[01]+")) return "侧键";
        switch (seq) {
            case "0": return "单击";
            case "00": return "双击";
            case "000": return "三击";
            case "1": return "长按";
            case "01": return "短按+长按";
            default:
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < seq.length(); i++) {
                    if (i > 0) sb.append('→');
                    sb.append(seq.charAt(i) == '0' ? '短' : '长');
                }
                return sb.toString();
        }
    }

    /** 退出码说明：-3 表示被信号终止（与守护进程日志一致）。 */
    public static String status(int code) {
        if (code == 0) return "执行成功";
        if (code == -3) return "被信号终止";
        return "执行失败（" + code + "）";
    }

    /** 流体云胶囊文字：系统只显示很短的内容，因此只放结果符号与按法。 */
    public static String chip(String seq, int code) {
        return (code == 0 ? "✓ " : "✗ ") + name(seq);
    }

    /** 耗时：1 秒内显示毫秒，1 分钟内保留一位小数，更长显示“分 秒”。 */
    public static String duration(long ms) {
        if (ms < 1000) return Math.max(0, ms) + " 毫秒";
        if (ms < 60_000) return String.format(Locale.ROOT, "%.1f 秒", Math.floor(ms / 100.0) / 10.0);
        long s = ms / 1000;
        return String.format(Locale.ROOT, "%d 分 %02d 秒", s / 60, s % 60);
    }

    /** 展开后的正文：动作摘要 · 耗时。 */
    public static String body(String label, long ms) {
        String d = duration(ms);
        return label == null || label.isEmpty() ? d : label + " · " + d;
    }
}
