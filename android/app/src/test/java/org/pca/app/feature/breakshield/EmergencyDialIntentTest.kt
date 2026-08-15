package org.pca.app.feature.breakshield

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

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
}
