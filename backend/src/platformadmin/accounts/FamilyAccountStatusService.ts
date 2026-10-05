/**
 * PCA-ADD-PA-017 (Writer65) -- the narrowest real slice of family-account
 * suspend/reactivate: sets `families.status` (migration 0016, additive)
 * under real RBAC (`SUSPEND_FAMILY_ACCOUNT`/`REACTIVATE_FAMILY_ACCOUNT`,
 * already reserved in rbacPolicy.ts), real step-up (`FAMILY_ACCOUNT_SUSPEND`/
 * `FAMILY_ACCOUNT_REACTIVATE`, already reserved in auth/types.ts), and a
 * real audit event (`ACCOUNT_SUSPENDED`/`ACCOUNT_REACTIVATED`, already
 * accepted by migration 0005's event-type CHECK constraint).
 *
 * Suspending a family also revokes its Parent sessions, daily-login browser
 * grants, pending email login challenges, and family-bound sensitive step-up
 * grants in the same transaction. Parent grants are account-bound, so every
 * active Parent account linked to the suspended family is invalidated.
 */
import { randomUUID } from 'node:crypto';
import { execute, runInTransaction } from '../../db/pool.js';
import { authorizePlatformAdminOperation } from '../auth/rbacPolicy.js';
import type { PlatformAdminAuthService } from '../auth/PlatformAdminAuthService.js';
import type { PlatformAdminId, PlatformAdminRole, PlatformAdminSessionId, PlatformAdminStepUpId } from '../auth/types.js';
import { insertPlatformAdminAuditEventRow } from '../audit/MySqlPlatformAdminAuditRepository.js';

export interface FamilyAccountStatusActor {
  readonly adminId: PlatformAdminId;
  readonly roles: PlatformAdminRole[];
  readonly sessionId: PlatformAdminSessionId;
}

export type FamilyAccountStatusErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'ALREADY_SUSPENDED' | 'ALREADY_ACTIVE' | 'INVALID_INPUT' | 'DEVICE_SESSION_EPOCH_EXHAUSTED' | 'DEVICE_SESSION_EPOCH_INVALID';

export class FamilyAccountStatusError extends Error {
  readonly code: FamilyAccountStatusErrorCode;
  constructor(code: FamilyAccountStatusErrorCode) {
    super(`Family account status operation denied: ${code}`);
    this.name = 'FamilyAccountStatusError';
    this.code = code;
  }
}

export interface FamilyAccountStatusRecord {
  readonly familyId: string;
  readonly status: 'ACTIVE' | 'SUSPENDED';
  readonly suspendedAt: Date | null;
  readonly suspendedByAdminId: string | null;
  readonly suspensionReason: string | null;
}

interface FamilyStatusRow {
  family_id: string;
  status: 'ACTIVE' | 'SUSPENDED';
  suspended_at: Date | null;
  suspended_by_admin_id: string | null;
  suspension_reason: string | null;
}

interface FamilyStatusMutationRow extends FamilyStatusRow {
  device_session_epoch: number | bigint | string;
}

function toRecord(row: FamilyStatusRow): FamilyAccountStatusRecord {
  return {
    familyId: row.family_id,
    status: row.status,
    suspendedAt: row.suspended_at,
    suspendedByAdminId: row.suspended_by_admin_id,
    suspensionReason: row.suspension_reason,
  };
}

const REASON_MAX_LENGTH = 500;
const MAX_DEVICE_SESSION_EPOCH = 0xffff_ffff;
const MAX_DEVICE_SESSION_EPOCH_BIGINT = BigInt(MAX_DEVICE_SESSION_EPOCH);

