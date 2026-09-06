/**
 * PCA-DW-W2-15F -- bounded exponential backoff with full jitter for the
 * email outbox's retry schedule. Independently implemented from (not
 * imported from) runtime-sync/backoff.ts: that module's constants
 * (MAX_RETRY_COUNT/BACKOFF_BASE_MS/BACKOFF_CAP_MS) are runtime-sync-
 * specific reconnect policy, not a generic shared utility -- see that
 * module's own doc comment on why this codebase duplicates rather than
 * shares this shape across domains. Same algorithm, this domain's own
 * (much shorter -- an email should either go out or dead-letter within
 * minutes, not the hours a device-reconnect backoff tolerates) policy
 * constants.
 */

export const EMAIL_MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 5 * 60_000;

export interface EmailBackoffDecision {
  /** false once attemptCount has reached EMAIL_MAX_ATTEMPTS -- the caller must dead-letter this row, never schedule another retry. */
  shouldRetry: boolean;
  nextAttemptAtEpochMillis: number;
}

/**
 * `attemptCount` is the number of attempts ALREADY made (0 before the
 * first). `randomFraction` is injected purely so tests can assert exact
 * bounds deterministically.
 */
export function computeEmailBackoff(
  attemptCount: number,
  nowEpochMillis: number,
  randomFraction: () => number = Math.random,
): EmailBackoffDecision {
  if (attemptCount >= EMAIL_MAX_ATTEMPTS) {
    return { shouldRetry: false, nextAttemptAtEpochMillis: nowEpochMillis };
  }
  const exponential = BACKOFF_BASE_MS * 2 ** attemptCount;
  const capped = Math.min(exponential, BACKOFF_CAP_MS);
  const jitterMultiplier = 0.5 + 0.5 * randomFraction();
  const delayMs = Math.round(capped * jitterMultiplier);
  return { shouldRetry: true, nextAttemptAtEpochMillis: nowEpochMillis + delayMs };
}
