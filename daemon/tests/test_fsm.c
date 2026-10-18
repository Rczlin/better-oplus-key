#include <stdio.h>
#include <string.h>
#include <assert.h>
#include "sidekey_fsm.h"

typedef struct { char seqs[16][256]; int n; const char *bindings[8]; } rec_t;

static void rec_cb(const char *seq, int len, void *ctx) {
    rec_t *r = (rec_t *)ctx;
    assert(len >= 1 && len < 256 && r->n < 16);
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
    sidekey_fsm_t f = {0};
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 1000);
    sidekey_fsm_key(&f, 0, 1100);      /* 按住 100ms < 300 => 0 */
    sidekey_fsm_tick(&f, 1100 + 300);  /* 窗口到期 */
    CHECK(r.n == 1);
    CHECK(strcmp(r.seqs[0], "0") == 0);
    sidekey_fsm_destroy(&f);
}

static void test_single_long_press(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f = {0};
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 1000);
    sidekey_fsm_key(&f, 0, 1400);      /* 按住 400ms >= 300 => 1 */
    sidekey_fsm_tick(&f, 1400 + 300);
    CHECK(r.n == 1);
    CHECK(strcmp(r.seqs[0], "1") == 0);
    sidekey_fsm_destroy(&f);
}

static void test_double_click(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f = {0};
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 0);   sidekey_fsm_key(&f, 0, 50);
    sidekey_fsm_key(&f, 1, 200); sidekey_fsm_key(&f, 0, 250);   /* 第二次在窗口内 */
    sidekey_fsm_tick(&f, 250 + 300);
    CHECK(r.n == 1);
    CHECK(strcmp(r.seqs[0], "00") == 0);
    sidekey_fsm_destroy(&f);
}

static void test_triple_click_flushes_immediately(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f = {0};
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 0);   sidekey_fsm_key(&f, 0, 50);
    sidekey_fsm_key(&f, 1, 100); sidekey_fsm_key(&f, 0, 150);
    sidekey_fsm_key(&f, 1, 200); sidekey_fsm_key(&f, 0, 250);   /* 第3次松开，立即结束 */
    CHECK(r.n == 1);                       /* 不需要 tick，已经结束 */
    CHECK(strcmp(r.seqs[0], "000") == 0);
    sidekey_fsm_destroy(&f);
}

static void test_window_boundary_not_yet(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f = {0};
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 0); sidekey_fsm_key(&f, 0, 50);
    sidekey_fsm_tick(&f, 50 + 299);        /* 差 1ms，未到期 */
    CHECK(r.n == 0);
    sidekey_fsm_destroy(&f);
}

static void test_mixed_long_then_short(void) {
    rec_t r = {0};
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_t f = {0};
    sidekey_fsm_init(&f, &cfg, rec_cb, &r);
    sidekey_fsm_key(&f, 1, 0);   sidekey_fsm_key(&f, 0, 400);  /* 长按 => 1 */
    sidekey_fsm_key(&f, 1, 500); sidekey_fsm_key(&f, 0, 550);  /* 短按 => 0，窗口内 */
    sidekey_fsm_tick(&f, 550 + 300);
    CHECK(r.n == 1);
    CHECK(strcmp(r.seqs[0], "10") == 0);
    sidekey_fsm_destroy(&f);
}

