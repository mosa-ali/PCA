package org.pca.app.platform

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.foundation.MonotonicTimeSource

private class FakeUsageObservationSource : UsageObservationSource {
    var state: UsageAccessState = UsageAccessState.NOT_CONFIGURED
    var events: List<UsageEvent> = emptyList()

    override fun accessState(): UsageAccessState = state
    override fun queryEventsSince(elapsedRealtimeMillis: Long): List<UsageEvent> = events
}

private class FakeMonotonicTimeSource(var nowMillis: Long = 0L) : MonotonicTimeSource {
    override fun elapsedRealtimeMillis(): Long = nowMillis
    override fun elapsedRealtimeNanos(): Long = nowMillis * 1_000_000
}

class UsageAccessStateTrackerTest {
    @Test
    fun `initial grant with recent evidence is GRANTED`() {
        val source = FakeUsageObservationSource().apply {
            state = UsageAccessState.GRANTED
            events = listOf(UsageEvent("pkg", UsageEventType.FOREGROUND, 100))
        }
        val tracker = UsageAccessStateTracker(source, FakeMonotonicTimeSource(1000))
        assertEquals(TrackedUsageAccessState.GRANTED, tracker.currentState())
    }

    @Test
    fun `never-granted DENIED is reported as DENIED, not REVOKED -- no prior grant evidence exists`() {
        val source = FakeUsageObservationSource().apply { state = UsageAccessState.DENIED }
        val tracker = UsageAccessStateTracker(source, FakeMonotonicTimeSource())
        assertEquals(TrackedUsageAccessState.DENIED, tracker.currentState())
    }

    @Test
    fun `usage access loss after a prior grant is REVOKED, evidence-backed by this tracker's own observed history`() {
        val source = FakeUsageObservationSource().apply {
            state = UsageAccessState.GRANTED
            events = listOf(UsageEvent("pkg", UsageEventType.FOREGROUND, 100))
        }
        val time = FakeMonotonicTimeSource(1000)
        val tracker = UsageAccessStateTracker(source, time)
        assertEquals(TrackedUsageAccessState.GRANTED, tracker.currentState())

        source.state = UsageAccessState.DENIED
        assertEquals(TrackedUsageAccessState.REVOKED, tracker.currentState())
    }

    @Test
    fun `NOT_CONFIGURED and UNAVAILABLE pass through unchanged regardless of prior grant history`() {
        val source = FakeUsageObservationSource().apply {
            state = UsageAccessState.GRANTED
            events = listOf(UsageEvent("pkg", UsageEventType.FOREGROUND, 100))
        }
        val tracker = UsageAccessStateTracker(source, FakeMonotonicTimeSource(1000))
        tracker.currentState() // establish prior-grant history

        source.state = UsageAccessState.NOT_CONFIGURED
        assertEquals(TrackedUsageAccessState.NOT_CONFIGURED, tracker.currentState())

        source.state = UsageAccessState.UNAVAILABLE
        assertEquals(TrackedUsageAccessState.UNAVAILABLE, tracker.currentState())
    }

    @Test
    fun `GRANTED with zero recent events over the observation window is DEGRADED, distinct from REVOKED`() {
        val source = FakeUsageObservationSource().apply {
            state = UsageAccessState.GRANTED
            events = emptyList()
        }
        val tracker = UsageAccessStateTracker(source, FakeMonotonicTimeSource(1000), degradedObservationWindowMillis = 500)
        assertEquals(TrackedUsageAccessState.DEGRADED, tracker.currentState())
    }

    @Test
    fun `DEGRADED clears back to GRANTED once fresh evidence arrives -- state is re-evaluated live, never sticky`() {
        val source = FakeUsageObservationSource().apply { state = UsageAccessState.GRANTED; events = emptyList() }
        val tracker = UsageAccessStateTracker(source, FakeMonotonicTimeSource(1000), degradedObservationWindowMillis = 500)
        assertEquals(TrackedUsageAccessState.DEGRADED, tracker.currentState())

        source.events = listOf(UsageEvent("pkg", UsageEventType.FOREGROUND, 900))
        assertEquals(TrackedUsageAccessState.GRANTED, tracker.currentState())
    }

    @Test
    fun `incomplete evidence (UNAVAILABLE) is never upgraded to GRANTED even with prior grant history`() {
        val source = FakeUsageObservationSource().apply { state = UsageAccessState.UNAVAILABLE }
        val tracker = UsageAccessStateTracker(source, FakeMonotonicTimeSource())
        assertEquals(TrackedUsageAccessState.UNAVAILABLE, tracker.currentState())
    }
}