function readDeviceSessionEpoch(value: unknown): number {
  let exact: bigint;
  try {
    if (typeof value === 'bigint') exact = value;
    else if (typeof value === 'number' && Number.isSafeInteger(value)) exact = BigInt(value);
    else if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) exact = BigInt(value);
    else throw new Error('invalid');
  } catch {
    throw new FamilyAccountStatusError('DEVICE_SESSION_EPOCH_INVALID');
  }
  if (exact < 0n || exact > MAX_DEVICE_SESSION_EPOCH_BIGINT) {
    throw new FamilyAccountStatusError('DEVICE_SESSION_EPOCH_INVALID');
  }
  return Number(exact);
}

async function revokeFamilyParentAccess(
  conn: import('mysql2/promise').PoolConnection,
  familyId: string,
  revokedAt: Date,
): Promise<void> {
  const { rows } = await execute<{ account_id: string }>(
    conn,
    `SELECT provisioned_for_account_id AS account_id
       FROM families
      WHERE family_id = ? AND provisioned_for_account_id IS NOT NULL
     UNION
     SELECT account_id
       FROM family_parent_memberships
      WHERE family_id = ? AND status = 'ACTIVE'`,
    [familyId, familyId],
  );
  const accountIds = [...new Set(rows.map((row) => row.account_id))];
  if (accountIds.length > 0) {
    const placeholders = accountIds.map(() => '?').join(', ');
    await execute(
      conn,
      `UPDATE service_sessions
          SET revoked_at = ?
        WHERE revoked_at IS NULL
          AND account_id IN (
            SELECT service_account_id FROM parent_accounts
             WHERE account_id IN (${placeholders}) AND service_account_id IS NOT NULL
          )`,
      [revokedAt, ...accountIds],
    );
    await execute(
      conn,
      `UPDATE parent_daily_login_grants
          SET revoked_at = ?
        WHERE revoked_at IS NULL AND account_id IN (${placeholders})`,
      [revokedAt, ...accountIds],
    );
    await execute(
      conn,
      `UPDATE parent_login_step_up_codes
          SET consumed_at = ?
        WHERE consumed_at IS NULL AND account_id IN (${placeholders})`,
      [revokedAt, ...accountIds],
    );
  }
  await execute(
    conn,
    `UPDATE parent_mfa_step_up_grants
        SET consumed_at = ?
      WHERE family_id = ? AND consumed_at IS NULL`,
    [revokedAt, familyId],
  );
}

export class FamilyAccountStatusService {
  constructor(
    private readonly authService: PlatformAdminAuthService,
    private readonly now: () => Date = () => new Date(),
    private readonly runTx: <T>(fn: (conn: import('mysql2/promise').PoolConnection) => Promise<T>) => Promise<T> = runInTransaction,
  ) {}

  async getStatus(familyId: string): Promise<FamilyAccountStatusRecord | null> {
    return this.runTx(async (conn) => {
      const { rows } = await execute<FamilyStatusRow>(
        conn,
        `SELECT family_id, status, suspended_at, suspended_by_admin_id, suspension_reason FROM families WHERE family_id = ? AND deleted_at IS NULL`,
        [familyId],
      );
      return rows[0] ? toRecord(rows[0]) : null;
    });
  }

