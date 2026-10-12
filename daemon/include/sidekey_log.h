#ifndef SIDEKEY_LOG_H
#define SIDEKEY_LOG_H

#include <stddef.h>

/* 格式化一条普通日志行：「<时间> <LEVEL> <message>\n」。 */
void sidekey_log_format_line(char *out, size_t out_len, const char *ts,
                             const char *level, const char *message);

/* 格式化一条序列解释行：「<时间> INFO seq=<s> action=<a> result=<r>\n」。
   action 为 NULL 时写 none；result < 0 时写 dropped，否则写退出码。 */
void sidekey_log_format_seq(char *out, size_t out_len, const char *ts,
                            const char *seq, const char *action, int result);

/* 追加一段文本到 path。若追加后超过 limit 字节，则只保留后半部分（截尾），
   使文件大小不超过 limit。成功返回 0，失败返回 -1。仅用 C 标准 I/O，不调用 shell。 */
int sidekey_log_append(const char *path, const char *text, long limit);

#endif
