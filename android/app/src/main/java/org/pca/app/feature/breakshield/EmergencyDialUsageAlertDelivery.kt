package org.pca.app.feature.breakshield

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.pca.app.R

/**
 * PCA-FR-132 trusted-contact closure (Writer73): real, local delivery of "the emergency dialer was
 * just opened on this device" -- until this class existed, [launchEmergencyDialer] generated no
 * signal of any kind once the dialer launched, silent even to the child holding the device.
 *
 * Mirrors [org.pca.app.platform.UsageAccessAlertNotificationDelivery]'s exact posture (itself
 * mirroring [org.pca.app.runtime.location.geofence.AndroidGeofenceAlertDelivery]): only
 * `NotificationCompat`, permission-guarded before every `notify()` call, degrades to a silent
 * no-op (never a crash, never delays or blocks the dial action that already happened by the time
 * this runs) when notifications are disabled or `POST_NOTIFICATIONS` is denied.
 *
 * This device-local notification is a same-device signal only -- transparency for the child that a
 * record now exists, not itself a substitute for a real parent-web/companion push notification
 * (see [enqueueEmergencyDialChildRequest] for the separate, real, durable cross-device signal this
 * lane adds alongside it, reusing the SAME already-accepted `ChildRequestOfflineQueue`/
 * `FamilySyncRuntimePort` mechanism `ChildHomeScreen`'s "Request Parent Contact" already uses --
 * honestly `PENDING_SYNC_LOCAL` until family sync reports `LIVE`, never a fabricated "delivered"
 * claim).
 */
class EmergencyDialUsageAlertDelivery(private val context: Context) {

    fun ensureChannel() {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.emergency_dial_alert_notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.emergency_dial_alert_notification_channel_description)
        }
        manager.createNotificationChannel(channel)
    }

    /** Returns `true` when a notification was actually posted, `false` on any degraded-capability
     * no-op -- callers (e.g. tests) can assert on this rather than needing to inspect
     * `NotificationManager` state themselves. Never throws. */
    fun deliver(): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        ensureChannel()

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(context.getString(R.string.emergency_dial_alert_title))
            .setContentText(context.getString(R.string.emergency_dial_alert_body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        // Inlined permission check (same discipline as UsageAccessAlertNotificationDelivery.deliver
        // / AndroidGeofenceAlertDelivery.deliver) so Lint's MissingPermission data-flow check
        // recognizes this exact guard as covering the notify() call directly below it.
        return if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
            true
        } else {
            false
        }
    }

    companion object {
        const val CHANNEL_ID = "emergency_dial_usage_alerts"
        const val NOTIFICATION_ID = 6_300
    }
}
