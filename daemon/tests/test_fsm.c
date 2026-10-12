#include <stdio.h>
#include <string.h>
#include <assert.h>
#include "sidekey_fsm.h"

typedef struct { char seqs[16][4]; int n; } rec_t;

static void rec_cb(const char *seq, int len, void *ctx) {
    rec_t *r = (rec_t *)ctx;
    assert(len >= 1 && len <= 3);
    memcpy(r->seqs[r->n], seq, len);
    r->seqs[r->n][len] = '\0';
    r->n++;
}

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { \
    fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)

static void test_single_short_tap(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f;
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 1000);
    sidekey_fsm_key(&f, 0, 1100);      /* 按住 100ms < 300 => 0 */
    sidekey_fsm_tick(&f, 1100 + 300);  /* 窗口到期 */
    CHECK(r.n == 1);
    CHECK(strcmp(r.seqs[0], "0") == 0);
}

static void test_single_long_press(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f;
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 1000);
    sidekey_fsm_key(&f, 0, 1400);      /* 按住 400ms >= 300 => 1 */
    sidekey_fsm_tick(&f, 1400 + 300);
    CHECK(r.n == 1);
    CHECK(strcmp(r.seqs[0], "1") == 0);
}

static void test_double_click(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f;
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 0);   sidekey_fsm_key(&f, 0, 50);
    sidekey_fsm_key(&f, 1, 200); sidekey_fsm_key(&f, 0, 250);   /* 第二次在窗口内 */
    sidekey_fsm_tick(&f, 250 + 300);
    CHECK(r.n == 1);
    CHECK(strcmp(r.seqs[0], "00") == 0);
}

static void test_triple_click_flushes_immediately(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f;
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 0);   sidekey_fsm_key(&f, 0, 50);
    sidekey_fsm_key(&f, 1, 100); sidekey_fsm_key(&f, 0, 150);
    sidekey_fsm_key(&f, 1, 200); sidekey_fsm_key(&f, 0, 250);   /* 第3次松开，立即结束 */
    CHECK(r.n == 1);                       /* 不需要 tick，已经结束 */
    CHECK(strcmp(r.seqs[0], "000") == 0);
}

static void test_window_boundary_not_yet(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f;
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 0); sidekey_fsm_key(&f, 0, 50);
    sidekey_fsm_tick(&f, 50 + 299);        /* 差 1ms，未到期 */
    CHECK(r.n == 0);
}

static void test_mixed_long_then_short(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f;
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 0);   sidekey_fsm_key(&f, 0, 400);  /* 长按 => 1 */
    sidekey_fsm_key(&f, 1, 500); sidekey_fsm_key(&f, 0, 550);  /* 短按 => 0，窗口内 */
    sidekey_fsm_tick(&f, 550 + 300);
    CHECK(r.n == 1);
    CHECK(strcmp(r.seqs[0], "10") == 0);
}

int main(void) {
    test_single_short_tap();
    test_single_long_press();
    test_double_click();
    test_triple_click_flushes_immediately();
    test_window_boundary_not_yet();
    test_mixed_long_then_short();
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    printf("test_fsm: all passed\n");
    return 0;
}
