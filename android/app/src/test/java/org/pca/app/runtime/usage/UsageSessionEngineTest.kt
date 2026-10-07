package org.pca.app.runtime.usage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.platform.UsageEventType

class UsageSessionEngineTest {

    @Test
    fun `duration uses elapsed endpoints despite forward or backward wall clock changes`() {
        for (wallEnd in listOf(50L, 3_600_000L, Long.MAX_VALUE)) {
            val result = UsageSessionEngine.apply(UsageSessionEngineState.INITIAL, listOf(
                event("app-a", UsageEventType.FOREGROUND, 100L, 10_000L),
                event("app-a", UsageEventType.BACKGROUND, 1_100L, wallEnd),
            ))
            val session = result.completedSessions.single()
            assertEquals(1_000L, session.durationMillis)
            assertEquals(10_000L, session.startedAtEpochMillis)
            assertEquals(wallEnd, session.endedAtEpochMillis)
        }
    }

    @Test
    fun `invalid elapsed endpoints cannot create usage duration`() {
        for ((start, end) in listOf(-1L to 1_000L, 1_000L to -1L, 1_000L to 999L)) {
            val session = CompletedUsageSession("app-a", start, end, 0L, 3_600_000L)
            assertEquals(0L, session.durationMillis)
        }
        assertEquals(Long.MAX_VALUE, CompletedUsageSession("app-a", 0L, Long.MAX_VALUE, 0L, 0L).durationMillis)
    }

    private fun event(token: String, type: UsageEventType, elapsedMillis: Long, epochMillis: Long = elapsedMillis) =
        TimestampedUsageEvent(token, type, elapsedMillis, epochMillis)

    @Test
    fun `foreground then background produces exactly one completed session`() {
        val events = listOf(
            event("app-a", UsageEventType.FOREGROUND, 0L),
            event("app-a", UsageEventType.BACKGROUND, 1_000L),
        )
        val result = UsageSessionEngine.apply(UsageSessionEngineState.INITIAL, events)

        assertEquals(1, result.completedSessions.size)
        val session = result.completedSessions.single()
        assertEquals("app-a", session.appToken)
        assertEquals(0L, session.startedAtElapsedMillis)
        assertEquals(1_000L, session.endedAtElapsedMillis)
        assertEquals(1_000L, session.durationMillis)
        assertNull(result.state.openSession)
        assertEquals(1_000L, result.state.lastProcessedElapsedMillis)
    }

    @Test
    fun `foreground with no matching background leaves an open session, not a fabricated completion`() {
        val events = listOf(event("app-a", UsageEventType.FOREGROUND, 0L))
        val result = UsageSessionEngine.apply(UsageSessionEngineState.INITIAL, events)

        assertTrue(result.completedSessions.isEmpty())
        assertEquals("app-a", result.state.openSession?.appToken)
    }

    @Test
    fun `app switch -- foreground B while A still open closes A and opens B without a BACKGROUND event`() {
        val events = listOf(
            event("app-a", UsageEventType.FOREGROUND, 0L),
            event("app-b", UsageEventType.FOREGROUND, 500L),
        )
        val result = UsageSessionEngine.apply(UsageSessionEngineState.INITIAL, events)

        assertEquals(1, result.completedSessions.size)
        assertEquals("app-a", result.completedSessions.single().appToken)
        assertEquals(500L, result.completedSessions.single().endedAtElapsedMillis)
        assertEquals("app-b", result.state.openSession?.appToken)
    }

    @Test
    fun `duplicate event redelivery is a no-op -- replaying an already-applied batch produces no new sessions`() {
        val events = listOf(
            event("app-a", UsageEventType.FOREGROUND, 0L),
            event("app-a", UsageEventType.BACKGROUND, 1_000L),
        )
        val first = UsageSessionEngine.apply(UsageSessionEngineState.INITIAL, events)
        assertEquals(1, first.completedSessions.size)

        // Re-deliver the exact same batch against the state produced by the first application --
        // simulates a duplicate producer tick or an overlapping query window.
        val second = UsageSessionEngine.apply(first.state, events)
        assertTrue("replaying already-processed events must not fabricate a second session", second.completedSessions.isEmpty())
        assertEquals(first.state, second.state)
    }

    @Test
    fun `out-of-order events within one batch are sorted before being applied`() {
        // BACKGROUND appears before FOREGROUND in delivery order, but its elapsed timestamp is
        // later -- correct behavior depends on time order, not delivery order.
        val events = listOf(
            event("app-a", UsageEventType.BACKGROUND, 1_000L),
            event("app-a", UsageEventType.FOREGROUND, 0L),
        )
        val result = UsageSessionEngine.apply(UsageSessionEngineState.INITIAL, events)

        assertEquals(1, result.completedSessions.size)
        assertEquals(0L, result.completedSessions.single().startedAtElapsedMillis)
        assertEquals(1_000L, result.completedSessions.single().endedAtElapsedMillis)
    }

    @Test
    fun `events at or before the cursor are ignored -- the cursor never regresses`() {
        val state = UsageSessionEngineState(openSession = null, lastProcessedElapsedMillis = 5_000L)
        val staleEvents = listOf(event("app-a", UsageEventType.FOREGROUND, 1_000L))

        val result = UsageSessionEngine.apply(state, staleEvents)

        assertTrue(result.completedSessions.isEmpty())
        assertNull(result.state.openSession)
        assertEquals(5_000L, result.state.lastProcessedElapsedMillis)
    }

    @Test
    fun `background for an app that was never observed foreground is ignored, not fabricated as a session`() {
        val events = listOf(event("app-a", UsageEventType.BACKGROUND, 100L))
        val result = UsageSessionEngine.apply(UsageSessionEngineState.INITIAL, events)

        assertTrue(result.completedSessions.isEmpty())
        assertNull(result.state.openSession)
    }

    @Test
    fun `duplicate foreground for the already-open app is a no-op, not a new session boundary`() {
        val events = listOf(
            event("app-a", UsageEventType.FOREGROUND, 0L),
            event("app-a", UsageEventType.FOREGROUND, 200L),
            event("app-a", UsageEventType.BACKGROUND, 1_000L),
        )
        val result = UsageSessionEngine.apply(UsageSessionEngineState.INITIAL, events)

        assertEquals(1, result.completedSessions.size)
        assertEquals(0L, result.completedSessions.single().startedAtElapsedMillis)
    }
}
