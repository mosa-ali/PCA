package org.pca.app.feature.wellbeing.engine

import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.wellbeing.model.NudgeRateState
import org.pca.app.feature.wellbeing.model.WellbeingNudgePolicy

class GameReturnAndReflectionTest {

    private val policy = WellbeingNudgePolicy(gameReturnWindow = 3.minutes)

    @Test
    fun `rapid re-entry within the window is detected`() {
        val afterExit = NudgeSelectionEngine.onEligibleAppExit(NudgeRateState(), "game_a", nowNanos = 0L)
        val within = NudgeSelectionEngine.isWithinGameReturnWindow(afterExit, "game_a", nowNanos = 1.minutes.inWholeNanoseconds, policy)
        assertTrue(within)
    }

    @Test
    fun `re-entry after the window has passed is not a game-return`() {
        val afterExit = NudgeSelectionEngine.onEligibleAppExit(NudgeRateState(), "game_a", nowNanos = 0L)
        val within = NudgeSelectionEngine.isWithinGameReturnWindow(afterExit, "game_a", nowNanos = 10.minutes.inWholeNanoseconds, policy)
        assertFalse(within)
    }

    @Test
    fun `re-entry into a different app is not a game-return`() {
        val afterExit = NudgeSelectionEngine.onEligibleAppExit(NudgeRateState(), "game_a", nowNanos = 0L)
        val within = NudgeSelectionEngine.isWithinGameReturnWindow(afterExit, "game_b", nowNanos = 30.seconds.inWholeNanoseconds, policy)
        assertFalse(within)
    }

    @Test
    fun `negative delta (exit appears after now) is never treated as within window`() {
        val afterExit = NudgeSelectionEngine.onEligibleAppExit(NudgeRateState(), "game_a", nowNanos = 10.minutes.inWholeNanoseconds)
        val within = NudgeSelectionEngine.isWithinGameReturnWindow(afterExit, "game_a", nowNanos = 0L, policy)
        assertFalse(within)
    }

    @Test
    fun `reflection prompt fires after repeated rapid re-entry and then cools down`() {
        var state = NudgeRateState()
        var now = 0L
        var shown = false
        repeat(3) {
            val (updated, showNow) = NudgeSelectionEngine.onGameReturnObserved(state, now, policy)
            state = updated
            shown = showNow
            now += 10.seconds.inWholeNanoseconds
        }
        assertTrue("expected reflection prompt after threshold rapid re-entries", shown)
        assertEquals(0, state.rapidReentryCount)

        // Immediately after, further re-entries must not fire it again until the cooldown passes.
        val (afterOneMore, showAgainSoon) = NudgeSelectionEngine.onGameReturnObserved(state, now, policy)
        assertFalse(showAgainSoon)
        state = afterOneMore
    }
}
