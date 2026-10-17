#include <stdio.h>
#include <string.h>
#include "sidekey_config.h"
#include "sidekey_runtime.h"

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { \
    fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)

static void test_lookup_bound_sequence(void) {
    sidekey_config_t c;
    sidekey_config_init(&c);
    CHECK(sidekey_config_parse("0=echo single\n00=echo double\n", &c) == 0);
    const char *cmd = sidekey_runtime_lookup(&c, "00");
    CHECK(cmd != NULL);
    CHECK(strcmp(cmd, "echo double") == 0);
    sidekey_config_destroy(&c);
}

static void test_lookup_unbound_returns_null(void) {
    sidekey_config_t c;
    sidekey_config_init(&c);
    CHECK(sidekey_config_parse("0=echo single\n", &c) == 0);
    CHECK(sidekey_runtime_lookup(&c, "111") == NULL);
    sidekey_config_destroy(&c);
}

static void test_event_line_format(void) {
    char out[256];
    sidekey_runtime_event_line(out, sizeof(out), 1700000000123LL, 4567LL, "down", 735);
    CHECK(strcmp(out,
        "{\"wall_ms\":1700000000123,\"mono_ms\":4567,\"edge\":\"down\",\"code\":735}\n") == 0);
}

int main(void) {
    test_lookup_bound_sequence();
    test_lookup_unbound_returns_null();
    test_event_line_format();
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    printf("test_runtime: all passed\n");
    return 0;
}
