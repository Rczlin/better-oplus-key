#include <stdio.h>
#include <string.h>
#include "sidekey_config.h"

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { \
    fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)

static void test_defaults_and_bindings(void) {
    const char *txt =
        "keycode=735\n"
        "long_press_ms=300\n"
        "window_ms=300\n"
        "0=echo single\n"
        "00=echo double\n"
        "000=echo triple\n";
    sidekey_config_t c;
    CHECK(sidekey_config_parse(txt, &c) == 0);
    CHECK(c.keycode == 735);
    CHECK(c.fsm.long_press_ms == 300);
    CHECK(c.n_bindings == 3);
    CHECK(strcmp(c.bindings[0].seq, "0") == 0);
    CHECK(strcmp(c.bindings[0].cmd, "echo single") == 0);
    CHECK(strcmp(c.bindings[2].seq, "000") == 0);
    CHECK(c.skipped_lines == 0);
}

static void test_value_containing_equals(void) {
    const char *txt = "keycode=735\n0=sh -c 'a=1; echo $a'\n";
    sidekey_config_t c;
    CHECK(sidekey_config_parse(txt, &c) == 0);
    CHECK(strcmp(c.bindings[0].cmd, "sh -c 'a=1; echo $a'") == 0);
}

static void test_invalid_sequence_skipped(void) {
    const char *txt = "keycode=735\n0000=echo too_long\n2=echo bad\n0=echo ok\n";
    sidekey_config_t c;
    CHECK(sidekey_config_parse(txt, &c) == 0);
    CHECK(c.n_bindings == 1);
    CHECK(strcmp(c.bindings[0].seq, "0") == 0);
    CHECK(c.skipped_lines == 2);
}

static void test_missing_keycode_uses_default(void) {
    const char *txt = "0=echo x\n";
    sidekey_config_t c;
    CHECK(sidekey_config_parse(txt, &c) == 0);
    CHECK(c.keycode == 735);
}

static void test_bad_keycode_is_fatal(void) {
    const char *txt = "keycode=notanumber\n";
    sidekey_config_t c;
    CHECK(sidekey_config_parse(txt, &c) == -1);
}

static void test_crlf_tolerant(void) {
    const char *txt = "keycode=735\r\n0=echo x\r\n";
    sidekey_config_t c;
    CHECK(sidekey_config_parse(txt, &c) == 0);
    CHECK(strcmp(c.bindings[0].cmd, "echo x") == 0);
}

int main(void) {
    test_defaults_and_bindings();
    test_value_containing_equals();
    test_invalid_sequence_skipped();
    test_missing_keycode_uses_default();
    test_bad_keycode_is_fatal();
    test_crlf_tolerant();
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    printf("test_config: all passed\n");
    return 0;
}
