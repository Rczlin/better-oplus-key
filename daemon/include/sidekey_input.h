#ifndef SIDEKEY_INPUT_H
#define SIDEKEY_INPUT_H

#include <libevdev/libevdev.h>
#include "sidekey_fsm.h"

typedef struct {
    int prev_pressed;
    int syncing;
    int discard_pending;  /* Set once after switching the device clock. */
} sidekey_input_t;

/* Only device reads, the current clock and event logging cross this seam. */
typedef struct {
    int (*next_event)(void *ctx, unsigned int flags, struct input_event *event);
    long long (*now_ms)(void *ctx);
    void (*log_event)(void *ctx, int pressed, int keycode, long long t_ms);
    void *ctx;
} sidekey_input_io_t;

/* Drain pending input then calculate poll timeout; returns 0 or negative errno.
   On interruption/error, the caller must handle it before ticking/polling. */
int sidekey_input_drain(sidekey_input_t *input, sidekey_fsm_t *fsm, int keycode,
                        const sidekey_input_io_t *io, int *timeout_ms);

#endif
