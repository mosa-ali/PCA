package org.pca.app.platform

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
 * Transparent, same-device capability alert. It is deliberately not a remote
 * parent-push claim; remote delivery remains behind the authenticated sync
 * boundary. The notification text names the capability and the honest local
 * consequence.
 */
class CapabilityTamperAlertNotificationDelivery(private val context: Context) {
    fun deliver(condition: String): Boolean {
        val copy = when (condition) {
            CONDITION_DEVICE_OWNER_REVOKED ->
                R.string.capability_alert_device_owner_lost_title to R.string.capability_alert_device_owner_lost_body
            CONDITION_DEVICE_POLICY_UNAVAILABLE ->
                R.string.capability_alert_device_policy_unavailable_title to R.string.capability_alert_device_policy_unavailable_body
            CONDITION_VPN_CONSENT_REVOKED ->
                R.string.capability_alert_vpn_revoked_title to R.string.capability_alert_vpn_revoked_body
            CONDITION_VPN_CONNECTION_DEGRADED ->
                R.string.capability_alert_vpn_degraded_title to R.string.capability_alert_vpn_degraded_body
            else -> return false
        }
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.capability_alert_notification_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = context.getString(R.string.capability_alert_notification_channel_description)
            },
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(context.getString(copy.first))
            .setContentText(context.getString(copy.second))
            .setAutoCancel(true)
            .build()
        return if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            manager.notify(NOTIFICATION_ID, notification)
            true
        } else {
            false
        }
    }

    companion object {
        private const val CONDITION_DEVICE_OWNER_REVOKED = "DEVICE_OWNER_AUTHORITY_LOST"
        private const val CONDITION_DEVICE_POLICY_UNAVAILABLE = "DEVICE_POLICY_UNAVAILABLE"
        private const val CONDITION_VPN_CONSENT_REVOKED = "VPN_CONSENT_REVOKED"
        private const val CONDITION_VPN_CONNECTION_DEGRADED = "VPN_CONNECTION_DEGRADED"
        private const val CHANNEL_ID = "capability_tamper_alerts"
        private const val NOTIFICATION_ID = 6_201
    }
}
