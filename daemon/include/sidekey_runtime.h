#ifndef SIDEKEY_RUNTIME_H
#define SIDEKEY_RUNTIME_H

#include <stddef.h>
#include "sidekey_config.h"

/* 按序列查找绑定命令。未绑定返回 NULL。返回的指针指向 c 内部，生命周期与 c 相同。 */
const char *sidekey_runtime_lookup(const sidekey_config_t *c, const char *seq);

/* 返回当前序列的匹配状态：完整绑定和/或仍有更长前缀。 */
unsigned sidekey_runtime_match(const char *seq, int len, void *ctx);

/* 格式化一条 events.jsonl 记录（含结尾换行）。
   edge 为 "down" 或 "up"；code 为键码。 */
void sidekey_runtime_event_line(char *out, size_t out_len, long long wall_ms,
                                long long mono_ms, const char *edge, int code);

#endif
