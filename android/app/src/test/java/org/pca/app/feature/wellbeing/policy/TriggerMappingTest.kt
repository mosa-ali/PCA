package org.pca.app.feature.wellbeing.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.wellbeing.model.NudgeTrigger

class TriggerMappingTest {

    @Test
    fun `every SdkWellbeingTrigger maps to exactly one Android trigger`() {
        for (sdk in SdkWellbeingTrigger.entries) {
            val android = TriggerMapping.toAndroid(sdk)
            assertTrue(android in NudgeTrigger.entries)
        }
    }

    @Test
    fun `the 7 unambiguous triggers map by direct meaning`() {
        assertEquals(NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE, TriggerMapping.toAndroid(SdkWellbeingTrigger.PERIODIC))
        assertEquals(NudgeTrigger.AFTER_SCREEN_UNLOCK, TriggerMapping.toAndroid(SdkWellbeingTrigger.AFTER_UNLOCK))
        assertEquals(NudgeTrigger.IMMEDIATE_APP_RETURN, TriggerMapping.toAndroid(SdkWellbeingTrigger.RAPID_GAME_RETURN))
        assertEquals(NudgeTrigger.BREAK_STARTED, TriggerMapping.toAndroid(SdkWellbeingTrigger.BREAK_STARTED))
        assertEquals(NudgeTrigger.BREAK_COMPLETED, TriggerMapping.toAndroid(SdkWellbeingTrigger.BREAK_COMPLETED))
        assertEquals(NudgeTrigger.LONG_SESSION_ENDED, TriggerMapping.toAndroid(SdkWellbeingTrigger.LONG_SESSION_ENDED))
        assertEquals(NudgeTrigger.CHILD_REQUESTED_IDEA, TriggerMapping.toAndroid(SdkWellbeingTrigger.CHILD_REQUESTED_IDEA))
    }

    @Test
    fun `SCHEDULED_TIME maps to PARENT_SCHEDULED`() {
        assertEquals(NudgeTrigger.PARENT_SCHEDULED, TriggerMapping.toAndroid(SdkWellbeingTrigger.SCHEDULED_TIME))
        assertEquals(SdkWellbeingTrigger.SCHEDULED_TIME, TriggerMapping.toSdkOrNull(NudgeTrigger.PARENT_SCHEDULED))
    }

    @Test
    fun `BREAK_ACTIVE has no Android trigger equivalent and lossily maps to BREAK_STARTED`() {
        assertEquals(NudgeTrigger.BREAK_STARTED, TriggerMapping.toAndroid(SdkWellbeingTrigger.BREAK_ACTIVE))
    }

    @Test
    fun `SCREEN_LOCKED_BEST_EFFORT has no SDK trigger equivalent`() {
        assertNull(TriggerMapping.toSdkOrNull(NudgeTrigger.SCREEN_LOCKED_BEST_EFFORT))
    }

    @Test
    fun `a message declaring only BREAK_ACTIVE is still eligible on Android BREAK_STARTED dispatch`() {
        assertTrue(TriggerMapping.coversAndroidTrigger(setOf(SdkWellbeingTrigger.BREAK_ACTIVE), NudgeTrigger.BREAK_STARTED))
    }

    @Test
    fun `a message declaring only BREAK_ACTIVE is never eligible on Android BREAK_COMPLETED dispatch`() {
        assertFalse(TriggerMapping.coversAndroidTrigger(setOf(SdkWellbeingTrigger.BREAK_ACTIVE), NudgeTrigger.BREAK_COMPLETED))
    }

    @Test
    fun `no message ever covers SCREEN_LOCKED_BEST_EFFORT dispatch`() {
        for (sdk in SdkWellbeingTrigger.entries) {
            assertFalse(TriggerMapping.coversAndroidTrigger(setOf(sdk), NudgeTrigger.SCREEN_LOCKED_BEST_EFFORT))
        }
    }
}
