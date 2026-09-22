/**
 * PCA-COMMERCIAL-LIVENESS-2 -- the attribution state model and its durable retry
 * schedule for quote-expiry notifications.
 *
 * WHY THIS EXISTS. `CommercialMaintenanceRunner` notifies the family a quote
 * expired by attributing the quote through its `increase_request_ref`. Some quotes
 * cannot be attributed. Before this module the runner skipped such a row on every
 * pass of every run, and because the backlog scan is ordered `expires_at ASC` and
 * reused the same LIMIT window, a batch-full of permanently-unattributable rows
 * starved every eligible row behind them for ever and drove each run to
 * MAX_PASSES_PER_RUN (measured: 1,000 passes, 3,000 skip-warnings, 0 notified).
 *
 * Two things are needed to make that bounded and honest:
 *   1. a reason code that distinguishes "provably never attributable" from "not
 *      attributable yet", so the first can stop being retried and the second
 *      cannot be silently abandoned; and
 *   2. a durable next-attempt time, so a not-yet-attributable row costs a
 *      bounded, decaying amount of work instead of a full re-scan every cycle.
 *
 * The state model lives here rather than in the runner because the vocabulary is
 * the part a reviewer must be able to check independently of the SQL.
 */

/**
 * The three attribution states.
 *
 * `NOTIFIED` is DERIVED, never stored: the durable evidence is the
 * `commercial_notifications` row keyed `QUOTE_EXPIRED:<quote_id>`. Storing it a
 * second time would create a second source of truth for the same fact, and it is
 * precisely that notification row that carries the exactly-once guarantee. The
 * `commercial_quote_attribution_retry` table's CHECK constraint therefore lists
 * only the two non-derived states, and this type keeps the third so callers name
 * the full model rather than an arbitrary subset of it.
 */
export type AttributionState = 'PENDING_ATTRIBUTION' | 'NOTIFIED' | 'TERMINAL_UNATTRIBUTABLE';

/** The states that can be persisted, i.e. everything except the derived one. */
export type PersistedAttributionState = Exclude<AttributionState, 'NOTIFIED'>;

/**
 * Why a quote could not be attributed.
 *
 * `REFERENCE_ABSENT`   no `increase_request_ref` at all. PROVABLY permanent: the
 *                      column is written by exactly one statement in this
 *                      codebase (the INSERT in billing/quote.ts) and assigned
 *                      nowhere else, so a NULL cannot later become non-NULL.
 *                      A build-time guard asserts that invariant in
 *                      test/tooling/commercialAttributionPermanence.test.mjs.
 * `REFERENCE_UNRESOLVED` a reference exists but no `entitlement_change_requests`
 *                      row resolves. Deliberately NOT permanent: those rows are
 *                      never deleted, so this is anomalous, but nothing in source
 *                      proves a missing row can never later appear. It is retried
 *                      with backoff instead of being terminalised.
 */
export type AttributionReasonCode = 'REFERENCE_ABSENT' | 'REFERENCE_UNRESOLVED';

/** First retry delay. Short enough to recover a transient inconsistency quickly. */
export const ATTRIBUTION_RETRY_BASE_DELAY_MS = 5 * 60 * 1000;

/**
 * Delay ceiling. Without a cap the schedule would grow without bound and a row
 * could effectively never be retried again, which would be terminalization by
 * arithmetic -- the thing this module exists to avoid.
 */
export const ATTRIBUTION_RETRY_MAX_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Backoff exponent ceiling. `2 ** 31` is already far past the delay cap, so this
 * only exists to keep the arithmetic finite for a pathological attempt count.
 */
const MAX_BACKOFF_EXPONENT = 31;

/**
 * Pure: the next time a not-yet-attributable quote should be considered again.
 *
 * `attemptCount` is the number of attempts ALREADY made, so the first failure
 * (0 prior attempts) schedules the base delay. The result is capped, and no
 * jitter is added on purpose: jitter would make the schedule non-deterministic
 * and therefore untestable, while the concurrency safety this table needs comes
 * from the primary key, not from staggered timing.
 */
export function nextAttributionAttemptAt(attemptCount: number, now: Date): Date {
  const failures = Number.isFinite(attemptCount) && attemptCount > 0 ? Math.floor(attemptCount) : 0;
  const exponent = Math.min(failures, MAX_BACKOFF_EXPONENT);
  const delayMs = Math.min(ATTRIBUTION_RETRY_MAX_DELAY_MS, ATTRIBUTION_RETRY_BASE_DELAY_MS * 2 ** exponent);
  return new Date(now.getTime() + delayMs);
}

/** Pure: classify an unattributable quote by its reference, never by age or retry count. */
export function classifyUnattributableReason(increaseRequestRef: string | null): AttributionReasonCode {
  return increaseRequestRef === null ? 'REFERENCE_ABSENT' : 'REFERENCE_UNRESOLVED';
}

/**
 * Pure: whether a reason code is PROVABLY permanent.
 *
 * Only `REFERENCE_ABSENT` qualifies, and only because the reference column is
 * write-once (see the type doc above and the build-time guard). Everything else
 * stays PENDING_ATTRIBUTION -- an unproven terminal state would drop a
 * notification that may still be owed.
 */
export function isProvablyTerminal(reasonCode: AttributionReasonCode): boolean {
  return reasonCode === 'REFERENCE_ABSENT';
}
