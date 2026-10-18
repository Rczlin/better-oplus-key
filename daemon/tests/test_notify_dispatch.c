/* 端到端：命令被回收后按 island_notify 派发流体云提示；通知程序替换为记录参数的脚本。 */
#define _GNU_SOURCE
#define SIDEKEY_SHELL "/bin/sh"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#define main daemon_test_main
#include "../src/main.c"
#undef main

static int failures;
#define CHECK(c) do { if (!(c)) { fprintf(stderr, "FAIL %d: %s\n", __LINE__, #c); failures++; } } while (0)

static char g_calls_path[256];

static char *slurp(const char *path) {
    static char buf[65536];
    FILE *f = fopen(path, "rb");
    if (!f) { buf[0] = 0; return buf; }
    size_t n = fread(buf, 1, sizeof(buf) - 1, f);
    fclose(f);
    buf[n] = 0;
    return buf;
}

static int count(const char *hay, const char *needle) {
    int n = 0;
    for (const char *p = hay; (p = strstr(p, needle)) != NULL; p += strlen(needle)) n++;
    return n;
}

static int calls(void) { return count(slurp(g_calls_path), "---\n"); }

/* 回收命令子进程与通知子进程，直到没有在飞命令且通知调用数达到 expect（或超时）。 */
static void settle(int expect) {
    for (int spins = 0; spins < 300; spins++) {
        int busy = 0;
        for (int i = 0; i < MAX_INFLIGHT; i++) if (g_inflight[i].pid > 0) busy = 1;
        drain_outputs();
        g_child_done = 1;
        reap_children();
        if (!busy && calls() >= expect && spins > 5) return;
        usleep(10000);
    }
}

static void write_config(const char *text) {
    FILE *f = fopen(g_conf_path, "wb");
    fputs(text, f);
    fclose(f);
    CHECK(load_config() == 0);
}

int main(void) {
    char dir[] = "/tmp/sidekey-notify-XXXXXX";
    CHECK(mkdtemp(dir) != NULL);
    CHECK(setup_paths(dir) == 0);
    init_inflight();
    sigprocmask(SIG_SETMASK, NULL, &g_child_mask);

    char script[256];
    snprintf(script, sizeof(script), "%s/fake-cmd", dir);
    snprintf(g_calls_path, sizeof(g_calls_path), "%s/calls", dir);
    FILE *f = fopen(script, "wb");
    fprintf(f, "#!/bin/sh\nprintf '%%s\\n' \"$0\" \"$@\" >> '%s'\necho --- >> '%s'\n", g_calls_path, g_calls_path);
    fclose(f);
    chmod(script, 0755);
    g_notify_bin = script;

    /* 模式 1：成功与失败都提示；未绑定按法不提示 */
    write_config("island_notify=1\n0=true\n00=exit 5\n");
    on_sequence("0", 1, NULL);
    settle(1);
    CHECK(calls() == 1);
    char *c = slurp(g_calls_path);
    char cp[400];
    snprintf(cp, sizeof(cp), "-Djava.class.path=%s/companion/island.apk\n/system/bin\n", dir);
    CHECK(strstr(c, cp) != NULL);
    CHECK(strstr(c, "io.github.rczlin.sidekey.island.Poster\n") != NULL);
    CHECK(strstr(c, "--seq\n0\n--label\ntrue\n--code\n0\n--duration\n") != NULL);
    CHECK(strstr(c, "--show\n5\n") != NULL);

    on_sequence("00", 2, NULL);
    settle(2);
    CHECK(calls() == 2);
    CHECK(strstr(slurp(g_calls_path), "--seq\n00\n--label\nexit 5\n--code\n5\n") != NULL);

    on_sequence("1", 1, NULL);   /* 无绑定：dropped */
    settle(2);
    CHECK(calls() == 2);

    /* 通知子进程不产生解释日志行、不写 output.jsonl 记录 */
    char *log = slurp(g_log_path);
    CHECK(count(log, " seq=") == 3);
    CHECK(count(log, "WARN") == 0);
    CHECK(count(slurp(g_output_path), "\"seq\":") == 2);

    /* 模式 2：仅失败 */
    unlink(g_calls_path);
    write_config("island_notify=2\nisland_seconds=12\n0=true\n00=exit 7\n");
    on_sequence("0", 1, NULL);
    settle(0);
    CHECK(calls() == 0);
    on_sequence("00", 2, NULL);
    settle(1);
    CHECK(calls() == 1 && strstr(slurp(g_calls_path), "--code\n7\n") != NULL);
    CHECK(strstr(slurp(g_calls_path), "--show\n12\n") != NULL);

    /* 模式 0（缺省）：不提示 */
    unlink(g_calls_path);
    write_config("00=exit 7\n");
    CHECK(g_cfg.island_notify == 0);
    on_sequence("00", 2, NULL);
    settle(0);
    CHECK(calls() == 0);

    /* 通知程序不存在：命令照常记录，守护进程不受影响 */
    char missing[300];
    snprintf(missing, sizeof(missing), "%s/no-such-cmd", dir);
    g_notify_bin = missing;
    write_config("island_notify=1\n0=true\n");
    on_sequence("0", 1, NULL);
    settle(0);
    CHECK(count(slurp(g_log_path), " seq=0 action=true result=0") == 3);

    for (int i = 0; i < MAX_INFLIGHT; i++) CHECK(g_inflight[i].pid == 0);
    sidekey_config_destroy(&g_cfg);
    sidekey_fsm_destroy(&g_fsm);
    char rm[300];
    snprintf(rm, sizeof(rm), "rm -rf '%s'", dir);
    if (system(rm) != 0) fprintf(stderr, "cleanup failed\n");
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    puts("notify dispatch ok");
    return 0;
}
