#ifndef SIDEKEY_FSM_H
#define SIDEKEY_FSM_H

#include <stddef.h>
#include <stdint.h>

typedef struct {
    int long_press_ms;   /* 默认 300 */
    int window_ms;       /* 默认 300 */
} sidekey_fsm_cfg_t;

/* 完成的输入回调（包括未匹配输入）；seq 在回调期间有效，以 NUL 结尾。 */
typedef void (*sidekey_on_seq_fn)(const char *seq, int len, void *ctx);
typedef unsigned (*sidekey_match_fn)(const char *seq, int len, void *ctx);

#define SIDEKEY_MATCH_EXACT 1u
#define SIDEKEY_MATCH_LONGER 2u

#define SIDEKEY_FSM_MAX_SEQ 3

/* 结构体定义在头文件中，便于调用方在栈上分配（计划中的 opaque 指针会导致测试无法编译）。
   字段仅供本模块内部使用，外部代码请通过函数访问。 */
typedef struct {
    uint32_t magic;
    sidekey_fsm_cfg_t cfg;
    sidekey_on_seq_fn cb;
    void *ctx;
    char *seq;
    size_t seq_cap;
    size_t max_seq_len;
    sidekey_match_fn match;
    int len;
    int invalid;
    int pressed;
    long long press_t;
    long long release_t;   /* 上次松开时间，用于窗口期；无松开则 -1 */
} sidekey_fsm_t;

/* 初始化前零初始化，重新初始化前须 destroy；reset 保留匹配器和缓冲区。 */
int sidekey_fsm_init_with_match(sidekey_fsm_t *f, const sidekey_fsm_cfg_t *cfg,
                                size_t max_seq_len, sidekey_match_fn match,
                                sidekey_on_seq_fn cb, void *ctx);
void sidekey_fsm_init(sidekey_fsm_t *f, const sidekey_fsm_cfg_t *cfg,
                      sidekey_on_seq_fn cb, void *ctx);
void sidekey_fsm_reset(sidekey_fsm_t *f);
void sidekey_fsm_destroy(sidekey_fsm_t *f);

/* 键按下/松开事件；t_ms 为单调时钟毫秒。 */
void sidekey_fsm_key(sidekey_fsm_t *f, int pressed, long long t_ms);

/* 周期性调用，检查窗口期是否到期。返回下一次需要唤醒的绝对时间（ms），无则 -1。 */
long long sidekey_fsm_tick(sidekey_fsm_t *f, long long t_ms);

#endif
