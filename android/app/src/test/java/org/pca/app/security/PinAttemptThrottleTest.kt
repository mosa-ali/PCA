package org.pca.app.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.foundation.MonotonicTimeSource

/** Deterministic, adjustable fake -- lets tests control elapsed time precisely without real delays. */
private class FakeMonotonicTimeSource : MonotonicTimeSource {
    var nowMillis: Long = 0L
    override fun elapsedRealtimeMillis(): Long = nowMillis
    override fun elapsedRealtimeNanos(): Long = nowMillis * 1_000_000
}

class PinAttemptThrottleTest {
    private fun newThrottle(time: FakeMonotonicTimeSource): PinAttemptThrottle =
        PinAttemptThrottle(time, InMemoryPinThrottleStateStore())

    @Test
    fun `not locked out before any failures`() {
        val throttle = newThrottle(FakeMonotonicTimeSource())
        assertFalse(throttle.isLockedOut())
        assertEquals(0L, throttle.remainingLockoutMillis())
    }

    @Test
    fun `first two failures do not lock out`() {
        val time = FakeMonotonicTimeSource()
        val throttle = newThrottle(time)
        throttle.recordFailure()
        assertFalse(throttle.isLockedOut())
        throttle.recordFailure()
        assertFalse(throttle.isLockedOut())
        assertEquals(2, throttle.consecutiveFailures())
    }

    @Test
    fun `third failure locks out for the scheduled duration`() {
        val time = FakeMonotonicTimeSource()
        val throttle = newThrottle(time)
        repeat(3) { throttle.recordFailure() }
        assertTrue(throttle.isLockedOut())
        assertEquals(5_000L, throttle.remainingLockoutMillis())
    }

    @Test
    fun `lockout clears once its duration elapses`() {
        val time = FakeMonotonicTimeSource()
        val throttle = newThrottle(time)
        repeat(3) { throttle.recordFailure() }
        time.nowMillis += 5_000L
        assertFalse(throttle.isLockedOut())
        assertEquals(0L, throttle.remainingLockoutMillis())
    }

    @Test
    fun `lockout is still active one millisecond before it elapses`() {
        val time = FakeMonotonicTimeSource()
        val throttle = newThrottle(time)
        repeat(3) { throttle.recordFailure() }
        time.nowMillis += 4_999L
        assertTrue(throttle.isLockedOut())
        assertEquals(1L, throttle.remainingLockoutMillis())
    }

    @Test
    fun `delay strictly increases across the documented schedule`() {
        val time = FakeMonotonicTimeSource()
        val throttle = newThrottle(time)
        val observedDelays = mutableListOf<Long>()
        repeat(8) {
            throttle.recordFailure()
            observedDelays += throttle.remainingLockoutMillis()
            // Jump forward past whatever lockout is currently active so the next failure is
            // recorded promptly, exactly like a persistent attacker retrying as soon as allowed.
            time.nowMillis += throttle.remainingLockoutMillis()
        }
        // Failures 1-2: 0, 0 (no lockout yet). From failure 3 onward, each scheduled delay must be
        // strictly greater than the previous nonzero delay -- this is the adversarial "does the
        // delay actually increase" case called out in the mission brief, not just "is it nonzero."
        val nonZeroDelays = observedDelays.filter { it > 0L }
        for (i in 1 until nonZeroDelays.size) {
            assertTrue(
                "expected delay to increase: ${nonZeroDelays[i - 1]} -> ${nonZeroDelays[i]}",
                nonZeroDelays[i] > nonZeroDelays[i - 1],
            )
        }
        assertEquals(6, nonZeroDelays.size) // failures 3..8
    }

    @Test
    fun `beyond the schedule length every further failure repeats the max delay`() {
        val time = FakeMonotonicTimeSource()
        val throttle = newThrottle(time)
        var lastRemaining = 0L
        repeat(20) {
            throttle.recordFailure()
            lastRemaining = throttle.remainingLockoutMillis()
            time.nowMillis += lastRemaining
        }
        // Checked right after the final recordFailure(), before this iteration's own
        // time-advance -- advancing time first would trivially clear the lockout and make the
        // assertion vacuous.
        assertEquals(900_000L, lastRemaining)
    }

    @Test
    fun `success clears the failure streak and any lockout`() {
        val time = FakeMonotonicTimeSource()
        val throttle = newThrottle(time)
        repeat(5) { throttle.recordFailure() }
        assertTrue(throttle.isLockedOut())
        throttle.recordSuccess()
        assertFalse(throttle.isLockedOut())
        assertEquals(0, throttle.consecutiveFailures())
    }

    @Test
    fun `many rapid failed attempts without time advancing keep extending the same lockout window`() {
        val time = FakeMonotonicTimeSource()
        val throttle = newThrottle(time)
        repeat(3) { throttle.recordFailure() }
        val firstRemaining = throttle.remainingLockoutMillis()
        // Simulate an attacker hammering verify() while still locked out -- a caller that (bug)
        // still calls recordFailure() during an active lockout must not get an ever-shrinking
        // remaining time due to some off-by-one; it should reflect the freshest failure's own
        // schedule entry (4th failure), which is strictly longer than the 3rd's.
        throttle.recordFailure()
        val secondRemaining = throttle.remainingLockoutMillis()
        assertTrue(secondRemaining > firstRemaining)
    }
}
