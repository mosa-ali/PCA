/**
 * Pure constants and pure functions for the Platform Administration auth
 * domain -- TTLs, lockout thresholds. No I/O, no DB access, directly unit
 * testable (backend/test/platformadmin/policy.test.mjs).
 */

/** Session lifetime. Not specified numerically by the addendum; chosen as a conservative operator-session bound, configurable later via platform settings (Section 16) if needed -- never hardcoded deeper than this one constant. */
export const PLATFORM_ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * PCA-ADD-PA-012: 5 minutes, mirroring doc 18 Section 4's/
 * familyrbac/policy.ts's STEP_UP_MAX_FRESHNESS_MS value but defined here as
 * an independent constant -- never imported from the family plane, per
 * PCA-ADD-PA-012's "not a shared code path" requirement.
 */
export const PLATFORM_ADMIN_STEP_UP_TTL_MS = 5 * 60 * 1000;

/** MFA challenge/TOTP step parameters (RFC 6238 defaults) -- see totp.ts. */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_CLOCK_SKEW_STEPS = 1;

/** Lockout policy (PCA-ADD-PA-020): 5+ failures within a rolling 15-minute window locks out the identifier. */
export const PLATFORM_ADMIN_LOCKOUT_THRESHOLD = 5;
export const PLATFORM_ADMIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/** Bound on how many recent failed-attempt timestamps the repository fetches before handing them to isLockedOut -- keeps the query cheap regardless of historical attempt volume. */
export const PLATFORM_ADMIN_LOGIN_ATTEMPT_LOOKBACK_LIMIT = 50;

export function computeExpiry(issuedAt: Date, ttlMs: number): Date {
  return new Date(issuedAt.getTime() + ttlMs);
}

/**
 * Pure lockout decision over a list of recent FAILED_CREDENTIALS/
 * FAILED_MFA attempt timestamps for one email_hash, ordered
 * MOST-RECENT-FIRST (the shape MySqlPlatformAdminAuthRepository's
 * `ORDER BY occurred_at DESC LIMIT N` query returns).
 *
 * "Within a rolling 15-minute window, 5 or more failures locks out further
 * attempts until the window rolls past the 5th-most-recent failure":
 * with fewer than the threshold, never locked out; at or above the
 * threshold, locked out exactly while `now` is still within
 * LOCKOUT_WINDOW_MS of the threshold-th most recent failure (i.e. the
 * failure that, once it ages out of the window, drops the count back
 * below the threshold).
 */
export function isLockedOut(recentFailureTimestampsDescending: readonly Date[], now: Date): boolean {
  if (recentFailureTimestampsDescending.length < PLATFORM_ADMIN_LOCKOUT_THRESHOLD) return false;
  const thresholdFailure = recentFailureTimestampsDescending[PLATFORM_ADMIN_LOCKOUT_THRESHOLD - 1];
  return now.getTime() - thresholdFailure.getTime() < PLATFORM_ADMIN_LOCKOUT_WINDOW_MS;
}
