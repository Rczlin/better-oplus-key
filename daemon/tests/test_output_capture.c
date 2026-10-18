/* 端到端：on_sequence 派发真实 /bin/sh 命令，主循环读取管道并在回收时写 output.jsonl。 */
#define _GNU_SOURCE
#define SIDEKEY_SHELL "/bin/sh"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#define main daemon_test_main
#include "../src/main.c"
#undef main

static int failures;
#define CHECK(c) do { if (!(c)) { fprintf(stderr, "FAIL %d: %s\n", __LINE__, #c); failures++; } } while (0)

static char *slurp(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    static char buf[65536];
    size_t n = fread(buf, 1, sizeof(buf) - 1, f);
    fclose(f);
    buf[n] = 0;
    return buf;
}

static void run_until_reaped(void) {
    for (int spins = 0; spins < 500; spins++) {
        int busy = 0;
        for (int i = 0; i < MAX_INFLIGHT; i++) if (g_inflight[i].pid > 0) busy = 1;
        if (!busy) return;
        drain_outputs();
        g_child_done = 1;
        reap_children();
        usleep(10000);
    }
}

int main(void) {
    char dir[] = "/tmp/sidekey-output-XXXXXX";
    CHECK(mkdtemp(dir) != NULL);
    CHECK(setup_paths(dir) == 0);
    init_inflight();
    sigprocmask(SIG_SETMASK, NULL, &g_child_mask);
    FILE *f = fopen(g_conf_path, "wb");
    /* 0：stdout+stderr+非零退出码；00：输出远超容量（验证不阻塞且截断）；1：无输出 */
    fputs("0=echo hello; echo oops >&2; exit 3\n"
          "00=i=0; while [ $i -lt 6000 ]; do echo 0123456789abcdef; i=$((i+1)); done\n"
          "1=true\n"
          "01=(sleep 0.3; echo late; echo $? > \"$BGDIR/bg\") & echo now\n", f);
    fclose(f);
    CHECK(load_config() == 0);

    on_sequence("0", 1, NULL);
    run_until_reaped();
    char *out = slurp(g_output_path);
    CHECK(out && strstr(out, "\"seq\":\"0\""));
    CHECK(out && strstr(out, "\"code\":3"));
    CHECK(out && strstr(out, "\"output\":\"hello\\noops\\n\""));
    CHECK(out && strstr(out, "\"truncated\":false"));
    char *log = slurp(g_log_path);
    CHECK(log && strstr(log, "seq=0 action=echo hello; echo oops >&2; exit 3 result=3"));

    unlink(g_output_path);
    on_sequence("00", 2, NULL);
    run_until_reaped();
    out = slurp(g_output_path);
    CHECK(out && strstr(out, "\"seq\":\"00\"") && strstr(out, "\"code\":0") && strstr(out, "\"truncated\":true"));
    CHECK(out && strlen(out) < SIDEKEY_OUTPUT_CAP + 1024);

    unlink(g_output_path);
    on_sequence("1", 1, NULL);
    run_until_reaped();
    out = slurp(g_output_path);
    CHECK(out && strstr(out, "\"seq\":\"1\"") && strstr(out, "\"output\":\"\"}"));

    /* 后台进程：主 shell 退出后读端转为孤儿继续读取，后台写入不会 EPIPE 失败 */
    unlink(g_output_path);
    setenv("BGDIR", dir, 1);
    on_sequence("01", 2, NULL);
    run_until_reaped();
    out = slurp(g_output_path);
    CHECK(out && strstr(out, "\"seq\":\"01\"") && strstr(out, "\"output\":\"now\\n\""));
    int orphans = 0;
    for (int i = 0; i < MAX_ORPHANS; i++) if (g_orphans[i] >= 0) orphans++;
    CHECK(orphans == 1);
    char bgpath[128]; snprintf(bgpath, sizeof(bgpath), "%s/bg", dir);
    for (int spins = 0; spins < 200 && access(bgpath, F_OK) != 0; spins++) { drain_outputs(); usleep(10000); }
    for (int spins = 0; spins < 50 && orphans; spins++) { drain_outputs(); orphans = 0; for (int i = 0; i < MAX_ORPHANS; i++) if (g_orphans[i] >= 0) orphans++; usleep(10000); }
    char *bg = slurp(bgpath);
    CHECK(bg && strcmp(bg, "0\n") == 0);
    CHECK(orphans == 0);
    unlink(bgpath);

    /* capture_output=0：不收集、不写 output.jsonl，命令照常执行 */
    unlink(g_output_path);
    f = fopen(g_conf_path, "wb");
    fputs("capture_output=0\n0=echo hidden\n", f);
    fclose(f);
    CHECK(load_config() == 0 && g_cfg.capture_output == 0);
    on_sequence("0", 1, NULL);
    run_until_reaped();
    CHECK(access(g_output_path, F_OK) != 0);
    log = slurp(g_log_path);
    CHECK(log && strstr(log, "seq=0 action=echo hidden result=0"));

    for (int i = 0; i < MAX_INFLIGHT; i++) CHECK(g_inflight[i].pid == 0 && g_inflight[i].out_fd == -1);
    sidekey_config_destroy(&g_cfg);
    sidekey_fsm_destroy(&g_fsm);
    unlink(g_output_path); unlink(g_conf_path); unlink(g_log_path); rmdir(dir);
    if (failures) return 1;
    puts("output capture ok");
    return 0;
}
