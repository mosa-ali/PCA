package org.pca.app.feature.wellbeing.engine

import kotlin.time.Duration.Companion.minutes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue
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
import org.pca.app.feature.wellbeing.ports.WellbeingScheduleContextSource
import org.pca.app.foundation.MonotonicTimeSource

private class FakeMonotonicTimeSource(var nowNanos: Long) : MonotonicTimeSource {
    override fun elapsedRealtimeMillis(): Long = nowNanos / 1_000_000
    override fun elapsedRealtimeNanos(): Long = nowNanos
}

private class FakePorts :
    EligibleAppSignalSource, ScreenLockStateSource, NotificationCapabilitySource, SuppressionContextSource,
    BreakStateSource, WallClockCalendarSource, WellbeingScheduleContextSource {
    var appToken: String? = "game_a"
    var locked = false
    var notifications = true
    var lockScreenNotifications = true
    var emergency = false
    var call = false
    var nav = false
    var school = false
    var criticalWarning = false
    var degraded = false
    var breakActive = false
    var minute = 720
    var pcaBedtimeActive = false
    var scheduledQuietContext = false

    override fun currentEligibleAppToken() = appToken
    override fun isScreenLocked() = locked
    override fun notificationsEnabled() = notifications
    override fun lockScreenNotificationsAvailable() = lockScreenNotifications
    override fun isEmergencyActive() = emergency
    override fun isCallActive() = call
    override fun isNavigationOrSafetyContextActive() = nav
    override fun isSchoolModeActive() = school
    override fun isCriticalWarningActive() = criticalWarning
    override fun isDegradedOrErrorFlow() = degraded
    override fun isBreakShieldActive() = breakActive
    override fun minuteOfDay() = minute
    override fun isPcaBedtimeActive() = pcaBedtimeActive
    override fun isScheduledQuietContext() = scheduledQuietContext
}

class WellbeingTriggerDispatcherTest {

    private fun dispatcher(clock: FakeMonotonicTimeSource, ports: FakePorts) = WellbeingTriggerDispatcher(
        clock, ports, ports, ports, ports, ports, ports, ports,
    )

    @Test
    fun `dispatch delivers a suggestion for a periodic trigger under default policy`() {
        val d = dispatcher(FakeMonotonicTimeSource(0L), FakePorts())
        val (selection, _) = d.dispatch(
            NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE,
            WellbeingNudgePolicy(),
            NudgeRateState(),
            WellbeingContentCatalogue.entries,
        )
        assertEquals(NudgeDeliveryStatus.DELIVERED, selection.status)
    }

