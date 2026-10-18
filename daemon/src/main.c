#define _GNU_SOURCE
#include <dirent.h>
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
#include "sidekey_notify.h"
#include "sidekey_output.h"
#include "sidekey_runtime.h"
#include "sidekey_scan.h"

#define PATH_MAX_LOCAL 256
#define LOG_LIMIT (512L * 1024L)
#define OUTPUT_LOG_LIMIT (512L * 1024L)
#ifndef SIDEKEY_SHELL
#define SIDEKEY_SHELL "/system/bin/sh"
#endif
#define SHELL SIDEKEY_SHELL
#ifndef SIDEKEY_NOTIFY_BIN
#define SIDEKEY_NOTIFY_BIN "/system/bin/app_process"
#endif
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
static char g_output_path[PATH_MAX_LOCAL];

/* 流体云提示的发布程序（app_process）；测试中替换为记录参数的脚本。 */
static const char *g_notify_bin = SIDEKEY_NOTIFY_BIN;

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
        log_msg("ERROR", "configuration rejected: command exceeds 4095 UTF-8 bytes or configuration line is too long");
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
typedef struct {
    pid_t pid;
    char *seq;
    char *action;
    int out_fd;              /* 输出管道读端；-1 表示未捕获或已读到 EOF */
    int captured;            /* 本次执行是否收集了输出 */
    long long start_ms;
} inflight_t;
static inflight_t g_inflight[MAX_INFLIGHT];
static sidekey_output_buf_t g_outbuf[MAX_INFLIGHT];

static void clear_inflight(int i) {
    if (g_inflight[i].out_fd >= 0) close(g_inflight[i].out_fd);
    free(g_inflight[i].seq);
    free(g_inflight[i].action);
    memset(&g_inflight[i], 0, sizeof(g_inflight[i]));
    g_inflight[i].out_fd = -1;
    g_outbuf[i].len = 0;
    g_outbuf[i].truncated = 0;
}

static void init_inflight(void) {
    for (int i = 0; i < MAX_INFLIGHT; i++) {
        memset(&g_inflight[i], 0, sizeof(g_inflight[i]));
        g_inflight[i].out_fd = -1;
    }
}

/* 每个 fd 每轮最多读取的字节数：持续高速输出的命令（如 yes、logcat）不会让主循环卡在读取里，
   侧键事件仍能及时处理。 */
#define DRAIN_BUDGET (64 * 1024)

/* 非阻塞读取一个 fd；buf 为 NULL 时只丢弃。返回 1 表示 fd 已到 EOF/出错并已关闭。
   超出容量的部分读出后丢弃，避免子进程因管道写满而阻塞。 */
static int drain_fd(int fd, sidekey_output_buf_t *buf) {
    char tmp[4096];
    size_t budget = DRAIN_BUDGET;
    while (budget > 0) {
        ssize_t n = read(fd, tmp, sizeof(tmp));
        if (n > 0) {
            if (buf) sidekey_output_append(buf, tmp, (size_t)n);
            budget = (size_t)n >= budget ? 0 : budget - (size_t)n;
            continue;
        }
        if (n < 0 && errno == EINTR) continue;
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return 0;
        close(fd);                     /* EOF 或读错误 */
        return 1;
    }
    return 0;                          /* 本轮预算用完，下一轮继续 */
}

static void drain_output(int i) {
    if (g_inflight[i].out_fd >= 0 && drain_fd(g_inflight[i].out_fd, &g_outbuf[i]))
        g_inflight[i].out_fd = -1;
}

/* 主 shell 已退出、但后台子进程（cmd &）仍持有管道写端的读端。
   继续读取并丢弃直到 EOF，使后台进程的写入不会因 EPIPE 失败（与旧版写 /dev/null 的行为一致）。 */
#define MAX_ORPHANS 16
static int g_orphans[MAX_ORPHANS] = {-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1};

static void adopt_orphan(int fd) {
    for (int i = 0; i < MAX_ORPHANS; i++) {
        if (g_orphans[i] < 0) { g_orphans[i] = fd; return; }
    }
    close(fd);                         /* 表满：关闭，后台进程写入将得到 EPIPE */
}

