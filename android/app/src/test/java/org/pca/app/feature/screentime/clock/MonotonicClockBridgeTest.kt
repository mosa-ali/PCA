package org.pca.app.feature.screentime.clock

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.foundation.MonotonicTimeSource

private class FakeMonotonicTimeSource(private val nanos: Long) : MonotonicTimeSource {
    override fun elapsedRealtimeMillis(): Long = nanos / 1_000_000
    override fun elapsedRealtimeNanos(): Long = nanos
}

class MonotonicClockBridgeTest {

    @Test
    fun `delegates directly to the nanosecond-resolution platform source`() {
        val bridge = MonotonicClockBridge(FakeMonotonicTimeSource(123_456_789L))
        assertEquals(123_456_789L, bridge.elapsedNanos())
    }

    @Test
    fun `reflects a changed reading on each call, never caches`() {
        var current = 1_000L
        val source = object : MonotonicTimeSource {
            override fun elapsedRealtimeMillis(): Long = current / 1_000_000
            override fun elapsedRealtimeNanos(): Long = current
        }
        val bridge = MonotonicClockBridge(source)
        assertEquals(1_000L, bridge.elapsedNanos())
        current = 2_000L
        assertEquals(2_000L, bridge.elapsedNanos())
    }
}
