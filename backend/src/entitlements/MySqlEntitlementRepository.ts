import type { PoolConnection } from 'mysql2/promise';
import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type { ComplimentaryGrantRepository } from './complimentary/ComplimentaryGrantRepository.js';
import { baseOnlyEffectiveEntitlementSnapshot, computeEffectiveEntitlementSnapshot } from './complimentary/EffectiveEntitlementCapacity.js';
import type { EffectiveEntitlementBaseUsage, EffectiveEntitlementSnapshot } from './complimentary/types.js';
import type { EntitlementRepository } from './EntitlementRepository.js';
import type { AccountEntitlementRecord, EntitlementDefaultsRecord, LimitType, OpaqueFamilyId } from './types.js';

interface DefaultsRow {
  tier: string;
  parent_member_limit: number;
  managed_device_limit: number;
  updated_at: Date;
  updated_by_admin_id: string | null;
}

interface EntitlementRow {
  family_id: string;
  plan_ref: string;
  parent_member_limit: number;
  managed_device_limit: number;
  parent_member_used_count: number;
  managed_device_active_count: number;
  managed_device_reserved_count: number;
  over_limit_parent_member: number;
  over_limit_managed_device: number;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

function mapDefaults(row: DefaultsRow): EntitlementDefaultsRecord {
  return {
    tier: row.tier,
    parentMemberLimit: row.parent_member_limit,
    managedDeviceLimit: row.managed_device_limit,
    updatedAt: row.updated_at,
    updatedByAdminId: row.updated_by_admin_id,
  };
}

function mapEntitlement(row: EntitlementRow): AccountEntitlementRecord {
  return {
    familyId: row.family_id,
    planRef: row.plan_ref,
    parentMemberLimit: row.parent_member_limit,
    managedDeviceLimit: row.managed_device_limit,
    parentMemberUsedCount: row.parent_member_used_count,
    managedDeviceActiveCount: row.managed_device_active_count,
    managedDeviceReservedCount: row.managed_device_reserved_count,
    overLimitParentMember: row.over_limit_parent_member === 1,
    overLimitManagedDevice: row.over_limit_managed_device === 1,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function selectForFamily(conn: PoolConnection, familyId: OpaqueFamilyId, forUpdate: boolean): Promise<AccountEntitlementRecord | null> {
  const { rows } = await execute<EntitlementRow>(
    conn,
    `SELECT * FROM account_entitlements WHERE family_id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [familyId],
  );
  return rows[0] ? mapEntitlement(rows[0]) : null;
}

function toBaseUsage(entitlement: AccountEntitlementRecord): EffectiveEntitlementBaseUsage {
  return {
    parentMemberLimit: entitlement.parentMemberLimit,
    managedDeviceLimit: entitlement.managedDeviceLimit,
    parentMemberUsed: entitlement.parentMemberUsedCount,
    managedDeviceActive: entitlement.managedDeviceActiveCount,
    managedDeviceReserved: entitlement.managedDeviceReservedCount,
  };
}

export class MySqlEntitlementRepository implements EntitlementRepository {
  /**
   * EFFECTIVE_ENTITLEMENT_V2 (PCA-COMPLIMENTARY-CONSUMPTION-1, Writer60
   * Round6): optional so every EXISTING `new MySqlEntitlementRepository()`
   * call site (main.ts, tests) keeps compiling unchanged -- when absent,
   * every method below degrades byte-for-byte to its pre-Round6 base-only
   * behavior (zero regression). Wiring a real
   * `ComplimentaryGrantRepository` here (Coordinator follow-up -- see
   * WRITER60 final report's INTERFACE_CHANGE_REQUEST) is what actually
   * closes the consumption-side gap in production.
   */
  private readonly complimentaryGrantRepository: ComplimentaryGrantRepository | null;

  constructor(complimentaryGrantRepository?: ComplimentaryGrantRepository) {
    this.complimentaryGrantRepository = complimentaryGrantRepository ?? null;
  }

  async getDefaults(tier: string): Promise<EntitlementDefaultsRecord | null> {
    const { rows } = await runInTransaction((conn) => execute<DefaultsRow>(conn, `SELECT * FROM entitlement_defaults WHERE tier = ?`, [tier]));
    return rows[0] ? mapDefaults(rows[0]) : null;
  }

  async updateDefaults(tier: string, parentMemberLimit: number, managedDeviceLimit: number, updatedByAdminId: string, now: Date): Promise<EntitlementDefaultsRecord> {
    return runInTransaction(async (conn) => {
      await execute(
        conn,
        `UPDATE entitlement_defaults SET parent_member_limit = ?, managed_device_limit = ?, updated_at = ?, updated_by_admin_id = ? WHERE tier = ?`,
        [parentMemberLimit, managedDeviceLimit, now, updatedByAdminId, tier],
      );
      const { rows } = await execute<DefaultsRow>(conn, `SELECT * FROM entitlement_defaults WHERE tier = ?`, [tier]);
      if (!rows[0]) throw new Error(`entitlement_defaults row missing for tier ${tier}`);
      return mapDefaults(rows[0]);
    });
  }

  async getForFamily(familyId: OpaqueFamilyId): Promise<AccountEntitlementRecord | null> {
    return runInTransaction((conn) => selectForFamily(conn, familyId, false));
  }

  /**
   * Idempotent create: attempts the INSERT directly (no read-then-write
   * race window); a duplicate-key error means another concurrent caller
   * already created the row, which is then simply re-read -- mirrors the
   * isDuplicateEntry idiom used throughout this codebase's other
   * repositories (e.g. MySqlEnrollmentCoordinatorRepository's key insert).
   */
  async getOrCreateForFamily(familyId: OpaqueFamilyId, planRef: string, defaults: EntitlementDefaultsRecord, now: Date): Promise<AccountEntitlementRecord> {
    return runInTransaction(async (conn) => {
      try {
        await execute(
          conn,
          `INSERT INTO account_entitlements
             (family_id, plan_ref, parent_member_limit, managed_device_limit, parent_member_used_count,
              managed_device_active_count, managed_device_reserved_count, over_limit_parent_member,
              over_limit_managed_device, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?)`,
          [familyId, planRef, defaults.parentMemberLimit, defaults.managedDeviceLimit, now, now],
        );
      } catch (error) {
        if (!isDuplicateEntry(error)) throw error;
      }
      const existing = await selectForFamily(conn, familyId, false);
      if (!existing) throw new Error(`account_entitlements row missing for family ${familyId} after getOrCreate`);
      return existing;
    });
  }

  async lockForFamily(conn: PoolConnection, familyId: OpaqueFamilyId): Promise<AccountEntitlementRecord | null> {
    return selectForFamily(conn, familyId, true);
  }

  /**
   * PCA-ADD-PA-023: the over-limit flag is always recomputed FRESH against
   * current usage (never merely cleared-if-satisfied) -- a downgrade whose
   * new limit is below current usage must flip the flag to 1, not leave a
   * stale 0 in place. Existing occupants are never touched by this method;
   * only the limit column and the derived flag change.
   */
  /**
   * EFFECTIVE_ENTITLEMENT_V2: the over-limit flag now compares current
   * usage against `targetLimit + complimentaryAmount` (the EFFECTIVE
   * limit), not `targetLimit` alone -- `complimentaryAmount` is read via
   * `ComplimentaryGrantRepository.sumActiveAmount` (the SAME canonical
   * query `EffectiveEntitlementCapacity.computeEffectiveEntitlementSnapshot`
   * calls) on THIS connection, so it observes the same in-flight grant
   * state any other consumption decision inside the same transaction
   * would. When no complimentaryGrantRepository is wired, complimentaryAmount
   * is 0 and this is byte-for-byte the pre-Round6 base-only formula.
   */
  async raiseLimit(conn: PoolConnection, familyId: OpaqueFamilyId, limitType: LimitType, targetLimit: number, now: Date): Promise<AccountEntitlementRecord> {
    const complimentaryAmount = this.complimentaryGrantRepository
      ? await this.complimentaryGrantRepository.sumActiveAmount(conn, familyId, limitType === 'MANAGED_DEVICE_LIMIT' ? 'MANAGED_DEVICE_CAPACITY' : 'PARENT_MEMBER_CAPACITY', now)
      : 0;
    if (limitType === 'MANAGED_DEVICE_LIMIT') {
      await execute(
        conn,
        `UPDATE account_entitlements
         SET managed_device_limit = ?, revision = revision + 1, updated_at = ?,
             over_limit_managed_device = CASE WHEN (? + ?) < (managed_device_active_count + managed_device_reserved_count) THEN 1 ELSE 0 END
         WHERE family_id = ?`,
        [targetLimit, now, targetLimit, complimentaryAmount, familyId],
      );
    } else {
      await execute(
        conn,
        `UPDATE account_entitlements
         SET parent_member_limit = ?, revision = revision + 1, updated_at = ?,
             over_limit_parent_member = CASE WHEN (? + ?) < parent_member_used_count THEN 1 ELSE 0 END
         WHERE family_id = ?`,
        [targetLimit, now, targetLimit, complimentaryAmount, familyId],
      );
    }
    const updated = await selectForFamily(conn, familyId, false);
    if (!updated) throw new Error(`account_entitlements row missing for family ${familyId} after raiseLimit`);
    return updated;
  }

  /** EFFECTIVE_ENTITLEMENT_V2: `over_limit_managed_device` now compares against `managed_device_limit + complimentaryAmount` -- see raiseLimit's doc comment for the same complimentaryAmount-sourcing rule. */
  async adjustManagedDeviceCounts(conn: PoolConnection, familyId: OpaqueFamilyId, reservedDelta: number, activeDelta: number, now: Date): Promise<AccountEntitlementRecord> {
    const complimentaryAmount = this.complimentaryGrantRepository
      ? await this.complimentaryGrantRepository.sumActiveAmount(conn, familyId, 'MANAGED_DEVICE_CAPACITY', now)
      : 0;
    await execute(
      conn,
      // MySQL evaluates single-table SET assignments LEFT TO RIGHT, and a
      // later expression reads the value an earlier assignment already
      // wrote. The over_limit_* CASE therefore MUST be assigned BEFORE the
      // count columns it re-derives, or it reads count+delta and adds delta
      // a second time -- flagging a family that exactly fills its limit as
      // over it. Verified against MySQL 8.4: with the CASE last,
      // (limit 2, reserved 1, +1) yielded over_limit_managed_device = 1.
      `UPDATE account_entitlements
       SET over_limit_managed_device = CASE
             WHEN (managed_device_limit + ?) < GREATEST(managed_device_reserved_count + ?, 0) + GREATEST(managed_device_active_count + ?, 0) THEN 1
             ELSE 0
           END,
           managed_device_reserved_count = GREATEST(managed_device_reserved_count + ?, 0),
           managed_device_active_count = GREATEST(managed_device_active_count + ?, 0),
           revision = revision + 1,
           updated_at = ?
       WHERE family_id = ?`,
      [complimentaryAmount, reservedDelta, activeDelta, reservedDelta, activeDelta, now, familyId],
    );
    const updated = await selectForFamily(conn, familyId, false);
    if (!updated) throw new Error(`account_entitlements row missing for family ${familyId} after adjustManagedDeviceCounts`);
    return updated;
  }

  /**
   * EFFECTIVE_ENTITLEMENT_V2: `over_limit_parent_member` now compares
   * against `parent_member_limit + complimentaryAmount`. Per the
   * PARENT_MEMBER_CONSUMPTION_BINDING_REQUIRED finding (WRITER60 final
   * report), this method still has zero real callers anywhere in the
   * backend -- fixed here for correctness/consistency (so the flag it
   * WOULD compute is correct the moment a caller is bound), not because a
   * live gap was closed.
   */
  async adjustParentMemberUsedCount(conn: PoolConnection, familyId: OpaqueFamilyId, delta: number, now: Date): Promise<AccountEntitlementRecord> {
    const complimentaryAmount = this.complimentaryGrantRepository
      ? await this.complimentaryGrantRepository.sumActiveAmount(conn, familyId, 'PARENT_MEMBER_CAPACITY', now)
      : 0;
    await execute(
      conn,
      // Same left-to-right SET-evaluation rule as adjustManagedDeviceCounts
      // above: the over_limit_* CASE is assigned FIRST so it re-derives the
      // new count from the OLD column value exactly once.
      `UPDATE account_entitlements
       SET over_limit_parent_member = CASE
             WHEN (parent_member_limit + ?) < GREATEST(parent_member_used_count + ?, 0) THEN 1
             ELSE 0
           END,
           parent_member_used_count = GREATEST(parent_member_used_count + ?, 0),
           revision = revision + 1,
           updated_at = ?
       WHERE family_id = ?`,
      [complimentaryAmount, delta, delta, now, familyId],
    );
    const updated = await selectForFamily(conn, familyId, false);
    if (!updated) throw new Error(`account_entitlements row missing for family ${familyId} after adjustParentMemberUsedCount`);
    return updated;
  }

  async getEffectiveSnapshotForFamily(familyId: OpaqueFamilyId, now: Date): Promise<EffectiveEntitlementSnapshot | null> {
    return runInTransaction((conn) => this.getEffectiveSnapshotForFamilyOnConnection(conn, familyId, now));
  }

  /**
   * Identical arithmetic to getEffectiveSnapshotForFamily, but on the
   * caller's own connection so it observes a lockForFamily() taken there --
   * see the interface's doc comment for why a seat-admission decision must
   * never read through the self-transacting variant.
   */
  async getEffectiveSnapshotForFamilyOnConnection(
    conn: PoolConnection,
    familyId: OpaqueFamilyId,
    now: Date,
  ): Promise<EffectiveEntitlementSnapshot | null> {
    const entitlement = await selectForFamily(conn, familyId, false);
    if (!entitlement) return null;
    const base = toBaseUsage(entitlement);
    if (!this.complimentaryGrantRepository) return baseOnlyEffectiveEntitlementSnapshot(base);
    return computeEffectiveEntitlementSnapshot(conn, this.complimentaryGrantRepository, familyId, base, now);
  }
}
