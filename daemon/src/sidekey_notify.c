#include <stdio.h>
#include <string.h>
#include "sidekey_notify.h"

#define SCRIPT_PREFIX ": sidekey-script;"
#define ELLIPSIS "\xE2\x80\xA6"   /* … */

int sidekey_notify_wanted(int mode, int code) {
    if (mode == SIDEKEY_NOTIFY_ALL) return 1;
    if (mode == SIDEKEY_NOTIFY_FAILURES) return code != 0;
    return 0;
}

/* 回退到完整 UTF-8 字符边界：len 处若是续字节，向前退到其起始字节之前。 */
static size_t utf8_floor(const char *s, size_t len) {
    while (len > 0 && ((unsigned char)s[len] & 0xC0) == 0x80) len--;
    return len;
}

size_t sidekey_notify_label(const char *cmd, char *out, size_t cap) {
    if (!out || cap == 0) return 0;
    out[0] = '\0';
    if (!cmd) return 0;
    if (strncmp(cmd, SCRIPT_PREFIX, strlen(SCRIPT_PREFIX)) == 0) cmd = "\xE5\xA4\x9A\xE8\xA1\x8C\xE8\x84\x9A\xE6\x9C\xAC"; /* 多行脚本 */
    size_t len = strlen(cmd);
    if (len < cap && len <= SIDEKEY_NOTIFY_LABEL_BYTES) {
        memcpy(out, cmd, len + 1);
        return len;
    }
    size_t ell = strlen(ELLIPSIS);
    size_t limit = SIDEKEY_NOTIFY_LABEL_BYTES;
    int with_ellipsis = cap > ell + 1;
    size_t room = with_ellipsis ? cap - 1 - ell : cap - 1;
    if (limit > room) limit = room;
    limit = utf8_floor(cmd, limit);
    memcpy(out, cmd, limit);
    if (with_ellipsis) { memcpy(out + limit, ELLIPSIS, ell); limit += ell; }
    out[limit] = '\0';
    return limit;
}

int sidekey_notify_prepare(sidekey_notify_msg_t *m, const char *apk, const char *seq, const char *cmd,
                           int code, long long duration_ms, int show_seconds) {
    if (!m || !apk || !seq || !cmd) return -1;
    if (strlen(apk) >= SIDEKEY_NOTIFY_APK_MAX) return -1;
    memset(m, 0, sizeof(*m));
    size_t seq_len = strlen(seq);
    if (seq_len > SIDEKEY_NOTIFY_SEQ_MAX) seq_len = SIDEKEY_NOTIFY_SEQ_MAX;
    memcpy(m->seq, seq, seq_len);
    m->seq[seq_len] = '\0';
    sidekey_notify_label(cmd, m->label, sizeof(m->label));
    if (show_seconds < SIDEKEY_NOTIFY_SHOW_MIN) show_seconds = SIDEKEY_NOTIFY_SHOW_MIN;
    if (show_seconds > SIDEKEY_NOTIFY_SHOW_MAX) show_seconds = SIDEKEY_NOTIFY_SHOW_MAX;
    snprintf(m->code, sizeof(m->code), "%d", code);
    snprintf(m->duration, sizeof(m->duration), "%lld", duration_ms < 0 ? 0LL : duration_ms);
    snprintf(m->show, sizeof(m->show), "%d", show_seconds);
    snprintf(m->classpath, sizeof(m->classpath), "-Djava.class.path=%s", apk);
    /* 选项都在类名之后作为 main 参数传入；app_process 只解析类名之前的参数，动作摘要以 “-” 开头也无妨。 */
    char *args[] = {
        "app_process", m->classpath, "/system/bin", "--nice-name=sidekey-island", SIDEKEY_NOTIFY_MAIN,
        "--seq", m->seq, "--label", m->label, "--code", m->code,
        "--duration", m->duration, "--show", m->show, NULL
    };
    _Static_assert(sizeof(args) / sizeof(args[0]) <= SIDEKEY_NOTIFY_ARGC_MAX, "argv too small");
    memcpy(m->argv, args, sizeof(args));
    return 0;
}

int sidekey_notify_server_prepare(sidekey_notify_server_t *s, const char *apk) {
    if (!s || !apk || strlen(apk) >= SIDEKEY_NOTIFY_APK_MAX) return -1;
    memset(s, 0, sizeof(*s));
    snprintf(s->classpath, sizeof(s->classpath), "-Djava.class.path=%s", apk);
    char *args[] = {"app_process", s->classpath, "/system/bin", "--nice-name=sidekey-island",
                    SIDEKEY_NOTIFY_MAIN, "--serve", NULL};
    _Static_assert(sizeof(args) / sizeof(args[0]) <= sizeof(s->argv) / sizeof(s->argv[0]), "argv too small");
    memcpy(s->argv, args, sizeof(args));
    return 0;
}

int sidekey_notify_request_line(char *out, size_t cap, const char *seq, const char *cmd,
                                int code, long long duration_ms, int show_seconds) {
    if (!out || cap == 0 || !seq || !cmd) return -1;
    char label[SIDEKEY_NOTIFY_LABEL_CAP];
    sidekey_notify_label(cmd, label, sizeof(label));
    for (char *p = label; *p; p++) if (*p == '\t' || *p == '\n' || *p == '\r') *p = ' ';
    char s[SIDEKEY_NOTIFY_SEQ_MAX + 1];
    size_t seq_len = strlen(seq);
    if (seq_len > SIDEKEY_NOTIFY_SEQ_MAX) seq_len = SIDEKEY_NOTIFY_SEQ_MAX;
    memcpy(s, seq, seq_len);
    s[seq_len] = '\0';
    for (char *p = s; *p; p++) if (*p != '0' && *p != '1') *p = '0';
    if (show_seconds < SIDEKEY_NOTIFY_SHOW_MIN) show_seconds = SIDEKEY_NOTIFY_SHOW_MIN;
    if (show_seconds > SIDEKEY_NOTIFY_SHOW_MAX) show_seconds = SIDEKEY_NOTIFY_SHOW_MAX;
    int n = snprintf(out, cap, "%s\t%s\t%d\t%lld\t%d\n", s, label, code,
                     duration_ms < 0 ? 0LL : duration_ms, show_seconds);
    if (n < 0 || (size_t)n >= cap) { out[0] = '\0'; return -1; }
    return n;
}

const char *sidekey_notify_env_find(const char *block, size_t len, const char *key) {
    if (!block || !key) return NULL;
    size_t klen = strlen(key);
    size_t i = 0;
    while (i < len) {
        const char *entry = block + i;
        size_t elen = strnlen(entry, len - i);
        if (elen > klen && memcmp(entry, key, klen) == 0 && entry[klen] == '=') {
            if (i + elen >= len) return NULL;   /* 没有 NUL 结尾的残缺条目 */
            return entry + klen + 1;
        }
        i += elen + 1;
    }
    return NULL;
}
