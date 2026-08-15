/**
 * FREE_ACCESS_ENFORCEMENT_V1 (ROUND6_INTERFACE_CONTRACTS.md, Writer61) --
 * the frozen account-facing status contract, derived server-side, every
 * time, from the existing Round5 `FreeAccessSnapshot`
 * (backend/src/parentaccount/types.ts) plus the server clock. NEVER
 * accepts or trusts a client-supplied remainingDays/clock/expiry -- every
 * field here is always recomputed from the snapshot + `now`.
 */
export interface FreeAccessStatus {
  mode: 'TIME_LIMITED' | 'PERPETUAL';
  /** ISO timestamp, from the existing FreeAccessSnapshot.startedAt. */
  grantedAt: string;
  /** null for PERPETUAL. */
  expiresAt: string | null;
  /** Server-computed whole days remaining; null for PERPETUAL or already-EXPIRED. 0 means "expires today" (still ACTIVE, but less than one full day of wall-clock time remains). */
  remainingDays: number | null;
  status: 'ACTIVE' | 'EXPIRED' | 'PERPETUAL';
}

export type FreeAccessEnforcementErrorCode = 'FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED';

/**
 * Thrown by `assertNewCapacityAllowed` (see enforcement.ts) -- the typed,
 * non-generic error the frozen contract's "denied" matrix requires. HTTP
 * adapters that bind this at a consumption call site must map this to a
 * meaningful, non-silent response (never a bare 403/500 with no code).
 */
export class FreeAccessEnforcementError extends Error {
  readonly code: FreeAccessEnforcementErrorCode;
  constructor(code: FreeAccessEnforcementErrorCode) {
    super(`FREE_ACCESS enforcement denied: ${code}`);
    this.name = 'FreeAccessEnforcementError';
    this.code = code;
  }
}
