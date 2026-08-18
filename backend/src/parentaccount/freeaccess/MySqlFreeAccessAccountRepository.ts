import type { PoolConnection } from 'mysql2/promise';
import { execute, runInTransaction } from '../../db/pool.js';
import type { FreeAccessMode, FreeAccessSnapshot, ParentAccountId, ParentAccountStatus } from '../types.js';
import { computeAdjustedSnapshot } from './adjustment.js';
import type { FreeAccessAdjustmentAction } from './adjustment.js';
import type { FreeAccessAccountRepository, FreeAccessAccountRow, FreeAccessAdjustmentResult } from './FreeAccessAccountRepository.js';

interface Row {
  account_id: string;
  status: ParentAccountStatus;
  disabled_at: Date | null;
  free_access_mode: FreeAccessMode | null;
  free_access_duration_days: number | null;
  free_access_started_at: Date | null;
  free_access_expires_at: Date | null;
  default_parent_member_limit: number | null;
  default_managed_device_limit: number | null;
}

const SELECT_COLUMNS = `account_id, status, disabled_at, free_access_mode, free_access_duration_days,
       free_access_started_at, free_access_expires_at, default_parent_member_limit, default_managed_device_limit`;

function rowToFreeAccess(row: Row): FreeAccessSnapshot | null {
  if (row.free_access_mode === null) return null;
  return {
    mode: row.free_access_mode,
    durationDays: row.free_access_duration_days,
    startedAt: row.free_access_started_at as Date,
    expiresAt: row.free_access_expires_at,
    defaultParentMemberLimit: row.default_parent_member_limit as number,
    defaultManagedDeviceLimit: row.default_managed_device_limit as number,
  };
}

function rowToRecord(row: Row): FreeAccessAccountRow {
  return { accountId: row.account_id, status: row.status, disabledAt: row.disabled_at, freeAccess: rowToFreeAccess(row) };
}

export class MySqlFreeAccessAccountRepository implements FreeAccessAccountRepository {
  async findByAccountId(accountId: ParentAccountId): Promise<FreeAccessAccountRow | null> {
    const { rows } = await runInTransaction((conn) => execute<Row>(conn, `SELECT ${SELECT_COLUMNS} FROM parent_accounts WHERE account_id = ?`, [accountId]));
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async findByFamilyId(familyId: string): Promise<FreeAccessAccountRow | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<Row>(conn, `SELECT ${SELECT_COLUMNS} FROM parent_accounts WHERE family_id = ? AND status = 'VERIFIED' ORDER BY account_id LIMIT 1`, [familyId]),
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async adjustFreeAccess(accountId: ParentAccountId, action: FreeAccessAdjustmentAction, now: Date): Promise<FreeAccessAdjustmentResult | null> {
    return runInTransaction((conn) => this.adjustFreeAccessWithinTransaction(conn, accountId, action, now));
  }

  async adjustFreeAccessWithinTransaction(
    conn: PoolConnection,
    accountId: ParentAccountId,
    action: FreeAccessAdjustmentAction,
    now: Date,
  ): Promise<FreeAccessAdjustmentResult | null> {
    // FOR UPDATE: serializes concurrent admin adjustments against the SAME
    // account so a before/after audit pair is never computed from a stale
    // read racing a concurrent writer.
    const { rows } = await execute<Row>(conn, `SELECT ${SELECT_COLUMNS} FROM parent_accounts WHERE account_id = ? AND status = 'VERIFIED' FOR UPDATE`, [accountId]);
    const row = rows[0];
    if (!row) return null;
    const before = rowToFreeAccess(row);
    if (before === null) return null; // defensive: VERIFIED implies a snapshot per migration 0013's CHECK constraint, but never assume it blindly.

    const after = computeAdjustedSnapshot(before, action, now);

    // Only the three FREE_ACCESS mode/duration/expiry columns are ever
    // written here -- default_*_limit, status, and every other column on
    // this row are left completely untouched, matching this port's own
    // documented scope.
    await execute(
      conn,
      `UPDATE parent_accounts SET free_access_mode = ?, free_access_duration_days = ?, free_access_expires_at = ? WHERE account_id = ?`,
      [after.mode, after.durationDays, after.expiresAt, accountId],
    );

    return { before, after };
  }
}
