#include <string.h>
#include "sidekey_fsm.h"

#define MAX_SEQ SIDEKEY_FSM_MAX_SEQ

void sidekey_fsm_init(sidekey_fsm_t *f, const sidekey_fsm_cfg_t *cfg,
                      sidekey_on_seq_fn cb, void *ctx) {
    memset(f, 0, sizeof(*f));
    f->cfg = *cfg;
    f->cb = cb;
    f->ctx = ctx;
    f->release_t = -1;
}

static void flush(sidekey_fsm_t *f) {
    if (f->len > 0) {
        f->cb(f->seq, f->len, f->ctx);
    }
    f->len = 0;
    f->release_t = -1;
}

void sidekey_fsm_key(sidekey_fsm_t *f, int pressed, long long t_ms) {
    if (pressed) {
        f->pressed = 1;
        f->press_t = t_ms;
        return;
    }
    if (!f->pressed) return;
    f->pressed = 0;
    long long held = t_ms - f->press_t;
    f->seq[f->len++] = (held >= f->cfg.long_press_ms) ? '1' : '0';
    f->seq[f->len] = '\0';
    f->release_t = t_ms;
    if (f->len >= MAX_SEQ) {
        flush(f);
    }
}

long long sidekey_fsm_tick(sidekey_fsm_t *f, long long t_ms) {
    if (f->len == 0 || f->pressed) return -1;
    long long deadline = f->release_t + f->cfg.window_ms;
    if (t_ms >= deadline) {
        flush(f);
        return -1;
    }
    return deadline;
}
