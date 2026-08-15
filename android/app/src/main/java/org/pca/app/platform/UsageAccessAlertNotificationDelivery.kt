package org.pca.app.platform

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
 * PCA-FR-081 closure: real, local delivery of the "parent is informed when usage-access is lost or
 * degraded" notification. Until this class existed, [UsageAccessStateTracker] was purely a
 * translation layer (its own doc comment: "makes NO policy decision about what PCA-4 should DO in
 * response to any state") with no confirmed caller that ever turned a REVOKED/DEGRADED state into
 * anything user-visible -- the only wired notification delivery mechanism anywhere in the app
 * belonged to the unrelated wellbeing feature
 * ([org.pca.app.feature.wellbeing.delivery.WellbeingNotificationDelivery]).
 *
 * A narrowly-scoped, standalone class rather than reusing [WellbeingNotificationDelivery] directly
 * -- that class is tightly coupled to wellbeing-specific model types
 * (`WellbeingNudgeDelivery`/`WellbeingSuggestion`/`NudgeDeliveryResult`) that do not generalize to
 * a platform-level access-state alert, but this class deliberately mirrors its exact posture: only
 * `NotificationCompat`, permission-guarded before every `notify()` call, degrades to a silent
 * no-op (never a crash) when notifications are disabled or POST_NOTIFICATIONS is denied.
 *
 * This device-local notification is a same-device signal only (it fires on the child's own device,
 * the one place local evidence of usage-access loss actually exists) -- it is NOT a substitute for
 * a real parent-web/companion-app push notification, which would require the crypto-gated sync
 * path this lane does not touch (see [org.pca.app.runtime.tamper.UsageAccessDegradationMonitor]'s
 * own doc comment for the same boundary).
 */
class UsageAccessAlertNotificationDelivery(private val context: Context) {

    fun ensureChannel() {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.usage_access_alert_notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.usage_access_alert_notification_channel_description)
        }
        manager.createNotificationChannel(channel)
    }

    /** Returns `true` when a notification was actually posted, `false` on any degraded-capability
     * no-op -- callers (e.g. tests) can assert on this rather than needing to inspect
     * `NotificationManager` state themselves. */
    fun deliver(state: TrackedUsageAccessState): Boolean {
        if (state != TrackedUsageAccessState.REVOKED && state != TrackedUsageAccessState.DEGRADED) return false
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        ensureChannel()

        val (titleRes, bodyRes) = if (state == TrackedUsageAccessState.REVOKED) {
            R.string.usage_access_alert_revoked_title to R.string.usage_access_alert_revoked_body
        } else {
            R.string.usage_access_alert_degraded_title to R.string.usage_access_alert_degraded_body
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(context.getString(titleRes))
            .setContentText(context.getString(bodyRes))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        // Inlined permission check (same discipline as WellbeingNotificationDelivery.deliver /
        // PrayerReminderReceiver.postNotification) so Lint's MissingPermission data-flow check
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
        const val CHANNEL_ID = "usage_access_alerts"
        const val NOTIFICATION_ID = 6_200
    }
}
