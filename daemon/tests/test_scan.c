#include <stdio.h>
#include <string.h>
#include "sidekey_scan.h"

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { \
    fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)

/* 假探测：只有 event0 声明 keycode 735 */
static int fake_probe(const char *path, int keycode, void *ctx) {
    (void)ctx;
    if (keycode != 735) return 0;
    return strstr(path, "event0") != NULL ? 1 : 0;
}

static void test_finds_only_matching_node(void) {
    char out[64] = {0};
    int matched = -1;
    const char *cands[] = {"/dev/input/event0", "/dev/input/event1", "/dev/input/event2"};
    int r = sidekey_scan_find_candidates(cands, 3, 735, fake_probe, NULL,
                                         out, sizeof(out), &matched);
    CHECK(r == 1);
    CHECK(strcmp(out, "/dev/input/event0") == 0);
    CHECK(matched == 1);
}

static void test_none_found(void) {
    char out[64] = {0};
    int matched = -1;
    const char *cands[] = {"/dev/input/event1"};
    int r = sidekey_scan_find_candidates(cands, 1, 735, fake_probe, NULL,
                                         out, sizeof(out), &matched);
    CHECK(r == 0);
    CHECK(matched == 0);
}

static int two_match_probe(const char *path, int keycode, void *ctx) {
    (void)keycode; (void)ctx;
    return (strstr(path, "event0") || strstr(path, "event1")) ? 1 : 0;
}

static void test_multiple_matches_picks_first_and_counts(void) {
    char out[64] = {0};
    int matched = -1;
    const char *cands[] = {"/dev/input/event0", "/dev/input/event1"};
    int r = sidekey_scan_find_candidates(cands, 2, 735, two_match_probe, NULL,
                                         out, sizeof(out), &matched);
    CHECK(r == 1);
    CHECK(strcmp(out, "/dev/input/event0") == 0);
    CHECK(matched == 2);
}

static void test_output_buffer_too_small_fails_safely(void) {
    char out[4] = {0};
    int matched = -1;
    const char *cands[] = {"/dev/input/event0"};
    int r = sidekey_scan_find_candidates(cands, 1, 735, fake_probe, NULL,
                                         out, sizeof(out), &matched);
    CHECK(r == -1);
}

int main(void) {
    test_finds_only_matching_node();
    test_none_found();
    test_multiple_matches_picks_first_and_counts();
    test_output_buffer_too_small_fails_safely();
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    printf("test_scan: all passed\n");
    return 0;
}
