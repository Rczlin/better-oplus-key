#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Exercise the production loader without starting the daemon or executing commands. */
#define main sidekey_daemon_main_for_test
#include "../src/main.c"
#undef main

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { \
    fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)

static void write_fixture(const char *text) {
    FILE *f = fopen(g_conf_path, "wb");
    if (!f) { perror("fixture fopen"); exit(1); }
    size_t len = strlen(text);
    CHECK(fwrite(text, 1, len, f) == len);
    CHECK(fclose(f) == 0);
}

static void read_log(char *out, size_t size) {
    FILE *f = fopen(g_log_path, "rb");
    if (!f) { out[0] = 0; return; }
    size_t len = fread(out, 1, size - 1, f);
    out[len] = 0;
    CHECK(fclose(f) == 0);
}

int main(void) {
    sidekey_config_init(&g_cfg);
    char dir[] = "/tmp/oplus-sidekey-loader-XXXXXX";
    if (!mkdtemp(dir)) { perror("mkdtemp"); return 1; }
    snprintf(g_conf_path, sizeof(g_conf_path), "%s/config.conf", dir);
    snprintf(g_log_path, sizeof(g_log_path), "%s/log.txt", dir);

    write_fixture("0=echo original\n");
    CHECK(load_config() == 0);
    sidekey_config_t before = g_cfg;

    char overlong[2 + SIDEKEY_CMD_MAX + 2];
    memcpy(overlong, "0=", 2);
    memset(overlong + 2, 'a', SIDEKEY_CMD_MAX);
    overlong[2 + SIDEKEY_CMD_MAX] = '\n';
    overlong[3 + SIDEKEY_CMD_MAX] = 0;
    write_fixture(overlong);
    CHECK(load_config() == SIDEKEY_CONFIG_ERR_TOO_LONG);
    CHECK(memcmp(&before, &g_cfg, sizeof(before)) == 0);
    char log[2048];
    read_log(log, sizeof(log));
    CHECK(strstr(log, "511 UTF-8 bytes") != NULL);
    CHECK(strstr(log, "rejected") != NULL);

    write_fixture("unknown_key=ignored\n0=echo replacement\n");
    CHECK(load_config() == 0);
    CHECK(g_cfg.skipped_lines == 1);
    read_log(log, sizeof(log));
    CHECK(strstr(log, "skipped 1 invalid or unknown") != NULL);
    CHECK(strcmp(sidekey_config_lookup(&g_cfg, "0"), "echo replacement") == 0);

    sidekey_fsm_key(&g_fsm, 1, 1000);
    write_fixture("keycode=736\n0000=echo changed\n");
    CHECK(load_config() != 0);
    CHECK(g_cfg.keycode == 735 && g_fsm.pressed == 1);
    CHECK(strcmp(sidekey_config_lookup(&g_cfg, "0"), "echo replacement") == 0);
    write_fixture("0000=echo four\n");
    CHECK(load_config() == 0);
    CHECK(g_fsm.pressed == 0 && g_fsm.max_seq_len == 4);
    CHECK(g_fsm.match("0000", 4, g_fsm.ctx) == SIDEKEY_MATCH_EXACT);

    CHECK(unlink(g_conf_path) == 0);
    CHECK(unlink(g_log_path) == 0);
    CHECK(rmdir(dir) == 0);
    sidekey_config_destroy(&g_cfg);
    sidekey_fsm_destroy(&g_fsm);
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    puts("test_daemon_config: all passed");
    return 0;
}
