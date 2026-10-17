#ifndef SIDEKEY_CONFIG_H
#define SIDEKEY_CONFIG_H

#include <stddef.h>
#include "sidekey_fsm.h"

#define SIDEKEY_CMD_MAX 512
#define SIDEKEY_CONFIG_MAX_BYTES (64u * 1024u)
#define SIDEKEY_CONFIG_ERR_TOO_LONG (-2)
#define SIDEKEY_CONFIG_ERR_NOMEM (-3)

typedef struct sidekey_binding sidekey_binding_t;

typedef struct {
    int keycode;
    sidekey_fsm_cfg_t fsm;
    size_t n_bindings;
    size_t max_seq_len;
    sidekey_binding_t *bindings;
    int skipped_lines;
} sidekey_config_t;

/* 从内存缓冲区解析。成功返回 0，命令/行过长返回 SIDEKEY_CONFIG_ERR_TOO_LONG，
   其他致命错误返回 -1（如 keycode 无效）。失败保留旧配置。 */
void sidekey_config_init(sidekey_config_t *c);
void sidekey_config_destroy(sidekey_config_t *c);
int sidekey_config_parse(const char *text, sidekey_config_t *out);
const char *sidekey_config_lookup(const sidekey_config_t *c, const char *seq);
int sidekey_config_has_longer(const sidekey_config_t *c, const char *seq, int len);

#endif