/* 覆盖错分长短按、漏序列、第三次松开延迟及按住时提前完成。 */
static void test_all_sequences(void) {
    static const struct { const char *seq; int held_ms[3]; } cases[] = {
        {"0",   {100}},           {"1",   {400}},
        {"00",  {100, 100}},      {"01",  {100, 400}},
        {"10",  {400, 100}},      {"11",  {400, 400}},
        {"000", {100, 100, 100}}, {"001", {100, 100, 400}},
        {"010", {100, 400, 100}}, {"011", {100, 400, 400}},
        {"100", {400, 100, 100}}, {"101", {400, 100, 400}},
        {"110", {400, 400, 100}}, {"111", {400, 400, 400}},
    };
    for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
        int before = failures;
        rec_t r = {0};
        sidekey_fsm_cfg_t cfg = {300, 300};
        sidekey_fsm_t f = {0};
        sidekey_fsm_init(&f, &cfg, rec_cb, &r);
        CHECK(sidekey_fsm_tick(&f, 1000) == -1);
        long long t = 1000;
        int len = (int)strlen(cases[i].seq);
        for (int j = 0; j < len; j++) {
            sidekey_fsm_key(&f, 1, t);
            CHECK(sidekey_fsm_tick(&f, t + cases[i].held_ms[j] - 1) == -1);
            CHECK(r.n == 0);  /* 长按可跨过上次松开窗口，但仍在同一序列中。 */
            t += cases[i].held_ms[j];
            sidekey_fsm_key(&f, 0, t);
            CHECK(r.n == (j == 2 ? 1 : 0));
            CHECK(sidekey_fsm_tick(&f, t) == (j == 2 ? -1 : t + 300));
            if (j + 1 < len) t += 100;
        }
        if (len == 3) CHECK(strcmp(r.seqs[0], cases[i].seq) == 0);
        CHECK(sidekey_fsm_tick(&f, t + 299) == (len == 3 ? -1 : t + 300));
        CHECK(r.n == (len == 3 ? 1 : 0));
        CHECK(sidekey_fsm_tick(&f, t + 300) == -1);
        CHECK(r.n == 1);
        CHECK(strcmp(r.seqs[0], cases[i].seq) == 0);
        CHECK(sidekey_fsm_tick(&f, t + 301) == -1);
        CHECK(sidekey_fsm_tick(&f, t + 600) == -1);
        CHECK(r.n == 1);
        if (failures != before) fprintf(stderr, "sequence case: %s\n", cases[i].seq);
        sidekey_fsm_destroy(&f);
    }
}

/* >= 300ms 为长按；将比较改为 > 或提前取整会被边界用例捕获。 */
static void test_long_press_threshold_boundaries(void) {
    static const struct { int held_ms; const char *seq; } cases[] = {
        {299, "0"}, {300, "1"}, {301, "1"},
    };
    for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
        int before = failures;
        rec_t r = {0};
        sidekey_fsm_cfg_t cfg = {300, 300};
        sidekey_fsm_t f = {0};
        sidekey_fsm_init(&f, &cfg, rec_cb, &r);
        long long release = 1000 + cases[i].held_ms;
        sidekey_fsm_key(&f, 1, 1000);
        CHECK(sidekey_fsm_tick(&f, release - 1) == -1);
        CHECK(r.n == 0);
        sidekey_fsm_key(&f, 0, release);
        CHECK(r.n == 0);
        CHECK(sidekey_fsm_tick(&f, release) == release + 300);
        CHECK(sidekey_fsm_tick(&f, release + 299) == release + 300);
        CHECK(r.n == 0);
        CHECK(sidekey_fsm_tick(&f, release + 300) == -1);
        CHECK(r.n == 1);
        CHECK(strcmp(r.seqs[0], cases[i].seq) == 0);
        CHECK(sidekey_fsm_tick(&f, release + 301) == -1);
        CHECK(r.n == 1);
        if (failures != before) fprintf(stderr, "long threshold case: %dms\n", cases[i].held_ms);
        sidekey_fsm_destroy(&f);
    }
}

/* 每个边界独立初始化，确保 301ms 确实验证首次到期 tick。 */
static void test_window_tick_boundaries(void) {
    static const struct { int elapsed_ms; int count; long long deadline; } cases[] = {
        {299, 0, 1350}, {300, 1, -1}, {301, 1, -1},
    };
    for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
        int before = failures;
        rec_t r = {0};
        sidekey_fsm_cfg_t cfg = {300, 300};
        sidekey_fsm_t f = {0};
        sidekey_fsm_init(&f, &cfg, rec_cb, &r);
        sidekey_fsm_key(&f, 1, 1000);
        sidekey_fsm_key(&f, 0, 1050);
        CHECK(r.n == 0);
        CHECK(sidekey_fsm_tick(&f, 1050) == 1350);
        CHECK(sidekey_fsm_tick(&f, 1050 + cases[i].elapsed_ms) == cases[i].deadline);
        CHECK(r.n == cases[i].count);
        if (cases[i].count) CHECK(strcmp(r.seqs[0], "0") == 0);
        CHECK(sidekey_fsm_tick(&f, 1650) == -1);
        CHECK(r.n == 1);
        CHECK(strcmp(r.seqs[0], "0") == 0);
        CHECK(sidekey_fsm_tick(&f, 1950) == -1);
        CHECK(r.n == 1);
        if (failures != before) fprintf(stderr, "window tick case: %dms\n", cases[i].elapsed_ms);
        sidekey_fsm_destroy(&f);
    }
}

