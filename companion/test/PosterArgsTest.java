import io.github.rczlin.sidekey.island.PosterArgs;

// 主机 JVM 运行：scripts/test-companion.sh
public final class PosterArgsTest {
    private static int failures;

    private static void check(boolean ok, String what) {
        if (!ok) { System.err.println("FAIL: " + what); failures++; }
    }

    public static void main(String[] args) {
        PosterArgs a = PosterArgs.parse(new String[] {
            "--seq", "00", "--label", "--code", "--code", "7", "--duration", "1234", "--show", "8"});
        check("00".equals(a.seq), "seq");
        check("--code".equals(a.label), "label may look like an option");
        check(a.code == 7, "code");
        check(a.durationMs == 1234, "duration");
        check(a.showSeconds == 8 && a.showMs() == 8000, "show");
        check(!a.test, "not test");

        PosterArgs t = PosterArgs.parse(new String[] {"--test"});
        check(t.test, "test flag");
        check(t.showSeconds == PosterArgs.SHOW_DEFAULT, "default show");

        check(PosterArgs.parse(new String[] {"--show", "1"}).showSeconds == 2, "clamp low");
        check(PosterArgs.parse(new String[] {"--show", "99"}).showSeconds == 15, "clamp high");
        check(PosterArgs.parse(new String[] {"--show", "x"}).showSeconds == 5, "bad show");
        check(PosterArgs.parse(new String[] {"--duration", "-9"}).durationMs == 0, "negative duration");
        check(PosterArgs.parse(new String[] {"--code", "-3"}).code == -3, "signal code");
        check(PosterArgs.parse(new String[] {"--seq"}).seq.isEmpty(), "dangling key");
        check(PosterArgs.parse(null) != null, "null args");

        if (failures > 0) { System.err.println(failures + " failure(s)"); System.exit(1); }
        System.out.println("PosterArgsTest: all passed");
    }
}
