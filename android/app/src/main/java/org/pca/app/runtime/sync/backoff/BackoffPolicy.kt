package org.pca.app.runtime.sync.backoff

const val BACKOFF_BASE_MILLIS: Long = 1_000
const val BACKOFF_CAP_MILLIS: Long = 300_000
const val MAX_RETRY_COUNT: Int = 8

data class BackoffDecision(val shouldRetry: Boolean, val nextRetryAtEpochMillis: Long)

/**
 * Ported from backend/src/runtime-sync/backoff.ts -- same bounded
 * exponential-with-full-jitter formula, independently implemented (see
 * that file's own doc comment for why code cannot be shared here). Keep
 * the constants and formula in sync by hand across all three
 * implementations (backend, parent-sdk, this one); each carries its own
 * test suite asserting the same bounds.
 */
fun computeBackoff(
    retryCount: Int,
    nowEpochMillis: Long,
    randomFraction: () -> Double = { Math.random() },
): BackoffDecision {
    if (retryCount >= MAX_RETRY_COUNT) {
        return BackoffDecision(shouldRetry = false, nextRetryAtEpochMillis = nowEpochMillis)
    }
    val exponential = BACKOFF_BASE_MILLIS * (1L shl retryCount)
    val capped = minOf(exponential, BACKOFF_CAP_MILLIS)
    val jitterMultiplier = 0.5 + 0.5 * randomFraction()
    val delayMillis = Math.round(capped * jitterMultiplier)
    return BackoffDecision(shouldRetry = true, nextRetryAtEpochMillis = nowEpochMillis + delayMillis)
}
