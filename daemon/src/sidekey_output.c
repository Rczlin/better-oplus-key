#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sidekey_output.h"

size_t sidekey_output_utf8_trim(const char *s, size_t len) {
    if (!s || len == 0) return 0;
    /* 找到最后一个非续字节（10xxxxxx 以外），最多回看 3 字节。 */
    size_t i = len;
    int back = 0;
    while (i > 0 && back < 4 && ((unsigned char)s[i - 1] & 0xC0) == 0x80) { i--; back++; }
    if (i == 0) return back ? 0 : len;
    unsigned char lead = (unsigned char)s[i - 1];
    size_t need;
    if (lead < 0x80) need = 1;
    else if ((lead & 0xE0) == 0xC0) need = 2;
    else if ((lead & 0xF0) == 0xE0) need = 3;
    else if ((lead & 0xF8) == 0xF0) need = 4;
    else return len;                       /* 非法首字节：不处理，原样保留 */
    size_t have = len - (i - 1);
    return have < need ? i - 1 : len;
}

void sidekey_output_append(sidekey_output_buf_t *b, const char *src, size_t n) {
    if (!b || !src || n == 0 || b->truncated) return;
    size_t room = SIDEKEY_OUTPUT_CAP - 1 - b->len;   /* 保留 1 字节，便于调用方加 NUL */
    if (n <= room) {
        memcpy(b->data + b->len, src, n);
        b->len += n;
        return;
    }
    memcpy(b->data + b->len, src, room);
    b->len = sidekey_output_utf8_trim(b->data, b->len + room);
    b->truncated = 1;
}

/* 返回从 s 开始的合法 UTF-8 序列长度（2–4），非法返回 0。拒绝过长编码与代理区。 */
static size_t utf8_seq_len(const char *s, size_t avail) {
    const unsigned char *u = (const unsigned char *)s;
    size_t need;
    unsigned int cp;
    if (u[0] >= 0xC2 && u[0] <= 0xDF) { need = 2; cp = u[0] & 0x1F; }
    else if ((u[0] & 0xF0) == 0xE0) { need = 3; cp = u[0] & 0x0F; }
    else if (u[0] >= 0xF0 && u[0] <= 0xF4) { need = 4; cp = u[0] & 0x07; }
    else return 0;
    if (avail < need) return 0;
    for (size_t k = 1; k < need; k++) {
        if ((u[k] & 0xC0) != 0x80) return 0;
        cp = (cp << 6) | (u[k] & 0x3F);
    }
    if ((need == 3 && (cp < 0x800 || (cp >= 0xD800 && cp <= 0xDFFF))) || (need == 4 && (cp < 0x10000 || cp > 0x10FFFF))) return 0;
    return need;
}

typedef struct { char *p; size_t len, cap; int failed; } sbuf_t;

static void sb_put(sbuf_t *s, const char *src, size_t n) {
    if (s->failed) return;
    if (s->len + n + 1 > s->cap) {
        size_t cap = s->cap ? s->cap : 256;
        while (s->len + n + 1 > cap) cap *= 2;
        char *p = realloc(s->p, cap);
        if (!p) { s->failed = 1; return; }
        s->p = p; s->cap = cap;
    }
    memcpy(s->p + s->len, src, n);
    s->len += n;
    s->p[s->len] = '\0';
}

static void sb_str(sbuf_t *s, const char *src) { sb_put(s, src, strlen(src)); }

static void sb_json(sbuf_t *s, const char *src, size_t n) {
    sb_put(s, "\"", 1);
    size_t run = 0;
    for (size_t i = 0; i < n; i++) {
        unsigned char c = (unsigned char)src[i];
        const char *esc = NULL;
        char hex[8];
        if (c == '"') esc = "\\\"";
        else if (c == '\\') esc = "\\\\";
        else if (c == '\n') esc = "\\n";
        else if (c == '\r') esc = "\\r";
        else if (c == '\t') esc = "\\t";
        else if (c < 0x20 || c == 0x7f) { snprintf(hex, sizeof(hex), "\\u%04x", c); esc = hex; }
        else if (c >= 0x80) {
            size_t len = utf8_seq_len(src + i, n - i);
            if (len == 0) esc = "\\ufffd";      /* 非法 UTF-8：替换为 U+FFFD，保证 JSON 合法 */
            else { run += len; i += len - 1; continue; }
        }
        if (esc) {
            sb_put(s, src + i - run, run);
            run = 0;
            sb_str(s, esc);
        } else {
            run++;
        }
    }
    sb_put(s, src + n - run, run);
    sb_put(s, "\"", 1);
}

char *sidekey_output_format_record(const char *time, long long wall_ms, const char *seq,
                                   const char *action, int code, long long duration_ms,
                                   int truncated, const char *out, size_t out_len) {
    sbuf_t s = {0};
    char num[64];
    sb_str(&s, "{\"time\":");
    sb_json(&s, time ? time : "", time ? strlen(time) : 0);
    snprintf(num, sizeof(num), ",\"wall_ms\":%lld,\"seq\":", wall_ms);
    sb_str(&s, num);
    sb_json(&s, seq ? seq : "", seq ? strlen(seq) : 0);
    sb_str(&s, ",\"action\":");
    sb_json(&s, action ? action : "", action ? strlen(action) : 0);
    snprintf(num, sizeof(num), ",\"code\":%d,\"duration_ms\":%lld,\"truncated\":%s,\"output\":",
             code, duration_ms, truncated ? "true" : "false");
    sb_str(&s, num);
    sb_json(&s, out ? out : "", out ? out_len : 0);
    sb_str(&s, "}\n");
    if (s.failed) { free(s.p); return NULL; }
    return s.p;
}
