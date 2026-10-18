package io.github.rczlin.sidekey.island;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 备用通道：Poster 无法以 root 直接发布时，退回到广播给本接收器。
 * ColorOS 会冻结/拦截后台应用，因此这条路径并不可靠，只作兜底。
 * extras：seq、label（String）、code（int）、duration_ms（long）、show（int 秒）、test（boolean）。
 */
public final class IslandReceiver extends BroadcastReceiver {
    static final String ACTION = "io.github.rczlin.sidekey.island.SHOW";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null || !nm.areNotificationsEnabled()) return;
        if (nm.getNotificationChannel(IslandNotification.CHANNEL) == null) {
            nm.createNotificationChannel(IslandNotification.channel(context));
        }
        PosterArgs a = new PosterArgs();
        a.test = intent.getBooleanExtra("test", false);
        a.seq = intent.getStringExtra("seq");
        a.label = intent.getStringExtra("label");
        a.code = intent.getIntExtra("code", 0);
        a.durationMs = Math.max(0, intent.getLongExtra("duration_ms", 0L));
        a.showSeconds = PosterArgs.clampShow(intent.getIntExtra("show", PosterArgs.SHOW_DEFAULT));
        Notification n = IslandNotification.build(context, a);
        nm.notify(IslandNotification.TAG, IslandNotification.ID, n);
    }
}
