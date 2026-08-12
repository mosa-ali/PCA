package org.pca.app.runtime.wellbeing

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue
import org.pca.app.feature.wellbeing.engine.WellbeingTriggerDispatcher
import org.pca.app.feature.wellbeing.model.NudgeDeliveryStatus
import org.pca.app.feature.wellbeing.model.NudgeRateState
import org.pca.app.feature.wellbeing.model.NudgeTrigger
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy
import org.pca.app.feature.wellbeing.ports.BreakStateSource
import org.pca.app.feature.wellbeing.ports.EligibleAppSignalSource
import org.pca.app.feature.wellbeing.ports.NotificationCapabilitySource
import org.pca.app.feature.wellbeing.ports.ScreenLockStateSource
import org.pca.app.feature.wellbeing.ports.SuppressionContextSource
import org.pca.app.feature.wellbeing.ports.WallClockCalendarSource
import org.pca.app.foundation.MonotonicTimeSource
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.runtime.schedule.AppScope
import org.pca.app.runtime.schedule.Connectivity
import org.pca.app.runtime.schedule.EnforcementCapabilityState
import org.pca.app.runtime.schedule.InMemorySchedulePolicyStore
import org.pca.app.runtime.schedule.ScheduleRuntime
import org.pca.app.runtime.schedule.SchedulePolicySnapshot
import org.pca.app.runtime.schedule.SchedulePolicyV1
import org.pca.app.runtime.schedule.ScheduleWindow
import org.pca.app.runtime.schedule.ScheduleWindowKind
import org.pca.app.runtime.schedule.TimeOfDay

/**
 * Coordinator verification (mission section 15's WELL-3 hard gate): proves, with the REAL
 * production classes -- [ScheduleRuntime], [RuntimeWellbeingScheduleContextSource],
 * [WellbeingTriggerDispatcher] -- that a schedule-accepted BEDTIME window suppresses a wellbeing
 * nudge through the exact same seam [org.pca.app.runtime.graph.PcaAppGraph] wires in production,
 * never a duplicate/independent bedtime concept. Only the seven ports orthogonal to WELL-3 itself
 * (call state, screen lock, etc.) are stubbed here; the schedule<->wellbeing seam under test uses
 * no test double.
 */
class RealWell3ClosureIntegrationTest {

    private class FixedMonotonicTimeSource(private val nanos: Long) : MonotonicTimeSource {
        override fun elapsedRealtimeMillis(): Long = nanos / 1_000_000
        override fun elapsedRealtimeNanos(): Long = nanos
    }

    private class OrthogonalPorts :
        EligibleAppSignalSource, ScreenLockStateSource, NotificationCapabilitySource, SuppressionContextSource,
        BreakStateSource, WallClockCalendarSource {
        override fun currentEligibleAppToken() = "game_a"
        override fun isScreenLocked() = false
        override fun notificationsEnabled() = true
        override fun lockScreenNotificationsAvailable() = true
        override fun isEmergencyActive() = false
        override fun isCallActive() = false
        override fun isNavigationOrSafetyContextActive() = false
        override fun isSchoolModeActive() = false
        override fun isCriticalWarningActive() = false
        override fun isDegradedOrErrorFlow() = false
        override fun isBreakShieldActive() = false
        override fun minuteOfDay() = 720
    }

    private fun bedtimePolicy(nowUtc: Instant) = SchedulePolicyV1(
        policyId = "policy-well3",
        policyRevision = 1,
        familyId = "family-well3",
        childProfileId = "child-well3",
        timezone = "UTC",
        windows = listOf(
            ScheduleWindow(
                id = "bedtime-window",
                kind = ScheduleWindowKind.BEDTIME,
                daysOfWeek = (0..6).toList(),
                start = TimeOfDay(0, 0),
                end = TimeOfDay(23, 59),
                appScope = AppScope.All,
                timezone = "UTC",
            ),
        ),
        bonusGrants = emptyList(),
        parentExceptions = emptyList(),
        dailyLimits = emptyList(),
        trustSetEpoch = 1,
        keyEpoch = 1,
        issuedAt = nowUtc.minusSeconds(3600),
        effectiveFrom = nowUtc.minusSeconds(3600),
        expiresAt = null,
    )

    private fun dispatcherFor(scheduleRuntime: ScheduleRuntime, wallClockTimeSource: WallClockTimeSource): WellbeingTriggerDispatcher {
        val ports = OrthogonalPorts()
        return WellbeingTriggerDispatcher(
            monotonicTimeSource = FixedMonotonicTimeSource(0L),
            eligibleAppSignalSource = ports,
            screenLockStateSource = ports,
            notificationCapabilitySource = ports,
            suppressionContextSource = ports,
            breakStateSource = ports,
            wallClockCalendarSource = ports,
            scheduleContextSource = RuntimeWellbeingScheduleContextSource(scheduleRuntime, wallClockTimeSource),
        )
    }

    @Test
    fun `a real accepted BEDTIME schedule policy suppresses a wellbeing nudge via the real production dispatcher path`() {
        val nowUtc = Instant.parse("2026-08-12T12:00:00Z")
        val store = InMemorySchedulePolicyStore()
        val policy = bedtimePolicy(nowUtc)
        store.save(
            SchedulePolicySnapshot(
                candidatePolicy = policy,
                lastKnownGoodPolicy = policy,
                lastPolicySyncAtUtc = nowUtc,
                deviceTrustSetEpoch = 1,
                deviceKeyEpoch = 1,
            ),
        )
        val scheduleRuntime = ScheduleRuntime(store)

        // Sanity: the schedule side itself genuinely reports bedtime active for this policy/time.
        assertEquals(true, scheduleRuntime.isPcaBedtimeActive(nowUtc))

        val wallClockTimeSource = object : WallClockTimeSource {
            override fun currentTimeMillis() = nowUtc.toEpochMilli()
        }
        val dispatcher = dispatcherFor(scheduleRuntime, wallClockTimeSource)

        val (selection, _) = dispatcher.dispatch(
            NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE,
            WellbeingNudgePolicy(),
            NudgeRateState(),
            WellbeingContentCatalogue.entries,
        )

        assertEquals(NudgeDeliveryStatus.SUPPRESSED_PCA_BEDTIME, selection.status)
    }

    @Test
    fun `the same schedule seam does not suppress for bedtime once no BEDTIME window is accepted`() {
        val nowUtc = Instant.parse("2026-08-12T12:00:00Z")
        val store = InMemorySchedulePolicyStore()
        val noBedtimePolicy = bedtimePolicy(nowUtc).copy(windows = emptyList())
        store.save(
            SchedulePolicySnapshot(
                candidatePolicy = noBedtimePolicy,
                lastKnownGoodPolicy = noBedtimePolicy,
                lastPolicySyncAtUtc = nowUtc,
                deviceTrustSetEpoch = 1,
                deviceKeyEpoch = 1,
            ),
        )
        val scheduleRuntime = ScheduleRuntime(store)
        assertEquals(false, scheduleRuntime.isPcaBedtimeActive(nowUtc))

        val wallClockTimeSource = object : WallClockTimeSource {
            override fun currentTimeMillis() = nowUtc.toEpochMilli()
        }
        val dispatcher = dispatcherFor(scheduleRuntime, wallClockTimeSource)

        val (selection, _) = dispatcher.dispatch(
            NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE,
            WellbeingNudgePolicy(),
            NudgeRateState(),
            WellbeingContentCatalogue.entries,
        )

        assertNotEquals(NudgeDeliveryStatus.SUPPRESSED_PCA_BEDTIME, selection.status)
    }
}