/* 调用方先 tick 到期窗口，再发送新按键；key 本身不承担到期策略。 */
static void test_presses_at_window_boundaries(void) {
    static const struct { int gap_ms; int prior_count; const char *first_seq; } cases[] = {
        {299, 0, "00"}, {300, 1, "0"}, {301, 1, "0"},
    };
    for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
        int before = failures;
        rec_t r = {0};
        sidekey_fsm_cfg_t cfg = {300, 300};
        sidekey_fsm_t f = {0};
        sidekey_fsm_init(&f, &cfg, rec_cb, &r);
        sidekey_fsm_key(&f, 1, 1000);
        sidekey_fsm_key(&f, 0, 1050);
        long long press = 1050 + cases[i].gap_ms;
        CHECK(sidekey_fsm_tick(&f, press) == (cases[i].prior_count ? -1 : 1350));
        CHECK(r.n == cases[i].prior_count);
        if (cases[i].prior_count) CHECK(strcmp(r.seqs[0], "0") == 0);
        sidekey_fsm_key(&f, 1, press);
        CHECK(sidekey_fsm_tick(&f, press + 49) == -1);
        CHECK(r.n == cases[i].prior_count);
        sidekey_fsm_key(&f, 0, press + 50);
        CHECK(r.n == cases[i].prior_count);
        CHECK(sidekey_fsm_tick(&f, press + 349) == press + 350);
        CHECK(r.n == cases[i].prior_count);
        CHECK(sidekey_fsm_tick(&f, press + 350) == -1);
        CHECK(r.n == cases[i].prior_count + 1);
        CHECK(strcmp(r.seqs[0], cases[i].first_seq) == 0);
        if (cases[i].prior_count) CHECK(strcmp(r.seqs[1], "0") == 0);
        CHECK(sidekey_fsm_tick(&f, press + 351) == -1);
        CHECK(sidekey_fsm_tick(&f, press + 650) == -1);
        CHECK(r.n == cases[i].prior_count + 1);
        if (failures != before) fprintf(stderr, "window press case: %dms\n", cases[i].gap_ms);
        sidekey_fsm_destroy(&f);
    }
}

static unsigned configured_match(const char *seq, int len, void *ctx) {
    rec_t *r = ctx;
    unsigned result = 0;
    for (int i = 0; i < 8 && r->bindings[i]; i++) {
        size_t size = strlen(r->bindings[i]);
        if (size == (size_t)len && !memcmp(seq, r->bindings[i], size)) result |= SIDEKEY_MATCH_EXACT;
        if (size > (size_t)len && !memcmp(seq, r->bindings[i], (size_t)len)) result |= SIDEKEY_MATCH_LONGER;
    }
    return result;
}

static long long gesture(sidekey_fsm_t *f, const char *seq, long long time) {
    for (const char *p = seq; *p; p++) {
        sidekey_fsm_tick(f, time);
        sidekey_fsm_key(f, 1, time);
        time += *p == '1' ? 400 : 50;
        sidekey_fsm_key(f, 0, time);
        time += 100;
    }
    return time - 100;
}

static void test_configured_sequences(void) {
    sidekey_fsm_cfg_t cfg = {300, 300};
    const struct { const char *a, *b, *input; int immediate; } cases[] = {
        {"0", NULL, "0", 1}, {"0", "00", "0", 0},
        {"0", "00", "00", 1}, {"0000", NULL, "0000", 1},
        {"01001", NULL, "01001", 1}, {"0", "001", "00", 0},
        {"0", "001", "0110", 0},
    };
    for (size_t i = 0; i < sizeof(cases)/sizeof(cases[0]); i++) {
        rec_t r = {.bindings = {cases[i].a, cases[i].b}};
        sidekey_fsm_t f = {0};
        CHECK(sidekey_fsm_init_with_match(&f, &cfg, 128, configured_match, rec_cb, &r) == 0);
        long long released = gesture(&f, cases[i].input, 1000);
        CHECK(r.n == cases[i].immediate);
        sidekey_fsm_tick(&f, released + 299);
        CHECK(r.n == cases[i].immediate);
        sidekey_fsm_tick(&f, released + 300);
        /* Incomplete and mismatched gestures reach the dispatcher once for diagnostics. */
        CHECK(r.n == 1);
        if (i != 6) CHECK(strcmp(r.seqs[0], cases[i].input) == 0);
        CHECK(!(i >= 5 && configured_match(r.seqs[0], (int)strlen(r.seqs[0]), &r) & SIDEKEY_MATCH_EXACT));
        sidekey_fsm_destroy(&f);
    }
    rec_t r = {.bindings = {"0"}};
    sidekey_fsm_t f = {0};
    CHECK(sidekey_fsm_init_with_match(&f, &cfg, 1, configured_match, rec_cb, &r) == 0);
    gesture(&f, "00", 0);
    CHECK(r.n == 2); /* A completed leaf starts a fresh gesture. */
    sidekey_fsm_destroy(&f);
    char long_seq[129]; memset(long_seq, '0', 128); long_seq[128] = 0;
    r = (rec_t){.bindings = {long_seq}};
    CHECK(sidekey_fsm_init_with_match(&f, &cfg, 128, configured_match, rec_cb, &r) == 0);
    gesture(&f, long_seq, 0);
    CHECK(r.n == 1 && strlen(r.seqs[0]) == 128);
    sidekey_fsm_destroy(&f);
}

