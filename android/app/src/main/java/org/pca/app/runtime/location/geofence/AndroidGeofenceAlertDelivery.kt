package org.pca.app.runtime.location.geofence

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
 * Real Android notification adapter for [GeofenceEvent] (PCA-FR-063). Same discipline as
 * [org.pca.app.feature.wellbeing.delivery.WellbeingNotificationDelivery]: `NotificationCompat`
 * only, no full-screen intent/overlay/Accessibility Service, and every failure mode (channel
 * missing, notifications disabled, POST_NOTIFICATIONS not granted on API 33+) degrades to a silent
 * no-op rather than crashing the caller -- a missed local alert is a real product gap, but never
 * one this class fabricates a fake "delivered" result for.
 */
class AndroidGeofenceAlertDelivery(private val context: Context) : GeofenceAlertPort {

    fun ensureChannel() {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.geofence_notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.geofence_notification_channel_description)
        }
        manager.createNotificationChannel(channel)
    }

    override fun deliver(event: GeofenceEvent) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled() || !hasPostNotificationsPermission()) {
            return
        }
        ensureChannel()

        val (titleRes, bodyRes) = when (event.transitionType) {
            GeofenceTransitionType.ENTRY -> R.string.geofence_alert_entry_title to R.string.geofence_alert_entry_body
            GeofenceTransitionType.EXIT -> R.string.geofence_alert_exit_title to R.string.geofence_alert_exit_body
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(context.getString(titleRes, event.zoneLabel))
            .setContentText(context.getString(bodyRes, event.zoneLabel))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        // Inlined (not a helper call) so Lint's MissingPermission data-flow check recognizes this
        // exact ContextCompat.checkSelfPermission guard as covering the notify() call below it --
        // same pattern WellbeingNotificationDelivery.deliver uses.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            NotificationManagerCompat.from(context).notify(notificationIdFor(event), notification)
        }
    }

    /** Stable per-zone-per-direction ID so a fresh entry/exit notification replaces a stale one
     * for the same zone+direction rather than piling up duplicates, while entry and exit for the
     * same zone (and different zones) never collide. */
    private fun notificationIdFor(event: GeofenceEvent): Int {
        val directionBit = if (event.transitionType == GeofenceTransitionType.ENTRY) 0 else 1
        return BASE_NOTIFICATION_ID + (event.zoneId.hashCode() and 0x3FFFFFFF) * 2 + directionBit
    }

    private fun hasPostNotificationsPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    companion object {
        const val CHANNEL_ID = "geofence_zone_alerts"
        const val BASE_NOTIFICATION_ID = 6000
    }
}
