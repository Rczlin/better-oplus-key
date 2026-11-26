package io.github.rczlin.sidekey.island;

/** 测试辅助：访问包内可见的 MediaLaunchArgs。 */
public final class MediaLaunchArgsAccess {
    private MediaLaunchArgsAccess() {}

    public static String pkg(String... argv) { return MediaLaunchArgs.parse(argv).pkg; }

    public static int waitMs(String... argv) { return MediaLaunchArgs.parse(argv).waitMs; }

    public static boolean rejects(String... argv) {
        try {
            MediaLaunchArgs.parse(argv);
            return false;
        } catch (IllegalArgumentException e) {
            return true;
        }
    }
}
