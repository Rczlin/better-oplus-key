#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <libevdev/libevdev.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/file.h>
#include <time.h>
#include <unistd.h>
#include <linux/input.h>
#include "sidekey_args.h"
#include "sidekey_config.h"
#include "sidekey_fsm.h"
#include "sidekey_input.h"
#include "sidekey_log.h"
#include "sidekey_runtime.h"
#include "sidekey_scan.h"

#define PATH_MAX_LOCAL 256
#define LOG_LIMIT (512L * 1024L)
#define SHELL "/system/bin/sh"
#ifndef SIDEKEY_NULL_DEVICE
#define SIDEKEY_NULL_DEVICE "/dev/null"
#endif

static volatile sig_atomic_t g_reload = 0;
static volatile sig_atomic_t g_stop = 0;
static volatile sig_atomic_t g_child_done = 0;

static char g_moddir[PATH_MAX_LOCAL];
static char g_log_path[PATH_MAX_LOCAL];
static char g_events_path[PATH_MAX_LOCAL];
static char g_pid_path[PATH_MAX_LOCAL];
static char g_conf_path[PATH_MAX_LOCAL];
static char g_lock_path[PATH_MAX_LOCAL];

static sidekey_config_t g_cfg;
static sidekey_fsm_t g_fsm;
static int g_dev_fd = -1;
static struct libevdev *g_dev;
static int g_lock_fd = -1;
static int g_pid_owned = 0;
static int g_active_resources = 0;
static sigset_t g_child_mask;

static void on_sequence(const char *seq, int len, void *ctx);

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
    char ts[32];
    now_ts(ts, sizeof(ts));
    size_t cap = strlen(seq) + (action ? strlen(action) : 4) + 128;
    char *line = malloc(cap);
    if (!line) {
        log_msg("ERROR", "unable to allocate sequence log buffer");
        return;
    }
    sidekey_log_format_seq(line, cap, ts, seq, action, result);
    sidekey_log_append(g_log_path, line, LOG_LIMIT);
    free(line);
}

static void input_log_event(void *ctx, int pressed, int code, long long t_ms) {
    (void)ctx;
    char line[256];
    sidekey_runtime_event_line(line, sizeof(line), wall_ms(), t_ms, pressed ? "down" : "up", code);
    sidekey_log_append(g_events_path, line, LOG_LIMIT);
}

static int input_next_event(void *ctx, unsigned int flags, struct input_event *event) {
    if (g_stop || g_reload || g_child_done) return -EINTR;
    return libevdev_next_event(ctx, flags, event);
}

static long long input_now_ms(void *ctx) {
    (void)ctx;
    return mono_ms();
}

static int load_config(void) {
    FILE *f = fopen(g_conf_path, "rb");
    if (!f) return -1;
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return -1; }
    long sz = ftell(f);
    if (sz < 0 || sz > 64 * 1024) { fclose(f); return -1; }
    if (fseek(f, 0, SEEK_SET) != 0) { fclose(f); return -1; }
    char *buf = malloc((size_t)sz + 1);
    if (!buf) { fclose(f); return -1; }
    size_t got = fread(buf, 1, (size_t)sz, f);
    int extra = fgetc(f);
    int read_error = ferror(f);
    fclose(f);
    if (read_error || got != (size_t)sz || extra != EOF) { free(buf); return -1; }
    if (memchr(buf, '\0', got) != NULL) { free(buf); return -1; }
    buf[got] = '\0';
    sidekey_config_t next;
    sidekey_config_init(&next);
    int rc = sidekey_config_parse(buf, &next);
    free(buf);
    if (rc == SIDEKEY_CONFIG_ERR_TOO_LONG) {
        log_msg("ERROR", "configuration rejected: command exceeds 511 UTF-8 bytes or configuration line is too long");
    } else if (rc == 0 && next.skipped_lines > 0) {
        char msg[128];
        snprintf(msg, sizeof(msg), "configuration skipped %d invalid or unknown line(s)",
                 next.skipped_lines);
        log_msg("WARN", msg);
    }
    if (rc != 0) {
        sidekey_config_destroy(&next);
        return rc;
    }
    if (g_active_resources && next.keycode != g_cfg.keycode) {
        sidekey_config_destroy(&next);
        log_msg("ERROR", "configuration keycode changed; restart required, keeping previous configuration");
        return -1;
    }

    sidekey_fsm_t next_fsm = {0};
    size_t max_seq = next.max_seq_len ? next.max_seq_len : 1;
    if (sidekey_fsm_init_with_match(&next_fsm, &next.fsm, max_seq,
                                    sidekey_runtime_match, on_sequence, &g_cfg) != 0) {
        sidekey_config_destroy(&next);
        log_msg("ERROR", "configuration reload failed: unable to allocate input state");
        return SIDEKEY_CONFIG_ERR_NOMEM;
    }

    sidekey_fsm_destroy(&g_fsm);
    sidekey_config_destroy(&g_cfg);
    g_cfg = next;
    g_fsm = next_fsm;
    g_active_resources = 1;
    return 0;
}

