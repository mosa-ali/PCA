/**
 * PCA-ADD-PA-017 (Writer65) -- the narrowest real slice of family-account
 * suspend/reactivate: sets `families.status` (migration 0016, additive)
 * under real RBAC (`SUSPEND_FAMILY_ACCOUNT`/`REACTIVATE_FAMILY_ACCOUNT`,
 * already reserved in rbacPolicy.ts), real step-up (`FAMILY_ACCOUNT_SUSPEND`/
 * `FAMILY_ACCOUNT_REACTIVATE`, already reserved in auth/types.ts), and a
 * real audit event (`ACCOUNT_SUSPENDED`/`ACCOUNT_REACTIVATED`, already
 * accepted by migration 0005's event-type CHECK constraint).
 *
 * SCOPE BOUNDARY (deliberate, see this lane's final report): this service
 * only ever WRITES `families.status`. It does NOT enforce that status
 * anywhere else -- no route in `backend/src/parentaccount/**`
 * (ParentAccountService.login, the actual family-facing session/API
 * boundary) currently checks it. That enforcement wiring is a single
 * `if (family.status === 'SUSPENDED') throw ...` guard at login time, but
 * `backend/src/parentaccount/**` is outside this lane's owned files
 * (Writer65 owns `backend/src/platformadmin/**`/`backend/src/billing/**`
 * only) -- see INTERFACE_CHANGE_REQUESTS in this lane's final report for
 * the exact proposed addition, rather than this lane silently editing a
 * file it does not own.
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

export type FamilyAccountStatusErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'ALREADY_SUSPENDED' | 'ALREADY_ACTIVE' | 'INVALID_INPUT';

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
      const { rows: existingRows } = await execute<FamilyStatusRow>(
        conn,
        `SELECT family_id, status, suspended_at, suspended_by_admin_id, suspension_reason FROM families WHERE family_id = ? AND deleted_at IS NULL FOR UPDATE`,
        [familyId],
      );
      const existing = existingRows[0];
      if (!existing) throw new FamilyAccountStatusError('NOT_FOUND');
      if (existing.status === 'SUSPENDED') throw new FamilyAccountStatusError('ALREADY_SUSPENDED');

      const { rowCount } = await execute(
        conn,
        `UPDATE families SET status = 'SUSPENDED', suspended_at = ?, suspended_by_admin_id = ?, suspension_reason = ? WHERE family_id = ? AND status = 'ACTIVE'`,
        [now, actor.adminId, reason, familyId],
      );
      if (rowCount !== 1) throw new FamilyAccountStatusError('ALREADY_SUSPENDED');

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
      const { rows: existingRows } = await execute<FamilyStatusRow>(
        conn,
        `SELECT family_id, status, suspended_at, suspended_by_admin_id, suspension_reason FROM families WHERE family_id = ? AND deleted_at IS NULL FOR UPDATE`,
        [familyId],
      );
      const existing = existingRows[0];
      if (!existing) throw new FamilyAccountStatusError('NOT_FOUND');
      if (existing.status === 'ACTIVE') throw new FamilyAccountStatusError('ALREADY_ACTIVE');

      const { rowCount } = await execute(
        conn,
        `UPDATE families SET status = 'ACTIVE', suspended_at = NULL, suspended_by_admin_id = NULL, suspension_reason = NULL WHERE family_id = ? AND status = 'SUSPENDED'`,
        [familyId],
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
