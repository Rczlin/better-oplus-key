#ifndef SIDEKEY_SCAN_H
#define SIDEKEY_SCAN_H

#include <stddef.h>

/* 探测函数：path 节点是否声明 keycode。返回 1 匹配，0 不匹配，-1 出错。 */
typedef int (*sidekey_probe_fn)(const char *path, int keycode, void *ctx);

/* 纯逻辑：在候选路径列表中找第一个匹配的节点。
   匹配数写入 *matched_count。找到返回 1，未找到返回 0，输出缓冲区不足或探测出错返回 -1。 */
int sidekey_scan_find_candidates(const char *const *paths, int n, int keycode,
                                 sidekey_probe_fn probe, void *ctx,
                                 char *out, size_t out_len, int *matched_count);

/* 扫描 dir（如 "/dev/input"）下名为 event<数字> 的节点，按数字升序，
   用 libevdev 探测。返回值与 sidekey_scan_find_candidates 相同。 */
int sidekey_scan_find(const char *dir, int keycode, char *out, size_t out_len,
                      int *matched_count);

#endif
