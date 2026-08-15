import type { FreeAccessSnapshot } from '../types.js';
import { FreeAccessEnforcementError } from './types.js';
import type { FreeAccessStatus } from './types.js';

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * FREE_ACCESS_ENFORCEMENT_V1's frozen derivation rule: purely a function of
 * the existing snapshot + `now` -- never reads a client-supplied clock or
 * remaining-days value, and never mutates or re-persists anything (the
 * snapshot itself stays PCA-ADD-IDENT-018's "written once, at verification"
 * artifact; this only computes a read-model view of it).
 *
 * Boundary rule (deliberately inclusive of the expiry instant itself):
 * `now.getTime() >= expiresAt.getTime()` is EXPIRED, matching "server time
 * is the sole authority" fail-closed discipline -- the instant expiry
 * arrives, access is gone, not "arrives strictly after".
 *
 * `remainingDays` is a whole-day FLOOR of the remaining wall-clock time,
 * not a ceiling: an account with 30 days left shows 30, one with 23 hours
 * left shows 0 (the UI renders 0 as "expires today", a state the frozen
 * contract explicitly calls out as distinct from a specific day count).
 */
export function deriveFreeAccessStatus(snapshot: FreeAccessSnapshot, now: Date): FreeAccessStatus {
  const grantedAt = snapshot.startedAt.toISOString();

  if (snapshot.mode === 'PERPETUAL') {
    return { mode: 'PERPETUAL', grantedAt, expiresAt: null, remainingDays: null, status: 'PERPETUAL' };
  }

  // TIME_LIMITED. migrations/0013's parent_accounts_time_limited_has_duration_check
  // guarantees a TIME_LIMITED row always carries a durationDays/expiresAt
  // pair at write time -- but this reader still treats an impossible
  // expiresAt===null defensively as already-EXPIRED (fail closed) rather
  // than granting indefinite access on an invariant violation.
  if (snapshot.expiresAt === null) {
    return { mode: 'TIME_LIMITED', grantedAt, expiresAt: null, remainingDays: null, status: 'EXPIRED' };
  }

  const expiresAtIso = snapshot.expiresAt.toISOString();
  const isExpired = now.getTime() >= snapshot.expiresAt.getTime();
  if (isExpired) {
    return { mode: 'TIME_LIMITED', grantedAt, expiresAt: expiresAtIso, remainingDays: null, status: 'EXPIRED' };
  }

  const remainingDays = Math.max(0, Math.floor((snapshot.expiresAt.getTime() - now.getTime()) / MS_PER_DAY));
  return { mode: 'TIME_LIMITED', grantedAt, expiresAt: expiresAtIso, remainingDays, status: 'ACTIVE' };
}

/**
 * The frozen contract's enforcement gate: "Allowed after EXPIRED" covers
 * auth/viewing/Billing/existing-protection-continuity; "Denied after
 * expiry" covers only NEW-capacity-consuming operations (device
 * enrollment, parent-member invite, new non-billing commercial
 * activation). This function gates exactly that second category -- callers
 * for the first category never call it at all.
 *
 * `hasActiveComplimentaryAccess` is supplied by the caller (never computed
 * here): an active COMMERCIAL_ACCESS complimentary grant
 * (Writer58/Round5's ComplimentaryEntitlementService, a completely
 * separate system) can make an account's effective commercial access
 * perpetual/extended independent of this FreeAccessSnapshot -- this
 * function does not reach into that system itself (this lane does not own
 * it), it only honors the flag its caller already resolved.
 *
 * Fails closed: PERPETUAL and ACTIVE both pass silently; only EXPIRED
 * (without an overriding complimentary grant) throws.
 */
export function assertNewCapacityAllowed(status: FreeAccessStatus, hasActiveComplimentaryAccess: boolean): void {
  if (status.status !== 'EXPIRED') return;
  if (hasActiveComplimentaryAccess) return;
  throw new FreeAccessEnforcementError('FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED');
}
