#ifndef SIDEKEY_CGROUP_H
#define SIDEKEY_CGROUP_H
#include <stddef.h>

/*
 * 把进程移到各 cgroup 层级的根组。
 * 从 KernelSU 管理器（WebUI）启动时，守护进程会继承管理器应用的 cgroup；
 * ColorOS 17 把后台应用冻结时会连同守护进程一起冻结，按键事件积压到解冻时才一次性处理。
 * 根组不受应用冻结影响。返回成功写入的文件数；路径不存在或不可写时跳过。
 */
extern const char *const SIDEKEY_CGROUP_ROOTS[];
extern const size_t SIDEKEY_CGROUP_ROOTS_COUNT;
int sidekey_cgroup_escape(const char *const *procs_files, size_t n, long pid);

#endif
