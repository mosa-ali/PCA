package org.pca.app.feature.breakshield

import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * PCA-FR-132: this is the safety-critical half of the emergency-call closure -- proves the actual
 * built [Intent] can never place a call automatically. `ACTION_CALL` places a call the instant the
 * Intent resolves (and additionally requires the `CALL_PHONE` permission, which this app does not
 * declare); `ACTION_DIAL` only ever opens the system dialer UI and requires a human tap to
 * actually place a call. Every assertion below is really one adversarial question: "could this
 * Intent, as built, ever result in a call being placed without a human confirming it?" -- and the
 * answer must always be no.
 */
@RunWith(RobolectricTestRunner::class)
class EmergencyDialIntentTest {

    @Test
    fun `the built intent's action is ACTION_DIAL`() {
        val intent = buildEmergencyDialIntent()
        assertEquals(Intent.ACTION_DIAL, intent.action)
    }

    @Test
    fun `the built intent's action is never ACTION_CALL, under any circumstance`() {
        val intent = buildEmergencyDialIntent()
        assertNotEquals(Intent.ACTION_CALL, intent.action)
    }

    @Test
    fun `the built intent carries no phone number -- the child chooses who to call`() {
        val intent = buildEmergencyDialIntent()
        assertNull(intent.data)
    }

    @Test
    fun `isSafeEmergencyDialIntent correctly identifies the real built intent as safe`() {
        assertTrue(isSafeEmergencyDialIntent(buildEmergencyDialIntent()))
    }

    @Test
    fun `isSafeEmergencyDialIntent rejects an ACTION_CALL intent even with the same extras`() {
        val maliciousShape = Intent(Intent.ACTION_CALL).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        assertTrue("sanity: this shape must not equal the real safe intent's action", maliciousShape.action != Intent.ACTION_DIAL)
        assertFalse(isSafeEmergencyDialIntent(maliciousShape))
    }

    @Test
    fun `isSafeEmergencyDialIntent rejects an ACTION_DIAL intent that pre-fills a number`() {
        val intentWithNumber = Intent(Intent.ACTION_DIAL, android.net.Uri.parse("tel:911"))
        assertFalse("a pre-filled number is not the deliberately-blank shape this app builds", isSafeEmergencyDialIntent(intentWithNumber))
    }

    // PCA-FR-132 trusted-contact closure (Writer73): launchEmergencyDialer's own safety
    // guarantees now that it also fires a best-effort EmergencyDialTrustedContactAlert -- the
    // safety boundary this item exists to protect is that the alert step can NEVER prevent,
    // delay-in-a-way-that-matters, or roll back the dial launch.

    private class RecordingAlert : EmergencyDialTrustedContactAlert {
        var callCount = 0
            private set
        var dialAlreadyLaunchedWhenCalled = false
            private set
        private val context: Context = ApplicationProvider.getApplicationContext()

        override fun alert() {
            callCount++
            // peekNextStartedActivity (non-consuming) so this check never steals the Intent the
            // test itself still needs to inspect afterward via the consuming nextStartedActivity.
            dialAlreadyLaunchedWhenCalled = shadowOf(context as android.app.Application).peekNextStartedActivity() != null
        }
    }

    @Test
    fun `launchEmergencyDialer still starts the real ACTION_DIAL intent, unchanged, with the new alert parameter present`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val alert = RecordingAlert()

        launchEmergencyDialer(context, alert)

        val started = shadowOf(context as android.app.Application).nextStartedActivity
        assertEquals(Intent.ACTION_DIAL, started?.action)
        assertNull(started?.data)
    }

    @Test
    fun `launchEmergencyDialer invokes the trusted-contact alert exactly once, strictly after the dial intent has already been started`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val alert = RecordingAlert()

        launchEmergencyDialer(context, alert)

        assertEquals(1, alert.callCount)
        assertTrue("the dial Intent must already be recorded as started by the time alert() runs", alert.dialAlreadyLaunchedWhenCalled)
    }

    @Test
    fun `SAFETY -- a trusted-contact alert that throws never propagates out of launchEmergencyDialer and never undoes the dial launch`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val throwingAlert = EmergencyDialTrustedContactAlert { throw IllegalStateException("simulated notification/sync failure") }

        // Must not throw.
        launchEmergencyDialer(context, throwingAlert)

        val started = shadowOf(context as android.app.Application).nextStartedActivity
        assertEquals("the dial intent must still have been started even though the alert threw", Intent.ACTION_DIAL, started?.action)
    }

    @Test
    fun `RealEmergencyDialTrustedContactAlert#alert never throws even with no PcaApplication wired (plain Robolectric application context)`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        // Sanity: this repo's plain unit-test environment does NOT use PcaApplication as the test
        // application (see PrayerReminderReceiverTest's own doc comment for why) -- so this also
        // proves the safe-cast degrade path in enqueueEmergencyDialChildRequest.
        assertFalse(context.applicationContext is org.pca.app.PcaApplication)

        // Must not throw -- both internal legs (notification delivery, child-request enqueue)
        // degrade silently.
        RealEmergencyDialTrustedContactAlert(context).alert()
    }
}
