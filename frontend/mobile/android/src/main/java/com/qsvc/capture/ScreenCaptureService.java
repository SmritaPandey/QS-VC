package com.qsvc.capture;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Binder;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.view.Surface;

/** Owns user-authorized capture independently of the meeting activity. Requires Android 10+. */
public final class ScreenCaptureService extends Service {
    private static final String CHANNEL = "qsvc-screen-capture";
    private static final String STOP = "com.qsvc.capture.STOP";
    private static final int NOTIFICATION_ID = 241;
    private final CaptureBinder binder = new CaptureBinder();
    private MediaProjection projection;
    private VirtualDisplay display;
    private Runnable stopped;

    private MediaProjection.Callback projectionCallback;

    @Override public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) finish(true);
        return START_NOT_STICKY;
    }

    public final class CaptureBinder extends Binder {
        /** Pass a fresh successful system consent result and a caller-owned encoder surface. */
        public void start(int resultCode, Intent consent, Surface surface, int width, int height,
                          int densityDpi, Runnable onStopped) {
            requireMainThread();
            if (projection != null) throw new IllegalStateException("A share is already active");
            if (resultCode != Activity.RESULT_OK || consent == null || !surface.isValid()
                || width <= 0 || height <= 0 || densityDpi <= 0) {
                throw new IllegalArgumentException("Capture requires consent and a valid output surface");
            }

            stopped = onStopped;
            try {
                startService(new Intent(ScreenCaptureService.this, ScreenCaptureService.class));
                startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
                MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
                projection = manager.getMediaProjection(resultCode, consent);
                if (projection == null) throw new IllegalStateException("Screen capture permission is unavailable");
                MediaProjection active = projection;
                projectionCallback = new MediaProjection.Callback() {
                    @Override public void onStop() {
                        if (projection == active) finish(false);
                    }
                };
                projection.registerCallback(projectionCallback, new Handler(Looper.getMainLooper()));
                display = projection.createVirtualDisplay("QS-VC", width, height, densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, null);
                if (display == null) throw new IllegalStateException("Screen capture could not start");
            } catch (RuntimeException error) {
                finish(true);
                throw error;
            }
        }

        public void resize(Surface surface, int width, int height, int densityDpi) {
            requireMainThread();
            if (display == null) throw new IllegalStateException("No active share");
            if (!surface.isValid() || width <= 0 || height <= 0 || densityDpi <= 0) {
                throw new IllegalArgumentException("Resize requires a valid output surface and dimensions");
            }
            display.resize(width, height, densityDpi);
            display.setSurface(surface);
        }

        public void stop() {
            requireMainThread();
            finish(true);
        }
    }

    private static void requireMainThread() {
        if (Looper.myLooper() != Looper.getMainLooper()) throw new IllegalStateException("Use the main thread");
    }

    private Notification notification() {
        getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel(CHANNEL, "QS-VC screen sharing", NotificationManager.IMPORTANCE_LOW));
        Intent stop = new Intent(this, ScreenCaptureService.class).setAction(STOP);
        PendingIntent action = PendingIntent.getService(this, 0, stop, PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setContentTitle("QS-VC is sharing your screen")
            .setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "Stop sharing", action).build())
            .build();
    }

    private void finish(boolean stopProjection) {
        Runnable notify = stopped;
        stopped = null;
        if (display != null) {
            display.release();
            display = null;
        }
        if (projection != null) {
            MediaProjection active = projection;
            projection = null;
            if (projectionCallback != null) active.unregisterCallback(projectionCallback);
            projectionCallback = null;
            if (stopProjection) active.stop();
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
        if (notify != null) notify.run();
    }

    @Override public void onDestroy() {
        finish(true);
        super.onDestroy();
    }
}
