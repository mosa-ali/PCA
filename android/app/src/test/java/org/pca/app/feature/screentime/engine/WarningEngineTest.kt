package org.pca.app.feature.screentime.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.screentime.persistence.InMemoryUsedAuthorizationStore
import kotlin.time.Duration.Companion.minutes

class WarningEngineTest {

    private val config = ScreenTimeConfig(
        activeThreshold = 60.minutes,
        breakDuration = 30.minutes,
        warningThresholds = listOf(10.minutes, 5.minutes, 1.minutes),
    )

    private fun tick(state: ScreenTimeState, nowNanos: Long): ScreenTimeState =
        ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(nowNanos), config)

    @Test
    fun `no warnings are crossed with plenty of time remaining`() {
        val state = tick(ScreenTimeState.initial(0L), 30.minutes.inWholeNanoseconds)
        assertTrue(WarningEngine.crossedThresholds(state, config).isEmpty())
    }

    @Test
    fun `crossing the 10-minute threshold surfaces exactly that warning as newly fired`() {
        val before = tick(ScreenTimeState.initial(0L), 49.minutes.inWholeNanoseconds) // 11 min remaining
        val after = tick(before, 50.minutes.inWholeNanoseconds) // 10 min remaining, exactly at threshold

        val newly = WarningEngine.newlyCrossedThresholds(before, after, config)
        assertEquals(setOf(10.minutes), newly)
    }

    @Test
    fun `crossing multiple thresholds in one jump reports all of them as newly fired`() {
        val before = tick(ScreenTimeState.initial(0L), 45.minutes.inWholeNanoseconds) // 15 min remaining
        val after = tick(before, 59.minutes.inWholeNanoseconds) // 1 min remaining

        val newly = WarningEngine.newlyCrossedThresholds(before, after, config)
        assertEquals(setOf(10.minutes, 5.minutes, 1.minutes), newly)
    }

    @Test
    fun `replaying the same instant does not re-fire an already-crossed warning`() {
        val afterFirstCross = tick(ScreenTimeState.initial(0L), 50.minutes.inWholeNanoseconds)
        val duplicate = tick(afterFirstCross, 50.minutes.inWholeNanoseconds)

        assertTrue(WarningEngine.newlyCrossedThresholds(afterFirstCross, duplicate, config).isEmpty())
    }

    @Test
    fun `warnings do not affect the underlying streak accounting`() {
        val before = tick(ScreenTimeState.initial(0L), 45.minutes.inWholeNanoseconds)
        WarningEngine.crossedThresholds(before, config)
        WarningEngine.crossedThresholds(before, config)

        assertEquals(45.minutes.inWholeNanoseconds, before.activeElapsedNanos)
    }

    @Test
    fun `no warnings are reported once BREAK_SHIELD starts`() {
        val state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
        assertTrue(WarningEngine.crossedThresholds(state, config).isEmpty())
    }

    @Test
    fun `a parent time grant can un-fire a warning so it can trigger again later`() {
        var state = tick(ScreenTimeState.initial(0L), 55.minutes.inWholeNanoseconds) // 5 min remaining
        assertEquals(setOf(10.minutes, 5.minutes), WarningEngine.crossedThresholds(state, config))

        val authorization = ParentAuthorization(
            approverId = "parent-1",
            scope = ParentOverrideScope.GRANT_TIME,
            boundedDuration = 30.minutes,
            issuedAtEpochMillis = 0L,
            expiresAtEpochMillis = 10_000L,
            auditId = "audit-1",
        )
        val result = ParentOverrideEngine.applyGrantTimeRequest(
            state,
            GrantTimeRequest(nowNanos = 55.minutes.inWholeNanoseconds, nowWallClockMillis = 1L, authorization = authorization, extra = 20.minutes),
            InMemoryUsedAuthorizationStore(),
            config,
        )
        state = (result as ParentOverrideResult.Applied).state

        // 25 minutes now remain; neither threshold should still read as crossed.
        assertTrue(WarningEngine.crossedThresholds(state, config).isEmpty())
    }
}
