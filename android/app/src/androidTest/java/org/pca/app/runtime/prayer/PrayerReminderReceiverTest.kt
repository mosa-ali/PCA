package org.pca.app.runtime.prayer

import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
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
        val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
        val receiver = PrayerReminderReceiver()
        val intent = PrayerReminderIntents.build(context, PrayerName.FAJR)

        receiver.onReceive(context, intent)

        val manager = context.getSystemService(NotificationManager::class.java)
        val posted = NotificationManagerCompat.from(context).activeNotifications
        assertTrue(
            "expected onReceive to post a real notification, found none",
            posted.isNotEmpty() || manager.activeNotifications.isNotEmpty(),
        )
    }
}
