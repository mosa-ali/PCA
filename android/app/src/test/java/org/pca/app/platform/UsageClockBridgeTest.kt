package org.pca.app.platform

import org.junit.Assert.*
import org.junit.Test

class UsageClockBridgeTest {
    @Test fun `continuity detects observed wall jumps and accepts exact tolerance boundaries`() {
        val before = UsageClockSample(100L, 10_000L)
        assertTrue(UsageClockBridge.continuous(before, UsageClockSample(1_100L, 11_000L)))
        assertTrue(UsageClockBridge.continuous(before, UsageClockSample(1_100L, 12_000L)))
        assertTrue(UsageClockBridge.continuous(before, UsageClockSample(1_100L, 10_000L)))
        assertFalse(UsageClockBridge.continuous(before, UsageClockSample(1_100L, 12_001L)))
        assertFalse(UsageClockBridge.continuous(before, UsageClockSample(1_100L, 9_999L)))
    }

    @Test fun `invalid reversed and overflowing clocks never establish continuity`() {
        assertFalse(UsageClockBridge.continuous(UsageClockSample(-1L, 0L), UsageClockSample(0L, 0L)))
        assertFalse(UsageClockBridge.continuous(UsageClockSample(1L, 10L), UsageClockSample(0L, 11L)))
        assertFalse(UsageClockBridge.continuous(UsageClockSample(0L, Long.MAX_VALUE), UsageClockSample(Long.MAX_VALUE, 0L)))
        assertFalse(UsageClockBridge.valid(UsageClockSample(0L, -1L)))
    }

    @Test fun `one captured bridge projects original event timestamps without replacement`() {
        val sample = UsageClockSample(2_000L, 10_000L)
        assertEquals(8_500L, UsageClockBridge.wallAtElapsed(500L, sample))
        assertEquals(500L, UsageClockBridge.elapsedAtWall(8_500L, sample))
        assertNull(UsageClockBridge.wallAtElapsed(-1L, sample))
        assertNull(UsageClockBridge.wallAtElapsed(2_001L, sample))
        assertNull(UsageClockBridge.elapsedAtWall(10_001L, sample))
        assertNull(UsageClockBridge.elapsedAtWall(0L, sample))
        assertNull(UsageClockBridge.wallAtElapsed(0L, UsageClockSample(Long.MAX_VALUE, 0L)))
    }
}
