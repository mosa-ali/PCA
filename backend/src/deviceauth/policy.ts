/**
 * Server-side challenge lifetime policy. Unlike an invitation TTL, a
 * device-authentication challenge is never client-negotiable -- it exists
 * only to bound the window during which a captured-in-transit challenge
 * could theoretically be relayed and signed, so it stays short and fixed.
 */
export const DEVICE_CHALLENGE_TTL_MS = 60 * 1000; // 60 seconds

/** Computes an expiry instant and guards against non-finite/overflowing results. */
export function computeExpiryInstant(createdAt: Date, ttlMs: number): Date {
  const expiresAtMs = createdAt.getTime() + ttlMs;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new RangeError('Computed challenge expiry is out of range.');
  }
  return new Date(expiresAtMs);
}
