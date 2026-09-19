package org.pca.app.feature.breakshield

import android.Manifest
import android.app.NotificationManager
import android.app.Instrumentation
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.R

/**
 * PCA-FR-132 trusted-contact closure evidence (Writer73): proves [EmergencyDialUsageAlertDelivery]
 * actually posts a real, inspectable notification with real resource-backed text on a real device
 * -- not just that the class compiles. Lives in `androidTest` (real device/emulator,
 * `connectedDebugAndroidTest`), not `testDebugUnitTest`, for the same reason
 * `PrayerReminderReceiverTest` does: this repo's plain-JVM Robolectric unit-test environment does
 * not resolve this app's own custom `R.string` resources
 * (`emergency_dial_alert_title`/`emergency_dial_alert_body`), crashing with
 * `Resources.NotFoundException` on the first `context.getString(...)` call. The negative/
 * degraded-capability case (notifications disabled) lives in `src/test/`'s sibling file, which
 * never touches a resource.
 */
class EmergencyDialUsageAlertDeliveryTest {

    @Test
    fun deliverPostsARealNotificationWithRealText() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context: Context = instrumentation.targetContext
        requireNotificationCapability(context, instrumentation)

        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(EmergencyDialUsageAlertDelivery.NOTIFICATION_ID)
        val delivery = EmergencyDialUsageAlertDelivery(context)
        delivery.ensureChannel()

        val posted = delivery.deliver()

        assertTrue("expected deliver() to report a real post", posted)
        val notification = awaitNotification(
            context = context,
            expectedId = EmergencyDialUsageAlertDelivery.NOTIFICATION_ID,
            expectedChannelId = EmergencyDialUsageAlertDelivery.CHANNEL_ID,
        )
        assertNotNull("expected the emergency notification to be posted", notification)
        assertEquals(
            context.getString(R.string.emergency_dial_alert_title),
            notification!!.notification.extras.getString(android.app.Notification.EXTRA_TITLE),
        )
        assertEquals(
            context.getString(R.string.emergency_dial_alert_body),
            notification.notification.extras.getString(android.app.Notification.EXTRA_TEXT),
        )
    }

    private fun requireNotificationCapability(context: Context, instrumentation: Instrumentation) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            try {
                val command = "pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}"
                ParcelFileDescriptor.AutoCloseInputStream(
                    instrumentation.uiAutomation.executeShellCommand(command),
                ).use { it.readBytes() }
            } catch (error: Exception) {
                throw AssertionError("could not grant POST_NOTIFICATIONS for the positive test", error)
            }
        }

        assertTrue(
            "POST_NOTIFICATIONS must be granted before asserting notification delivery",
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) == PackageManager.PERMISSION_GRANTED,
        )
        assertTrue(
            "notifications must be enabled before asserting notification delivery",
            NotificationManagerCompat.from(context).areNotificationsEnabled(),
        )
    }

    private fun awaitNotification(
        context: Context,
        expectedId: Int,
        expectedChannelId: String,
    ): StatusBarNotification? {
        val deadline = SystemClock.uptimeMillis() + MAX_WAIT_MILLIS
        while (SystemClock.uptimeMillis() < deadline) {
            val notification = NotificationManagerCompat.from(context).activeNotifications
                .firstOrNull {
                    it.id == expectedId && it.notification.channelId == expectedChannelId
                }
            if (notification != null) return notification
            SystemClock.sleep(POLL_INTERVAL_MILLIS)
        }
        return NotificationManagerCompat.from(context).activeNotifications.firstOrNull {
            it.id == expectedId && it.notification.channelId == expectedChannelId
        }
    }

    private companion object {
        const val MAX_WAIT_MILLIS = 5_000L
        const val POLL_INTERVAL_MILLIS = 100L
    }
}
