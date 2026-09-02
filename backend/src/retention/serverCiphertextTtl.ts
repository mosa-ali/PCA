/**
 * Server-held-ciphertext retention policy, shared by every server-side
 * store-and-forward ledger that holds opaque family ciphertext for a
 * trusted device to collect.
 *
 * THE IN-REPO PRECEDENT, NOT A NEW POLICY DECISION. `relay_envelopes` has
 * enforced exactly this since migration 0001: a `expires_at` column set at
 * insert time, reads that exclude expired rows, and a `purgeExpired` DELETE
 * (see relay/policy.ts, relay/RelayService.ts, relay/MySqlRelayRepository.ts).
 * The ceiling below is literally MAX_RELAY_TTL_MS -- the same 7 days, from
 * the same constant -- so the two can never drift apart.
 *
 * `family_audit_events` (migration 0028) and `protection_alerts`
 * (migration 0025) are the same class of store: append-only ledgers of
 * opaque ciphertext the server can never read, written for a specific
 * parent device to poll and decrypt locally. They shipped without any of
 * the three parts, which turned "operational delivery availability" into
 * unbounded server-side retention of family ciphertext -- exactly what
 * relay/policy.ts's own header says these stores must never become.
 *
 * Retention here is a liability, not an asset: when in doubt a row is
 * treated as expired and dropped, never as retained.
 */
import { MAX_RELAY_TTL_MS, computeExpiryInstant } from '../relay/policy.js';

/**
 * The 7-day ceiling, taken directly from the relay's own constant so the
 * server-ciphertext TTL is one number in one place.
 */
export const SERVER_CIPHERTEXT_TTL_MS = MAX_RELAY_TTL_MS;

/**
 * Upper bound on rows any single feed request may return. An unbounded
 * `SELECT *` over a per-family ledger lets one family's event volume decide
 * how much memory the API process allocates for one request; with the TTL
 * above, seven days of events is the worst case and this caps the response
 * well below it.
 *
 * Callers get the MOST RECENT rows within the bound (still delivered in
 * ascending order), never the oldest: an oldest-first cap would let a busy
 * family's backlog starve its newest alerts until they aged out.
 */
export const MAX_SERVER_CIPHERTEXT_FEED_ROWS = 500;

/**
 * Expiry instant for a ciphertext row generated at `generatedAt`. Uses the
 * relay's own overflow-checked helper rather than bare arithmetic.
 */
export function computeServerCiphertextExpiry(generatedAt: Date): Date {
  return computeExpiryInstant(generatedAt, SERVER_CIPHERTEXT_TTL_MS);
}

/**
 * Clamps a caller-supplied page size into [1, MAX_SERVER_CIPHERTEXT_FEED_ROWS].
 * Anything absent, non-integer, or out of range collapses to the maximum --
 * the bound is the server's, never the caller's, to raise.
 */
export function resolveServerCiphertextFeedLimit(requested?: number): number {
  if (requested === undefined) return MAX_SERVER_CIPHERTEXT_FEED_ROWS;
  if (!Number.isInteger(requested) || requested < 1) return MAX_SERVER_CIPHERTEXT_FEED_ROWS;
  return Math.min(requested, MAX_SERVER_CIPHERTEXT_FEED_ROWS);
}

/** True when a row generated at `generatedAt` has aged past the TTL by `now`. */
export function isServerCiphertextExpired(generatedAt: Date, now: Date): boolean {
  return now.getTime() >= computeServerCiphertextExpiry(generatedAt).getTime();
}

/**
 * Applies the TTL and the row bound to an already-ascending feed. Shared by
 * the in-memory ledgers so their doubles behave exactly like the SQL the
 * MySQL ledgers run.
 *
 * The bound keeps the NEWEST rows while still returning them oldest-first:
 * capping oldest-first would let a busy family's backlog starve its most
 * recent alerts/events until they aged out, which for a protection-alert
 * feed is the worst possible failure direction.
 */
export function applyServerCiphertextFeedWindow<T extends { readonly generatedAtUtc: Date }>(
  ascending: readonly T[],
  now: Date,
  limit?: number,
): T[] {
  const live = ascending.filter((entry) => !isServerCiphertextExpired(entry.generatedAtUtc, now));
  return live.slice(-resolveServerCiphertextFeedLimit(limit));
}
