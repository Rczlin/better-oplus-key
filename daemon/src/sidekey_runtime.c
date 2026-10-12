#include <stdio.h>
#include <string.h>
#include "sidekey_runtime.h"

const char *sidekey_runtime_lookup(const sidekey_config_t *c, const char *seq) {
    for (int i = 0; i < c->n_bindings; i++) {
        if (strcmp(c->bindings[i].seq, seq) == 0) {
            return c->bindings[i].cmd;
        }
    }
    return NULL;
}

void sidekey_runtime_event_line(char *out, size_t out_len, long long wall_ms,
                                long long mono_ms, const char *edge, int code) {
    snprintf(out, out_len,
             "{\"wall_ms\":%lld,\"mono_ms\":%lld,\"edge\":\"%s\",\"code\":%d}\n",
             wall_ms, mono_ms, edge, code);
}
