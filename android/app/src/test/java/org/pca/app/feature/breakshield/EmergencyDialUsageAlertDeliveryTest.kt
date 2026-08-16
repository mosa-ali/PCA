package org.pca.app.feature.breakshield

import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * PCA-FR-132 trusted-contact closure (Writer73): the negative/degraded-capability half of
 * [EmergencyDialUsageAlertDelivery]'s coverage -- this case returns before touching any custom
 * `R.string` resource, so it runs fine under this repo's plain `testDebugUnitTest` Robolectric
 * environment (which does not resolve this app's own custom resources -- see
 * `androidTest/.../PrayerReminderReceiverTest.kt`'s own doc comment for the same repo-wide
 * constraint). The POSITIVE "a real notification is actually posted with real text" case lives in
 * `androidTest/.../EmergencyDialUsageAlertDeliveryTest.kt` instead, for the same reason.
 */
@RunWith(RobolectricTestRunner::class)
class EmergencyDialUsageAlertDeliveryTest {

    @Test
    fun `deliver returns false and posts nothing when notifications are disabled -- never throws`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val manager = context.getSystemService(NotificationManager::class.java)
        shadowOf(manager).setNotificationsEnabled(false)

        val delivery = EmergencyDialUsageAlertDelivery(context)
        val posted = delivery.deliver()

        assertFalse(posted)
        assertFalse(shadowOf(manager).allNotifications.isNotEmpty())
    }
}
