package io.github.rczlin.sidekey.island;

/** MediaLaunch 的参数：--list | --recent | <包名> [等待毫秒]，纯 Java，便于在主机上测试。 */
final class MediaLaunchArgs {
    static final int WAIT_DEFAULT = 5000;
    static final int WAIT_MAX = 15000;
    enum Mode { LIST, RECENT, APP }
    final Mode mode;
    final String pkg;
    final int waitMs;

    private MediaLaunchArgs(Mode mode, String pkg, int waitMs) {
        this.mode = mode;
        this.pkg = pkg;
        this.waitMs = waitMs;
    }

    static boolean validPackage(String s) {
        return s != null && s.length() <= 255 && s.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+");
    }

    static MediaLaunchArgs parse(String[] argv) {
        if (argv.length == 1 && "--list".equals(argv[0])) return new MediaLaunchArgs(Mode.LIST, null, 0);
        if (argv.length == 1 && "--recent".equals(argv[0])) return new MediaLaunchArgs(Mode.RECENT, null, WAIT_DEFAULT);
        if (argv.length < 1 || argv.length > 2 || !validPackage(argv[0])) {
            throw new IllegalArgumentException("usage: MediaLaunch --list | --recent | <package> [waitMs]");
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
        return new MediaLaunchArgs(Mode.APP, argv[0], wait);
    }
}
