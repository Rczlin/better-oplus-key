#include <errno.h>
#include <stdio.h>
#include <string.h>
#include "sidekey_input.h"

static int failures;
#define CHECK(c) do { if (!(c)) { fprintf(stderr, "FAIL %s:%d: %s\n", __func__, __LINE__, #c); failures++; } } while (0)

typedef struct {
    struct input_event events[128];
    int status[128];
    size_t count, pos;
    long long now;
    int read_error;
    char seqs[16][4];
    int nseq, nlog;
    long long logged[16];
} fixture_t;

static int next_event(void *ctx, unsigned int flags, struct input_event *event) {
    fixture_t *r = ctx;
    if (r->read_error) { int rc = r->read_error; r->read_error = 0; return rc; }
    if (r->pos == r->count) return -EAGAIN;
    /* libevdev sync completion is distinct from a normal queue becoming empty. */
    if (flags == LIBEVDEV_READ_FLAG_SYNC && r->status[r->pos] == LIBEVDEV_READ_STATUS_SUCCESS)
        return -EAGAIN;
    *event = r->events[r->pos];
    return r->status[r->pos++];
}

static long long now_ms(void *ctx) { return ((fixture_t *)ctx)->now; }
static void event_log(void *ctx, int pressed, int code, long long t_ms) {
    fixture_t *r = ctx;
    (void)pressed; (void)code;
    if (r->nlog < 16) r->logged[r->nlog] = t_ms;
    r->nlog++;
}
static void sequence(const char *seq, int len, void *ctx) {
    fixture_t *r = ctx;
    if (r->nseq < 16) { memcpy(r->seqs[r->nseq], seq, (size_t)len); r->seqs[r->nseq][len] = 0; }
    r->nseq++;
}
static void add(fixture_t *r, int type, int code, int value, long long t, int status) {
    r->events[r->count] = (struct input_event){ .time = {t / 1000, (t % 1000) * 1000},
        .type = (unsigned short)type, .code = (unsigned short)code, .value = value };
    r->status[r->count++] = status;
}
static void key(fixture_t *r, int value, long long t) { add(r, EV_KEY, 735, value, t, 0); }
static void init(sidekey_fsm_t *fsm, fixture_t *r) {
    sidekey_fsm_cfg_t cfg = {300, 300};
    sidekey_fsm_init(fsm, &cfg, sequence, r);
}
static int drain(sidekey_input_t *input, sidekey_fsm_t *fsm, fixture_t *r, int *timeout) {
    sidekey_input_io_t io = {next_event, now_ms, event_log, r};
    return sidekey_input_drain(input, fsm, 735, &io, timeout);
}

/* Break: replacing edge timestamps with processing time shortens a real hold. */
static void delayed_long_press(void) {
    fixture_t r = {.now = 5000}; sidekey_fsm_t f = {0}; sidekey_input_t input = {0}; int timeout;
    init(&f, &r); key(&r, 1, 1000); key(&r, 0, 1400);
    CHECK(drain(&input, &f, &r, &timeout) == 0);
    CHECK(r.nseq == 1); CHECK(strcmp(r.seqs[0], "1") == 0);
    CHECK(r.nlog == 2); CHECK(r.logged[0] == 1000); CHECK(r.logged[1] == 1400);
    sidekey_fsm_destroy(&f);
}

/* Break: ticking current time before queued edges prematurely splits 1299. */
static void queued_window_boundaries(void) {
    const struct { long long down; int count; const char *first; } cases[] = {
        {1299, 1, "00"}, {1300, 2, "0"}, {1301, 2, "0"}
    };
    for (size_t i = 0; i < sizeof(cases)/sizeof(cases[0]); i++) {
        fixture_t r = {.now = 1100}; sidekey_fsm_t f = {0}; sidekey_input_t input = {0}; int timeout;
        init(&f, &r); key(&r, 1, 900); key(&r, 0, 1000);
        CHECK(drain(&input, &f, &r, &timeout) == 0); CHECK(r.nseq == 0); CHECK(timeout == 200);
        key(&r, 1, cases[i].down); key(&r, 0, cases[i].down + 100); r.now = 5000;
        CHECK(drain(&input, &f, &r, &timeout) == 0);
        CHECK(r.nseq == cases[i].count); CHECK(strcmp(r.seqs[0], cases[i].first) == 0);
        if (cases[i].count == 2) CHECK(strcmp(r.seqs[1], "0") == 0);
        sidekey_fsm_destroy(&f);
    }
}

/* Break: wrong timestamp or >= threshold comparison misclassifies 299/300/301. */
static void long_press_boundaries(void) {
    const struct { int held; const char *want; } cases[] = {{299,"0"},{300,"1"},{301,"1"}};
    for (size_t i = 0; i < sizeof(cases)/sizeof(cases[0]); i++) {
        fixture_t r = {.now = 5000}; sidekey_fsm_t f = {0}; sidekey_input_t input = {0}; int timeout;
        init(&f, &r); key(&r, 1, 1000); key(&r, 0, 1000 + cases[i].held);
        CHECK(drain(&input, &f, &r, &timeout) == 0);
        CHECK(r.nseq == 1); CHECK(strcmp(r.seqs[0], cases[i].want) == 0);
        sidekey_fsm_destroy(&f);
    }
}

