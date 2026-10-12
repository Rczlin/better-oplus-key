#include <errno.h>
#include <fcntl.h>
#include <libevdev/libevdev.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <linux/input.h>
#include "sidekey_args.h"
#include "sidekey_config.h"
#include "sidekey_fsm.h"
#include "sidekey_log.h"
#include "sidekey_runtime.h"
#include "sidekey_scan.h"

#define PATH_MAX_LOCAL 256
#define LOG_LIMIT (512L * 1024L)
#define SHELL "/system/bin/sh"

static volatile sig_atomic_t g_reload = 0;
static volatile sig_atomic_t g_stop = 0;
static volatile sig_atomic_t g_child_done = 0;

static char g_moddir[PATH_MAX_LOCAL];
static char g_log_path[PATH_MAX_LOCAL];
static char g_events_path[PATH_MAX_LOCAL];
static char g_pid_path[PATH_MAX_LOCAL];
static char g_conf_path[PATH_MAX_LOCAL];

static sidekey_config_t g_cfg;
static sidekey_fsm_t g_fsm;
static int g_dev_fd = -1;

static void on_hup(int s) { (void)s; g_reload = 1; }
static void on_term(int s) { (void)s; g_stop = 1; }
static void on_chld(int s) { (void)s; g_child_done = 1; }

static void now_ts(char *out, size_t n) {
    time_t t = time(NULL);
    struct tm tm;
    localtime_r(&t, &tm);
    strftime(out, n, "%Y-%m-%d %H:%M:%S", &tm);
}

static long long wall_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (long long)ts.tv_sec * 1000LL + ts.tv_nsec / 1000000LL;
}

static long long mono_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long long)ts.tv_sec * 1000LL + ts.tv_nsec / 1000000LL;
}

static void log_msg(const char *level, const char *msg) {
    char ts[32], line[1024];
    now_ts(ts, sizeof(ts));
    sidekey_log_format_line(line, sizeof(line), ts, level, msg);
    sidekey_log_append(g_log_path, line, LOG_LIMIT);
}

static void log_seq(const char *seq, const char *action, int result) {
    char ts[32], line[1024];
    now_ts(ts, sizeof(ts));
    sidekey_log_format_seq(line, sizeof(line), ts, seq, action, result);
    sidekey_log_append(g_log_path, line, LOG_LIMIT);
}

static void log_event(const char *edge, int code) {
    char line[256];
    sidekey_runtime_event_line(line, sizeof(line), wall_ms(), mono_ms(), edge, code);
    sidekey_log_append(g_events_path, line, LOG_LIMIT);
}

static int load_config(void) {
    FILE *f = fopen(g_conf_path, "rb");
    if (!f) return -1;
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return -1; }
    long sz = ftell(f);
    if (sz < 0 || sz > 64 * 1024) { fclose(f); return -1; }
    rewind(f);
    char *buf = malloc((size_t)sz + 1);
    if (!buf) { fclose(f); return -1; }
    size_t got = fread(buf, 1, (size_t)sz, f);
    fclose(f);
    buf[got] = '\0';
    int rc = sidekey_config_parse(buf, &g_cfg);
    free(buf);
    return rc;
}

/* 在飞行中的子进程：pid -> 序列，用于在 SIGCHLD 回收时写出真实退出码。 */
#define MAX_INFLIGHT 16
typedef struct { pid_t pid; char seq[4]; char action[SIDEKEY_CMD_MAX]; } inflight_t;
static inflight_t g_inflight[MAX_INFLIGHT];

static void remember_inflight(pid_t pid, const char *seq, const char *action) {
    for (int i = 0; i < MAX_INFLIGHT; i++) {
        if (g_inflight[i].pid == 0) {
            g_inflight[i].pid = pid;
            snprintf(g_inflight[i].seq, sizeof(g_inflight[i].seq), "%s", seq);
            snprintf(g_inflight[i].action, sizeof(g_inflight[i].action), "%s", action);
            return;
        }
    }
    /* 槽位满：仍会执行命令，但退出码无法回填，记一条警告。 */
    log_msg("WARN", "too many concurrent actions; exit code will not be recorded");
}

