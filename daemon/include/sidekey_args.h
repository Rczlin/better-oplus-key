#ifndef SIDEKEY_ARGS_H
#define SIDEKEY_ARGS_H

#include <stddef.h>

/* 解析命令行，取出 <moddir>。成功返回 0 并把路径写入 dir；
   缺少参数或路径过长（>= dir_len）返回 -1。 */
int sidekey_parse_args(int argc, char **argv, char *dir, size_t dir_len);

#endif
