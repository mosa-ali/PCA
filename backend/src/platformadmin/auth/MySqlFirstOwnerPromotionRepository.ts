import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { execute, runInTransaction } from '../../db/pool.js';
import { insertPlatformAdminAuditEventRow } from '../audit/MySqlPlatformAdminAuditRepository.js';
import type { PlatformAdminId, PlatformAdminRole } from './types.js';

/**
 * PCA-PA-1 owner-architecture decision (2026-09-15): the first APP_OWNER is
 * not always a brand-new account. When the operator's authorized decision
 * is instead "grant APP_OWNER to an already-existing, already-ACTIVE
 * Platform Admin," this is the dedicated, hardened path for exactly that
 * one-time condition -- NOT a general-purpose role-assignment operation
 * (that already exists: `PlatformAdminAccountService.assignRole`, gated by
 * `MANAGE_ADMIN_ACCOUNTS`/`ASSIGN_ADMIN_ROLE`, requiring an authenticated
 * APP_OWNER actor). This path exists because, by definition, the
 * zero-owner moment has no authenticated APP_OWNER actor to invoke that
 * ordinary path with -- exactly the same reason
 * `MySqlFirstOwnerBootstrapRepository.createFirstOwnerBootstrap` exists
 * for the "brand-new account" variant of the same problem.
 *
 * Deliberately reuses the exact same DB-level shape ordinary role grants
 * already use (an INSERT into `platform_admin_role_assignments`, protected
 * by `platform_admin_role_assignments_admin_active_key`'s UNIQUE
 * (admin_id, active_role_marker) constraint -- see migration 0005's
 * comment) -- this is not new authorization machinery, just a new,
 * narrowly-scoped caller for the existing one. `authorizePlatformAdminOperation`
 * (rbacPolicy.ts) already evaluates the FULL active-role set via
 * `roles.some(...)`, with no role-order dependency, so an admin holding
 * both `PLATFORM_ADMIN` and `APP_OWNER` after this runs is already
 * correctly authorized for the union of both roles' permissions -- nothing
 * about authorization evaluation needed to change for this feature.
 *
 * Never touches `password_credential`, `platform_admin_mfa_state`, or
 * creates any new `platform_admin_accounts` row -- this function's only
 * writes are one new `platform_admin_role_assignments` row and one
 * `ADMIN_ROLE_CHANGED` audit event, inside one transaction.
 */
export type FirstOwnerPromotionRefusalReason = 'ACCOUNT_NOT_FOUND' | 'ACCOUNT_NOT_ACTIVE' | 'ALREADY_APP_OWNER';

export class FirstOwnerPromotionError extends Error {
  readonly reason: FirstOwnerPromotionRefusalReason;
  constructor(reason: FirstOwnerPromotionRefusalReason) {
    super(`First-owner promotion refused: ${reason}`);
    this.name = 'FirstOwnerPromotionError';
    this.reason = reason;
  }
}

export interface PromoteExistingAccountToFirstOwnerInput {
  /** SHA-256 of the normalized target email (emailHash.ts's own hashAdminEmail) -- never the raw email persisted or logged by this function. */
  readonly emailHash: Buffer;
  readonly assignmentId: string;
  readonly grantedAt: Date;
  readonly auditEventId: string;
  readonly correlationId: string;
}

export interface PromoteExistingAccountToFirstOwnerResult {
  readonly adminId: PlatformAdminId;
  readonly previousRoles: readonly PlatformAdminRole[];
  readonly newRoles: readonly PlatformAdminRole[];
}

interface AccountRow extends RowDataPacket {
  admin_id: string;
  status: string;
}
interface RoleRow extends RowDataPacket {
  role: string;
}

/**
 * Caller contract: must run with the SAME advisory lock
 * (`pca:first-app-owner-bootstrap`, see scripts/bootstrap-platform-owner.mjs)
 * held, and must re-check `ACTIVE_APP_OWNER_COUNT=0` while holding it,
 * exactly like `createFirstOwnerBootstrap`'s caller does -- this function
 * does not itself acquire the lock (it is a plain DB transaction, reusable
 * by tests without needing a real lock), but it is NOT safe to call
 * concurrently with either itself or `createFirstOwnerBootstrap` outside
 * that lock, since both mutate the same "is there an active owner yet"
 * invariant. Row-level locking inside this transaction
 * (`SELECT ... FOR UPDATE`) is defense in depth, not a substitute for the
 * advisory lock's own precondition re-check.
 */
export async function promoteExistingAccountToFirstOwner(
  input: PromoteExistingAccountToFirstOwnerInput,
): Promise<PromoteExistingAccountToFirstOwnerResult> {
  return runInTransaction(async (conn: PoolConnection) => {
    const { rows: accountRows } = await execute<AccountRow>(
      conn,
      `SELECT admin_id, status FROM platform_admin_accounts WHERE email_hash = ? FOR UPDATE`,
      [input.emailHash],
    );
    const account = accountRows[0];
    if (!account) throw new FirstOwnerPromotionError('ACCOUNT_NOT_FOUND');
    if (account.status !== 'ACTIVE') throw new FirstOwnerPromotionError('ACCOUNT_NOT_ACTIVE');

    const { rows: roleRows } = await execute<RoleRow>(
      conn,
      `SELECT role FROM platform_admin_role_assignments WHERE admin_id = ? AND revoked_at IS NULL FOR UPDATE`,
      [account.admin_id],
    );
    const previousRoles = roleRows.map((row) => row.role as PlatformAdminRole);
    if (previousRoles.includes('APP_OWNER')) throw new FirstOwnerPromotionError('ALREADY_APP_OWNER');

    // Same INSERT shape ordinary assignRole uses (MySqlAuthRepository.assignRole)
    // -- protected by the identical UNIQUE (admin_id, active_role_marker)
    // constraint, so a concurrent duplicate grant of APP_OWNER to this SAME
    // admin_id (e.g. two racing promotion attempts) fails with ER_DUP_ENTRY
    // rather than silently succeeding twice.
    await execute(
      conn,
      `INSERT INTO platform_admin_role_assignments (assignment_id, admin_id, role, granted_at, revoked_at, granted_by_admin_id)
       VALUES (?, ?, 'APP_OWNER', ?, NULL, NULL)`,
      [input.assignmentId, account.admin_id, input.grantedAt],
    );

    const newRoles = [...previousRoles, 'APP_OWNER' as PlatformAdminRole];
    await insertPlatformAdminAuditEventRow(conn, {
      eventId: input.auditEventId,
      eventType: 'ADMIN_ROLE_CHANGED',
      actorAdminId: null, // NULL = system/bootstrap-granted, matching migration 0005's convention for the original bootstrap.
      actorRole: null,
      targetRef: `admin:${account.admin_id}`,
      result: 'SUCCESS',
      occurredAt: input.grantedAt,
      correlationId: input.correlationId,
      metadata: {
        action: 'GRANTED',
        role: 'APP_OWNER',
        source: 'FIRST_OWNER_PROMOTION',
        previousRoles,
        newRoles,
      },
    });

    return { adminId: account.admin_id, previousRoles, newRoles };
  });
}
