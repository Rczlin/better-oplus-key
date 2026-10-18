#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sidekey_output.h"

static int failures;
#define CHECK(x) do { if (!(x)) { fprintf(stderr, "FAIL %d: %s\n", __LINE__, #x); failures++; } } while (0)

int main(void) {
    /* JSON 转义 */
    char *r = sidekey_output_format_record("2026-10-17 18:00:00", 1700000000000LL, "01",
        "echo \"hi\" \\ ok", 0, 42, 0, "a\nb\t\"c\"\x01\x7f", 9);
    CHECK(r != NULL);
    CHECK(r && strcmp(r, "{\"time\":\"2026-10-17 18:00:00\",\"wall_ms\":1700000000000,\"seq\":\"01\","
        "\"action\":\"echo \\\"hi\\\" \\\\ ok\",\"code\":0,\"duration_ms\":42,\"truncated\":false,"
        "\"output\":\"a\\nb\\t\\\"c\\\"\\u0001\\u007f\"}\n") == 0);
    free(r);

    /* 非 ASCII 原样保留，负退出码，truncated */
    r = sidekey_output_format_record("t", 1, "1", "截屏", -3, 0, 1, "中文", strlen("中文"));
    CHECK(r && strstr(r, "\"action\":\"截屏\"") && strstr(r, "\"code\":-3") &&
          strstr(r, "\"truncated\":true") && strstr(r, "\"output\":\"中文\"}\n"));
    free(r);

    /* 输出中的 NUL 不截断 JSON，而是转义 */
    r = sidekey_output_format_record("t", 1, "0", "x", 1, 0, 0, "a\0b", 3);
    CHECK(r && strstr(r, "\"output\":\"a\\u0000b\""));
    free(r);

    /* 非法 UTF-8 替换为 U+FFFD，合法多字节保留 */
    r = sidekey_output_format_record("t", 1, "0", "x", 0, 0, 0, "a\xff" "b\xe4\xb8" "c\xc0\xaf\xed\xa0\x80" "中", 14);
    CHECK(r && strstr(r, "\"output\":\"a\\ufffdb\\ufffd\\ufffdc\\ufffd\\ufffd\\ufffd\\ufffd\\ufffd中\""));
    free(r);

    /* UTF-8 尾部修剪 */
    const char *zh = "中文";               /* 6 字节 */
    CHECK(sidekey_output_utf8_trim(zh, 6) == 6);
    CHECK(sidekey_output_utf8_trim(zh, 5) == 3);
    CHECK(sidekey_output_utf8_trim(zh, 4) == 3);
    CHECK(sidekey_output_utf8_trim(zh, 3) == 3);
    CHECK(sidekey_output_utf8_trim("ab", 2) == 2);
    CHECK(sidekey_output_utf8_trim("\xf0\x9f\x98", 3) == 0);

    /* 容量与截断 */
    sidekey_output_buf_t *b = calloc(1, sizeof(*b));
    char chunk[1000];
    memset(chunk, 'x', sizeof(chunk));
    for (int i = 0; i < 4; i++) sidekey_output_append(b, chunk, sizeof(chunk));
    CHECK(b->len == 4000 && !b->truncated);
    sidekey_output_append(b, chunk, 95);
    CHECK(b->len == 4095 && !b->truncated);
    sidekey_output_append(b, zh, 6);       /* 只剩 1 字节空间，不能留下半个汉字 */
    CHECK(b->truncated && b->len == 4095);
    sidekey_output_append(b, "y", 1);
    CHECK(b->len == 4095 && b->data[4094] == 'x');
    free(b);

    b = calloc(1, sizeof(*b));
    memset(chunk, 'x', sizeof(chunk));
    for (int i = 0; i < 4; i++) sidekey_output_append(b, chunk, sizeof(chunk));
    sidekey_output_append(b, chunk, 94);
    sidekey_output_append(b, zh, 6);       /* 剩 2 字节：仍不足一个汉字 */
    CHECK(b->truncated && b->len == 4094);
    free(b);

    if (failures) return 1;
    puts("output ok");
    return 0;
}
