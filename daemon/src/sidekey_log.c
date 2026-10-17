#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sidekey_log.h"

void sidekey_log_format_line(char *out, size_t out_len, const char *ts,
                             const char *level, const char *message) {
    snprintf(out, out_len, "%s %s %s\n", ts, level, message);
}

void sidekey_log_format_seq(char *out, size_t out_len, const char *ts,
                            const char *seq, const char *action, int result) {
    char res[32];
    if (result == -1 && action == NULL) {
        snprintf(res, sizeof(res), "dropped");
    } else {
        snprintf(res, sizeof(res), "%d", result);
    }
    snprintf(out, out_len, "%s INFO seq=%s action=%s result=%s\n",
             ts, seq, action ? action : "none", res);
}

static long file_size_of(FILE *f) {
    if (fseek(f, 0, SEEK_END) != 0) return -1;
    return ftell(f);
}

int sidekey_log_append(const char *path, const char *text, long limit) {
    FILE *f = fopen(path, "a+b");
    if (!f) return -1;
    size_t n = strlen(text);
    if (fwrite(text, 1, n, f) != n) {
        fclose(f);
        return -1;
    }
    fflush(f);

    long sz = file_size_of(f);
    if (sz < 0) {
        fclose(f);
        return -1;
    }
    if (sz <= limit) {
        fclose(f);
        return 0;
    }

    /* 超限：保留后半部分。从 sz - keep 开始读，写回开头，再截断。 */
    long keep = limit / 2;
    char *buf = malloc((size_t)keep);
    if (!buf) {
        fclose(f);
        return -1;
    }
    if (fseek(f, sz - keep, SEEK_SET) != 0 ||
        fread(buf, 1, (size_t)keep, f) != (size_t)keep) {
        free(buf);
        fclose(f);
        return -1;
    }
    /* 对齐到下一个换行，避免保留半行 */
    size_t start = 0;
    while (start < (size_t)keep && buf[start] != '\n') start++;
    if (start < (size_t)keep) start++;

    FILE *w = fopen(path, "wb");
    if (!w) {
        free(buf);
        fclose(f);
        return -1;
    }
    size_t out_n = (size_t)keep - start;
    if (fwrite(buf + start, 1, out_n, w) != out_n) {
        fclose(w);
        free(buf);
        fclose(f);
        return -1;
    }
    fclose(w);
    free(buf);
    fclose(f);
    return 0;
}