static void drain_outputs(void) {
    for (int i = 0; i < MAX_INFLIGHT; i++) {
        if (g_inflight[i].pid > 0) drain_output(i);
    }
    for (int i = 0; i < MAX_ORPHANS; i++) {
        if (g_orphans[i] >= 0 && drain_fd(g_orphans[i], NULL)) g_orphans[i] = -1;
    }
}

static int remember_inflight(pid_t pid, const char *seq, const char *action) {
    for (int i = 0; i < MAX_INFLIGHT; i++) {
        if (g_inflight[i].pid == 0) {
            g_inflight[i].out_fd = -1;
            g_outbuf[i].len = 0;
            g_outbuf[i].truncated = 0;
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

/* 子进程执行命令前设置标准 fd：stdin 指向 /dev/null；stdout/stderr 指向输出管道，
   没有管道时指向 /dev/null。
   input/am/cmd/settings 等命令会通过 binder 把自身的标准 fd 交给 system_server；
   继承到的 fd 若是 /data/adb 下的日志文件，SELinux 拒绝传递，命令报
   “Failed transaction”并以退出码 2 失败。/dev/null 与 su 域的管道对所有域可用
   （KernelSU WebUI 的 ksu.exec 同样依赖管道）。 */
/* 把 fd 移到 3 以上并保留 CLOEXEC：若守护进程启动时 0–2 被关闭，pipe2 可能返回 0–2，
   直接 dup2 会互相覆盖或丢失。 */
static int move_above_stdio(int fd) {
    if (fd < 0 || fd > 2) return fd;
    int moved = fcntl(fd, F_DUPFD_CLOEXEC, 3);
    close(fd);
    return moved;
}

static int setup_child_stdio(int out_fd) {
    int fd = open(SIDEKEY_NULL_DEVICE, O_RDWR | O_CLOEXEC);
    if (fd < 0) return -1;
    int rc = 0;
    int out = out_fd >= 0 ? out_fd : fd;
    if (dup2(fd, 0) < 0) rc = -1;              /* dup2 结果不带 CLOEXEC */
    if (dup2(out, 1) < 0) rc = -1;
    if (dup2(out, 2) < 0) rc = -1;
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
    /* 输出管道：创建失败时退回 /dev/null，命令照常执行，只是不记录输出。 */
    int fds[2] = {-1, -1};
    if (g_cfg.capture_output) {
        if (pipe2(fds, O_CLOEXEC) != 0) { fds[0] = -1; fds[1] = -1; }
        fds[0] = move_above_stdio(fds[0]);
        fds[1] = move_above_stdio(fds[1]);
        if (fds[0] < 0 || fds[1] < 0) {
            if (fds[0] >= 0) close(fds[0]);
            if (fds[1] >= 0) close(fds[1]);
            fds[0] = fds[1] = -1;
        }
    }
    pid_t pid = fork();
    if (pid == 0) {
        sigprocmask(SIG_SETMASK, &g_child_mask, NULL);
        if (setup_child_stdio(fds[1]) != 0) _exit(126);
        execl(SHELL, "sh", "-c", cmd, (char *)NULL);
        _exit(127);
    }
    if (fds[1] >= 0) close(fds[1]);
    if (pid < 0) {
        if (fds[0] >= 0) close(fds[0]);
        log_seq(s, cmd, -2);    /* fork 失败：记 result=-2 */
        clear_inflight(slot);
    } else {
        g_inflight[slot].pid = pid;
        g_inflight[slot].start_ms = mono_ms();
        if (fds[0] >= 0) {
            int fl = fcntl(fds[0], F_GETFL);
            if (fl >= 0 && fcntl(fds[0], F_SETFL, fl | O_NONBLOCK) == 0) { g_inflight[slot].out_fd = fds[0]; g_inflight[slot].captured = 1; }
            else close(fds[0]);
        }
    }
    free(s);
}

static void write_output_record(int i, int code) {
    char ts[32];
    now_ts(ts, sizeof(ts));
    long long duration = mono_ms() - g_inflight[i].start_ms;
    char *rec = sidekey_output_format_record(ts, wall_ms(), g_inflight[i].seq, g_inflight[i].action,
                                             code, duration < 0 ? 0 : duration,
                                             g_outbuf[i].truncated, g_outbuf[i].data, g_outbuf[i].len);
    if (!rec) { log_msg("WARN", "unable to allocate command output record"); return; }
    if (strlen(rec) > (size_t)OUTPUT_LOG_LIMIT / 2) {  /* 最坏约 50 KiB（命令与输出全为控制字符转义），防御性检查 */
        free(rec);
        return;
    }
    sidekey_log_append(g_output_path, rec, OUTPUT_LOG_LIMIT);
    free(rec);
}

/* 流体云提示：常驻的 root 发布进程（app_process 运行伴生 APK 中的 Poster --serve）。
   守护进程只向它的标准输入写一行请求；ART 虚拟机只在启用提示时冷启动一次，
   之后每条提示几毫秒内送达，不再与刚执行的命令争抢 CPU。
   发布进程不进入 inflight 表，不写解释日志与 output.jsonl；它退出时由 reap_children 回收，下次提示再拉起。 */
static pid_t g_island_pid = 0;
static int g_island_fd = -1;          /* 发布进程标准输入的写端（非阻塞、CLOEXEC） */
static char g_island_log[PATH_MAX_LOCAL + 16];

/* app_process 依赖 init 导出的 BOOTCLASSPATH 等变量；守护进程的环境若缺少，就从 zygote 的初始环境补齐。 */
static const char *const ISLAND_ENV_KEYS[] = {
    "BOOTCLASSPATH", "DEX2OATBOOTCLASSPATH", "SYSTEMSERVERCLASSPATH", "STANDALONE_SYSTEMSERVER_JARS",
    "ANDROID_ROOT", "ANDROID_DATA", "ANDROID_ART_ROOT", "ANDROID_I18N_ROOT", "ANDROID_TZDATA_ROOT",
    "ANDROID_STORAGE", "ANDROID_ASSETS", NULL
};

static size_t read_small_file(const char *path, char *buf, size_t cap) {
    int fd = open(path, O_RDONLY | O_CLOEXEC);
    if (fd < 0) return 0;
    size_t got = 0;
    while (got < cap) {
        ssize_t n = read(fd, buf + got, cap - got);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) break;
        got += (size_t)n;
    }
    close(fd);
    return got;
}

/* 仅在发布进程的子进程里调用（fork 后、exec 前，守护进程单线程，可安全分配内存）。 */
static void island_fill_env(void) {
    int missing = 0;
    for (int i = 0; ISLAND_ENV_KEYS[i]; i++) if (!getenv(ISLAND_ENV_KEYS[i])) missing = 1;
    if (!missing) return;
    static char env[256 * 1024];
    size_t len = 0;
    DIR *d = opendir("/proc");
    if (d) {
        struct dirent *e;
        while (len == 0 && (e = readdir(d)) != NULL) {
            if (e->d_name[0] < '1' || e->d_name[0] > '9') continue;
            char path[64], cmd[32];
            snprintf(path, sizeof(path), "/proc/%s/cmdline", e->d_name);
            size_t n = read_small_file(path, cmd, sizeof(cmd) - 1);
            cmd[n] = '\0';
            if (strcmp(cmd, "zygote64") != 0 && strcmp(cmd, "zygote") != 0) continue;
            snprintf(path, sizeof(path), "/proc/%s/environ", e->d_name);
            len = read_small_file(path, env, sizeof(env));
        }
        closedir(d);
    }
    for (int i = 0; ISLAND_ENV_KEYS[i]; i++) {
        if (getenv(ISLAND_ENV_KEYS[i])) continue;
        const char *v = sidekey_notify_env_find(env, len, ISLAND_ENV_KEYS[i]);
        if (v) setenv(ISLAND_ENV_KEYS[i], v, 0);
    }
    if (!getenv("ANDROID_ROOT")) setenv("ANDROID_ROOT", "/system", 0);
    if (!getenv("ANDROID_DATA")) setenv("ANDROID_DATA", "/data", 0);
    if (!getenv("ANDROID_ART_ROOT")) setenv("ANDROID_ART_ROOT", "/apex/com.android.art", 0);
    if (!getenv("ANDROID_I18N_ROOT")) setenv("ANDROID_I18N_ROOT", "/apex/com.android.i18n", 0);
    if (!getenv("ANDROID_TZDATA_ROOT")) setenv("ANDROID_TZDATA_ROOT", "/apex/com.android.tzdata", 0);
}

static void island_close(void) {
    if (g_island_fd >= 0) close(g_island_fd);   /* 发布进程读到 EOF 后自行退出 */
    g_island_fd = -1;
}

static int island_spawn(void) {
    static sidekey_notify_server_t sv;
    char apk[PATH_MAX_LOCAL + sizeof(SIDEKEY_NOTIFY_APK_REL)];
    snprintf(apk, sizeof(apk), "%s%s", g_moddir, SIDEKEY_NOTIFY_APK_REL);
    if (access(apk, R_OK) != 0) return -1;
    if (sidekey_notify_server_prepare(&sv, apk) != 0) return -1;
    int fds[2];
    if (pipe2(fds, O_CLOEXEC) != 0) return -1;
    fds[0] = move_above_stdio(fds[0]);
    fds[1] = move_above_stdio(fds[1]);
    if (fds[0] < 0 || fds[1] < 0) {
        if (fds[0] >= 0) close(fds[0]);
        if (fds[1] >= 0) close(fds[1]);
        return -1;
    }
    snprintf(g_island_log, sizeof(g_island_log), "%s/island.log", g_moddir);
    pid_t pid = fork();
    if (pid == 0) {
        sigprocmask(SIG_SETMASK, &g_child_mask, NULL);
        /* 标准输入是请求管道；输出写 island.log（每次拉起时截断），供诊断查看发布结果。 */
        int logfd = open(g_island_log, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
        if (logfd < 0) logfd = open(SIDEKEY_NULL_DEVICE, O_WRONLY | O_CLOEXEC);
        if (logfd < 0 || dup2(fds[0], 0) < 0 || dup2(logfd, 1) < 0 || dup2(logfd, 2) < 0) _exit(126);
        island_fill_env();
        /* 内存紧张时优先回收发布进程（下一次提示会重新拉起），不挤占前台应用。 */
        int adj = open("/proc/self/oom_score_adj", O_WRONLY | O_CLOEXEC);
        if (adj >= 0) { (void)!write(adj, "800", 3); close(adj); }
        execv(g_notify_bin, sv.argv);
        _exit(127);
    }
    close(fds[0]);
    if (pid < 0) { close(fds[1]); return -1; }
    int fl = fcntl(fds[1], F_GETFL);
    if (fl >= 0) fcntl(fds[1], F_SETFL, fl | O_NONBLOCK);
    g_island_pid = pid;
    g_island_fd = fds[1];
    return 0;
}

/* 启用提示时预先拉起发布进程，第一次按键也不必等虚拟机冷启动；关闭时让它退出。 */
static void island_sync(void) {
    if (g_cfg.island_notify == SIDEKEY_NOTIFY_OFF) { island_close(); return; }
    if (g_island_fd < 0 && island_spawn() != 0)
        log_msg("WARN", "island poster not started: companion APK missing or fork failed");
}

static int island_write(const char *line, size_t len) {
    if (g_island_fd < 0) return -1;
    ssize_t n;
    do n = write(g_island_fd, line, len); while (n < 0 && errno == EINTR);
    return n == (ssize_t)len ? 0 : -1;
}

static void dispatch_notify(const char *seq, const char *action, int code, long long duration_ms) {
    char line[SIDEKEY_NOTIFY_LINE_MAX];
    int n = sidekey_notify_request_line(line, sizeof(line), seq, action, code, duration_ms, g_cfg.island_seconds);
    if (n <= 0) return;
    if (g_island_fd < 0) island_spawn();
    if (island_write(line, (size_t)n) == 0) return;
    /* 发布进程已退出（EPIPE）或卡住：换一个新进程重发一次 */
    island_close();
    if (island_spawn() == 0 && island_write(line, (size_t)n) == 0) return;
    log_msg("WARN", "island notification not sent: poster unavailable");
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
            if (p == g_island_pid) {
                g_island_pid = 0;
                island_close();
                if (code != 0) {
                    char msg[96];
                    snprintf(msg, sizeof(msg), "island poster exited (%d); see island.log", code);
                    log_msg("WARN", msg);
                }
                continue;
            }
            for (int i = 0; i < MAX_INFLIGHT; i++) {
                if (g_inflight[i].pid == p) {
                    drain_output(i);   /* 读走已写入管道的剩余输出 */
                    log_seq(g_inflight[i].seq, g_inflight[i].action, code);
                    if (g_inflight[i].captured) write_output_record(i, code);
                    if (sidekey_notify_wanted(g_cfg.island_notify, code)) {
                        long long duration = mono_ms() - g_inflight[i].start_ms;
                        dispatch_notify(g_inflight[i].seq, g_inflight[i].action, code, duration);
                    }
                    if (g_inflight[i].out_fd >= 0) {   /* 后台进程仍持有写端：转为孤儿继续丢弃读取 */
                        adopt_orphan(g_inflight[i].out_fd);
                        g_inflight[i].out_fd = -1;
                    }
                    clear_inflight(i);
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

/* Block only around the final flag check and atomically unblock inside ppoll.
   同时等待输入设备与所有命令输出管道；管道可读时返回，由主循环读取。 */
static int wait_for_input(int timeout_ms) {
    sigset_t blocked, previous;
    sigemptyset(&blocked);
    sigaddset(&blocked, SIGHUP); sigaddset(&blocked, SIGTERM);
    sigaddset(&blocked, SIGINT); sigaddset(&blocked, SIGCHLD);
    if (sigprocmask(SIG_BLOCK, &blocked, &previous) != 0) return -1;
    struct pollfd pfd[1 + MAX_INFLIGHT + MAX_ORPHANS];
    nfds_t n = 0;
    pfd[n++] = (struct pollfd){.fd = g_dev_fd, .events = POLLIN};
    for (int i = 0; i < MAX_INFLIGHT; i++) {
        if (g_inflight[i].pid > 0 && g_inflight[i].out_fd >= 0)
            pfd[n++] = (struct pollfd){.fd = g_inflight[i].out_fd, .events = POLLIN};
    }
    for (int i = 0; i < MAX_ORPHANS; i++) {
        if (g_orphans[i] >= 0) pfd[n++] = (struct pollfd){.fd = g_orphans[i], .events = POLLIN};
    }
    struct timespec timeout = {timeout_ms / 1000, (timeout_ms % 1000) * 1000000L};
    int rc = 0;
    if (!g_stop && !g_reload && !g_child_done)
        rc = ppoll(pfd, n, timeout_ms < 0 ? NULL : &timeout, &previous);
    int error = errno;
    if (sigprocmask(SIG_SETMASK, &previous, NULL) != 0) return -1;
    if (rc < 0 && error != EINTR) { errno = error; return -1; }
    if (pfd[0].revents & (POLLERR | POLLHUP | POLLNVAL)) { errno = ENODEV; return -1; }
    return 0;
}

static int setup_paths(const char *moddir) {
    int n1 = snprintf(g_moddir, sizeof(g_moddir), "%s", moddir);
    int n2 = snprintf(g_log_path, sizeof(g_log_path), "%s/log.txt", moddir);
    int n3 = snprintf(g_events_path, sizeof(g_events_path), "%s/events.jsonl", moddir);
    int n4 = snprintf(g_pid_path, sizeof(g_pid_path), "%s/daemon.pid", moddir);
    int n5 = snprintf(g_conf_path, sizeof(g_conf_path), "%s/config.conf", moddir);
    int n6 = snprintf(g_lock_path, sizeof(g_lock_path), "%s/daemon.lock", moddir);
    int n7 = snprintf(g_output_path, sizeof(g_output_path), "%s/output.jsonl", moddir);
    if (n1 < 0 || n2 < 0 || n3 < 0 || n4 < 0 || n5 < 0 || n6 < 0 || n7 < 0) return -1;
    if ((size_t)n7 >= sizeof(g_output_path)) return -1;
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
    island_close();
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
    init_inflight();
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
    island_sync();

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
                island_sync();
            } else {
                log_msg("ERROR", "config reload failed; keeping previous config");
            }
        }
        if (g_child_done) reap_children();
        drain_outputs();

        int timeout;
        int rc = sidekey_input_drain(&input, &g_fsm, g_cfg.keycode, &input_io, &timeout);
        if (rc == -EINTR) continue;
        if (rc < 0) fail_exit("read device failed");
        if (g_stop || g_reload || g_child_done) continue;

        if (wait_for_input(timeout) != 0) fail_exit("input wait failed or device disconnected");
        /* A timeout or readable fd both return to drain before current-time tick. */
    }
}
