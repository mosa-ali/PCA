import type { PoolConnection } from 'mysql2/promise';
import type { EffectiveEntitlementSnapshot } from './complimentary/types.js';
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

  /**
   * EFFECTIVE_ENTITLEMENT_V2 (PCA-COMPLIMENTARY-CONSUMPTION-1, Writer60
   * Round6) -- additive, read-only. Returns the family's current
   * EffectiveEntitlementSnapshot (base + ACTIVE complimentary grants) via
   * the same SSOT arithmetic every consumption decision in this codebase
   * uses (`complimentary/EffectiveEntitlementCapacity
   * .computeEffectiveEntitlementSnapshot`). Null if no account_entitlements
   * row exists for the family yet. Never removes/renames any base-only
   * method above -- callers that only need the base limit keep using
   * getForFamily/lockForFamily exactly as before.
   */
  getEffectiveSnapshotForFamily(familyId: OpaqueFamilyId, now: Date): Promise<EffectiveEntitlementSnapshot | null>;

  /**
   * Connection-scoped variant of the method above: reads through the
   * CALLER'S OWN transaction connection instead of opening its own.
   *
   * This exists because `getEffectiveSnapshotForFamily` opens its own
   * transaction on its own pooled connection, so a caller that has just
   * taken `lockForFamily(conn, ...)` would not observe that lock through it
   * -- the capacity decision would be read outside the very serialization
   * it depends on. Any seat-admission decision (see
   * FamilyMemberInvitationService.createInvitation, and the same shape
   * MySqlSlotReservationRepository.reserve already uses inline) MUST use
   * this one, on the same `conn` it locked.
   */
  getEffectiveSnapshotForFamilyOnConnection(
    conn: PoolConnection,
    familyId: OpaqueFamilyId,
    now: Date,
  ): Promise<EffectiveEntitlementSnapshot | null>;
}
