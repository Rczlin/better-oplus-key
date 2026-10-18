#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include "sidekey_fsm.h"

#define FSM_MAGIC UINT32_C(0x534b4653)

static unsigned legacy_match(const char *seq, int len, void *ctx) {
    (void)seq; (void)ctx;
    return len >= SIDEKEY_FSM_MAX_SEQ
        ? SIDEKEY_MATCH_EXACT
        : (SIDEKEY_MATCH_EXACT | SIDEKEY_MATCH_LONGER);
}

void sidekey_fsm_destroy(sidekey_fsm_t *f) {
    if (!f || f->magic != FSM_MAGIC) return;
    free(f->seq);
    memset(f, 0, sizeof(*f));
}

int sidekey_fsm_init_with_match(sidekey_fsm_t *f, const sidekey_fsm_cfg_t *cfg,
                                size_t max_seq_len, sidekey_match_fn match,
                                sidekey_on_seq_fn cb, void *ctx) {
    if (!f || !cfg || !cb || max_seq_len == 0 || max_seq_len > INT_MAX) return -1;
    memset(f, 0, sizeof(*f));
    f->seq = calloc(max_seq_len + 1, 1);
    if (!f->seq) return -1;
    f->seq_cap = max_seq_len + 1;
    f->max_seq_len = max_seq_len;
    f->cfg = *cfg;
    f->match = match;
    f->cb = cb;
    f->ctx = ctx;
    f->release_t = -1;
    f->magic = FSM_MAGIC;
    return 0;
}

void sidekey_fsm_init(sidekey_fsm_t *f, const sidekey_fsm_cfg_t *cfg,
                      sidekey_on_seq_fn cb, void *ctx) {
    (void)sidekey_fsm_init_with_match(f, cfg, SIDEKEY_FSM_MAX_SEQ,
                                      legacy_match, cb, ctx);
}

void sidekey_fsm_reset(sidekey_fsm_t *f) {
    if (!f || f->magic != FSM_MAGIC) return;
    f->len = 0;
    f->invalid = 0;
    f->pressed = 0;
    f->press_t = 0;
    f->release_t = -1;
    f->swallow_release = 0;
    if (f->seq) f->seq[0] = '\0';
}

static void flush(sidekey_fsm_t *f) {
    /* The dispatcher also records incomplete/mismatched input as dropped. */
    if (f->len > 0) f->cb(f->seq, f->len, f->ctx);
    sidekey_fsm_reset(f);
}

void sidekey_fsm_key(sidekey_fsm_t *f, int pressed, long long t_ms) {
    if (!f || f->magic != FSM_MAGIC) return;
    if (pressed) {
        f->swallow_release = 0;
        f->pressed = 1;
        f->press_t = t_ms;
        return;
    }
    if (!f->pressed) {
        f->swallow_release = 0;   /* 提前触发的长按松开了，或松开没有对应的按下 */
        return;
    }
    f->pressed = 0;
    if (!f->invalid && f->len < (int)f->max_seq_len) {
        long long held = t_ms - f->press_t;
        f->seq[f->len++] = (held >= f->cfg.long_press_ms) ? '1' : '0';
        f->seq[f->len] = '\0';
        unsigned match = f->match ? f->match(f->seq, f->len, f->ctx) : SIDEKEY_MATCH_EXACT;
        if ((match & SIDEKEY_MATCH_EXACT) && !(match & SIDEKEY_MATCH_LONGER)) {
            f->cb(f->seq, f->len, f->ctx);
            sidekey_fsm_reset(f);
            return;
        }
        if (!(match & (SIDEKEY_MATCH_EXACT | SIDEKEY_MATCH_LONGER))) f->invalid = 1;
    }
    f->release_t = t_ms;
}

/* 按住期间：再记一个 '1' 是否构成没有后续的完整组合。 */
static int long_press_fires_early(sidekey_fsm_t *f) {
    /* 旧版固定 3 次序列的匹配器保持“松开时判定”的原语义。 */
    if (f->invalid || f->len >= (int)f->max_seq_len || !f->match || f->match == legacy_match) return 0;
    f->seq[f->len] = '1';
    f->seq[f->len + 1] = '\0';
    unsigned match = f->match(f->seq, f->len + 1, f->ctx);
    f->seq[f->len] = '\0';
    return (match & SIDEKEY_MATCH_EXACT) && !(match & SIDEKEY_MATCH_LONGER);
}

long long sidekey_fsm_tick(sidekey_fsm_t *f, long long t_ms) {
    if (!f || f->magic != FSM_MAGIC) return -1;
    if (f->pressed) {
        if (!long_press_fires_early(f)) return -1;
        long long due = f->press_t + f->cfg.long_press_ms;
        if (t_ms < due) return due;
        f->seq[f->len++] = '1';
        f->seq[f->len] = '\0';
        f->cb(f->seq, f->len, f->ctx);
        sidekey_fsm_reset(f);
        f->swallow_release = 1;
        return -1;
    }
    if (f->len == 0) return -1;
    long long deadline = f->release_t + f->cfg.window_ms;
    if (t_ms >= deadline) {
        flush(f);
        return -1;
    }
    return deadline;
}
