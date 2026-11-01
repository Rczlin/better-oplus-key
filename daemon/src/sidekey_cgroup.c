#include "sidekey_cgroup.h"
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>

const char *const SIDEKEY_CGROUP_ROOTS[] = {
    "/sys/fs/cgroup/cgroup.procs",          /* cgroup v2（含 freezer v2） */
    "/sys/fs/cgroup/freezer/cgroup.procs",  /* cgroup v1 freezer */
    "/dev/freezer/cgroup.procs",
    "/dev/cpuset/cgroup.procs",             /* 不被限制到后台小核 */
};
const size_t SIDEKEY_CGROUP_ROOTS_COUNT = sizeof(SIDEKEY_CGROUP_ROOTS) / sizeof(SIDEKEY_CGROUP_ROOTS[0]);

int sidekey_cgroup_escape(const char *const *procs_files, size_t n, long pid) {
    char buf[32];
    int len = snprintf(buf, sizeof(buf), "%ld\n", pid);
    if (len <= 0 || (size_t)len >= sizeof(buf) || pid <= 0) return 0;
    int moved = 0;
    for (size_t i = 0; i < n; i++) {
        int fd = open(procs_files[i], O_WRONLY | O_CLOEXEC);
        if (fd < 0) continue;
        if (write(fd, buf, (size_t)len) == len) moved++;
        close(fd);
    }
    return moved;
}
