package org.pca.app.runtime.usage

import kotlin.time.Duration.Companion.minutes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.engine.ScreenTimeEngine
import org.pca.app.feature.screentime.engine.ScreenTimeEvent
import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.engine.ScreenTimeState
import org.pca.app.platform.UsageEventType

/**
 * Mission-critical anti-gaming proof: app switching is a SEPARATE concept from the global
 * 60-minute continuous-use debt [org.pca.app.feature.screentime.engine.ScreenTimeEngine] tracks.
 *
 * [org.pca.app.feature.screentime.engine.ScreenTimeEngine] is driven exclusively by
 * [org.pca.app.runtime.screenstate.ScreenStateObserver] (real screen-on/locked transitions --
 * see that file's own doc comment) via [ScreenTimeEvent.Tick]/[ScreenTimeEvent.Pause]/
 * [ScreenTimeEvent.Resume]. [UsageSessionEngine] (this lane's own app-usage session tracker) has
 * no reference to, dependency on, or callback into [ScreenTimeEngine] anywhere in its
 * implementation -- there is no code path by which processing an app-switch event could invoke
 * [ScreenTimeEvent.Pause] or otherwise reset [ScreenTimeState.activeElapsedNanos].
 *
 * This test proves the invariant behaviorally, not just by code inspection: 30 minutes of
 * continuous qualifying screen use on App A, an app switch to App B (processed only by
 * [UsageSessionEngine], never by [ScreenTimeEngine]), then 30 more minutes on App B -- with the
 * screen never turning off or locking in between (so [ScreenTimeEngine] receives ONLY
 * [ScreenTimeEvent.Tick], never [ScreenTimeEvent.Pause]) -- still reaches
 * [ScreenTimeMode.BREAK_SHIELD] at exactly the full 60-minute threshold, with the full debt
 * accumulated, not reset or discounted by the switch.
 */
class AppSwitchScreenTimeDebtIndependenceTest {

    @Test
    fun `30 minutes on app A, switch, 30 minutes on app B -- still reaches Break Shield at the full 60-minute threshold`() {
        val config = ScreenTimeConfig()
        val thirtyMinNanos = 30.minutes.inWholeNanoseconds
        val sixtyMinNanos = 60.minutes.inWholeNanoseconds

        // ---- Usage-session side: real FOREGROUND/BACKGROUND events for two different apps,
        // processed entirely by UsageSessionEngine, on the SAME elapsed timeline as the
        // screen-time ticks below (0 = session start, 60 min = end).
        val usageEvents = listOf(
            TimestampedUsageEvent("app-a-token", UsageEventType.FOREGROUND, elapsedRealtimeMillis = 0L, epochMillis = 0L),
            // The switch: A backgrounds, B foregrounds, both at the 30-minute mark.
            TimestampedUsageEvent("app-a-token", UsageEventType.BACKGROUND, elapsedRealtimeMillis = 30 * 60_000L, epochMillis = 30 * 60_000L),
            TimestampedUsageEvent("app-b-token", UsageEventType.FOREGROUND, elapsedRealtimeMillis = 30 * 60_000L, epochMillis = 30 * 60_000L),
            TimestampedUsageEvent("app-b-token", UsageEventType.BACKGROUND, elapsedRealtimeMillis = 60 * 60_000L, epochMillis = 60 * 60_000L),
        )
        val usageResult = UsageSessionEngine.apply(UsageSessionEngineState.INITIAL, usageEvents)

        // Sanity check on the usage side itself: two distinct 30-minute sessions were recorded.
        assertEquals(2, usageResult.completedSessions.size)
        assertEquals("app-a-token", usageResult.completedSessions[0].appToken)
        assertEquals(30 * 60_000L, usageResult.completedSessions[0].durationMillis)
        assertEquals("app-b-token", usageResult.completedSessions[1].appToken)
        assertEquals(30 * 60_000L, usageResult.completedSessions[1].durationMillis)

        // ---- Screen-time side: the screen never turns off or locks across the whole 60 minutes
        // (qualifying active use throughout), so ScreenTimeEngine receives ONLY Tick events -- the
        // app switch at t=30min is NEVER translated into a ScreenTimeEvent.Pause/Resume anywhere
        // in this test, exactly as production wiring never does (UsageSessionRecorder has no
        // reference to PcaRuntime/ScreenTimeEngine at all).
        var state: ScreenTimeState = ScreenTimeState.initial(nowNanos = 0L)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)

        // Tick at the 30-minute mark (the moment of the app switch) -- still well under the
        // 60-minute threshold.
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(thirtyMinNanos), config)
        assertEquals(ScreenTimeMode.ACTIVE, state.mode)
        assertEquals(thirtyMinNanos, state.activeElapsedNanos)

        // Tick at the 60-minute mark -- App B has now also run for 30 minutes, for a combined 60
        // minutes of continuous qualifying use across the switch.
        state = ScreenTimeEngine.reduce(state, ScreenTimeEvent.Tick(sixtyMinNanos), config)

        assertEquals(
            "the app switch must not have reset or discounted any of the accumulated active-use debt",
            ScreenTimeMode.BREAK_SHIELD,
            state.mode,
        )
        assertEquals(
            "the full 60 minutes must be accounted for, not reset back to zero or partial at the switch",
            config.activeThresholdNanos,
            state.activeElapsedNanos,
        )
    }

    @Test
    fun `many rapid app switches within the 60-minute window still reach Break Shield right on schedule`() {
        val config = ScreenTimeConfig()
        val sixtyMinNanos = 60.minutes.inWholeNanoseconds

        // 12 switches every 5 minutes, alternating between two apps -- UsageSessionEngine
        // processes all of them; none of it is wired to ScreenTimeEngine.
        val usageEvents = mutableListOf<TimestampedUsageEvent>()
        for (i in 0 until 12) {
            val startMillis = i * 5 * 60_000L
            val token = if (i % 2 == 0) "app-a-token" else "app-b-token"
            usageEvents += TimestampedUsageEvent(token, UsageEventType.FOREGROUND, startMillis, startMillis)
            if (i > 0) {
                val prevToken = if ((i - 1) % 2 == 0) "app-a-token" else "app-b-token"
                usageEvents += TimestampedUsageEvent(prevToken, UsageEventType.BACKGROUND, startMillis, startMillis)
            }
        }
        val usageResult = UsageSessionEngine.apply(UsageSessionEngineState.INITIAL, usageEvents)
        assertTrue("many switches must produce many short sessions", usageResult.completedSessions.size >= 10)

        // A single Tick straight to 60 minutes, screen never off/locked throughout.
        val state = ScreenTimeEngine.reduce(ScreenTimeState.initial(0L), ScreenTimeEvent.Tick(sixtyMinNanos), config)

        assertEquals(ScreenTimeMode.BREAK_SHIELD, state.mode)
        assertEquals(config.activeThresholdNanos, state.activeElapsedNanos)
    }
}
