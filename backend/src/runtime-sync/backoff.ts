import { BACKOFF_BASE_MS, BACKOFF_CAP_MS, MAX_RETRY_COUNT } from './policy.js';

export interface BackoffDecision {
  /** false once retryCount has exceeded MAX_RETRY_COUNT -- the caller must report this item as a terminal failure, never retry it again. */
  shouldRetry: boolean;
  nextRetryAtEpochMillis: number;
}

/**
 * Bounded exponential backoff with jitter, computed the same way on every
 * runtime that reimplements this algorithm (Android's BackoffPolicy.kt
 * mirrors this exactly -- code cannot be shared across Kotlin/TypeScript,
 * so both are independently, deterministically testable against the same
 * formula). Full jitter within [0.5, 1.0) of the exponential delay, never
 * below it and never unbounded, so a mass-reconnect event does not produce
 * a synchronized retry thundering herd nor retry every second forever.
 *
 * `randomFraction` is injected (defaults to Math.random) purely so tests
 * can assert exact bounds deterministically.
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