/* 在飞行中的子进程：pid -> 序列，用于在 SIGCHLD 回收时写出真实退出码。 */
#define MAX_INFLIGHT 16
typedef struct { pid_t pid; char *seq; char *action; } inflight_t;
static inflight_t g_inflight[MAX_INFLIGHT];

static int remember_inflight(pid_t pid, const char *seq, const char *action) {
    for (int i = 0; i < MAX_INFLIGHT; i++) {
        if (g_inflight[i].pid == 0) {
            g_inflight[i].seq = strdup(seq);
            g_inflight[i].action = strdup(action);
            if (!g_inflight[i].seq || !g_inflight[i].action) {
                free(g_inflight[i].seq);
                free(g_inflight[i].action);
                g_inflight[i].seq = NULL;
                g_inflight[i].action = NULL;
                return -1;
            }
            g_inflight[i].pid = pid;
            return i;
        }
    }
    return -1;
}

/* 子进程执行命令前把 stdin/stdout/stderr 全部指向 /dev/null。
   input/am/cmd/settings 等命令会通过 binder 把自身的标准 fd 交给 system_server；
   继承到的 fd 若是 /data/adb 下的日志文件，SELinux 拒绝传递，命令报
   “Failed transaction”并以退出码 2 失败。/dev/null 对所有域可用。 */
static int redirect_child_stdio(void) {
    int fd = open(SIDEKEY_NULL_DEVICE, O_RDWR | O_CLOEXEC);
    if (fd < 0) return -1;
    int rc = 0;
    for (int target = 0; target <= 2; target++) {
        if (dup2(fd, target) < 0) rc = -1;   /* dup2 结果不带 CLOEXEC */
    }
    if (fd > 2) close(fd);
    return rc;
}

/* 序列完成回调：查绑定并派发。解释日志在子进程退出后写真实结果。 */
static void on_sequence(const char *seq, int len, void *ctx) {
    (void)ctx;
    if (len <= 0) return;
    char *s = malloc((size_t)len + 1);
    if (!s) {
        log_msg("ERROR", "unable to allocate sequence dispatch buffer");
        return;
    }
    memcpy(s, seq, (size_t)len);
    s[len] = '\0';

    const char *cmd = sidekey_runtime_lookup(&g_cfg, s);
    if (!cmd) {
        log_seq(s, NULL, -1);   /* 无绑定：丢弃，记 dropped */
        free(s);
        return;
    }
    /* Own both strings before fork; allocation failure must not dispatch an untracked action. */
    int slot = remember_inflight(-1, s, cmd);
    if (slot < 0) {
        log_msg("ERROR", "action not dispatched: no memory or free action slot");
        free(s);
        return;
    }
    pid_t pid = fork();
    if (pid == 0) {
        sigprocmask(SIG_SETMASK, &g_child_mask, NULL);
        if (redirect_child_stdio() != 0) _exit(126);
        execl(SHELL, "sh", "-c", cmd, (char *)NULL);
        _exit(127);
    }
    if (pid < 0) {
        log_seq(s, cmd, -2);    /* fork 失败：记 result=-2 */
        free(g_inflight[slot].seq);
        free(g_inflight[slot].action);
        memset(&g_inflight[slot], 0, sizeof(g_inflight[slot]));
    } else g_inflight[slot].pid = pid;
    free(s);
}

