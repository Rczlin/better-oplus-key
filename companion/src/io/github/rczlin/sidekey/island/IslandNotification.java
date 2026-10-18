package io.github.rczlin.sidekey.island;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Bundle;

/** 构造流体云（Android 16 Live Updates / promoted ongoing）通知，Poster 与 IslandReceiver 共用。 */
public final class IslandNotification {
    private IslandNotification() {}

    /** 低重要性渠道（静音）：只进流体云胶囊与通知栏，不弹横幅遮挡屏幕顶部。 */
    static final String CHANNEL = "sidekey_island";
    /** 0.5.0/0.5.1 使用的高重要性渠道（会弹横幅），发布时尝试删除。 */
    static final String LEGACY_CHANNEL = "sidekey_result";
    static final String TAG = "sidekey";
    static final int ID = 1;
    /** API 36.1 的 Notification.EXTRA_REQUEST_PROMOTED_ONGOING；按 API 36 编译时直接写入同名 extra。 */
    static final String EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing";
    /** Notification.FLAG_PROMOTED_ONGOING（API 36）。 */
    static final int FLAG_PROMOTED_ONGOING = 0x00040000;
    static final int COLOR_OK = 0xFF2E9D5B;
    static final int COLOR_FAIL = 0xFFD93A3A;

    static NotificationChannel channel(Context context) {
        NotificationChannel ch = new NotificationChannel(CHANNEL,
                context.getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW);
        ch.setDescription(context.getString(R.string.channel_description));
        ch.setShowBadge(false);
        ch.setSound(null, null);
        ch.enableVibration(false);
        return ch;
    }

    /**
     * 两套晋升规则互斥：Android 16 初版（无 ui_rich_ongoing）要求 setColorized(true)，
     * QPR1 起（ColorOS 16 流体云沿用的 Live Updates 规范）要求不得着色。
     * 先按新规范构造，若本机判定不可晋升，再换着色版本；由系统自己的 hasPromotableCharacteristics 决定。
     */
    static Notification build(Context context, PosterArgs a) {
        Notification n = build(context, a, false);
        if (n.hasPromotableCharacteristics()) return n;
        Notification colorized = build(context, a, true);
        return colorized.hasPromotableCharacteristics() ? colorized : n;
    }

    static Notification build(Context context, PosterArgs a, boolean colorized) {
        boolean ok = a.test || a.code == 0;
        int color = ok ? COLOR_OK : COLOR_FAIL;
        String title = a.test ? context.getString(R.string.test_title)
                : PressNames.name(a.seq) + " · " + PressNames.status(a.code);
        String body = a.test ? context.getString(R.string.test_body) : PressNames.body(a.label, a.durationMs);
        String chip = a.test ? "✓ 测试" : PressNames.chip(a.seq, a.code);

        // 结果已经确定，不用进度条（满格进度条与末端图标展开后很难看）；BigTextStyle 同样可晋升为实况通知。
        Notification.BigTextStyle style = new Notification.BigTextStyle().bigText(body);

        Bundle extras = new Bundle();
        extras.putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true);

        return new Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_sidekey)
                .setContentTitle(title)
                .setContentText(body)
                .setShortCriticalText(chip)
                .setStyle(style)
                .setColor(color)
                .setColorized(colorized)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_STATUS)
                .setShowWhen(false)
                .setTimeoutAfter(a.showMs())
                .addExtras(extras)
                .build();
    }
}
