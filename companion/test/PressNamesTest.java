import io.github.rczlin.sidekey.island.PressNames;

// 主机 JVM 运行的纯 Java 测试（不依赖 Android）：scripts/test-companion.sh
public final class PressNamesTest {
    private static int failures;

    private static void eq(String actual, String expected) {
        if (!expected.equals(actual)) {
            System.err.println("FAIL: expected <" + expected + "> but was <" + actual + ">");
            failures++;
        }
    }

    public static void main(String[] args) {
        eq(PressNames.name("0"), "单击");
        eq(PressNames.name("00"), "双击");
        eq(PressNames.name("000"), "三击");
        eq(PressNames.name("1"), "长按");
        eq(PressNames.name("01"), "短按+长按");
        eq(PressNames.name("0110"), "短→长→长→短");
        eq(PressNames.name(""), "侧键");
        eq(PressNames.name(null), "侧键");
        eq(PressNames.name("0x1"), "侧键");

        eq(PressNames.status(0), "执行成功");
        eq(PressNames.status(127), "执行失败（127）");
        eq(PressNames.status(-3), "被信号终止");

        eq(PressNames.chip("00", 0), "✓ 双击");
        eq(PressNames.chip("1", 2), "✗ 长按");

        eq(PressNames.duration(0), "0 毫秒");
        eq(PressNames.duration(999), "999 毫秒");
        eq(PressNames.duration(1000), "1.0 秒");
        eq(PressNames.duration(12345), "12.3 秒");
        eq(PressNames.duration(-5), "0 毫秒");
        eq(PressNames.duration(1999), "1.9 秒");
        eq(PressNames.duration(59_999), "59.9 秒");
        eq(PressNames.duration(60_000), "1 分 00 秒");
        eq(PressNames.duration(125_400), "2 分 05 秒");

        eq(PressNames.body("截屏", 42), "截屏 · 42 毫秒");
        eq(PressNames.body("", 42), "42 毫秒");
        eq(PressNames.body(null, 1500), "1.5 秒");

        if (failures > 0) {
            System.err.println(failures + " failure(s)");
            System.exit(1);
        }
        System.out.println("PressNamesTest: all passed");
    }
}
