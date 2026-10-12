#ifndef SIDEKEY_FSM_H
#define SIDEKEY_FSM_H

#include <stddef.h>

typedef struct {
    int long_press_ms;   /* 默认 300 */
    int window_ms;       /* 默认 300 */
} sidekey_fsm_cfg_t;

/* 完成的序列回调：seq 为 "0"/"1" 串（长度 1..3），不以 NUL 结尾。 */
typedef void (*sidekey_on_seq_fn)(const char *seq, int len, void *ctx);

#define SIDEKEY_FSM_MAX_SEQ 3

/* 结构体定义在头文件中，便于调用方在栈上分配（计划中的 opaque 指针会导致测试无法编译）。
   字段仅供本模块内部使用，外部代码请通过函数访问。 */
typedef struct {
    sidekey_fsm_cfg_t cfg;
    sidekey_on_seq_fn cb;
    void *ctx;
    char seq[SIDEKEY_FSM_MAX_SEQ + 1];
    int len;
    int pressed;
    long long press_t;
    long long release_t;   /* 上次松开时间，用于窗口期；无松开则 -1 */
} sidekey_fsm_t;

void sidekey_fsm_init(sidekey_fsm_t *f, const sidekey_fsm_cfg_t *cfg,
                      sidekey_on_seq_fn cb, void *ctx);

/* 键按下/松开事件；t_ms 为单调时钟毫秒。 */
void sidekey_fsm_key(sidekey_fsm_t *f, int pressed, long long t_ms);

/* 周期性调用，检查窗口期是否到期。返回下一次需要唤醒的绝对时间（ms），无则 -1。 */
long long sidekey_fsm_tick(sidekey_fsm_t *f, long long t_ms);

#endif
