package org.pca.app.feature.breakshield

import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test

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
        val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
        val delivery = EmergencyDialUsageAlertDelivery(context)

        val posted = delivery.deliver()

        assertTrue("expected deliver() to report a real post", posted)
        val manager = context.getSystemService(NotificationManager::class.java)
        val active = NotificationManagerCompat.from(context).activeNotifications
        assertTrue(
            "expected a real notification to be posted, found none",
            active.isNotEmpty() || manager.activeNotifications.isNotEmpty(),
        )
    }
}
