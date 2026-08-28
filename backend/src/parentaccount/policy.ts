import type { FreeAccessMode } from './types.js';

/** Verification codes expire quickly -- long enough for a real inbox check, short enough to bound brute-force value (PCA-ADD-IDENT-007). */
export const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
/** A code locks itself out well before exhausting its own 1-in-a-million space. */
export const MAX_VERIFICATION_ATTEMPTS_PER_CODE = 8;

export interface RateLimitPolicy {
  windowMs: number;
  max: number;
}

/** Registration/verification/login are all rate-limited per email AND per source IP (PCA-ADD-IDENT-007, WRITER57 assignment). Deliberately distinct budgets per bucket, per backend/src/http/rateLimit.ts's own "exhausting one budget must not affect another" discipline. */
export const REGISTER_IP_RATE_LIMIT: RateLimitPolicy = { windowMs: 60 * 60 * 1000, max: 20 };
export const REGISTER_EMAIL_RATE_LIMIT: RateLimitPolicy = { windowMs: 60 * 60 * 1000, max: 5 };
export const VERIFY_IP_RATE_LIMIT: RateLimitPolicy = { windowMs: 15 * 60 * 1000, max: 30 };
export const VERIFY_EMAIL_RATE_LIMIT: RateLimitPolicy = { windowMs: 15 * 60 * 1000, max: 10 };
export const LOGIN_IP_RATE_LIMIT: RateLimitPolicy = { windowMs: 15 * 60 * 1000, max: 30 };
export const LOGIN_EMAIL_RATE_LIMIT: RateLimitPolicy = { windowMs: 15 * 60 * 1000, max: 10 };

/** Same TTL/attempt-budget shape as email verification (PCA-ADD-IDENT-007) -- see migration 0029's own header for why this is a distinct table/code kind, not a reused one. */
export const PASSWORD_RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_PASSWORD_RESET_ATTEMPTS_PER_CODE = 8;
export const REQUEST_PASSWORD_RESET_IP_RATE_LIMIT: RateLimitPolicy = { windowMs: 60 * 60 * 1000, max: 20 };
export const REQUEST_PASSWORD_RESET_EMAIL_RATE_LIMIT: RateLimitPolicy = { windowMs: 60 * 60 * 1000, max: 5 };
export const RESET_PASSWORD_IP_RATE_LIMIT: RateLimitPolicy = { windowMs: 15 * 60 * 1000, max: 30 };
export const RESET_PASSWORD_EMAIL_RATE_LIMIT: RateLimitPolicy = { windowMs: 15 * 60 * 1000, max: 10 };

export interface FreeAccessDefaults {
  mode: FreeAccessMode;
  durationDays: number | null;
  defaultParentMemberLimit: number;
  defaultManagedDeviceLimit: number;
}

const DEFAULT_FREE_ACCESS_MODE: FreeAccessMode = 'TIME_LIMITED';
const DEFAULT_FREE_ACCESS_DURATION_DAYS = 30; // PCA-ADD-IDENT-017's explicitly labeled illustrative default
const DEFAULT_PARENT_MEMBER_LIMIT = 4;
const DEFAULT_MANAGED_DEVICE_LIMIT = 5;

function parsePositiveInt(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer if set; got "${raw}".`);
  }
  return parsed;
}

/**
 * PCA-ADD-IDENT-017/023/024: FREE_ACCESS defaults are Platform-
 * Administration-configurable at runtime, never hardcoded production
 * values. This round ships the config SEAM (environment-variable driven,
 * validated, fail-safe -- refuses to start rather than silently
 * misconfiguring) rather than a live platform-admin UI to edit these values
 * (no such UI is requested of this lane; see this lane's final report for
 * this explicitly named gap). `EntitlementService.getOrCreateForFamily`'s
 * existing FREE_STARTER `entitlement_defaults` row is a DISTINCT, unrelated
 * source of truth for the family's entitlement row itself -- this function
 * governs the ADDITIONAL FREE_ACCESS commercial-access policy an account
 * snapshots (PCA_IMPL_DECISION_003's "Reconciliation with PCA-DEC-022"
 * section): the two numbers below are NOT read from or written into
 * `entitlement_defaults`, and a future reconciliation pass may choose to
 * compose them -- this lane does not silently merge the two tables.
 */
export function resolveFreeAccessDefaults(env: NodeJS.ProcessEnv = process.env): FreeAccessDefaults {
  const modeRaw = env.PCA_FREE_ACCESS_MODE ?? DEFAULT_FREE_ACCESS_MODE;
  if (modeRaw !== 'TIME_LIMITED' && modeRaw !== 'PERPETUAL') {
    throw new Error(`PCA_FREE_ACCESS_MODE must be TIME_LIMITED or PERPETUAL if set; got "${modeRaw}".`);
  }
  const durationDays =
    modeRaw === 'TIME_LIMITED' ? parsePositiveInt(env.PCA_FREE_ACCESS_DURATION_DAYS, DEFAULT_FREE_ACCESS_DURATION_DAYS, 'PCA_FREE_ACCESS_DURATION_DAYS') : null;
  const defaultParentMemberLimit = parsePositiveInt(env.PCA_DEFAULT_PARENT_MEMBER_LIMIT, DEFAULT_PARENT_MEMBER_LIMIT, 'PCA_DEFAULT_PARENT_MEMBER_LIMIT');
  const defaultManagedDeviceLimit = parsePositiveInt(env.PCA_DEFAULT_MANAGED_DEVICE_LIMIT, DEFAULT_MANAGED_DEVICE_LIMIT, 'PCA_DEFAULT_MANAGED_DEVICE_LIMIT');
  return { mode: modeRaw, durationDays, defaultParentMemberLimit, defaultManagedDeviceLimit };
}

export function computeFreeAccessExpiry(startedAt: Date, defaults: FreeAccessDefaults): Date | null {
  if (defaults.mode === 'PERPETUAL' || defaults.durationDays === null) return null;
  return new Date(startedAt.getTime() + defaults.durationDays * 24 * 60 * 60 * 1000);
}
