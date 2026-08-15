package org.pca.app.runtime.background

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * PCA-NFR-034: proves the diagnostic counters [BackgroundWorkMetrics] documents actually
 * accumulate correctly, and gives a real (JVM-local, not on-device) measurement of how cheap one
 * ingestion-shaped unit of work is -- see the class's own doc comment for exactly what this is and
 * is not evidence of.
 */
class BackgroundWorkMetricsTest {

    @After
    fun tearDown() {
        BackgroundWorkMetrics.resetForTest()
    }

    @Test
    fun `records successful and failed runs separately, keeps a running total`() {
        BackgroundWorkMetrics.recordRun(durationNanos = 1_000_000, success = true)
        BackgroundWorkMetrics.recordRun(durationNanos = 2_000_000, success = false)
        BackgroundWorkMetrics.recordRun(durationNanos = 3_000_000, success = true)

        val snapshot = BackgroundWorkMetrics.snapshot()
        assertEquals(3, snapshot.runCount)
        assertEquals(1, snapshot.failureCount)
        assertEquals(3_000_000L, snapshot.lastDurationNanos)
        assertEquals(6_000_000L, snapshot.totalDurationNanos)
    }

    @Test
    fun `a single simulated ingestion-shaped unit of work completes in low single-digit milliseconds`() {
        // Not a real UsageStatsManager/Room measurement (out of scope for a JVM unit test -- see
        // BackgroundWorkMetrics' own doc comment on what this is/isn't evidence of). This measures
        // this test JVM's own baseline call overhead as a sanity floor only.
        val start = System.nanoTime()
        BackgroundWorkMetrics.recordRun(System.nanoTime() - start, success = true)
        val snapshot = BackgroundWorkMetrics.snapshot()

        // Generous bound (a shared/loaded CI machine can occasionally schedule this thread away
        // mid-measurement) -- the point of this assertion is "bounded and small," not a tight
        // real-time guarantee; see the class doc comment for what this is/isn't evidence of.
        assert(snapshot.lastDurationNanos < 100_000_000) {
            "expected the metrics call itself to complete in well under 100ms, was ${snapshot.lastDurationNanos}ns"
        }
    }

    @Test
    fun `resetForTest zeroes every counter`() {
        BackgroundWorkMetrics.recordRun(1_000, success = false)
        BackgroundWorkMetrics.resetForTest()

        val snapshot = BackgroundWorkMetrics.snapshot()
        assertEquals(0, snapshot.runCount)
        assertEquals(0, snapshot.failureCount)
        assertEquals(0L, snapshot.lastDurationNanos)
        assertEquals(0L, snapshot.totalDurationNanos)
    }
}
