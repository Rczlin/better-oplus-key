#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sidekey_config.h"
static int fail_at = -1, allocations, short_read, read_error;
static void *test_malloc(size_t n) { return allocations++ == fail_at ? NULL : malloc(n); }
static void *test_calloc(size_t n, size_t size) { return allocations++ == fail_at ? NULL : calloc(n, size); }
static size_t test_fread(void *ptr, size_t size, size_t count, FILE *f) {
    return fread(ptr, size, short_read && count ? count - 1 : count, f);
}
static int test_ferror(FILE *f) { return read_error || ferror(f); }
#define malloc test_malloc
#define calloc test_calloc
#define fread test_fread
#define ferror test_ferror
#include "../src/sidekey_config.c"
#include "../src/sidekey_fsm.c"
#define main daemon_test_main
#include "../src/main.c"
#undef main
#undef malloc
#undef calloc
#undef fread
#undef ferror
static int failures;
#define CHECK(c) do { if (!(c)) { fprintf(stderr,"FAIL %d: %s\n",__LINE__,#c); failures++; } } while (0)
static void fixture(const char *text, size_t len) {
    FILE *f = fopen(g_conf_path, "wb");
    if (!f) exit(2);
    CHECK(fwrite(text, 1, len, f) == len); CHECK(fclose(f) == 0);
}
int main(void) {
    char dir[] = "/tmp/sidekey-reload-XXXXXX";
    CHECK(mkdtemp(dir) != NULL); CHECK(setup_paths(dir) == 0);
    sidekey_config_init(&g_cfg);
    const char *initial = "0=old\n0000=four\n";
    fixture(initial, strlen(initial)); CHECK(load_config() == 0);
    CHECK(remember_inflight(123, "0000", "four") == 0);
    const char *changed = "0=new\n01001=mixed\n";
    fixture(changed, strlen(changed));
    allocations = 0; CHECK(load_config() == 0); int total = allocations;
    fixture(initial, strlen(initial)); CHECK(load_config() == 0);
    fixture(changed, strlen(changed));
    for (int i = 0; i < total; i++) {
        sidekey_fsm_key(&g_fsm, 1, 1000);
        char *buffer = g_fsm.seq; sidekey_binding_t *bindings = g_cfg.bindings;
        allocations = 0; fail_at = i;
        CHECK(load_config() != 0);
        fail_at = -1;
        CHECK(g_fsm.seq == buffer && g_fsm.pressed && g_cfg.bindings == bindings);
        CHECK(!strcmp(sidekey_config_lookup(&g_cfg, "0"), "old"));
    }
    short_read = 1; CHECK(load_config() != 0); short_read = 0;
    read_error = 1; CHECK(load_config() != 0); read_error = 0;
    CHECK(!strcmp(sidekey_config_lookup(&g_cfg, "0"), "old") && g_fsm.pressed);
    const char nul[] = "0=new\0bad\n"; fixture(nul, sizeof(nul) - 1);
    CHECK(load_config() != 0 && g_fsm.pressed);
    fixture(changed, strlen(changed)); CHECK(load_config() == 0);
    CHECK(!g_fsm.pressed && !strcmp(sidekey_config_lookup(&g_cfg, "0"), "new"));
    CHECK(!strcmp(g_inflight[0].seq, "0000") && !strcmp(g_inflight[0].action, "four"));
    free(g_inflight[0].seq); free(g_inflight[0].action);
    sidekey_config_destroy(&g_cfg); sidekey_fsm_destroy(&g_fsm);
    unlink(g_conf_path); unlink(g_log_path); rmdir(dir);
    return failures ? 1 : 0;
}