/* 长按是没有后续的完整组合时，按住满阈值即触发，松开不再重复触发。 */
static void test_long_press_fires_while_held(void) {
    sidekey_fsm_cfg_t cfg = {300, 300};
    rec_t r = {.bindings = {"1", "00"}};
    sidekey_fsm_t f = {0};
    CHECK(sidekey_fsm_init_with_match(&f, &cfg, 8, configured_match, rec_cb, &r) == 0);
    sidekey_fsm_key(&f, 1, 1000);
    CHECK(sidekey_fsm_tick(&f, 1100) == 1300);   /* 告诉调用方何时唤醒 */
    CHECK(r.n == 0);
    CHECK(sidekey_fsm_tick(&f, 1299) == 1300 && r.n == 0);
    CHECK(sidekey_fsm_tick(&f, 1300) == -1);
    CHECK(r.n == 1 && strcmp(r.seqs[0], "1") == 0);
    sidekey_fsm_tick(&f, 1800);
    sidekey_fsm_key(&f, 0, 2000);                /* 松开被吞掉 */
    CHECK(sidekey_fsm_tick(&f, 5000) == -1 && r.n == 1);
    gesture(&f, "00", 6000);                      /* 之后的手势不受影响 */
    CHECK(r.n == 2 && strcmp(r.seqs[1], "00") == 0);
    sidekey_fsm_destroy(&f);

    /* 第二次按压的长按（01）同样提前触发 */
    r = (rec_t){.bindings = {"0", "01"}};
    CHECK(sidekey_fsm_init_with_match(&f, &cfg, 8, configured_match, rec_cb, &r) == 0);
    gesture(&f, "0", 0);
    sidekey_fsm_key(&f, 1, 150);
    CHECK(sidekey_fsm_tick(&f, 200) == 450);
    sidekey_fsm_tick(&f, 450);
    CHECK(r.n == 1 && strcmp(r.seqs[0], "01") == 0);
    sidekey_fsm_key(&f, 0, 900);
    sidekey_fsm_tick(&f, 3000);
    CHECK(r.n == 1);
    sidekey_fsm_destroy(&f);

    /* 长按还有后续（10）时必须等松开 */
    r = (rec_t){.bindings = {"1", "10"}};
    CHECK(sidekey_fsm_init_with_match(&f, &cfg, 8, configured_match, rec_cb, &r) == 0);
    sidekey_fsm_key(&f, 1, 0);
    CHECK(sidekey_fsm_tick(&f, 100) == -1);
    sidekey_fsm_tick(&f, 1000);
    CHECK(r.n == 0);
    sidekey_fsm_key(&f, 0, 1000);
    sidekey_fsm_tick(&f, 1300);
    CHECK(r.n == 1 && strcmp(r.seqs[0], "1") == 0);
    sidekey_fsm_destroy(&f);

    /* 短按在阈值前松开：照常记为短按 */
    r = (rec_t){.bindings = {"1", "0"}};
    CHECK(sidekey_fsm_init_with_match(&f, &cfg, 8, configured_match, rec_cb, &r) == 0);
    sidekey_fsm_key(&f, 1, 0);
    CHECK(sidekey_fsm_tick(&f, 50) == 300);
    sidekey_fsm_key(&f, 0, 80);
    CHECK(r.n == 1 && strcmp(r.seqs[0], "0") == 0);
    sidekey_fsm_destroy(&f);
}

int main(void) {
    test_long_press_fires_while_held();
    test_configured_sequences();
    test_single_short_tap();
    test_single_long_press();
    test_double_click();
    test_triple_click_flushes_immediately();
    test_window_boundary_not_yet();
    test_mixed_long_then_short();
    test_all_sequences();
    test_long_press_threshold_boundaries();
    test_window_tick_boundaries();
    test_presses_at_window_boundaries();
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    printf("test_fsm: all passed\n");
    return 0;
}
