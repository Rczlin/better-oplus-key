#include <stdio.h>
#include "sidekey_runtime.h"

const char *sidekey_runtime_lookup(const sidekey_config_t *c, const char *seq) {
    return sidekey_config_lookup(c, seq);
}

unsigned sidekey_runtime_match(const char *seq, int len, void *ctx) {
    const sidekey_config_t *c = (const sidekey_config_t *)ctx;
    if (!c || !seq || len <= 0) return 0;
    unsigned match = 0;
    if (sidekey_config_lookup(c, seq) != NULL) match |= SIDEKEY_MATCH_EXACT;
    if (sidekey_config_has_longer(c, seq, len)) match |= SIDEKEY_MATCH_LONGER;
    return match;
}

void sidekey_runtime_event_line(char *out, size_t out_len, long long wall_ms,
                                long long mono_ms, const char *edge, int code) {
    snprintf(out, out_len,
             "{\"wall_ms\":%lld,\"mono_ms\":%lld,\"edge\":\"%s\",\"code\":%d}\n",
             wall_ms, mono_ms, edge, code);
}