static void reap_children(void) {
    int status;
    pid_t p;
    g_child_done = 0;
    int saved_errno = 0;
    for (;;) {
        p = waitpid(-1, &status, WNOHANG);
        if (p > 0) {
            int code = WIFEXITED(status) ? WEXITSTATUS(status) : -3;
            for (int i = 0; i < MAX_INFLIGHT; i++) {
                if (g_inflight[i].pid == p) {
                    log_seq(g_inflight[i].seq, g_inflight[i].action, code);
                    free(g_inflight[i].seq);
                    free(g_inflight[i].action);
                    memset(&g_inflight[i], 0, sizeof(g_inflight[i]));
                    break;
                }
            }
            continue;
        }
        saved_errno = errno;
        if (p < 0 && saved_errno == EINTR) continue;
        break;
    }
    if (p < 0 && saved_errno != ECHILD && saved_errno != EINTR) {
        log_msg("WARN", "waitpid failed while reaping child");
    }
}

static int write_pid(void) {
    FILE *f = fopen(g_pid_path, "w");
    if (!f) return -1;
    int written = fprintf(f, "%d\n", (int)getpid());
    int closed = fclose(f);
    if (written < 0 || closed != 0) return -1;
    g_pid_owned = 1;
    return 0;
}

static void remove_pid(void) {
    if (!g_pid_owned) return;
    FILE *f = fopen(g_pid_path, "r");
    int pid = 0;
    int ours = f && fscanf(f, "%d", &pid) == 1 && pid == (int)getpid();
    if (f) fclose(f);
    if (ours) unlink(g_pid_path);
    g_pid_owned = 0;
}

static int acquire_instance_lock(void) {
    int fd = open(g_lock_path, O_RDWR | O_CREAT | O_CLOEXEC, 0600);
    if (fd < 0) return -1;
    if (flock(fd, LOCK_EX | LOCK_NB) != 0) { close(fd); return -1; }
    g_lock_fd = fd;
    return 0;
}

/* Block only around the final flag check and atomically unblock inside ppoll. */
static int wait_for_input(int timeout_ms) {
    sigset_t blocked, previous;
    sigemptyset(&blocked);
    sigaddset(&blocked, SIGHUP); sigaddset(&blocked, SIGTERM);
    sigaddset(&blocked, SIGINT); sigaddset(&blocked, SIGCHLD);
    if (sigprocmask(SIG_BLOCK, &blocked, &previous) != 0) return -1;
    struct pollfd pfd = {.fd = g_dev_fd, .events = POLLIN};
    struct timespec timeout = {timeout_ms / 1000, (timeout_ms % 1000) * 1000000L};
    int rc = 0;
    if (!g_stop && !g_reload && !g_child_done)
        rc = ppoll(&pfd, 1, timeout_ms < 0 ? NULL : &timeout, &previous);
    int error = errno;
    if (sigprocmask(SIG_SETMASK, &previous, NULL) != 0) return -1;
    if (rc < 0 && error != EINTR) { errno = error; return -1; }
    if (pfd.revents & (POLLERR | POLLHUP | POLLNVAL)) { errno = ENODEV; return -1; }
    return 0;
}

