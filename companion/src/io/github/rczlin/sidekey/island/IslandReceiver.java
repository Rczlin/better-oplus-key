package io.github.rczlin.sidekey.island;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Bundle;

/**
 * 接收守护进程的执行结果广播，发出 Android 16 promoted ongoing 通知；ColorOS 16 将其显示在流体云中。
 * extras：seq（String）、label（String）、code（int）、duration_ms（long）、test（boolean）。
 */
public final class IslandReceiver extends BroadcastReceiver {
    static final String ACTION = "io.github.rczlin.sidekey.island.SHOW";
    static final String CHANNEL = "sidekey_result";
    static final int NOTIFICATION_ID = 1;
    static final long TIMEOUT_MS = 4000;
    /** API 36.1 的 Notification.EXTRA_REQUEST_PROMOTED_ONGOING；按 API 36 编译时直接写入同名 extra。 */
    static final String EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing";
    static final int COLOR_OK = 0xFF2E9D5B;
    static final int COLOR_FAIL = 0xFFD93A3A;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) return;
        ensureChannel(context, nm);

        boolean test = intent.getBooleanExtra("test", false);
        String seq = intent.getStringExtra("seq");
        String label = intent.getStringExtra("label");
        int code = intent.getIntExtra("code", 0);
        long duration = intent.getLongExtra("duration_ms", 0L);

        boolean ok = code == 0;
        int color = ok ? COLOR_OK : COLOR_FAIL;
        String title = test ? context.getString(R.string.test_title)
                : PressNames.name(seq) + " · " + PressNames.status(code);
        String body = test ? context.getString(R.string.test_body) : PressNames.body(label, duration);
        String chip = test ? "✓ 测试" : PressNames.chip(seq, code);

        Notification.ProgressStyle style = new Notification.ProgressStyle()
                .addProgressSegment(new Notification.ProgressStyle.Segment(100).setColor(color))
                .setProgress(100)
                .setProgressTrackerIcon(Icon.createWithResource(context, R.drawable.ic_sidekey));

        Bundle extras = new Bundle();
        extras.putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true);

        Notification n = new Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_sidekey)
                .setContentTitle(title)
                .setContentText(body)
                .setShortCriticalText(chip)
                .setStyle(style)
                .setColor(color)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_STATUS)
                .setShowWhen(true)
                .setTimeoutAfter(TIMEOUT_MS)
                .addExtras(extras)
                .build();
        nm.notify(NOTIFICATION_ID, n);
    }

    private static void ensureChannel(Context context, NotificationManager nm) {
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL,
                context.getString(R.string.channel_name), NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(context.getString(R.string.channel_description));
        ch.setShowBadge(false);
        ch.setSound(null, null);
        ch.enableVibration(false);
        nm.createNotificationChannel(ch);
    }
}
