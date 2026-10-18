#ifndef SIDEKEY_NOTIFY_H
#define SIDEKEY_NOTIFY_H

#include <stddef.h>

/* 流体云提示：命令结束后以 root 运行 app_process，加载伴生 APK 中的 Poster，
   由它直接向 NotificationManagerService 代伴生应用发布 Android 16 promoted ongoing 通知。
   不依赖伴生应用进程被广播唤醒（ColorOS 会冻结后台应用，广播只有第一次送达）。 */
#define SIDEKEY_NOTIFY_PACKAGE "io.github.rczlin.sidekey.island"
#define SIDEKEY_NOTIFY_MAIN SIDEKEY_NOTIFY_PACKAGE ".Poster"
#define SIDEKEY_NOTIFY_APK_REL "/companion/island.apk"
#define SIDEKEY_NOTIFY_APK_MAX 1024
#define SIDEKEY_NOTIFY_SHOW_MIN 2
#define SIDEKEY_NOTIFY_SHOW_MAX 15

#define SIDEKEY_NOTIFY_OFF 0
#define SIDEKEY_NOTIFY_ALL 1
#define SIDEKEY_NOTIFY_FAILURES 2

/* 动作摘要最多保留的命令字节数（回退到完整 UTF-8 字符），截断时追加 “…”。 */
#define SIDEKEY_NOTIFY_LABEL_BYTES 96
#define SIDEKEY_NOTIFY_LABEL_CAP (SIDEKEY_NOTIFY_LABEL_BYTES + 3 + 1)
#define SIDEKEY_NOTIFY_SEQ_MAX 32
#define SIDEKEY_NOTIFY_ARGC_MAX 24

typedef struct {
    char seq[SIDEKEY_NOTIFY_SEQ_MAX + 1];
    char label[SIDEKEY_NOTIFY_LABEL_CAP];
    char code[16];
    char duration[24];
    char show[8];
    char classpath[sizeof("-Djava.class.path=") + SIDEKEY_NOTIFY_APK_MAX];
    char *argv[SIDEKEY_NOTIFY_ARGC_MAX];   /* 以 NULL 结尾，直接交给 execv，不经过 shell */
} sidekey_notify_msg_t;

/* mode 为 island_notify 取值；code 为退出码（被信号终止为 -3）。 */
int sidekey_notify_wanted(int mode, int code);

/* 生成动作摘要，返回写入的字节数（不含 NUL）。多行脚本包装显示为 “多行脚本”。 */
size_t sidekey_notify_label(const char *cmd, char *out, size_t cap);

/* 填充 app_process 参数。apk 为伴生 APK 的绝对路径；show_seconds 限制在 2–15。
   成功返回 0；参数无效或路径过长返回 -1。 */
int sidekey_notify_prepare(sidekey_notify_msg_t *m, const char *apk, const char *seq, const char *cmd,
                           int code, long long duration_ms, int show_seconds);

#endif
