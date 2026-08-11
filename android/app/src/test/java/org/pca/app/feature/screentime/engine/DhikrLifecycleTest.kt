package org.pca.app.feature.screentime.engine

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.feature.screentime.persistence.InMemoryUsedAuthorizationStore
import org.pca.app.feature.screentime.persistence.ScreenTimeRestorer
import org.pca.app.feature.screentime.persistence.ScreenTimeSnapshot
import kotlin.time.Duration.Companion.minutes

/**
 * NEW-001: dhikrInteractionCount is scoped strictly to the break session that produced it. It
 * must read zero as soon as that break ends — whether by completing naturally, being skipped by
 * a parent override, or being crossed during restoration — never leaking into ordinary ACTIVE
 * use or a subsequent break.
 */
class DhikrLifecycleTest {

    private val config = ScreenTimeConfig(activeThreshold = 60.minutes, breakDuration = 30.minutes)

    private fun tick(state: ScreenTimeState, nowNanos: Long): ScreenTimeState =
        ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(nowNanos), config)

    private fun dhikr(state: ScreenTimeState, nowNanos: Long): ScreenTimeState =
        ScreenTimeEngine.reduce(state, ScreenTimeEvent.DhikrInteraction(nowNanos), config)

    @Test
    fun `count accumulates during the active break`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        state = dhikr(state, 60.minutes.inWholeNanoseconds)
        state = dhikr(state, 61.minutes.inWholeNanoseconds)
        state = dhikr(state, 62.minutes.inWholeNanoseconds)

        assertEquals(3, state.dhikrInteractionCount)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
    }

    @Test
    fun `break completes naturally, count is zero`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        state = dhikr(state, 60.minutes.inWholeNanoseconds)
        state = dhikr(state, 61.minutes.inWholeNanoseconds)
        assertEquals(2, state.dhikrInteractionCount)

        state = tick(state, 90.minutes.inWholeNanoseconds) // break completes exactly here

        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(0, state.dhikrInteractionCount)
    }

    @Test
    fun `break ended via parent override skip, count is zero`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        state = dhikr(state, 60.minutes.inWholeNanoseconds)
        state = dhikr(state, 65.minutes.inWholeNanoseconds)
        assertEquals(2, state.dhikrInteractionCount)

        val authorization = ParentAuthorization(
            approverId = "parent-1",
            scope = ParentOverrideScope.SKIP_BREAK,
            boundedDuration = kotlin.time.Duration.ZERO,
            issuedAtEpochMillis = 0L,
            expiresAtEpochMillis = 10_000L,
            auditId = "audit-dhikr-skip",
        )
        val result = ParentOverrideEngine.applySkipBreakRequest(
            state,
            SkipBreakRequest(nowNanos = 65.minutes.inWholeNanoseconds, nowWallClockMillis = 1L, authorization = authorization),
            InMemoryUsedAuthorizationStore(),
            config,
        )
        state = (result as ParentOverrideResult.Applied).state

        assertEquals(0, state.dhikrInteractionCount)
    }

    @Test
    fun `residual count does not leak into ordinary ACTIVE use after a break ends`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        state = dhikr(state, 60.minutes.inWholeNanoseconds)
        state = tick(state, 90.minutes.inWholeNanoseconds) // completes

        // Well into the next active streak, still zero — no leak.
        state = tick(state, 100.minutes.inWholeNanoseconds)
        assertEquals(0, state.dhikrInteractionCount)
    }

    @Test
    fun `a fresh break starting from zero also reads zero interactions`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds) // break 1
        state = dhikr(state, 60.minutes.inWholeNanoseconds)
        state = tick(state, 90.minutes.inWholeNanoseconds) // break 1 completes

        state = tick(state, 150.minutes.inWholeNanoseconds) // break 2 begins (another 60 min active)
        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
        assertEquals(0, state.dhikrInteractionCount)
    }

    @Test
    fun `restart mid-break preserves the current break's interaction count`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        state = dhikr(state, 60.minutes.inWholeNanoseconds)
        state = dhikr(state, 65.minutes.inWholeNanoseconds)
        assertEquals(2, state.dhikrInteractionCount)

        val snapshot = ScreenTimeSnapshot(state = state, snapshotWallClockMillis = 1_000L, bootId = "boot-1")
        // Process restarts 5 minutes later, still well inside the 30-minute break.
        val restored = ScreenTimeRestorer.restoreAfterProcessRestart(snapshot, nowNanos = 70.minutes.inWholeNanoseconds, config = config)

        assertEquals(ScreenTimeMode.BREAK_SHIELD, restored.mode)
        assertEquals(2, restored.dhikrInteractionCount)
    }

    @Test
    fun `completion discovered only upon restoration still clears the count`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        state = dhikr(state, 60.minutes.inWholeNanoseconds)
        state = dhikr(state, 61.minutes.inWholeNanoseconds)
        assertEquals(2, state.dhikrInteractionCount)

        val snapshot = ScreenTimeSnapshot(state = state, snapshotWallClockMillis = 1_000L, bootId = "boot-1")
        // Process was dead well past the end of the break (60 + 30 = 90 min mark).
        val restored = ScreenTimeRestorer.restoreAfterProcessRestart(snapshot, nowNanos = 120.minutes.inWholeNanoseconds, config = config)

        assertEquals(ScreenTimeMode.ACTIVE, restored.mode)
        assertEquals(0, restored.dhikrInteractionCount)
    }

    @Test
    fun `reboot restoration preserves the current break's interaction count unchanged`() {
        var state = tick(ScreenTimeState.initial(0L), 60.minutes.inWholeNanoseconds)
        state = dhikr(state, 60.minutes.inWholeNanoseconds)
        assertEquals(1, state.dhikrInteractionCount)

        val snapshot = ScreenTimeSnapshot(state = state, snapshotWallClockMillis = 1_000L, bootId = "boot-1")
        val restored = ScreenTimeRestorer.restoreAfterReboot(snapshot, nowNanos = 3.minutes.inWholeNanoseconds)

        assertEquals(ScreenTimeMode.BREAK_SHIELD, restored.mode)
        assertEquals(1, restored.dhikrInteractionCount)
    }
}
