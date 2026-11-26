import io.github.rczlin.sidekey.island.MediaLaunchArgsAccess;

public class MediaLaunchArgsTest {
    static void check(boolean ok, String what) {
        if (!ok) throw new AssertionError(what);
    }

    public static void main(String[] a) {
        check(MediaLaunchArgsAccess.pkg("com.netease.cloudmusic").equals("com.netease.cloudmusic"), "pkg");
        check(MediaLaunchArgsAccess.waitMs("com.a.b") == 5000, "default wait");
        check(MediaLaunchArgsAccess.waitMs("com.a.b", "99999") == 15000, "clamp max");
        check(MediaLaunchArgsAccess.waitMs("com.a.b", "-5") == 0, "clamp min");
        for (String[] bad : new String[][] { {}, {"nodot"}, {"com.a;reboot"}, {"com.a.b", "x"}, {"com.a.b", "1", "2"} }) {
            check(MediaLaunchArgsAccess.rejects(bad), "rejects " + String.join(" ", bad));
        }
        System.out.println("MediaLaunchArgsTest OK");
    }
}
