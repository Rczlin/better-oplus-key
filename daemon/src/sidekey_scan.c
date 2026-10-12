#include <dirent.h>
#include <fcntl.h>
#include <libevdev/libevdev.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "sidekey_scan.h"

int sidekey_scan_find_candidates(const char *const *paths, int n, int keycode,
                                 sidekey_probe_fn probe, void *ctx,
                                 char *out, size_t out_len, int *matched_count) {
    int matched = 0;
    int first = -1;
    for (int i = 0; i < n; i++) {
        int r = probe(paths[i], keycode, ctx);
        if (r < 0) {
            *matched_count = matched;
            return -1;
        }
        if (r == 1) {
            matched++;
            if (first < 0) first = i;
        }
    }
    *matched_count = matched;
    if (first < 0) return 0;

    size_t need = strlen(paths[first]) + 1;
    if (out_len < need) return -1;
    memcpy(out, paths[first], need);
    return 1;
}

/* 真实探测：用 libevdev 检查节点是否声明 EV_KEY/keycode。
   节点无权限或已消失时视为不匹配，不报错。 */
static int libevdev_probe(const char *path, int keycode, void *ctx) {
    (void)ctx;
    int fd = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) return 0;
    struct libevdev *dev = NULL;
    int ret = libevdev_new_from_fd(fd, &dev);
    int has = 0;
    if (ret == 0) {
        has = libevdev_has_event_code(dev, EV_KEY, keycode) ? 1 : 0;
        libevdev_free(dev);
    }
    close(fd);
    return has;
}

static int cmp_names(const void *a, const void *b) {
    const char *const *sa = a;
    const char *const *sb = b;
    long na = strtol(*sa + strlen("event"), NULL, 10);
    long nb = strtol(*sb + strlen("event"), NULL, 10);
    return (na > nb) - (na < nb);
}

#define SCAN_MAX 256

int sidekey_scan_find(const char *dir, int keycode, char *out, size_t out_len,
                      int *matched_count) {
    DIR *d = opendir(dir);
    if (!d) {
        *matched_count = 0;
        return -1;
    }

    static char names[SCAN_MAX][64];
    static char full[SCAN_MAX][160];
    const char *paths[SCAN_MAX];
    int count = 0;

    struct dirent *ent;
    while ((ent = readdir(d)) != NULL && count < SCAN_MAX) {
        const char *nm = ent->d_name;
        if (strncmp(nm, "event", 5) != 0) continue;
        const char *digits = nm + 5;
        if (*digits == '\0') continue;
        int all_digits = 1;
        for (const char *c = digits; *c; c++) {
            if (*c < '0' || *c > '9') { all_digits = 0; break; }
        }
        if (!all_digits) continue;
        strncpy(names[count], nm, sizeof(names[count]) - 1);
        names[count][sizeof(names[count]) - 1] = '\0';
        count++;
    }
    closedir(d);

    if (count == 0) {
        *matched_count = 0;
        return 0;
    }

    /* 按数字升序排序，保证「第一个匹配」在两次运行间稳定 */
    static char *sorted[SCAN_MAX];
    for (int i = 0; i < count; i++) sorted[i] = names[i];
    qsort(sorted, count, sizeof(sorted[0]), cmp_names);

    for (int i = 0; i < count; i++) {
        int w = snprintf(full[i], sizeof(full[i]), "%s/%s", dir, sorted[i]);
        if (w < 0 || (size_t)w >= sizeof(full[i])) {
            *matched_count = 0;
            return -1;
        }
        paths[i] = full[i];
    }
    return sidekey_scan_find_candidates(paths, count, keycode, libevdev_probe, NULL,
                                        out, out_len, matched_count);
}