/* Break: third down flushing early, or final idle tick emitting a duplicate. */
static void third_release_is_complete_once(void) {
    fixture_t r = {.now = 1299}; sidekey_fsm_t f = {0}; sidekey_input_t input = {0}; int timeout;
    init(&f, &r); key(&r,1,1000); key(&r,0,1050); key(&r,1,1100); key(&r,0,1150); key(&r,1,1200);
    CHECK(drain(&input,&f,&r,&timeout) == 0); CHECK(r.nseq == 0);
    key(&r,0,1500); r.now = 5000;
    CHECK(drain(&input,&f,&r,&timeout) == 0); CHECK(r.nseq == 1); CHECK(strcmp(r.seqs[0],"001") == 0);
    CHECK(drain(&input,&f,&r,&timeout) == 0); CHECK(r.nseq == 1); CHECK(timeout == -1);
    sidekey_fsm_destroy(&f);
}

/* Break: a 32-event cap leaves the up in a later device read and ticks too early. */
static void drains_more_than_32_events(void) {
    fixture_t r = {.now = 5000}; sidekey_fsm_t f = {0}; sidekey_input_t input = {0}; int timeout;
    init(&f,&r); key(&r,1,1000);
    for (int i = 0; i < 70; i++) add(&r,EV_SYN,SYN_REPORT,0,1001+i,0);
    key(&r,0,1400);
    CHECK(drain(&input,&f,&r,&timeout) == 0); CHECK(r.nseq == 1); CHECK(strcmp(r.seqs[0],"1") == 0);
    sidekey_fsm_destroy(&f);
}

/* Break: duplicates/repeats reset press time, or unrelated events form a sequence. */
static void filters_duplicates_repeats_and_unrelated(void) {
    fixture_t r = {.now = 5000}; sidekey_fsm_t f = {0}; sidekey_input_t input = {0}; int timeout;
    init(&f,&r); key(&r,0,900); key(&r,1,1000); key(&r,1,1200); key(&r,2,1300);
    add(&r,EV_KEY,734,0,1350,0); add(&r,EV_MSC,735,0,1351,0);
    key(&r,0,1400); key(&r,0,1450);
    CHECK(drain(&input,&f,&r,&timeout) == 0); CHECK(r.nseq == 1); CHECK(strcmp(r.seqs[0],"1") == 0);
    CHECK(r.nlog == 2);
    sidekey_fsm_destroy(&f);
}

/* Break: processing old REALTIME events after switching clocks creates bogus actions. */
static void discards_clock_switch_queue(void) {
    fixture_t r = {.now = 5000}; sidekey_fsm_t f = {0};
    sidekey_input_t input = {.discard_pending = 1}; int timeout;
    init(&f,&r); key(&r,1,1700000000000LL); key(&r,0,1700000000400LL);
    CHECK(drain(&input,&f,&r,&timeout) == 0); CHECK(r.nseq == 0); CHECK(r.nlog == 0);
    key(&r,1,5100); key(&r,0,5500); r.now = 6000;
    CHECK(drain(&input,&f,&r,&timeout) == 0); CHECK(r.nseq == 1); CHECK(strcmp(r.seqs[0],"1") == 0);
    sidekey_fsm_destroy(&f);
}

/* Break: treating resync deltas as real edges classifies a missing/unknown hold. */
static void dropped_sequence_is_cancelled(void) {
    fixture_t r = {.now = 5000}; sidekey_fsm_t f = {0}; sidekey_input_t input = {0}; int timeout;
    init(&f,&r); key(&r,1,900); key(&r,0,1000); key(&r,1,1100);
    add(&r,EV_SYN,SYN_DROPPED,0,1150,LIBEVDEV_READ_STATUS_SYNC);
    add(&r,EV_KEY,735,0,1160,LIBEVDEV_READ_STATUS_SYNC);
    key(&r,0,1200);
    CHECK(drain(&input,&f,&r,&timeout) == 0); CHECK(r.nseq == 0);
    key(&r,1,5100); key(&r,0,5500); r.now = 6000;
    CHECK(drain(&input,&f,&r,&timeout) == 0); CHECK(r.nseq == 1); CHECK(strcmp(r.seqs[0],"1") == 0);
    sidekey_fsm_destroy(&f);
}

/* Break: a signal/read failure must not finalize a queue that was not drained. */
static void interrupted_drain_defers_idle_tick(void) {
    fixture_t r = {.now = 1100}; sidekey_fsm_t f = {0}; sidekey_input_t input = {0}; int timeout;
    init(&f,&r); key(&r,1,900); key(&r,0,1000);
    CHECK(drain(&input,&f,&r,&timeout) == 0); r.now = 5000; r.read_error = -EINTR;
    key(&r,1,1299); key(&r,0,1399);
    CHECK(drain(&input,&f,&r,&timeout) == -EINTR); CHECK(r.nseq == 0);
    CHECK(drain(&input,&f,&r,&timeout) == 0); CHECK(r.nseq == 1); CHECK(strcmp(r.seqs[0],"00") == 0);
    sidekey_fsm_destroy(&f);
}

int main(void) {
    delayed_long_press(); queued_window_boundaries(); long_press_boundaries();
    third_release_is_complete_once(); drains_more_than_32_events();
    filters_duplicates_repeats_and_unrelated(); discards_clock_switch_queue();
    dropped_sequence_is_cancelled(); interrupted_drain_defers_idle_tick();
    if (failures) { fprintf(stderr,"%d failure(s)\n",failures); return 1; }
    puts("test_input: all passed (9 cases)"); return 0;
}
