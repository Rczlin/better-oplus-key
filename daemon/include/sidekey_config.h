#ifndef SIDEKEY_CONFIG_H
#define SIDEKEY_CONFIG_H

#include "sidekey_fsm.h"

#define SIDEKEY_MAX_BINDINGS 14
#define SIDEKEY_CMD_MAX 512

typedef struct {
    char seq[4];                 /* "0"/"1" 串，长度 1..3 */
    char cmd[SIDEKEY_CMD_MAX];
} sidekey_binding_t;

typedef struct {
    int keycode;                 /* 默认 735 */
    sidekey_fsm_cfg_t fsm;       /* long_press_ms / window_ms */
    int n_bindings;
    sidekey_binding_t bindings[SIDEKEY_MAX_BINDINGS];
    int skipped_lines;           /* 解析失败的行数，用于日志 */
} sidekey_config_t;

/* 从内存缓冲区解析。成功返回 0，致命错误返回 -1（如 keycode 无效）。 */
int sidekey_config_parse(const char *text, sidekey_config_t *out);

#endif
