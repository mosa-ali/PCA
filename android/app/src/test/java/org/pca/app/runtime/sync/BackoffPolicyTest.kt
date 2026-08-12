package org.pca.app.runtime.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.runtime.sync.backoff.BACKOFF_BASE_MILLIS
import org.pca.app.runtime.sync.backoff.BACKOFF_CAP_MILLIS
import org.pca.app.runtime.sync.backoff.MAX_RETRY_COUNT
import org.pca.app.runtime.sync.backoff.computeBackoff

class BackoffPolicyTest {
    private val now = 1_700_000_000_000L

    @Test
    fun `retry 0 is bounded within half to full base delay`() {
        val low = computeBackoff(0, now) { 0.0 }
        val high = computeBackoff(0, now) { 0.999999 }
        assertEquals(Math.round(BACKOFF_BASE_MILLIS * 0.5), low.nextRetryAtEpochMillis - now)
        assertTrue(high.nextRetryAtEpochMillis - now <= BACKOFF_BASE_MILLIS)
    }

    @Test
    fun `delay grows exponentially and never exceeds the cap`() {
        val r1 = computeBackoff(1, now) { 1.0 }
        val r2 = computeBackoff(2, now) { 1.0 }
        assertTrue((r2.nextRetryAtEpochMillis - now) > (r1.nextRetryAtEpochMillis - now))
        val rHigh = computeBackoff(20, now) { 1.0 }
        assertTrue(rHigh.nextRetryAtEpochMillis - now <= BACKOFF_CAP_MILLIS)
    }

    @Test
    fun `stops retrying at MAX_RETRY_COUNT`() {
        assertEquals(false, computeBackoff(MAX_RETRY_COUNT, now).shouldRetry)
        assertEquals(true, computeBackoff(MAX_RETRY_COUNT - 1, now).shouldRetry)
    }
}
