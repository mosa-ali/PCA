package org.pca.app.runtime.prayer

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.pca.app.PcaApplication
import org.pca.app.R
import org.pca.app.feature.prayer.displayNameRes
import org.pca.app.feature.prayer.model.PrayerName
import org.pca.app.persistence.entity.PrayerDeliveryState
import org.pca.app.runtime.identity.DeviceIdentityState

/**
 * PCA-FR-073 closure: [AlarmManagerPrayerScheduler] already correctly schedules an exact
 * `AlarmManager` alarm (`setExactAndAllowWhileIdle`) for every reminder, but until this class
 * existed AND was registered in the manifest, nothing in the app ever received that broadcast --
 * the alarm fired into the void and no notification ever appeared. This is that receiver.
 *
 * Reads the shared [PrayerReminderIntents] contract (action + extra key), which
 * [org.pca.app.runtime.graph.PcaAppGraph.prayerReminderIntent] builds when handing
 * [AlarmManagerPrayerScheduler] its `receiverIntentFactory`. Registered `android:exported="false"`
 * in the manifest with a matching `<intent-filter>` -- the sending `PendingIntent` is always
 * created by this same app (`setPackage(context.packageName)`), so it never needs to be reachable
 * from outside the app.
 *
 * Uses only documented `NotificationCompat`/`NotificationManager` APIs -- no full-screen intent,
 * no overlay window, no `AccessibilityService` (Section 17 documented-mechanisms-only boundary).
 * Deliberately a narrow, standalone implementation rather than reusing
 * [org.pca.app.feature.wellbeing.delivery.WellbeingNotificationDelivery] directly: that class is
 * tightly coupled to wellbeing-specific model types (`WellbeingNudgeDelivery`/`WellbeingSuggestion`)
 * that do not generalize to a prayer reminder, but it is the closest sibling in posture (same
 * `NotificationCompat` + permission-guarded, no-crash-on-denial discipline).
 *
 * `goAsync()` + a background coroutine for the delivery-event write: `onReceive` runs on the main
 * thread and the OS is free to kill the hosting process shortly after it returns, so persisting
 * the [org.pca.app.persistence.repository.PrayerReminderEventRepository] row (a suspend/Room call)
 * happens under `goAsync()`'s extended-lifetime guarantee rather than being fired-and-forgotten.
 * The notification itself is posted synchronously before that, since showing it does not need to
 * wait on Room.
 */
class PrayerReminderReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val prayer = PrayerReminderIntents.parsePrayerOrNull(intent) ?: return

        postNotification(context, prayer)

        val app = context.applicationContext as? PcaApplication ?: return
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            runCatching { recordDelivery(app, prayer) }
            pendingResult.finish()
        }
    }

    /**
     * Mirrors [org.pca.app.feature.wellbeing.delivery.WellbeingNotificationDelivery]'s own
     * fail-safe posture: any missing capability (notifications disabled, POST_NOTIFICATIONS
     * denied on API 33+) degrades to a silent no-op, never a crash.
     */
    private fun postNotification(context: Context, prayer: PrayerName) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        ensureChannel(context, manager)
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return

        val prayerDisplayName = context.getString(prayer.displayNameRes())
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(context.getString(R.string.prayer_reminder_notification_title, prayerDisplayName))
            .setContentText(context.getString(R.string.prayer_reminder_notification_body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        // Inlined permission check (rather than a helper) so Lint's MissingPermission data-flow
        // check recognizes this exact guard as covering the notify() call directly below it --
        // same discipline WellbeingNotificationDelivery.deliver uses for the identical reason.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID_BASE + prayer.ordinal, notification)
        }
    }

    private fun ensureChannel(context: Context, manager: NotificationManager) {
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.prayer_reminder_notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.prayer_reminder_notification_channel_description)
        }
        manager.createNotificationChannel(channel)
    }

    /**
     * Doc 10 Section 4.7 delivery metadata only (see [PrayerReminderEventEntity]'s own doc
     * comment) -- records that this reminder was actually delivered, not any devotional-behavior
     * signal. Silently does nothing if the device has no PCA enrolled identity yet (mirrors
     * [org.pca.app.runtime.usage.UsageSessionRecorder]'s "never fabricate an id" discipline) --
     * the notification above still shows either way, since showing the reminder does not depend on
     * enrollment.
     */
    private suspend fun recordDelivery(app: PcaApplication, prayer: PrayerName) {
        val graph = app.graph
        val deviceId = (graph.deviceIdentityProvider.currentIdentity() as? DeviceIdentityState.Enrolled)?.deviceId ?: return
        val now = graph.wallClockTimeSource.currentTimeMillis()
        graph.persistence.prayerReminderEventRepository.record(
            id = UUID.nameUUIDFromBytes("$deviceId|${prayer.name}|$now".toByteArray(Charsets.UTF_8)).toString(),
            deviceId = deviceId,
            prayerKey = prayer.name,
            scheduledAtEpochMillis = now,
            deliveryState = PrayerDeliveryState.DELIVERED,
        )
    }

    private companion object {
        const val CHANNEL_ID = "prayer_reminders"
        const val NOTIFICATION_ID_BASE = 6_100
    }
}
