package org.pca.app.feature.wellbeing.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.feature.wellbeing.model.NudgeRateState

class WellbeingRebootGuardTest {

    @Test
    fun `same boot generation (process restart) preserves monotonic state untouched`() {
        val state = NudgeRateState(
            lastNudgeMonotonicNanos = 500L,
            lastEligibleExitMonotonicNanos = 400L,
            dailyNudgeCount = 3,
            lastBootGenerationToken = "boot-1",
        )
        val reconciled = WellbeingRebootGuard.reconcile(state, nowMonotonicNanos = 600L, currentBootId = "boot-1")
        assertEquals(500L, reconciled.lastNudgeMonotonicNanos)
        assertEquals(400L, reconciled.lastEligibleExitMonotonicNanos)
        assertEquals(3, reconciled.dailyNudgeCount)
    }

    @Test
    fun `current boot id unknown fails safe to the reboot-conservative path, never assumed same-boot`() {
        // PCA-RUNTIME-2R1: an unavailable currentBootId is NOT evidence of a same-boot restart --
        // it must take the same conservative reconciliation path as a confirmed reboot.
        val state = NudgeRateState(
            lastNudgeMonotonicNanos = 999_999_999_999L,
            lastEligibleExitMonotonicNanos = 999_999_999_999L,
            dailyNudgeCount = 4,
            lastBootGenerationToken = "boot-1",
        )
        val reconciled = WellbeingRebootGuard.reconcile(state, nowMonotonicNanos = 10L, currentBootId = null)

        assertEquals(10L, reconciled.lastNudgeMonotonicNanos)
        assertNull(reconciled.lastEligibleExitMonotonicNanos)
        assertEquals(4, reconciled.dailyNudgeCount)
        assertNull(reconciled.lastBootGenerationToken)
    }

    @Test
    fun `first run with no prior boot token is a no-op other than stamping the token`() {
        val state = NudgeRateState(lastNudgeMonotonicNanos = 500L)
        val reconciled = WellbeingRebootGuard.reconcile(state, nowMonotonicNanos = 600L, currentBootId = "boot-1")
        assertEquals(500L, reconciled.lastNudgeMonotonicNanos)
        assertEquals("boot-1", reconciled.lastBootGenerationToken)
    }

    @Test
    fun `reboot detected clears stale monotonic instants and preserves the daily count conservatively`() {
        val state = NudgeRateState(
            lastNudgeMonotonicNanos = 999_999_999_999L,
            lastEligibleExitMonotonicNanos = 999_999_999_999L,
            lastScreenLockMonotonicNanos = 999_999_999_999L,
            lastUnlockMonotonicNanos = 999_999_999_999L,
            dailyNudgeCount = 4,
            lastBootGenerationToken = "boot-1",
        )
        val reconciled = WellbeingRebootGuard.reconcile(state, nowMonotonicNanos = 10L, currentBootId = "boot-2")

        // Re-anchored to "now" so the ordinary minimum interval still applies (anti-flood), never
        // dropped outright (which would allow an immediate nudge).
        assertEquals(10L, reconciled.lastNudgeMonotonicNanos)
        assertEquals(10L, reconciled.dayWindowAnchorMonotonicNanos)
        assertNull(reconciled.lastEligibleExitMonotonicNanos)
        assertNull(reconciled.lastScreenLockMonotonicNanos)
        assertNull(reconciled.lastUnlockMonotonicNanos)
        // No fabricated elapsed time, no reset-to-zero flood risk: prior count is preserved.
        assertEquals(4, reconciled.dailyNudgeCount)
        assertEquals("boot-2", reconciled.lastBootGenerationToken)
    }

    @Test
    fun `no missed-nudge flood -- reconciled state immediately rate-limits the very next evaluation`() {
        val state = NudgeRateState(lastNudgeMonotonicNanos = 999_999_999_999L, lastBootGenerationToken = "boot-1")
        val reconciled = WellbeingRebootGuard.reconcile(state, nowMonotonicNanos = 0L, currentBootId = "boot-2")

        val policy = org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy(minimumInterval = kotlin.time.Duration.parse("PT20M"))
        val ctx = org.pca.app.feature.wellbeing.model.NudgeTriggerContext(
            trigger = org.pca.app.feature.wellbeing.model.NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE,
            nowMonotonicNanos = 0L,
            eligibleAppToken = "a",
            isScreenLocked = false,
            isEmergencyActive = false,
            isCallActive = false,
            isNavigationOrSafetyContextActive = false,
            isSchoolModeActive = false,
            isCriticalWarningActive = false,
            isDegradedOrErrorFlow = false,
            isBreakShieldActive = false,
            minuteOfDayForQuietHoursOnly = 720,
            notificationsCapable = true,
            lockScreenNotificationsCapable = true,
        )
        val (selection, _) = NudgeSelectionEngine.evaluate(
            policy,
            ctx,
            reconciled,
            org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue.entries,
        )
        assertEquals(org.pca.app.feature.wellbeing.model.NudgeDeliveryStatus.SUPPRESSED_RATE_LIMIT, selection.status)
    }
}
