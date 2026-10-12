#include <stdlib.h>
#include <string.h>
#include "sidekey_config.h"

static int is_bind_key(const char *k) {
    size_t n = strlen(k);
    if (n < 1 || n > 3) return 0;
    for (size_t i = 0; i < n; i++) {
        if (k[i] != '0' && k[i] != '1') return 0;
    }
    return 1;
}

static int parse_int(const char *s, int *out) {
    char *end = NULL;
    long v = strtol(s, &end, 10);
    if (end == s || *end != '\0') return 0;
    *out = (int)v;
    return 1;
}

static int parse_into(const char *text, sidekey_config_t *out);

/* 对外接口：先解析到临时结构体，成功后才覆盖调用方的结构体。
   这样热加载失败时旧配置保持不变（见 test_failed_parse_preserves_previous_config）。 */
int sidekey_config_parse(const char *text, sidekey_config_t *out) {
    sidekey_config_t tmp;
    if (parse_into(text, &tmp) != 0) return -1;
    *out = tmp;
    return 0;
}

static int parse_into(const char *text, sidekey_config_t *out) {
    memset(out, 0, sizeof(*out));
    out->keycode = 735;
    out->fsm.long_press_ms = 300;
    out->fsm.window_ms = 300;

    const char *p = text;
    while (*p) {
        const char *eol = strchr(p, '\n');
        size_t len = eol ? (size_t)(eol - p) : strlen(p);
        char line[1024];
        if (len >= sizeof(line)) len = sizeof(line) - 1;
        memcpy(line, p, len);
        line[len] = '\0';
        if (len > 0 && line[len - 1] == '\r') line[len - 1] = '\0';

        p = eol ? eol + 1 : p + len;

        if (line[0] == '\0' || line[0] == '#') continue;

        char *eq = strchr(line, '=');
        if (!eq) {
            out->skipped_lines++;
            continue;
        }
        *eq = '\0';
        const char *key = line;
        const char *val = eq + 1;

        if (strcmp(key, "keycode") == 0) {
            if (!parse_int(val, &out->keycode)) return -1;
        } else if (strcmp(key, "long_press_ms") == 0) {
            if (!parse_int(val, &out->fsm.long_press_ms)) return -1;
        } else if (strcmp(key, "window_ms") == 0) {
            if (!parse_int(val, &out->fsm.window_ms)) return -1;
        } else if (is_bind_key(key)) {
            if (out->n_bindings >= SIDEKEY_MAX_BINDINGS) {
                out->skipped_lines++;
                continue;
            }
            sidekey_binding_t *b = &out->bindings[out->n_bindings];
            strncpy(b->seq, key, sizeof(b->seq) - 1);
            b->seq[sizeof(b->seq) - 1] = '\0';
            strncpy(b->cmd, val, SIDEKEY_CMD_MAX - 1);
            b->cmd[SIDEKEY_CMD_MAX - 1] = '\0';
            out->n_bindings++;
        } else {
            out->skipped_lines++;
        }
    }
    return 0;
}
