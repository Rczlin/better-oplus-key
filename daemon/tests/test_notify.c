#include <stdio.h>
#include <string.h>
#include "sidekey_notify.h"

static int failures;
#define CHECK(c) do { if (!(c)) { fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); failures++; } } while (0)

static int valid_utf8(const char *s) {
    const unsigned char *p = (const unsigned char *)s;
    while (*p) {
        int n = *p < 0x80 ? 0 : (*p & 0xE0) == 0xC0 ? 1 : (*p & 0xF0) == 0xE0 ? 2 : (*p & 0xF8) == 0xF0 ? 3 : -1;
        if (n < 0) return 0;
        p++;
        for (int i = 0; i < n; i++, p++) if ((*p & 0xC0) != 0x80) return 0;
    }
    return 1;
}

static void test_wanted(void) {
    CHECK(!sidekey_notify_wanted(0, 0) && !sidekey_notify_wanted(0, 1));
    CHECK(sidekey_notify_wanted(1, 0) && sidekey_notify_wanted(1, 127) && sidekey_notify_wanted(1, -3));
    CHECK(!sidekey_notify_wanted(2, 0) && sidekey_notify_wanted(2, 2) && sidekey_notify_wanted(2, -3));
    CHECK(!sidekey_notify_wanted(3, 1) && !sidekey_notify_wanted(-1, 1));
}

static void test_label(void) {
    char out[SIDEKEY_NOTIFY_LABEL_CAP];
    CHECK(sidekey_notify_label("input keyevent 120", out, sizeof(out)) == strlen("input keyevent 120"));
    CHECK(strcmp(out, "input keyevent 120") == 0);
    sidekey_notify_label(": sidekey-script; S=$(printf %s 'ZWNobwo=' | base64 -d) || exit 126; eval \"$S\"", out, sizeof(out));
    CHECK(strcmp(out, "多行脚本") == 0);

    char longcmd[300];
    memset(longcmd, 'a', 299); longcmd[299] = 0;
    sidekey_notify_label(longcmd, out, sizeof(out));
    CHECK(strlen(out) == SIDEKEY_NOTIFY_LABEL_BYTES + strlen("…"));
    CHECK(strcmp(out + SIDEKEY_NOTIFY_LABEL_BYTES, "…") == 0);

    /* 中文每字 3 字节：96 字节边界恰好落在字符中间时须回退 */
    char zh[400] = "a";
    for (int i = 0; i < 60; i++) strcat(zh, "中");
    sidekey_notify_label(zh, out, sizeof(out));
    CHECK(valid_utf8(out));
    CHECK(strlen(out) - strlen("…") <= SIDEKEY_NOTIFY_LABEL_BYTES);
    CHECK(strlen(out) - strlen("…") == 1 + 31 * 3);

    char tiny[8];
    sidekey_notify_label("abcdefghijk", tiny, sizeof(tiny));
    CHECK(strlen(tiny) < sizeof(tiny) && valid_utf8(tiny));
    CHECK(sidekey_notify_label(NULL, out, sizeof(out)) == 0 && out[0] == 0);
}

static void test_prepare(void) {
    sidekey_notify_msg_t m;
    CHECK(sidekey_notify_prepare(&m, "/data/adb/modules/oplus-sidekey/companion/island.apk",
                                 "00", "input keyevent 120", 127, 42, 8) == 0);
    const char *want[] = {"app_process", "-Djava.class.path=/data/adb/modules/oplus-sidekey/companion/island.apk",
        "/system/bin", "--nice-name=sidekey-island", "io.github.rczlin.sidekey.island.Poster",
        "--seq", "00", "--label", "input keyevent 120", "--code", "127", "--duration", "42", "--show", "8", NULL};
    size_t i = 0;
    for (; want[i]; i++) {
        CHECK(m.argv[i] != NULL);
        if (m.argv[i]) CHECK(strcmp(m.argv[i], want[i]) == 0);
    }
    CHECK(m.argv[i] == NULL);
    CHECK(strcmp(SIDEKEY_NOTIFY_MAIN, "io.github.rczlin.sidekey.island.Poster") == 0);

    /* 显示时长限制在 2–15 秒；序列截断；负耗时归零 */
    char seq[64]; memset(seq, '0', 63); seq[63] = 0;
    CHECK(sidekey_notify_prepare(&m, "/a.apk", seq, "x", -3, -5, 99) == 0);
    CHECK(strlen(m.argv[6]) == SIDEKEY_NOTIFY_SEQ_MAX);
    CHECK(strcmp(m.argv[10], "-3") == 0 && strcmp(m.argv[12], "0") == 0 && strcmp(m.argv[14], "15") == 0);
    CHECK(sidekey_notify_prepare(&m, "/a.apk", "0", "x", 0, 0, 0) == 0 && strcmp(m.argv[14], "2") == 0);

    CHECK(sidekey_notify_prepare(&m, "/a.apk", NULL, "x", 0, 0, 5) == -1);
    CHECK(sidekey_notify_prepare(NULL, "/a.apk", "0", "x", 0, 0, 5) == -1);
    CHECK(sidekey_notify_prepare(&m, NULL, "0", "x", 0, 0, 5) == -1);
    char longpath[SIDEKEY_NOTIFY_APK_MAX + 8];
    memset(longpath, 'a', sizeof(longpath) - 1); longpath[sizeof(longpath) - 1] = 0;
    CHECK(sidekey_notify_prepare(&m, longpath, "0", "x", 0, 0, 5) == -1);
}

int main(void) {
    test_wanted(); test_label(); test_prepare();
    if (failures) { fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    puts("test_notify: all passed"); return 0;
}
