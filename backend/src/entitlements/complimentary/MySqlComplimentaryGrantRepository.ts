import type { PoolConnection } from 'mysql2/promise';
import { execute } from '../../db/pool.js';
import type { ComplimentaryGrantRepository } from './ComplimentaryGrantRepository.js';
import type {
  ComplimentaryEntitlementType,
  ComplimentaryGrantCategory,
  ComplimentaryGrantRecord,
  ComplimentaryGrantStatus,
  CreateComplimentaryGrantInput,
  OpaqueFamilyId,
} from './types.js';

interface GrantRow {
  grant_id: string;
  family_id: string;
  entitlement_type: string;
  category: string;
  amount_or_allowance: number;
  effective_from: Date;
  expires_at: Date | null;
  status: string;
  reason_code: string;
  internal_note: string | null;
  granted_by_admin_id: string;
  created_at: Date;
  revoked_at: Date | null;
  revoked_by_admin_id: string | null;
  revision: number;
}

function mapRow(row: GrantRow): ComplimentaryGrantRecord {
  return {
    grantId: row.grant_id,
    familyId: row.family_id,
    entitlementType: row.entitlement_type as ComplimentaryEntitlementType,
    category: row.category as ComplimentaryGrantCategory,
    amountOrAllowance: row.amount_or_allowance,
    effectiveFrom: row.effective_from,
    expiresAt: row.expires_at,
    status: row.status as ComplimentaryGrantStatus,
    reasonCode: row.reason_code,
    internalNote: row.internal_note,
    grantedByAdminId: row.granted_by_admin_id,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    revokedByAdminId: row.revoked_by_admin_id,
    revision: row.revision,
  };
}

async function selectById(conn: PoolConnection, grantId: string, forUpdate: boolean): Promise<ComplimentaryGrantRecord | null> {
  const { rows } = await execute<GrantRow>(
    conn,
    `SELECT * FROM complimentary_entitlement_grants WHERE grant_id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [grantId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export class MySqlComplimentaryGrantRepository implements ComplimentaryGrantRepository {
  async create(conn: PoolConnection, input: CreateComplimentaryGrantInput, grantId: string, now: Date): Promise<ComplimentaryGrantRecord> {
    await execute(
      conn,
      `INSERT INTO complimentary_entitlement_grants
         (grant_id, family_id, entitlement_type, category, amount_or_allowance, effective_from, expires_at,
          status, reason_code, internal_note, granted_by_admin_id, created_at, revoked_at, revoked_by_admin_id, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, NULL, NULL, 0)`,
      [
        grantId,
        input.familyId,
        input.entitlementType,
        input.category,
        input.amountOrAllowance,
        input.effectiveFrom,
        input.expiresAt,
        input.reasonCode,
        input.internalNote,
        input.grantedByAdminId,
        now,
      ],
    );
    const created = await selectById(conn, grantId, false);
    if (!created) throw new Error(`complimentary_entitlement_grants row missing for grant ${grantId} immediately after insert`);
    return created;
  }

  async getById(conn: PoolConnection, grantId: string): Promise<ComplimentaryGrantRecord | null> {
    return selectById(conn, grantId, false);
  }

  async lockById(conn: PoolConnection, grantId: string): Promise<ComplimentaryGrantRecord | null> {
    return selectById(conn, grantId, true);
  }

  async listForFamily(conn: PoolConnection, familyId: OpaqueFamilyId): Promise<ComplimentaryGrantRecord[]> {
    const { rows } = await execute<GrantRow>(
      conn,
      `SELECT * FROM complimentary_entitlement_grants WHERE family_id = ? ORDER BY created_at DESC, grant_id DESC`,
      [familyId],
    );
    return rows.map(mapRow);
  }

  /**
   * PCA-ADD-COMP-005: a single aggregate query is the effective-entitlement
   * summation authority -- never accumulated client-side across multiple
   * round trips, so there is no window in which a caller could observe a
   * partially-summed value.
   */
  async sumActiveAmount(conn: PoolConnection, familyId: OpaqueFamilyId, entitlementType: ComplimentaryEntitlementType, asOf: Date): Promise<number> {
    const { rows } = await execute<{ total: number | null }>(
      conn,
      `SELECT COALESCE(SUM(amount_or_allowance), 0) AS total
       FROM complimentary_entitlement_grants
       WHERE family_id = ? AND entitlement_type = ? AND status = 'ACTIVE'
         AND effective_from <= ? AND (expires_at IS NULL OR expires_at > ?)`,
      [familyId, entitlementType, asOf, asOf],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async tryRevoke(conn: PoolConnection, grantId: string, revokedByAdminId: string, now: Date): Promise<{ applied: boolean; record: ComplimentaryGrantRecord | null }> {
    const { rowCount } = await execute(
      conn,
      `UPDATE complimentary_entitlement_grants
       SET status = 'REVOKED', revoked_at = ?, revoked_by_admin_id = ?, revision = revision + 1
       WHERE grant_id = ? AND status = 'ACTIVE'`,
      [now, revokedByAdminId, grantId],
    );
    const record = await selectById(conn, grantId, false);
    return { applied: rowCount > 0, record };
  }

  async tryRenew(conn: PoolConnection, grantId: string, newExpiresAt: Date | null, now: Date): Promise<{ applied: boolean; record: ComplimentaryGrantRecord | null }> {
    void now;
    const { rowCount } = await execute(
      conn,
      `UPDATE complimentary_entitlement_grants
       SET expires_at = ?, revision = revision + 1
       WHERE grant_id = ? AND status = 'ACTIVE'`,
      [newExpiresAt, grantId],
    );
    const record = await selectById(conn, grantId, false);
    return { applied: rowCount > 0, record };
  }

  async expireDueForFamily(conn: PoolConnection, familyId: OpaqueFamilyId, now: Date): Promise<ComplimentaryGrantRecord[]> {
    const { rows: dueRows } = await execute<{ grant_id: string }>(
      conn,
      `SELECT grant_id FROM complimentary_entitlement_grants
       WHERE family_id = ? AND status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= ?`,
      [familyId, now],
    );
    if (dueRows.length === 0) return [];
    // Per-row conditional UPDATE (identical WHERE status = 'ACTIVE' guard
    // as tryRevoke/tryRenew), never a single bulk UPDATE: a bulk statement's
    // affected-row count cannot tell us WHICH rows it transitioned, and a
    // concurrent instance may have already expired a subset of dueRows
    // between the SELECT above and this loop -- only a row THIS call's own
    // conditional UPDATE actually flips from ACTIVE is reported back, so
    // "exactly one COMPLIMENTARY_GRANT_EXPIRED audit event per transitioned
    // row" (never a duplicate from two instances racing the same sweep) is
    // guaranteed the same way tryRevoke/tryConsume already guarantee it.
    const expired: ComplimentaryGrantRecord[] = [];
    for (const { grant_id: grantId } of dueRows) {
      const { rowCount } = await execute(
        conn,
        `UPDATE complimentary_entitlement_grants
         SET status = 'EXPIRED', revision = revision + 1
         WHERE grant_id = ? AND status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= ?`,
        [grantId, now],
      );
      if (rowCount === 0) continue;
      const record = await selectById(conn, grantId, false);
      if (record) expired.push(record);
    }
    return expired;
  }
}