/* 序列完成回调：查绑定并派发。解释日志在子进程退出后写真实结果。 */
static void on_sequence(const char *seq, int len, void *ctx) {
    (void)ctx;
    char s[4];
    memcpy(s, seq, (size_t)len);
    s[len] = '\0';

    const char *cmd = sidekey_runtime_lookup(&g_cfg, s);
    if (!cmd) {
        log_seq(s, NULL, -1);   /* 无绑定：丢弃，记 dropped */
        return;
    }
    pid_t pid = fork();
    if (pid == 0) {
        execl(SHELL, "sh", "-c", cmd, (char *)NULL);
        _exit(127);
    }
    if (pid < 0) {
        log_seq(s, cmd, -2);    /* fork 失败：记 result=-2 */
        return;
    }
    remember_inflight(pid, s, cmd);
}

static void reap_children(void) {
    int status;
    pid_t p;
    while ((p = waitpid(-1, &status, WNOHANG)) > 0) {
        int code = -3;          /* -3：被信号终止 */
        if (WIFEXITED(status)) code = WEXITSTATUS(status);
        for (int i = 0; i < MAX_INFLIGHT; i++) {
            if (g_inflight[i].pid == p) {
                log_seq(g_inflight[i].seq, g_inflight[i].action, code);
                g_inflight[i].pid = 0;
                break;
            }
        }
    }
    g_child_done = 0;
}

static int write_pid(void) {
    FILE *f = fopen(g_pid_path, "w");
    if (!f) return -1;
    fprintf(f, "%d\n", (int)getpid());
    fclose(f);
    return 0;
}

static void remove_pid(void) { unlink(g_pid_path); }

static int pid_file_alive(void) {
    FILE *f = fopen(g_pid_path, "r");
    if (!f) return 0;
    int pid = 0;
    int ok = fscanf(f, "%d", &pid);
    fclose(f);
    if (ok != 1 || pid <= 0) return 0;
    if (pid == (int)getpid()) return 0;
    char p[64];
    snprintf(p, sizeof(p), "/proc/%d", pid);
    return access(p, F_OK) == 0;
}

static int setup_paths(const char *moddir) {
    int n1 = snprintf(g_moddir, sizeof(g_moddir), "%s", moddir);
    int n2 = snprintf(g_log_path, sizeof(g_log_path), "%s/log.txt", moddir);
    int n3 = snprintf(g_events_path, sizeof(g_events_path), "%s/events.jsonl", moddir);
    int n4 = snprintf(g_pid_path, sizeof(g_pid_path), "%s/daemon.pid", moddir);
    int n5 = snprintf(g_conf_path, sizeof(g_conf_path), "%s/config.conf", moddir);
    if (n1 < 0 || n2 < 0 || n3 < 0 || n4 < 0 || n5 < 0) return -1;
    if ((size_t)n1 >= sizeof(g_moddir) || (size_t)n2 >= sizeof(g_log_path) ||
        (size_t)n3 >= sizeof(g_events_path) || (size_t)n4 >= sizeof(g_pid_path) ||
        (size_t)n5 >= sizeof(g_conf_path)) return -1;
    return 0;
}

static void fail_exit(const char *msg) {
    char line[512];
    snprintf(line, sizeof(line), "%s", msg);
    log_msg("ERROR", line);
    remove_pid();
    if (g_dev_fd >= 0) close(g_dev_fd);
    exit(1);
}

static void release_and_exit(int code) {
    if (g_dev_fd >= 0) {
        ioctl(g_dev_fd, EVIOCGRAB, 0);
        close(g_dev_fd);
        g_dev_fd = -1;
    }
    remove_pid();
    log_msg("INFO", "daemon stopped");
    exit(code);
}

