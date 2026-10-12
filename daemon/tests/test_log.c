#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include "sidekey_log.h"

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { \
    fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)

static const char *TMP_DIR = "/tmp/sidekey_test_log";

/* 纯 C 清理：删除文件并确保目录存在，不调用 shell。 */
static void reset_dir(void) {
    char path[256];
    snprintf(path, sizeof(path), "%s/log.txt", TMP_DIR);
    remove(path);
    mkdir(TMP_DIR, 0755);
}

static long file_size(const char *path) {
    struct stat st;
    if (stat(path, &st) != 0) return -1;
    return (long)st.st_size;
}

static int file_contains(const char *path, const char *needle) {
    FILE *f = fopen(path, "r");
    if (!f) return 0;
    char buf[4096];
    int found = 0;
    while (fgets(buf, sizeof(buf), f)) {
        if (strstr(buf, needle)) { found = 1; break; }
    }
    fclose(f);
    return found;
}

static void test_format_line_has_timestamp_and_level(void) {
    char out[256];
    sidekey_log_format_line(out, sizeof(out), "2026-10-12 16:00:00", "INFO", "daemon started");
    CHECK(strcmp(out, "2026-10-12 16:00:00 INFO daemon started\n") == 0);
}

static void test_explain_sequence_line_format(void) {
    char out[256];
    sidekey_log_format_seq(out, sizeof(out), "2026-10-12 16:00:01", "00", "echo double", 0);
    CHECK(strcmp(out, "2026-10-12 16:00:01 INFO seq=00 action=echo double result=0\n") == 0);
}

static void test_dropped_sequence_marks_result(void) {
    char out[256];
    sidekey_log_format_seq(out, sizeof(out), "2026-10-12 16:00:02", "01", NULL, -1);
    CHECK(strcmp(out, "2026-10-12 16:00:02 INFO seq=01 action=none result=dropped\n") == 0);
}

static void test_append_creates_file(void) {
    reset_dir();
    char path[256];
    snprintf(path, sizeof(path), "%s/log.txt", TMP_DIR);
    CHECK(sidekey_log_append(path, "line one\n", 512 * 1024) == 0);
    CHECK(file_contains(path, "line one"));
}

static void test_truncates_to_back_half_when_over_limit(void) {
    reset_dir();
    char path[256];
    snprintf(path, sizeof(path), "%s/log.txt", TMP_DIR);
    const long limit = 1024;
    /* 每行 63 字节 + 换行 = 64 字节。第 i 行以序号标记，便于检查首行是否完整。 */
    for (int i = 0; i < 40; i++) {
        char line[64];
        snprintf(line, sizeof(line), "%03d%059d\n", i, 0);
        CHECK(sidekey_log_append(path, line, limit) == 0);
    }
    long sz = file_size(path);
    CHECK(sz > 0);
    CHECK(sz <= limit);          /* 不得超过上限 */
    CHECK(sz >= limit / 2 - 64); /* 至少保留后半部分 */

    /* 首行必须是完整行：3 位序号 + 59 位填充 + 换行 = 63 字节，没有半行 */
    FILE *f = fopen(path, "r");
    CHECK(f != NULL);
    if (f) {
        char first[128];
        CHECK(fgets(first, sizeof(first), f) != NULL);
        size_t n = strlen(first);
        CHECK(n == 63);
        CHECK(first[n - 1] == '\n');
        fclose(f);
    }
}

int main(void) {
    test_format_line_has_timestamp_and_level();
    test_explain_sequence_line_format();
    test_dropped_sequence_marks_result();
    test_append_creates_file();
    test_truncates_to_back_half_when_over_limit();
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    printf("test_log: all passed\n");
    return 0;
}
