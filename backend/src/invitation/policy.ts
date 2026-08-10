/**
 * Server-side invitation lifetime policy. The client may request a shorter
 * lifetime than the default, but may never obtain an invitation that
 * outlives MAX_INVITATION_TTL_MS -- that ceiling is enforced here, not by
 * trusting caller input.
 */
export const DEFAULT_INVITATION_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_INVITATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Resolves and validates a requested TTL against server policy.
 * Throws RangeError for any value the server will not honor: missing input
 * is not an error (it falls back to the default), but zero, negative,
 * non-finite, and above-maximum values are all rejected outright rather
 * than silently clamped, so a caller never observes a shorter invitation
 * than it thinks it requested.
 */
export function resolveInvitationTtlMs(requestedTtlMs: number | undefined): number {
  if (requestedTtlMs === undefined) return DEFAULT_INVITATION_TTL_MS;
  if (!Number.isFinite(requestedTtlMs) || requestedTtlMs <= 0) {
    throw new RangeError('ttlMs must be a positive finite duration in milliseconds.');
  }
  if (requestedTtlMs > MAX_INVITATION_TTL_MS) {
    throw new RangeError('ttlMs exceeds the maximum permitted invitation lifetime.');
  }
  return requestedTtlMs;
}

/** Computes an expiry instant and guards against non-finite/overflowing results. */
export function computeExpiryInstant(createdAt: Date, ttlMs: number): Date {
  const expiresAtMs = createdAt.getTime() + ttlMs;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new RangeError('Computed invitation expiry is out of range.');
  }
  return new Date(expiresAtMs);
}