int main(int argc, char **argv) {
    char moddir[PATH_MAX_LOCAL];
    if (sidekey_parse_args(argc, argv, moddir, sizeof(moddir)) != 0) {
        fprintf(stderr, "usage: oplus-sidekey <moddir>\n");
        return 2;
    }
    if (setup_paths(moddir) != 0) {
        fprintf(stderr, "moddir path too long\n");
        return 2;
    }

    /* 每个信号显式设置 flags，不依赖残留状态。
       SIGHUP/SIGTERM/SIGINT 不设 SA_RESTART：让 poll 被打断，及时响应。 */
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_flags = 0;
    sa.sa_handler = on_hup;  sigaction(SIGHUP, &sa, NULL);
    sa.sa_handler = on_term; sigaction(SIGTERM, &sa, NULL);
    sa.sa_handler = on_term; sigaction(SIGINT, &sa, NULL);
    sa.sa_flags = SA_RESTART | SA_NOCLDSTOP;
    sa.sa_handler = on_chld; sigaction(SIGCHLD, &sa, NULL);
    signal(SIGPIPE, SIG_IGN);

    log_msg("INFO", "daemon starting");

    if (pid_file_alive()) {
        log_msg("WARN", "another instance appears to be running; exiting");
        return 0;
    }

    if (load_config() != 0) {
        fail_exit("config.conf missing or invalid; not grabbing device");
    }
    log_msg("INFO", "config loaded");

    char devpath[PATH_MAX_LOCAL];
    int matched = 0;
    int found = sidekey_scan_find("/dev/input", g_cfg.keycode, devpath, sizeof(devpath), &matched);
    {
        char msg[256];
        snprintf(msg, sizeof(msg), "scan keycode=%d matched=%d path=%s",
                 g_cfg.keycode, matched, found == 1 ? devpath : "none");
        log_msg("INFO", msg);
    }
    if (found != 1) {
        fail_exit("no input device declares keycode; not grabbing");
    }
    if (matched > 1) {
        log_msg("WARN", "multiple devices matched; grabbing the first one only");
    }

    g_dev_fd = open(devpath, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (g_dev_fd < 0) {
        fail_exit("open device failed; not grabbing");
    }
    if (ioctl(g_dev_fd, EVIOCGRAB, 1) != 0) {
        fail_exit("EVIOCGRAB failed; not grabbing");
    }
    log_msg("INFO", "device grabbed exclusively");

    if (write_pid() != 0) {
        fail_exit("cannot write daemon.pid");
    }

    sidekey_fsm_cfg_t fcfg = g_cfg.fsm;
    sidekey_fsm_init(&g_fsm, &fcfg, on_sequence, NULL);

    int prev_pressed = 0;
    for (;;) {
        if (g_stop) release_and_exit(0);

        if (g_reload) {
            g_reload = 0;
            if (load_config() == 0) {
                g_fsm.cfg = g_cfg.fsm;
                log_msg("INFO", "config reloaded");
            } else {
                log_msg("ERROR", "config reload failed; keeping previous config");
            }
        }
        if (g_child_done) reap_children();

        long long now = mono_ms();
        long long next = sidekey_fsm_tick(&g_fsm, now);
        int timeout = (next < 0) ? -1 : (int)(next - now);
        if (timeout < 0 && next >= 0) timeout = 0;

        struct pollfd pfd = { .fd = g_dev_fd, .events = POLLIN };
        int pr = poll(&pfd, 1, timeout);
        if (pr < 0) {
            if (errno == EINTR) continue;
            fail_exit("poll failed");
        }
        if (pr == 0) continue;

        struct input_event ev[32];
        ssize_t n = read(g_dev_fd, ev, sizeof(ev));
        if (n < 0) {
            if (errno == EAGAIN || errno == EINTR) continue;
            fail_exit("read device failed");
        }
        size_t count = (size_t)n / sizeof(ev[0]);
        for (size_t i = 0; i < count; i++) {
            if (ev[i].type != EV_KEY || ev[i].code != (unsigned)g_cfg.keycode) continue;
            if (ev[i].value == 2) continue;          /* 忽略自动重复 */
            int pressed = (ev[i].value == 1);
            if (pressed == prev_pressed) continue;
            prev_pressed = pressed;
            log_event(pressed ? "down" : "up", g_cfg.keycode);
            sidekey_fsm_key(&g_fsm, pressed, mono_ms());
        }
    }
}
