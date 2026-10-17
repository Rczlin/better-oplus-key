#include <errno.h>
#include "sidekey_input.h"

int sidekey_input_drain(sidekey_input_t *input, sidekey_fsm_t *fsm, int keycode,
                        const sidekey_input_io_t *io, int *timeout_ms) {
    for (;;) {
        struct input_event event;
        unsigned int flags = input->syncing ? LIBEVDEV_READ_FLAG_SYNC : LIBEVDEV_READ_FLAG_NORMAL;
        int rc = io->next_event(io->ctx, flags, &event);
        if (rc == -EAGAIN) {
            if (input->syncing) { input->syncing = 0; continue; }
            input->discard_pending = 0;
            break;
        }
        if (rc < 0) return rc;  /* Never tick an incompletely drained queue. */
        if (rc == LIBEVDEV_READ_STATUS_SYNC) {
            if (!input->syncing) {
                /* Missing edges invalidate the whole in-progress sequence. */
                sidekey_fsm_reset(fsm);
                input->syncing = 1;
            }
            if (event.type == EV_KEY && event.code == (unsigned)keycode &&
                (event.value == 0 || event.value == 1)) input->prev_pressed = event.value;
            continue;  /* State deltas have no trustworthy press duration. */
        }
        if (event.type != EV_KEY || event.code != (unsigned)keycode) continue;
        if (event.value != 0 && event.value != 1) continue;
        int pressed = event.value == 1;
        if (input->discard_pending) {
            input->prev_pressed = pressed;
            continue;  /* Clock switching only changes future event timestamps. */
        }
        if (pressed == input->prev_pressed) continue;
        input->prev_pressed = pressed;
        long long t_ms = (long long)event.time.tv_sec * 1000LL + event.time.tv_usec / 1000;
        sidekey_fsm_tick(fsm, t_ms);
        if (io->log_event) io->log_event(io->ctx, pressed, keycode, t_ms);
        sidekey_fsm_key(fsm, pressed, t_ms);
    }
    long long now = io->now_ms(io->ctx);
    long long next = sidekey_fsm_tick(fsm, now);
    *timeout_ms = next < 0 ? -1 : (int)(next - now);
    if (*timeout_ms < 0 && next >= 0) *timeout_ms = 0;
    return 0;
}
