package org.pca.app.runtime.prayer

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * PCA-FR-073: the negative/ignore-path half of [PrayerReminderReceiver]'s coverage -- both cases
 * below return before touching any Android resource, so they run fine under this repo's plain
 * `testDebugUnitTest` Robolectric environment (which does not resolve this app's own custom
 * `R.string` resources -- see `androidTest/.../PrayerReminderReceiverTest.kt`'s own doc comment for
 * why the POSITIVE "a real notification is actually posted" case lives there instead, and
 * `PrayerReminderIntentsTest` for the parsing-contract coverage this delegates to).
 */
@RunWith(RobolectricTestRunner::class)
class PrayerReminderReceiverTest {

    @Test
    fun `an intent with the wrong action is ignored -- no notification posted`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val receiver = PrayerReminderReceiver()
        val intent = Intent("some.other.action")

        receiver.onReceive(context, intent)

        val manager = context.getSystemService(NotificationManager::class.java)
        assertFalse(shadowOf(manager).allNotifications.isNotEmpty())
    }

    @Test
    fun `an intent with a missing or unrecognized prayer name extra is ignored`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val receiver = PrayerReminderReceiver()
        val intent = Intent(PrayerReminderIntents.ACTION_PRAYER_REMINDER).apply {
            setPackage(context.packageName)
            putExtra(PrayerReminderIntents.EXTRA_PRAYER_NAME, "NOT_A_REAL_PRAYER")
        }

        receiver.onReceive(context, intent)

        val manager = context.getSystemService(NotificationManager::class.java)
        assertFalse(shadowOf(manager).allNotifications.isNotEmpty())
    }
}
