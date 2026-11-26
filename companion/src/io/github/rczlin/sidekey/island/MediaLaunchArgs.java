package io.github.rczlin.sidekey.island;

/** MediaLaunch 的参数：<包名> [等待毫秒]，纯 Java，便于在主机上测试。 */
final class MediaLaunchArgs {
    static final int WAIT_DEFAULT = 5000;
    static final int WAIT_MAX = 15000;
    final String pkg;
    final int waitMs;

    private MediaLaunchArgs(String pkg, int waitMs) {
        this.pkg = pkg;
        this.waitMs = waitMs;
    }

    static boolean validPackage(String s) {
        return s != null && s.length() <= 255 && s.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+");
    }

    static MediaLaunchArgs parse(String[] argv) {
        if (argv.length < 1 || argv.length > 2 || !validPackage(argv[0])) {
            throw new IllegalArgumentException("usage: MediaLaunch <package> [waitMs]");
        }
        int wait = WAIT_DEFAULT;
        if (argv.length == 2) {
            try {
                wait = Integer.parseInt(argv[1]);
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("bad wait: " + argv[1]);
            }
            if (wait < 0) wait = 0;
            if (wait > WAIT_MAX) wait = WAIT_MAX;
        }
        return new MediaLaunchArgs(argv[0], wait);
    }
}
