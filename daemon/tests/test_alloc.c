#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sidekey_config.h"

static int allocations, fail_at = -1;
static void *test_malloc(size_t n) { return allocations++ == fail_at ? NULL : malloc(n); }
static void *test_calloc(size_t n, size_t size) { return allocations++ == fail_at ? NULL : calloc(n, size); }
#define malloc test_malloc
#define calloc test_calloc
#include "../src/sidekey_config.c"
#include "../src/sidekey_fsm.c"
#undef malloc
#undef calloc

static int failures;
#define CHECK(c) do { if (!(c)) { fprintf(stderr,"FAIL %d: %s\n",__LINE__,#c); failures++; } } while (0)
static void noop(const char *s, int len, void *ctx) { (void)s; (void)len; (void)ctx; }
int main(void) {
    sidekey_config_t c; sidekey_config_init(&c);
    CHECK(sidekey_config_parse("0=old\n", &c) == 0);
    for (int i = 0; i < 7; i++) {
        allocations = 0; fail_at = i;
        int rc = sidekey_config_parse("0000=four\n01001=mixed\n", &c);
        CHECK(rc == SIDEKEY_CONFIG_ERR_NOMEM);
        const char *cmd = sidekey_config_lookup(&c, "0");
        CHECK(cmd && !strcmp(cmd, "old") && c.n_bindings == 1);
    }
    fail_at = -1;
    CHECK(sidekey_config_parse("0000=four\n01001=mixed\n", &c) == 0);
    sidekey_config_destroy(&c);
    sidekey_fsm_t f = {0}; sidekey_fsm_cfg_t cfg = {300, 300};
    allocations = 0; fail_at = 0;
    CHECK(sidekey_fsm_init_with_match(&f, &cfg, 1, NULL, noop, NULL) == -1);
    sidekey_fsm_destroy(&f);
    return failures ? 1 : 0;
}
