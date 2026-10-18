#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sidekey_config.h"

static int failures;
#define CHECK(c) do { if (!(c)) { fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); failures++; } } while (0)

static void test_defaults_and_values(void) {
    sidekey_config_t c; sidekey_config_init(&c);
    CHECK(sidekey_config_parse("keycode=735\nlong_press_ms=300\nwindow_ms=300\n0=echo single\n00=echo double\n", &c) == 0);
    CHECK(c.keycode == 735 && c.fsm.long_press_ms == 300 && c.n_bindings == 2);
    CHECK(strcmp(sidekey_config_lookup(&c, "0"), "echo single") == 0);
    CHECK(strcmp(sidekey_config_lookup(&c, "00"), "echo double") == 0);
    CHECK(c.max_seq_len == 2 && c.skipped_lines == 0);
    sidekey_config_destroy(&c);
}

static void test_long_and_duplicate_bindings(void) {
    sidekey_config_t c; sidekey_config_init(&c);
    CHECK(sidekey_config_parse("0000=echo four\n01001=echo mixed\n", &c) == 0);
    CHECK(strcmp(sidekey_config_lookup(&c, "0000"), "echo four") == 0);
    CHECK(strcmp(sidekey_config_lookup(&c, "01001"), "echo mixed") == 0);
    CHECK(sidekey_config_has_longer(&c, "0", 1));
    CHECK(!sidekey_config_has_longer(&c, "01001", 5));
    CHECK(sidekey_config_parse("0=first\n0=second\n", &c) == 0);
    CHECK(c.n_bindings == 1 && strcmp(sidekey_config_lookup(&c, "0"), "second") == 0);
    CHECK(sidekey_config_parse("0=first\n0=\n", &c) == 0);
    CHECK(c.n_bindings == 0 && sidekey_config_lookup(&c, "0") == NULL);
    sidekey_config_destroy(&c);
}

static void test_more_than_fourteen(void) {
    char text[4096] = "";
    for (int i = 1; i <= 20; i++) {
        char seq[32]; for (int j = 0; j < i; j++) seq[j] = (char)('0' + (j & 1)); seq[i] = 0;
        strcat(text, seq); strcat(text, "=echo x\n");
    }
    sidekey_config_t c; sidekey_config_init(&c);
    CHECK(sidekey_config_parse(text, &c) == 0);
    CHECK(c.n_bindings == 20 && c.max_seq_len == 20);
    CHECK(strcmp(sidekey_config_lookup(&c, "01010101010101010101"), "echo x") == 0);
    sidekey_config_destroy(&c);
}

static void test_strict_integers(void) {
    const char *bad[] = {"long_press_ms=0\n", "window_ms=-1\n", "long_press_ms=801\n",
        "keycode=768\n", "keycode=4294967596\n", "keycode=735x\n"};
    for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); i++) {
        sidekey_config_t c; sidekey_config_init(&c);
        CHECK(sidekey_config_parse("0=echo old\n", &c) == 0);
        CHECK(sidekey_config_parse(bad[i], &c) == -1);
        CHECK(strcmp(sidekey_config_lookup(&c, "0"), "echo old") == 0);
        sidekey_config_destroy(&c);
    }
    sidekey_config_t c; sidekey_config_init(&c);
    CHECK(sidekey_config_parse("keycode=1\nlong_press_ms=100\nwindow_ms=800\n", &c) == 0);
    CHECK(c.keycode == 1 && c.fsm.long_press_ms == 100 && c.fsm.window_ms == 800);
    sidekey_config_destroy(&c);
}

static void test_capture_output_key(void) {
    sidekey_config_t c; sidekey_config_init(&c);
    CHECK(c.capture_output == 1);
    CHECK(sidekey_config_parse("capture_output=0\n", &c) == 0 && c.capture_output == 0);
    CHECK(sidekey_config_parse("0=x\n", &c) == 0 && c.capture_output == 1);
    CHECK(sidekey_config_parse("capture_output=2\n", &c) == -1);
    sidekey_config_destroy(&c);
}