    @Test
    fun `dispatch suppresses during an active call regardless of trigger`() {
        val ports = FakePorts().apply { call = true }
        val d = dispatcher(FakeMonotonicTimeSource(0L), ports)
        val (selection, _) = d.dispatch(
            NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE,
            WellbeingNudgePolicy(),
            NudgeRateState(),
            WellbeingContentCatalogue.entries,
        )
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_CALL_ACTIVE, selection.status)
    }

    @Test
    fun `handleAppForegrounded detects a rapid game return and offers a nudge`() {
        val clock = FakeMonotonicTimeSource(0L)
        val ports = FakePorts()
        val d = dispatcher(clock, ports)

        var rateState = NudgeSelectionEngine.onEligibleAppExit(NudgeRateState(), "game_a", clock.nowNanos)
        clock.nowNanos = 1.minutes.inWholeNanoseconds

        val outcome = d.handleAppForegrounded("game_a", WellbeingNudgePolicy(gameReturnWindow = 3.minutes), rateState, WellbeingContentCatalogue.entries)
        assertNotNull(outcome.selection)
        assertEquals(NudgeDeliveryStatus.DELIVERED, outcome.selection!!.status)
    }

    @Test
    fun `handleAppForegrounded outside the window yields no selection`() {
        val clock = FakeMonotonicTimeSource(0L)
        val ports = FakePorts()
        val d = dispatcher(clock, ports)

        var rateState = NudgeSelectionEngine.onEligibleAppExit(NudgeRateState(), "game_a", clock.nowNanos)
        clock.nowNanos = 30.minutes.inWholeNanoseconds

        val outcome = d.handleAppForegrounded("game_a", WellbeingNudgePolicy(gameReturnWindow = 3.minutes), rateState, WellbeingContentCatalogue.entries)
        assertNull(outcome.selection)
    }

    @Test
    fun `handleAppForegrounded respects eligibleApps -- non-configured app yields a suppressed (not delivered) selection`() {
        val clock = FakeMonotonicTimeSource(0L)
        val ports = FakePorts().apply { appToken = "game_a" }
        val d = dispatcher(clock, ports)

        var rateState = NudgeSelectionEngine.onEligibleAppExit(NudgeRateState(), "game_a", clock.nowNanos)
        clock.nowNanos = 1.minutes.inWholeNanoseconds

        val policy = WellbeingNudgePolicy(gameReturnWindow = 3.minutes, eligibleApps = setOf("some_other_app"))
        val outcome = d.handleAppForegrounded("game_a", policy, rateState, WellbeingContentCatalogue.entries)
        assertNotNull(outcome.selection)
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_APP_NOT_ELIGIBLE, outcome.selection!!.status)
    }

    @Test
    fun `handleAppForegrounded respects eligibleApps -- configured app still delivers`() {
        val clock = FakeMonotonicTimeSource(0L)
        val ports = FakePorts().apply { appToken = "game_a" }
        val d = dispatcher(clock, ports)

        var rateState = NudgeSelectionEngine.onEligibleAppExit(NudgeRateState(), "game_a", clock.nowNanos)
        clock.nowNanos = 1.minutes.inWholeNanoseconds

        val policy = WellbeingNudgePolicy(gameReturnWindow = 3.minutes, eligibleApps = setOf("game_a"))
        val outcome = d.handleAppForegrounded("game_a", policy, rateState, WellbeingContentCatalogue.entries)
        assertNotNull(outcome.selection)
        assertEquals(NudgeDeliveryStatus.DELIVERED, outcome.selection!!.status)
    }

    @Test
    fun `dispatch suppresses when PCA bedtime is active, via the schedule port`() {
        val ports = FakePorts().apply { pcaBedtimeActive = true }
        val d = dispatcher(FakeMonotonicTimeSource(0L), ports)
        val (selection, _) = d.dispatch(
            NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE,
            WellbeingNudgePolicy(),
            NudgeRateState(),
            WellbeingContentCatalogue.entries,
        )
        assertEquals(NudgeDeliveryStatus.SUPPRESSED_PCA_BEDTIME, selection.status)
    }

    @Test
    fun `dispatch is unaffected by the default no-op schedule adapter (bedtime false by default)`() {
        val d = dispatcher(FakeMonotonicTimeSource(0L), FakePorts())
        val (selection, _) = d.dispatch(
            NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE,
            WellbeingNudgePolicy(),
            NudgeRateState(),
            WellbeingContentCatalogue.entries,
        )
        assertEquals(NudgeDeliveryStatus.DELIVERED, selection.status)
    }

    @Test
    fun `dispatcher omitting the schedule source constructor param falls back to the no-op adapter`() {
        val clock = FakeMonotonicTimeSource(0L)
        val ports = FakePorts()
        // Deliberately construct with only the original six ports (no scheduleContextSource) --
        // this must still compile and behave exactly as before WELL-3 (default = no-op, never
        // suppresses on its own).
        val d = WellbeingTriggerDispatcher(clock, ports, ports, ports, ports, ports, ports)
        val (selection, _) = d.dispatch(
            NudgeTrigger.PERIODIC_HIGH_ENGAGEMENT_USE,
            WellbeingNudgePolicy(),
            NudgeRateState(),
            WellbeingContentCatalogue.entries,
        )
        assertEquals(NudgeDeliveryStatus.DELIVERED, selection.status)
    }
}
