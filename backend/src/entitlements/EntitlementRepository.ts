import type { PoolConnection } from 'mysql2/promise';
import type { AccountEntitlementRecord, EntitlementDefaultsRecord, LimitType, OpaqueFamilyId } from './types.js';

/**
 * Persistence port for the durable per-family entitlement record and its
 * Platform-Administration-owned defaults. Every mutating method that
 * accepts a `conn` parameter MUST be called from within an existing
 * runInTransaction block on that same connection (it locks the family's
 * single row with SELECT ... FOR UPDATE and expects the caller to commit),
 * matching this codebase's existing repository convention (see
 * MySqlEnrollmentCoordinatorRepository).
 */
export interface EntitlementRepository {
  getDefaults(tier: string): Promise<EntitlementDefaultsRecord | null>;

  /** PCA-ADD-PA-024: updates the durable default; never rewrites any existing account_entitlements row. */
  updateDefaults(tier: string, parentMemberLimit: number, managedDeviceLimit: number, updatedByAdminId: string, now: Date): Promise<EntitlementDefaultsRecord>;

  getForFamily(familyId: OpaqueFamilyId): Promise<AccountEntitlementRecord | null>;

  /** Idempotent: creates the family's row from the given defaults if absent; otherwise returns the existing row unchanged. */
  getOrCreateForFamily(familyId: OpaqueFamilyId, planRef: string, defaults: EntitlementDefaultsRecord, now: Date): Promise<AccountEntitlementRecord>;

  /** Locks and returns the family's row within an existing transaction. Null if no row exists. */
  lockForFamily(conn: PoolConnection, familyId: OpaqueFamilyId): Promise<AccountEntitlementRecord | null>;

  /**
   * Sets `limitType`'s limit column to `targetLimit` (never additive) and
   * recomputes that limit's over-limit flag against current usage
   * (PCA-ADD-PA-023: never force-removes existing occupants). Caller MUST
   * already hold the row lock (via lockForFamily) on `conn`.
   */
  raiseLimit(conn: PoolConnection, familyId: OpaqueFamilyId, limitType: LimitType, targetLimit: number, now: Date): Promise<AccountEntitlementRecord>;

  /** Adjusts managed-device reserved/active counters by the given deltas (may be negative) and recomputes the over-limit flag. Caller MUST already hold the row lock. */
  adjustManagedDeviceCounts(
    conn: PoolConnection,
    familyId: OpaqueFamilyId,
    reservedDelta: number,
    activeDelta: number,
    now: Date,
  ): Promise<AccountEntitlementRecord>;

  /** Adjusts the parent-member used counter and recomputes its over-limit flag. Caller MUST already hold the row lock. */
  adjustParentMemberUsedCount(conn: PoolConnection, familyId: OpaqueFamilyId, delta: number, now: Date): Promise<AccountEntitlementRecord>;
}
