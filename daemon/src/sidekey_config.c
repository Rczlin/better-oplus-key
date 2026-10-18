#include <errno.h>
#include <stdlib.h>
#include <string.h>

#define HASH_NONFATAL_OOM 1
#include "uthash.h"
#include "sidekey_config.h"

struct sidekey_binding {
    char *seq;
    char *cmd;          /* 按实际长度分配，避免每条绑定固定占用 SIDEKEY_CMD_MAX 字节 */
    UT_hash_handle hh;
};

void sidekey_config_init(sidekey_config_t *c) {
    if (!c) return;
    memset(c, 0, sizeof(*c));
    c->keycode = 735;
    c->fsm.long_press_ms = 300;
    c->fsm.window_ms = 300;
    c->capture_output = 1;
    c->island_seconds = 5;
}

void sidekey_config_destroy(sidekey_config_t *c) {
    if (!c) return;
    sidekey_binding_t *b, *next;
    HASH_ITER(hh, c->bindings, b, next) {
        HASH_DEL(c->bindings, b);
        free(b->seq);
        free(b->cmd);
        free(b);
    }
    sidekey_config_init(c);
}

const char *sidekey_config_lookup(const sidekey_config_t *c, const char *seq) {
    if (!c || !seq) return NULL;
    sidekey_binding_t *b = NULL;
    HASH_FIND_STR(c->bindings, seq, b);
    return b ? b->cmd : NULL;
}

int sidekey_config_has_longer(const sidekey_config_t *c, const char *seq, int len) {
    if (!c || !seq || len <= 0) return 0;
    sidekey_binding_t *b;
    for (b = c->bindings; b; b = b->hh.next) {
        if (strlen(b->seq) > (size_t)len && memcmp(b->seq, seq, (size_t)len) == 0) return 1;
    }
    return 0;
}

static int is_bind_key(const char *key) {
    if (*key == '\0') return 0;
    for (const char *p = key; *p; ++p) {
        if (*p != '0' && *p != '1') return 0;
    }
    return 1;
}

static int parse_int(const char *s, int min, int max, int *out) {
    if (*s == '\0') return 0;
    for (const char *p = s; *p; ++p) {
        if (*p < '0' || *p > '9') return 0;
    }
    errno = 0;
    char *end = NULL;
    long value = strtol(s, &end, 10);
    if (errno == ERANGE || end == s || *end != '\0' || value < min || value > max) return 0;
    *out = (int)value;
    return 1;
}

static int set_binding(sidekey_config_t *c, const char *seq, const char *cmd) {
    size_t command_len = strlen(cmd);
    if (command_len >= SIDEKEY_CMD_MAX) return SIDEKEY_CONFIG_ERR_TOO_LONG;
    if (strchr(cmd, '\r') || strchr(cmd, '\n')) return -1;
    sidekey_binding_t *b = NULL;
    HASH_FIND_STR(c->bindings, seq, b);
    if (command_len == 0) {
        if (b) {
            HASH_DEL(c->bindings, b);
            free(b->seq);
            free(b->cmd);
            free(b);
            c->n_bindings--;
        }
        return 0;
    }
    char *copy = malloc(command_len + 1);
    if (!copy) return SIDEKEY_CONFIG_ERR_NOMEM;
    memcpy(copy, cmd, command_len + 1);
    if (!b) {
        b = calloc(1, sizeof(*b));
        if (!b) { free(copy); return SIDEKEY_CONFIG_ERR_NOMEM; }
        size_t seq_len = strlen(seq);
        b->seq = malloc(seq_len + 1);
        if (!b->seq) { free(b); free(copy); return SIDEKEY_CONFIG_ERR_NOMEM; }
        memcpy(b->seq, seq, seq_len + 1);
        HASH_ADD_KEYPTR(hh, c->bindings, b->seq, strlen(b->seq), b);
        if (!b->hh.tbl) {
            free(b->seq);
            free(b);
            free(copy);
            return SIDEKEY_CONFIG_ERR_NOMEM;
        }
        c->n_bindings++;
        if (seq_len > c->max_seq_len) c->max_seq_len = seq_len;
    }
    free(b->cmd);
    b->cmd = copy;
    return 0;
}

int sidekey_config_parse(const char *text, sidekey_config_t *out) {
    if (!text || !out) return -1;
    size_t bytes = strlen(text);
    if (bytes > SIDEKEY_CONFIG_MAX_BYTES) return SIDEKEY_CONFIG_ERR_TOO_LONG;
    char *copy = malloc(bytes + 1);
    if (!copy) return SIDEKEY_CONFIG_ERR_NOMEM;
    memcpy(copy, text, bytes + 1);

    sidekey_config_t next;
    sidekey_config_init(&next);
    int result = 0;
    for (char *line = copy; line && result == 0;) {
        char *next_line = strchr(line, '\n');
        if (next_line) *next_line++ = '\0';
        size_t line_len = strlen(line);
        if (line_len > 0 && line[line_len - 1] == '\r') line[--line_len] = '\0';
        if (line_len == 0 || line[0] == '#') { line = next_line; continue; }
        char *equals = strchr(line, '=');
        if (!equals) { next.skipped_lines++; line = next_line; continue; }
        *equals++ = '\0';
        if (strcmp(line, "keycode") == 0) {
            if (!parse_int(equals, 1, 767, &next.keycode)) result = -1;
        } else if (strcmp(line, "long_press_ms") == 0) {
            if (!parse_int(equals, 100, 1200, &next.fsm.long_press_ms)) result = -1;
        } else if (strcmp(line, "window_ms") == 0) {
            if (!parse_int(equals, 100, 1200, &next.fsm.window_ms)) result = -1;
        } else if (strcmp(line, "capture_output") == 0) {
            if (!parse_int(equals, 0, 1, &next.capture_output)) result = -1;
        } else if (strcmp(line, "island_notify") == 0) {
            if (!parse_int(equals, 0, 2, &next.island_notify)) result = -1;
        } else if (strcmp(line, "island_seconds") == 0) {
            if (!parse_int(equals, 2, 15, &next.island_seconds)) result = -1;
        } else if (is_bind_key(line)) {
            result = set_binding(&next, line, equals);
        } else {
            next.skipped_lines++;
        }
        line = next_line;
    }
    free(copy);
    if (result != 0) { sidekey_config_destroy(&next); return result; }
    next.max_seq_len = 0;
    for (sidekey_binding_t *b = next.bindings; b; b = b->hh.next) {
        size_t len = strlen(b->seq);
        if (len > next.max_seq_len) next.max_seq_len = len;
    }
    sidekey_config_destroy(out);
    *out = next;
    return 0;
}
