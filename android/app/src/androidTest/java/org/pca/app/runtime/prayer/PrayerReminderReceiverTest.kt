package org.pca.app.runtime.prayer

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
import org.pca.app.feature.prayer.displayNameRes
import org.pca.app.feature.prayer.model.PrayerName

/**
 * PCA-FR-073 closure evidence: proves the real, reachable path -- [PrayerReminderReceiver] is
 * manifest-registered (see `AndroidManifest.xml`'s
 * `<receiver android:name=".runtime.prayer.PrayerReminderReceiver">`) and, when it actually
 * receives the exact broadcast [org.pca.app.runtime.graph.PcaAppGraph] sends (via
 * [PrayerReminderIntents]), posts a real, inspectable notification -- not just that the class
 * compiles.
 *
 * Lives in `androidTest` (real device/emulator, `connectedDebugAndroidTest`), not
 * `testDebugUnitTest` -- this repo's plain-JVM Robolectric unit-test environment does not resolve
 * this app's own custom `R.string` resources (`prayer_reminder_notification_*`), crashing with
 * `Resources.NotFoundException` on the first `context.getString(R.string.prayer_reminder_...)`
 * call; enabling `testOptions.unitTests.includeAndroidResources` to fix that repo-wide would also
 * make every Robolectric unit test in this module use the manifest-declared `PcaApplication` as
 * its test application, which crashes on `AndroidKeyStore not found` inside `PcaAppGraph`
 * construction (no real device-backed KeyStore exists on a plain JVM) -- a much larger,
 * cross-cutting change this lane deliberately does not make. `PrayerReminderReceiverTest` in
 * `src/test/` covers the negative/ignore-path cases that never touch a resource; this file covers
 * the one case that needs a real device's real resources.
 */
class PrayerReminderReceiverTest {

    @Test
    fun receivingTheRealPrayerReminderBroadcastPostsARealNotification() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context: Context = instrumentation.targetContext
        requireNotificationCapability(context, instrumentation)

        val prayer = PrayerName.FAJR
        val expectedId = NOTIFICATION_ID_BASE + prayer.ordinal
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.cancel(expectedId)
        val intent = PrayerReminderIntents.build(context, prayer)
            .setClass(context, PrayerReminderReceiver::class.java)

        context.sendBroadcast(intent)

        val notification = awaitNotification(
            context = context,
            expectedId = expectedId,
            expectedChannelId = CHANNEL_ID,
        )
        assertNotNull("expected the prayer notification to be posted", notification)
        assertEquals(
            context.getString(
                R.string.prayer_reminder_notification_title,
                context.getString(prayer.displayNameRes()),
            ),
            notification!!.notification.extras.getString(android.app.Notification.EXTRA_TITLE),
        )
        assertEquals(
            context.getString(R.string.prayer_reminder_notification_body),
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
        const val CHANNEL_ID = "prayer_reminders"
        const val NOTIFICATION_ID_BASE = 6_100
        const val MAX_WAIT_MILLIS = 5_000L
        const val POLL_INTERVAL_MILLIS = 100L
    }
}
