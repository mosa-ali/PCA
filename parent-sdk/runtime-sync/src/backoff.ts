export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 300_000;
export const MAX_RETRY_COUNT = 8;

export interface BackoffDecision {
  shouldRetry: boolean;
  nextRetryAtEpochMillis: number;
}

/**
 * Ported from backend/src/runtime-sync/backoff.ts -- same formula
 * (bounded exponential with full jitter in [0.5, 1.0)), independently
 * implemented per runtime since code cannot be shared across the
 * TypeScript backend/parent-sdk and Kotlin Android boundary. Keep the
 * three implementations' constants and formula in sync by hand; each has
 * its own test suite asserting the same bounds.
 */
export function computeBackoff(
  retryCount: number,
  nowEpochMillis: number,
  randomFraction: () => number = Math.random,
): BackoffDecision {
  if (retryCount >= MAX_RETRY_COUNT) {
    return { shouldRetry: false, nextRetryAtEpochMillis: nowEpochMillis };
  }
  const exponential = BACKOFF_BASE_MS * 2 ** retryCount;
  const capped = Math.min(exponential, BACKOFF_CAP_MS);
  const jitterMultiplier = 0.5 + 0.5 * randomFraction();
  const delayMs = Math.round(capped * jitterMultiplier);
  return { shouldRetry: true, nextRetryAtEpochMillis: nowEpochMillis + delayMs };
}
