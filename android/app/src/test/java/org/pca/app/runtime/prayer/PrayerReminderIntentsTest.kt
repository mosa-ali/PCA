package org.pca.app.runtime.prayer

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.feature.prayer.model.PrayerName
import org.robolectric.RobolectricTestRunner

/**
 * PCA-FR-073: pure parsing-contract coverage for [PrayerReminderIntents], the single source of
 * truth both [org.pca.app.runtime.graph.PcaAppGraph] (sender) and [PrayerReminderReceiver]
 * (receiver) depend on. Deliberately does not touch `Context`/notifications/resources -- see
 * `androidTest/.../PrayerReminderReceiverTest.kt` for the full, device-backed, real-notification
 * end-to-end path (this repo's `testDebugUnitTest` Robolectric environment does not resolve this
 * app's own `R.string` resources -- see that file's own doc comment for why).
 */
@RunWith(RobolectricTestRunner::class)
class PrayerReminderIntentsTest {

    @Test
    fun `build then parse round-trips every real prayer`() {
        val context = org.robolectric.RuntimeEnvironment.getApplication()
        for (prayer in PrayerName.entries) {
            val intent = PrayerReminderIntents.build(context, prayer)
            assertEquals(prayer, PrayerReminderIntents.parsePrayerOrNull(intent))
        }
    }

    @Test
    fun `an intent with a different action is not parsed`() {
        val intent = Intent("some.other.action").putExtra(PrayerReminderIntents.EXTRA_PRAYER_NAME, PrayerName.FAJR.name)
        assertNull(PrayerReminderIntents.parsePrayerOrNull(intent))
    }

    @Test
    fun `an intent with a missing extra is not parsed`() {
        val intent = Intent(PrayerReminderIntents.ACTION_PRAYER_REMINDER)
        assertNull(PrayerReminderIntents.parsePrayerOrNull(intent))
    }

    @Test
    fun `an intent with an unrecognized prayer name is not parsed`() {
        val intent = Intent(PrayerReminderIntents.ACTION_PRAYER_REMINDER)
            .putExtra(PrayerReminderIntents.EXTRA_PRAYER_NAME, "NOT_A_REAL_PRAYER")
        assertNull(PrayerReminderIntents.parsePrayerOrNull(intent))
    }
}
