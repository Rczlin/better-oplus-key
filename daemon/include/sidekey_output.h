#ifndef SIDEKEY_OUTPUT_H
#define SIDEKEY_OUTPUT_H

#include <stddef.h>

/* 每次命令执行最多保留的输出字节数；超出部分读出后丢弃并标记 truncated。 */
#define SIDEKEY_OUTPUT_CAP 4096

typedef struct {
    char data[SIDEKEY_OUTPUT_CAP];
    size_t len;
    int truncated;
} sidekey_output_buf_t;

/* 追加 n 字节；超过容量时丢弃多余部分，置 truncated 并把末尾回退到完整 UTF-8 字符边界。 */
void sidekey_output_append(sidekey_output_buf_t *b, const char *src, size_t n);

/* 返回不含残缺尾部 UTF-8 序列的长度（只检查末尾，最多回退 3 字节）。 */
size_t sidekey_output_utf8_trim(const char *s, size_t len);

/* 生成一行 output.jsonl 记录（以 \n 结尾），调用方 free。失败返回 NULL。
   字符串按 JSON 转义：引号、反斜杠与控制字符；合法 UTF-8 原样保留，非法字节替换为 \ufffd。 */
char *sidekey_output_format_record(const char *time, long long wall_ms, const char *seq,
                                   const char *action, int code, long long duration_ms,
                                   int truncated, const char *out, size_t out_len);

#endif
