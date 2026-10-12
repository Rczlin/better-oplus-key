#include <stdio.h>
#include <string.h>
#include "sidekey_args.h"

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { \
    fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)

static void test_missing_arg_is_error(void) {
    char dir[256];
    char *argv[] = {"oplus-sidekey", NULL};
    CHECK(sidekey_parse_args(1, argv, dir, sizeof(dir)) == -1);
}

static void test_moddir_returned(void) {
    char dir[256];
    char *argv[] = {"oplus-sidekey", "/data/adb/modules/oplus-sidekey", NULL};
    CHECK(sidekey_parse_args(2, argv, dir, sizeof(dir)) == 0);
    CHECK(strcmp(dir, "/data/adb/modules/oplus-sidekey") == 0);
}

static void test_overlong_path_rejected(void) {
    char dir[8];
    char *argv[] = {"oplus-sidekey", "/data/adb/modules/oplus-sidekey", NULL};
    CHECK(sidekey_parse_args(2, argv, dir, sizeof(dir)) == -1);
}

/* 边界：长度 == dir_len - 1 时可放下（含 NUL），长度 == dir_len 时放不下 */
static void test_exact_fit_boundary(void) {
    char dir[5];
    char *fit[] = {"x", "abcd", NULL};          /* 长度 4，dir_len 5：刚好放下 */
    CHECK(sidekey_parse_args(2, fit, dir, sizeof(dir)) == 0);
    CHECK(strcmp(dir, "abcd") == 0);

    char *nofit[] = {"x", "abcde", NULL};       /* 长度 5，dir_len 5：放不下 */
    CHECK(sidekey_parse_args(2, nofit, dir, sizeof(dir)) == -1);
}

int main(void) {
    test_missing_arg_is_error();
    test_moddir_returned();
    test_overlong_path_rejected();
    test_exact_fit_boundary();
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    printf("test_args: all passed\n");
    return 0;
}