  async suspend(actor: FamilyAccountStatusActor, familyId: string, reason: string, stepUpId: PlatformAdminStepUpId): Promise<FamilyAccountStatusRecord> {
    if (authorizePlatformAdminOperation(actor.roles, 'SUSPEND_FAMILY_ACCOUNT') !== 'ALLOW') throw new FamilyAccountStatusError('FORBIDDEN');
    if (reason.length === 0 || reason.length > REASON_MAX_LENGTH) throw new FamilyAccountStatusError('INVALID_INPUT');
    await this.authService.consumeStepUp(stepUpId, actor.adminId, actor.sessionId, 'FAMILY_ACCOUNT_SUSPEND');

    const now = this.now();
    return this.runTx(async (conn) => {
      const { rows: existingRows } = await execute<FamilyStatusMutationRow>(
        conn,
        `SELECT family_id, status, suspended_at, suspended_by_admin_id, suspension_reason, device_session_epoch FROM families WHERE family_id = ? AND deleted_at IS NULL FOR UPDATE`,
        [familyId],
      );
      const existing = existingRows[0];
      if (!existing) throw new FamilyAccountStatusError('NOT_FOUND');
      if (existing.status === 'SUSPENDED') throw new FamilyAccountStatusError('ALREADY_SUSPENDED');
      readDeviceSessionEpoch(existing.device_session_epoch);

      const { rowCount } = await execute(
        conn,
        `UPDATE families SET status = 'SUSPENDED', suspended_at = ?, suspended_by_admin_id = ?, suspension_reason = ?, device_session_epoch = CASE WHEN device_session_epoch < ? THEN device_session_epoch + 1 ELSE device_session_epoch END WHERE family_id = ? AND status = 'ACTIVE'`,
        [now, actor.adminId, reason, MAX_DEVICE_SESSION_EPOCH, familyId],
      );
      if (rowCount !== 1) throw new FamilyAccountStatusError('ALREADY_SUSPENDED');

      await revokeFamilyParentAccess(conn, familyId, now);

      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'ACCOUNT_SUSPENDED',
        actorAdminId: actor.adminId,
        actorRole: actor.roles[0] ?? null,
        targetRef: `family:${familyId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: { reason },
      });

      const { rows } = await execute<FamilyStatusRow>(
        conn,
        `SELECT family_id, status, suspended_at, suspended_by_admin_id, suspension_reason FROM families WHERE family_id = ?`,
        [familyId],
      );
      return toRecord(rows[0]);
    });
  }

  async reactivate(actor: FamilyAccountStatusActor, familyId: string, stepUpId: PlatformAdminStepUpId): Promise<FamilyAccountStatusRecord> {
    if (authorizePlatformAdminOperation(actor.roles, 'REACTIVATE_FAMILY_ACCOUNT') !== 'ALLOW') throw new FamilyAccountStatusError('FORBIDDEN');
    await this.authService.consumeStepUp(stepUpId, actor.adminId, actor.sessionId, 'FAMILY_ACCOUNT_REACTIVATE');

    const now = this.now();
    return this.runTx(async (conn) => {
      const { rows: existingRows } = await execute<FamilyStatusMutationRow>(
        conn,
        `SELECT family_id, status, suspended_at, suspended_by_admin_id, suspension_reason, device_session_epoch FROM families WHERE family_id = ? AND deleted_at IS NULL FOR UPDATE`,
        [familyId],
      );
      const existing = existingRows[0];
      if (!existing) throw new FamilyAccountStatusError('NOT_FOUND');
      if (existing.status === 'ACTIVE') throw new FamilyAccountStatusError('ALREADY_ACTIVE');
      if (readDeviceSessionEpoch(existing.device_session_epoch) === MAX_DEVICE_SESSION_EPOCH) {
        throw new FamilyAccountStatusError('DEVICE_SESSION_EPOCH_EXHAUSTED');
      }

      const { rowCount } = await execute(
        conn,
        `UPDATE families SET status = 'ACTIVE', suspended_at = NULL, suspended_by_admin_id = NULL, suspension_reason = NULL, device_session_epoch = device_session_epoch + 1 WHERE family_id = ? AND status = 'SUSPENDED' AND device_session_epoch < ?`,
        [familyId, MAX_DEVICE_SESSION_EPOCH],
      );
      if (rowCount !== 1) throw new FamilyAccountStatusError('ALREADY_ACTIVE');

      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'ACCOUNT_REACTIVATED',
        actorAdminId: actor.adminId,
        actorRole: actor.roles[0] ?? null,
        targetRef: `family:${familyId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: { previousSuspensionReason: existing.suspension_reason },
      });

      const { rows } = await execute<FamilyStatusRow>(
        conn,
        `SELECT family_id, status, suspended_at, suspended_by_admin_id, suspension_reason FROM families WHERE family_id = ?`,
        [familyId],
      );
      return toRecord(rows[0]);
    });
  }
}