static void test_island_notify_key(void) {
    sidekey_config_t c; sidekey_config_init(&c);
    CHECK(c.island_notify == 0);
    CHECK(sidekey_config_parse("island_notify=1\n", &c) == 0 && c.island_notify == 1);
    CHECK(sidekey_config_parse("island_notify=2\n", &c) == 0 && c.island_notify == 2);
    CHECK(sidekey_config_parse("0=x\n", &c) == 0 && c.island_notify == 0);
    CHECK(sidekey_config_parse("island_notify=3\n", &c) == -1);
    CHECK(sidekey_config_parse("island_notify=\n", &c) == -1);
    CHECK(c.island_notify == 0 && c.skipped_lines == 0);
    CHECK(c.island_seconds == 5);
    CHECK(sidekey_config_parse("island_seconds=8\n", &c) == 0 && c.island_seconds == 8);
    CHECK(sidekey_config_parse("island_seconds=2\n", &c) == 0 && c.island_seconds == 2);
    CHECK(sidekey_config_parse("island_seconds=15\n", &c) == 0 && c.island_seconds == 15);
    CHECK(sidekey_config_parse("0=x\n", &c) == 0 && c.island_seconds == 5);
    CHECK(sidekey_config_parse("island_seconds=1\n", &c) == -1);
    CHECK(sidekey_config_parse("island_seconds=16\n", &c) == -1);
    sidekey_config_destroy(&c);
}

static void test_command_and_config_limits(void) {
    static char text[SIDEKEY_CMD_MAX + 1], line[SIDEKEY_CMD_MAX + 8];
    sidekey_config_t c; sidekey_config_init(&c);
    CHECK(SIDEKEY_CMD_MAX == 4096);
    memset(text, 'x', 4095); text[4095] = 0;
    snprintf(line, sizeof(line), "0=%s\n", text);
    CHECK(sidekey_config_parse(line, &c) == 0);
    CHECK(strlen(sidekey_config_lookup(&c, "0")) == 4095);
    text[4095] = 'x'; text[4096] = 0; snprintf(line, sizeof(line), "0=%s\n", text);
    CHECK(sidekey_config_parse(line, &c) == SIDEKEY_CONFIG_ERR_TOO_LONG);
    CHECK(strlen(sidekey_config_lookup(&c, "0")) == 4095);
    /* 短命令更新长命令：内存按实际长度重新分配 */
    CHECK(sidekey_config_parse("0=short\n0=input keyevent 3\n", &c) == 0);
    CHECK(strcmp(sidekey_config_lookup(&c, "0"), "input keyevent 3") == 0);
    sidekey_config_destroy(&c);
}

static void test_raw_command_and_size_boundaries(void) {
    sidekey_config_t c; sidekey_config_init(&c);
    CHECK(sidekey_config_parse("0=  echo '中=a'  \r\n", &c) == 0);
    CHECK(strcmp(sidekey_config_lookup(&c, "0"), "  echo '中=a'  ") == 0);
    CHECK(sidekey_config_parse("0=a\rb\n", &c) != 0);
    CHECK(strcmp(sidekey_config_lookup(&c, "0"), "  echo '中=a'  ") == 0);
    char *text = malloc(SIDEKEY_CONFIG_MAX_BYTES + 2);
    memset(text, '#', SIDEKEY_CONFIG_MAX_BYTES); text[SIDEKEY_CONFIG_MAX_BYTES] = 0;
    CHECK(sidekey_config_parse(text, &c) == 0);
    text[SIDEKEY_CONFIG_MAX_BYTES] = '#'; text[SIDEKEY_CONFIG_MAX_BYTES + 1] = 0;
    CHECK(sidekey_config_parse(text, &c) == SIDEKEY_CONFIG_ERR_TOO_LONG);
    free(text); sidekey_config_destroy(&c);
}

static void test_parse_failure_preserves_previous(void) {
    sidekey_config_t c; sidekey_config_init(&c);
    CHECK(sidekey_config_parse("keycode=735\n0=echo old\n", &c) == 0);
    CHECK(sidekey_config_parse("long_press_ms=bad\n", &c) == -1);
    CHECK(c.keycode == 735 && strcmp(sidekey_config_lookup(&c, "0"), "echo old") == 0);
    sidekey_config_destroy(&c);
}

int main(void) {
    test_defaults_and_values(); test_long_and_duplicate_bindings(); test_more_than_fourteen();
    test_strict_integers(); test_command_and_config_limits(); test_capture_output_key(); test_island_notify_key(); test_parse_failure_preserves_previous();
    test_raw_command_and_size_boundaries();
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    puts("test_config: all passed"); return 0;
}