static int setup_paths(const char *moddir) {
    int n1 = snprintf(g_moddir, sizeof(g_moddir), "%s", moddir);
    int n2 = snprintf(g_log_path, sizeof(g_log_path), "%s/log.txt", moddir);
    int n3 = snprintf(g_events_path, sizeof(g_events_path), "%s/events.jsonl", moddir);
    int n4 = snprintf(g_pid_path, sizeof(g_pid_path), "%s/daemon.pid", moddir);
    int n5 = snprintf(g_conf_path, sizeof(g_conf_path), "%s/config.conf", moddir);
    int n6 = snprintf(g_lock_path, sizeof(g_lock_path), "%s/daemon.lock", moddir);
    if (n1 < 0 || n2 < 0 || n3 < 0 || n4 < 0 || n5 < 0 || n6 < 0) return -1;
    if ((size_t)n1 >= sizeof(g_moddir) || (size_t)n2 >= sizeof(g_log_path) ||
        (size_t)n3 >= sizeof(g_events_path) || (size_t)n4 >= sizeof(g_pid_path) ||
        (size_t)n5 >= sizeof(g_conf_path) || (size_t)n6 >= sizeof(g_lock_path)) return -1;
    return 0;
}

static void fail_exit(const char *msg) {
    char line[512];
    snprintf(line, sizeof(line), "%s", msg);
    log_msg("ERROR", line);
    remove_pid();
    if (g_dev) { libevdev_free(g_dev); g_dev = NULL; }
    if (g_dev_fd >= 0) close(g_dev_fd);
    exit(1);
}

static void release_and_exit(int code) {
    if (g_dev_fd >= 0) {
        if (g_dev) {
            libevdev_grab(g_dev, LIBEVDEV_UNGRAB);
            libevdev_free(g_dev);
            g_dev = NULL;
        }
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
    sidekey_config_init(&g_cfg);
    sigprocmask(SIG_SETMASK, NULL, &g_child_mask);

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

    if (acquire_instance_lock() != 0) {
        log_msg("WARN", "cannot acquire instance lock; another instance may be running");
        return 1;
    }

    if (load_config() != 0) {
        fail_exit("config.conf missing or invalid; not grabbing device");
    }
    log_msg("INFO", "config loaded");

    char devpath[PATH_MAX_LOCAL];
    int matched = 0;
    int found = sidekey_scan_find("/dev/input", g_cfg.keycode, devpath, sizeof(devpath), &matched);
    {
        char msg[PATH_MAX_LOCAL + 128];
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
    struct libevdev *dev;
    if (libevdev_new_from_fd(g_dev_fd, &dev) != 0) {
        fail_exit("libevdev initialization failed; not grabbing");
    }
    g_dev = dev;
    if (libevdev_set_clock_id(g_dev, CLOCK_MONOTONIC) != 0) {
        fail_exit("monotonic event clock failed; not grabbing");
    }
    if (libevdev_grab(g_dev, LIBEVDEV_GRAB) != 0) {
        fail_exit("EVIOCGRAB failed; not grabbing");
    }
    log_msg("INFO", "device grabbed exclusively");

    if (write_pid() != 0) {
        fail_exit("cannot write daemon.pid");
    }

    sidekey_input_t input = {
        .prev_pressed = libevdev_get_event_value(g_dev, EV_KEY, (unsigned)g_cfg.keycode) == 1,
        .discard_pending = 1
    };
    sidekey_input_io_t input_io = {input_next_event, input_now_ms, input_log_event, g_dev};
    for (;;) {
        if (g_stop) release_and_exit(0);

        if (g_reload) {
            g_reload = 0;
            if (load_config() == 0) {
                input.syncing = 0;
                input.discard_pending = 1;
                input.prev_pressed = libevdev_get_event_value(g_dev, EV_KEY, (unsigned)g_cfg.keycode) == 1;
                log_msg("INFO", "config reloaded");
            } else {
                log_msg("ERROR", "config reload failed; keeping previous config");
            }
        }
        if (g_child_done) reap_children();

        int timeout;
        int rc = sidekey_input_drain(&input, &g_fsm, g_cfg.keycode, &input_io, &timeout);
        if (rc == -EINTR) continue;
        if (rc < 0) fail_exit("read device failed");
        if (g_stop || g_reload || g_child_done) continue;

        if (wait_for_input(timeout) != 0) fail_exit("input wait failed or device disconnected");
        /* A timeout or readable fd both return to drain before current-time tick. */
    }
}
