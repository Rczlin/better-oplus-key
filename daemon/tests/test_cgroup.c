#include "sidekey_cgroup.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int failures;
#define CHECK(x) do { if (!(x)) { fprintf(stderr, "%s:%d CHECK(%s)\n", __FILE__, __LINE__, #x); failures++; } } while (0)

static void read_file(const char *path, char *out, size_t n) {
    FILE *f = fopen(path, "r"); out[0] = 0;
    if (!f) return;
    size_t r = fread(out, 1, n - 1, f); out[r] = 0; fclose(f);
}

int main(void) {
    char dir[] = "/tmp/sidekey-cgroup-XXXXXX";
    CHECK(mkdtemp(dir) != NULL);
    char a[256], b[256], missing[256], buf[64];
    snprintf(a, sizeof(a), "%s/a.procs", dir);
    snprintf(b, sizeof(b), "%s/b.procs", dir);
    snprintf(missing, sizeof(missing), "%s/nope/cgroup.procs", dir);
    FILE *f = fopen(a, "w"); fclose(f);
    f = fopen(b, "w"); fclose(f);

    /* 写入存在的文件，跳过不存在的路径 */
    const char *paths[] = {a, missing, b};
    CHECK(sidekey_cgroup_escape(paths, 3, 4321) == 2);
    read_file(a, buf, sizeof(buf)); CHECK(strcmp(buf, "4321\n") == 0);
    read_file(b, buf, sizeof(buf)); CHECK(strcmp(buf, "4321\n") == 0);

    /* 非法 pid 不写任何文件 */
    CHECK(sidekey_cgroup_escape(paths, 3, 0) == 0);
    CHECK(sidekey_cgroup_escape(paths, 0, 1) == 0);
    CHECK(SIDEKEY_CGROUP_ROOTS_COUNT >= 2);
    CHECK(strcmp(SIDEKEY_CGROUP_ROOTS[0], "/sys/fs/cgroup/cgroup.procs") == 0);

    unlink(a); unlink(b); rmdir(dir);
    if (failures) return 1;
    puts("cgroup ok");
    return 0;
}
