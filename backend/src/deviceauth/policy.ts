/**
 * Server-side challenge lifetime policy. Unlike an invitation TTL, a
 * device-authentication challenge is never client-negotiable -- it exists
 * only to bound the window during which a captured-in-transit challenge
 * could theoretically be relayed and signed, so it stays short and fixed.
 */
export const DEVICE_CHALLENGE_TTL_MS = 60 * 1000; // 60 seconds

const MYSQL_DATETIME_MIN_MS = Date.UTC(1000, 0, 1, 0, 0, 0, 0);
const MYSQL_DATETIME_MAX_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

/** Whether a challenge timestamp can be represented by the production DATETIME(3) columns. */
export function isSupportedChallengeTime(value: unknown): value is Date {
  if (!(value instanceof Date)) return false;
  const time = value.getTime();
  return Number.isFinite(time) && time >= MYSQL_DATETIME_MIN_MS && time <= MYSQL_DATETIME_MAX_MS;
}

/** Computes an expiry instant and guards against non-finite/overflowing results. */
export function computeExpiryInstant(createdAt: Date, ttlMs: number): Date {
  const expiresAtMs = createdAt.getTime() + ttlMs;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new RangeError('Computed challenge expiry is out of range.');
  }
  return new Date(expiresAtMs);
}
