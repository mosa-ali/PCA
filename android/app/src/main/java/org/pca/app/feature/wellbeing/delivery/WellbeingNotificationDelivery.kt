package org.pca.app.feature.wellbeing.delivery

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.pca.app.feature.wellbeing.model.NudgeDeliveryResult
import org.pca.app.feature.wellbeing.model.NudgeDeliveryStatus
import org.pca.app.feature.wellbeing.model.WellbeingNudgeDelivery
import org.pca.app.feature.wellbeing.model.WellbeingSuggestion

/**
 * Android delivery adapter for [WellbeingNudgeDelivery.STANDARD_NOTIFICATION] and
 * [WellbeingNudgeDelivery.LOCK_SCREEN_NOTIFICATION_BEST_EFFORT] (PCA-WELL-012/013). Uses only
 * `NotificationCompat` -- no full-screen intent, no overlay window, no Accessibility Service, no
 * `DevicePolicyManager` (doc 35's Android lock-screen boundary). Lock-screen visibility is always
 * `BEST_EFFORT`: the OS, not this class, decides whether a secure lock screen actually renders it.
 *
 * Public (lock-screen-visible) content is always the fixed generic/redacted string -- never the
 * eligible app's name, category, or any family-identifying detail (PCA-WELL-013, PCA-WELL-027).
 * Full suggestion text is only attached to the private notification, shown post-unlock.
 */
class WellbeingNotificationDelivery(
    private val context: Context,
    private val resolver: WellbeingMessageResolver,
) {
    fun ensureChannel() {
        // Notification channels exist on every supported API level (minSdk 26 == O), so no
        // version gate is needed here.
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(org.pca.app.R.string.wellbeing_notification_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = context.getString(org.pca.app.R.string.wellbeing_notification_channel_description)
        }
        manager.createNotificationChannel(channel)
    }

    fun deliver(
        delivery: WellbeingNudgeDelivery,
        suggestions: List<WellbeingSuggestion>,
        nowMonotonicNanos: Long,
        notificationId: Int = STANDARD_NOTIFICATION_ID,
    ): NudgeDeliveryResult {
        if (delivery != WellbeingNudgeDelivery.STANDARD_NOTIFICATION &&
            delivery != WellbeingNudgeDelivery.LOCK_SCREEN_NOTIFICATION_BEST_EFFORT
        ) {
            return NudgeDeliveryResult(
                NudgeDeliveryStatus.SUPPRESSED_CAPABILITY_UNAVAILABLE,
                delivery,
                nowMonotonicNanos,
                suggestions.map { it.suggestionId },
            )
        }
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled() || !hasPostNotificationsPermission()) {
            // Degrades gracefully (PCA-WELL-014-style capability degradation): on API 33+ the
            // POST_NOTIFICATIONS runtime permission may be denied, or the manifest entry this
            // feature needs may not (yet) be registered by the Coordinator -- either way this is
            // a no-crash, no-op capability-unavailable result, never a fabricated success.
            return NudgeDeliveryResult(
                NudgeDeliveryStatus.SUPPRESSED_CAPABILITY_UNAVAILABLE,
                delivery,
                nowMonotonicNanos,
                suggestions.map { it.suggestionId },
            )
        }
        ensureChannel()

        val fullText = suggestions.joinToString(" · ") { resolver.resolve(it) }
        val publicVersion = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(context.getString(org.pca.app.R.string.wellbeing_notification_generic_title))
            .setContentText(context.getString(org.pca.app.R.string.wellbeing_notification_generic_body))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(context.getString(org.pca.app.R.string.wellbeing_notification_generic_title))
            .setContentText(fullText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(fullText))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setAutoCancel(true)
            .build()

        // Inlined (rather than routed through a helper) so Lint's MissingPermission data-flow
        // check recognizes this exact ContextCompat.checkSelfPermission guard as covering the
        // notify() call directly below it.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            NotificationManagerCompat.from(context).notify(notificationId, notification)
        } else {
            return NudgeDeliveryResult(
                NudgeDeliveryStatus.SUPPRESSED_CAPABILITY_UNAVAILABLE,
                delivery,
                nowMonotonicNanos,
                suggestions.map { it.suggestionId },
            )
        }

        return NudgeDeliveryResult(
            NudgeDeliveryStatus.DELIVERED,
            delivery,
            nowMonotonicNanos,
            suggestions.map { it.suggestionId },
        )
    }

    /** On API < 33 no runtime permission is required for ordinary notifications, so this is
     * vacuously true. On API 33+, POST_NOTIFICATIONS must be both declared (Coordinator manifest
     * wiring -- see the PCA-WELL-1 final report's integration queue) and granted at runtime. */
    private fun hasPostNotificationsPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    companion object {
        const val CHANNEL_ID = "wellbeing_suggestions"
        const val STANDARD_NOTIFICATION_ID = 5001
    }
}
