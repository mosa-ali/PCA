import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { execute, runInTransaction } from '../../db/pool.js';
import { insertPlatformAdminAuditEventRow } from '../audit/MySqlPlatformAdminAuditRepository.js';
import type {
  AssignRoleInput,
  ConsumeStepUpInput,
  CreateAccountInput,
  CreateStepUpInput,
  PlatformAdminAuthRepository,
  RecordLoginAttemptInput,
  RevokeRoleResult,
  SessionValidationLookup,
} from './AuthRepository.js';
import type {
  PlatformAdminAccountRecord,
  PlatformAdminId,
  PlatformAdminMfaStateRecord,
  PlatformAdminRole,
  PlatformAdminRoleAssignmentRecord,
  PlatformAdminSessionId,
  PlatformAdminSessionRecord,
  PlatformAdminStepUpSessionRecord,
} from './types.js';
import type { PlatformAdminAuditEvent } from '../audit/types.js';

interface AccountRow extends RowDataPacket {
  admin_id: string;
  email_hash: Buffer;
  display_name: string;
  password_credential: string;
  status: string;
  created_at: Date;
  disabled_at: Date | null;
}

interface RoleAssignmentRow extends RowDataPacket {
  assignment_id: string;
  admin_id: string;
  role: string;
  granted_at: Date;
  revoked_at: Date | null;
  granted_by_admin_id: string | null;
}

interface MfaStateRow extends RowDataPacket {
  admin_id: string;
  status: string;
  totp_secret_ciphertext: Buffer | null;
  totp_secret_nonce: Buffer | null;
  activated_at: Date | null;
  created_at: Date;
}

interface SessionRow extends RowDataPacket {
  session_id: string;
  admin_id: string;
  token_hash: string;
  realm: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  account_status: string;
}

interface StepUpRow extends RowDataPacket {
  step_up_id: string;
  admin_id: string;
  session_id: string;
  scope: string;
  asserted_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

function toAccount(row: AccountRow): PlatformAdminAccountRecord {
  return {
    adminId: row.admin_id,
    emailHash: row.email_hash,
    displayName: row.display_name,
    passwordCredential: row.password_credential,
    status: row.status as PlatformAdminAccountRecord['status'],
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  };
}

function toRoleAssignment(row: RoleAssignmentRow): PlatformAdminRoleAssignmentRecord {
  return {
    assignmentId: row.assignment_id,
    adminId: row.admin_id,
    role: row.role as PlatformAdminRole,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    grantedByAdminId: row.granted_by_admin_id,
  };
}

function toMfaState(row: MfaStateRow): PlatformAdminMfaStateRecord {
  return {
    adminId: row.admin_id,
    status: row.status as PlatformAdminMfaStateRecord['status'],
    totpSecretCiphertext: row.totp_secret_ciphertext,
    totpSecretNonce: row.totp_secret_nonce,
    activatedAt: row.activated_at,
    createdAt: row.created_at,
  };
}

function toStepUp(row: StepUpRow): PlatformAdminStepUpSessionRecord {
  return {
    stepUpId: row.step_up_id,
    adminId: row.admin_id,
    sessionId: row.session_id,
    scope: row.scope as PlatformAdminStepUpSessionRecord['scope'],
    assertedAt: row.asserted_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

/**
 * Revokes every currently-active session for an admin ON THE GIVEN
 * CONNECTION (so a caller already inside a transaction -- role
 * revocation, account disable -- gets exactly-once, atomic cascade
 * revocation, per PCA-ADD-PA-019). One ADMIN_SESSION_REVOKED audit event
 * is written per session revoked (a documented choice: a summary "N
 * sessions revoked" single event was the alternative, but per-session
 * events keep target_ref unambiguous and let a reviewer trace exactly
 * which session a given revocation event corresponds to).
 */
async function revokeActiveSessionsOnConnection(
  conn: PoolConnection,
  adminId: PlatformAdminId,
  revokedAt: Date,
  buildAuditEvent: (sessionId: PlatformAdminSessionId) => PlatformAdminAuditEvent,
): Promise<RevokeRoleResult> {
  const { rows } = await execute<SessionRow>(
    conn,
    `SELECT session_id FROM platform_admin_sessions WHERE admin_id = ? AND revoked_at IS NULL FOR UPDATE`,
    [adminId],
  );
  const sessionIds = rows.map((row) => row.session_id);
  if (sessionIds.length === 0) return { revokedSessionIds: [] };

  await execute(
    conn,
    `UPDATE platform_admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL`,
    [revokedAt, adminId],
  );
  for (const sessionId of sessionIds) {
    await insertPlatformAdminAuditEventRow(conn, buildAuditEvent(sessionId));
  }
  return { revokedSessionIds: sessionIds };
}

export class MySqlPlatformAdminAuthRepository implements PlatformAdminAuthRepository {
  async createAccount(input: CreateAccountInput): Promise<PlatformAdminAccountRecord> {
    return runInTransaction(async (conn) => {
      await execute(
        conn,
        `INSERT INTO platform_admin_accounts (admin_id, email_hash, display_name, password_credential, status, created_at, disabled_at)
         VALUES (?, ?, ?, ?, 'ACTIVE', ?, NULL)`,
        [input.adminId, input.emailHash, input.displayName, input.passwordCredential, input.createdAt],
      );
      await execute(
        conn,
        `INSERT INTO platform_admin_role_assignments (assignment_id, admin_id, role, granted_at, revoked_at, granted_by_admin_id)
         VALUES (?, ?, ?, ?, NULL, ?)`,
        [input.assignmentId, input.adminId, input.role, input.grantedAt, input.grantedByAdminId],
      );
      await execute(
        conn,
        `INSERT INTO platform_admin_mfa_state (admin_id, status, totp_secret_ciphertext, totp_secret_nonce, activated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          input.adminId,
          input.initialMfa.status,
          input.initialMfa.totpSecretCiphertext,
          input.initialMfa.totpSecretNonce,
          input.initialMfa.activatedAt,
          input.initialMfa.createdAt,
        ],
      );
      for (const auditEvent of input.auditEvents) {
        await insertPlatformAdminAuditEventRow(conn, auditEvent);
      }
      return {
        adminId: input.adminId,
        emailHash: input.emailHash,
        displayName: input.displayName,
        passwordCredential: input.passwordCredential,
        status: 'ACTIVE',
        createdAt: input.createdAt,
        disabledAt: null,
      };
    });
  }

  async findAccountByEmailHash(emailHash: Buffer): Promise<PlatformAdminAccountRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<AccountRow>(conn, `SELECT * FROM platform_admin_accounts WHERE email_hash = ?`, [emailHash]),
    );
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async findAccountById(adminId: PlatformAdminId): Promise<PlatformAdminAccountRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<AccountRow>(conn, `SELECT * FROM platform_admin_accounts WHERE admin_id = ?`, [adminId]),
    );
    return rows[0] ? toAccount(rows[0]) : null;
  }

  async findActiveRoles(adminId: PlatformAdminId): Promise<PlatformAdminRole[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<RoleAssignmentRow>(
        conn,
        `SELECT * FROM platform_admin_role_assignments WHERE admin_id = ? AND revoked_at IS NULL`,
        [adminId],
      ),
    );
    return rows.map((row) => row.role as PlatformAdminRole);
  }

  async findActiveRoleAssignments(adminId: PlatformAdminId): Promise<PlatformAdminRoleAssignmentRecord[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<RoleAssignmentRow>(
        conn,
        `SELECT * FROM platform_admin_role_assignments WHERE admin_id = ? AND revoked_at IS NULL`,
        [adminId],
      ),
    );
    return rows.map(toRoleAssignment);
  }

  async assignRole(input: AssignRoleInput): Promise<void> {
    await runInTransaction(async (conn) => {
      // Duplicate ACTIVE (admin_id, role) grants are rejected by
      // platform_admin_role_assignments_admin_active_key (see migration
      // 0005's comment) -- this INSERT surfaces that as an ER_DUP_ENTRY the
      // caller (PlatformAdminAccountService.assignRole) maps to its single
      // generic domain error.
      await execute(
        conn,
        `INSERT INTO platform_admin_role_assignments (assignment_id, admin_id, role, granted_at, revoked_at, granted_by_admin_id)
         VALUES (?, ?, ?, ?, NULL, ?)`,
        [input.assignmentId, input.adminId, input.role, input.grantedAt, input.grantedByAdminId],
      );
      await insertPlatformAdminAuditEventRow(conn, input.auditEvent);
    });
  }

  async revokeRole(input: {
    adminId: PlatformAdminId;
    role: PlatformAdminRole;
    revokedAt: Date;
    auditEvent: PlatformAdminAuditEvent;
  }): Promise<RevokeRoleResult> {
    return runInTransaction(async (conn) => {
      await execute(
        conn,
        `UPDATE platform_admin_role_assignments SET revoked_at = ? WHERE admin_id = ? AND role = ? AND revoked_at IS NULL`,
        [input.revokedAt, input.adminId, input.role],
      );
      await insertPlatformAdminAuditEventRow(conn, input.auditEvent);
      // PCA-ADD-PA-019: role removal forces every active session for this
      // admin to be revoked in the SAME transaction -- even if the admin
      // is left with zero active roles (a valid "fully disabled" state),
      // never leaving a live session behind a stale role set.
      return revokeActiveSessionsOnConnection(conn, input.adminId, input.revokedAt, (sessionId) => ({
        eventId: randomUUID(),
        eventType: 'ADMIN_SESSION_REVOKED',
        actorAdminId: input.auditEvent.actorAdminId,
        actorRole: input.auditEvent.actorRole,
        targetRef: `session:${sessionId}`,
        result: 'SUCCESS',
        occurredAt: input.revokedAt,
        correlationId: input.auditEvent.correlationId,
        metadata: { reason: 'ROLE_REVOKED', adminId: input.adminId },
      }));
    });
  }

  async disableAccount(input: { adminId: PlatformAdminId; disabledAt: Date; auditEvent: PlatformAdminAuditEvent }): Promise<RevokeRoleResult> {
    return runInTransaction(async (conn) => {
      await execute(
        conn,
        `UPDATE platform_admin_accounts SET status = 'DISABLED', disabled_at = ? WHERE admin_id = ?`,
        [input.disabledAt, input.adminId],
      );
      await insertPlatformAdminAuditEventRow(conn, input.auditEvent);
      return revokeActiveSessionsOnConnection(conn, input.adminId, input.disabledAt, (sessionId) => ({
        eventId: randomUUID(),
        eventType: 'ADMIN_SESSION_REVOKED',
        actorAdminId: input.auditEvent.actorAdminId,
        actorRole: input.auditEvent.actorRole,
        targetRef: `session:${sessionId}`,
        result: 'SUCCESS',
        occurredAt: input.disabledAt,
        correlationId: input.auditEvent.correlationId,
        metadata: { reason: 'ACCOUNT_DISABLED', adminId: input.adminId },
      }));
    });
  }

  async reactivateAccount(input: { adminId: PlatformAdminId; auditEvent: PlatformAdminAuditEvent }): Promise<void> {
    await runInTransaction(async (conn) => {
      await execute(
        conn,
        `UPDATE platform_admin_accounts SET status = 'ACTIVE', disabled_at = NULL WHERE admin_id = ?`,
        [input.adminId],
      );
      await insertPlatformAdminAuditEventRow(conn, input.auditEvent);
    });
  }

  async getMfaState(adminId: PlatformAdminId): Promise<PlatformAdminMfaStateRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<MfaStateRow>(conn, `SELECT * FROM platform_admin_mfa_state WHERE admin_id = ?`, [adminId]),
    );
    return rows[0] ? toMfaState(rows[0]) : null;
  }

  async createSession(record: PlatformAdminSessionRecord): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO platform_admin_sessions (session_id, admin_id, token_hash, realm, issued_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [record.sessionId, record.adminId, record.tokenHash, record.realm, record.issuedAt, record.expiresAt, record.revokedAt],
      ),
    );
  }

  async findSessionForValidation(tokenHash: string): Promise<SessionValidationLookup | null> {
    return runInTransaction(async (conn) => {
      const { rows } = await execute<SessionRow>(
        conn,
        `SELECT s.session_id, s.admin_id, s.token_hash, s.realm, s.issued_at, s.expires_at, s.revoked_at, a.status AS account_status
         FROM platform_admin_sessions s
         JOIN platform_admin_accounts a ON a.admin_id = s.admin_id
         WHERE s.token_hash = ?`,
        [tokenHash],
      );
      const row = rows[0];
      if (!row) return null;
      const { rows: roleRows } = await execute<RoleAssignmentRow>(
        conn,
        `SELECT role FROM platform_admin_role_assignments WHERE admin_id = ? AND revoked_at IS NULL`,
        [row.admin_id],
      );
      return {
        session: {
          sessionId: row.session_id,
          adminId: row.admin_id,
          tokenHash: row.token_hash,
          realm: 'PLATFORM_ADMIN',
          issuedAt: row.issued_at,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
        },
        accountStatus: row.account_status as SessionValidationLookup['accountStatus'],
        activeRoles: roleRows.map((r) => r.role as PlatformAdminRole),
      };
    });
  }

  async revokeSessionByTokenHash(tokenHash: string, revokedAt: Date, auditEvent?: PlatformAdminAuditEvent): Promise<boolean> {
    return runInTransaction(async (conn) => {
      const { rowCount } = await execute(
        conn,
        `UPDATE platform_admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
        [revokedAt, tokenHash],
      );
      if (rowCount > 0 && auditEvent) await insertPlatformAdminAuditEventRow(conn, auditEvent);
      return rowCount > 0;
    });
  }

  async revokeAllActiveSessions(
    adminId: PlatformAdminId,
    revokedAt: Date,
    buildAuditEvent: (sessionId: PlatformAdminSessionId) => PlatformAdminAuditEvent,
  ): Promise<RevokeRoleResult> {
    return runInTransaction((conn) => revokeActiveSessionsOnConnection(conn, adminId, revokedAt, buildAuditEvent));
  }

  async recentFailedLoginTimestampsDescending(emailHash: Buffer, limit: number): Promise<Date[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<RowDataPacket & { occurred_at: Date }>(
        conn,
        `SELECT occurred_at FROM platform_admin_login_attempts
         WHERE email_hash = ? AND outcome IN ('FAILED_CREDENTIALS', 'FAILED_MFA')
         ORDER BY occurred_at DESC
         LIMIT ${Math.max(1, Math.min(limit, 500))}`,
        [emailHash],
      ),
    );
    return rows.map((row) => row.occurred_at);
  }

  async recordLoginAttempt(input: RecordLoginAttemptInput): Promise<void> {
    await runInTransaction(async (conn) => {
      await execute(
        conn,
        `INSERT INTO platform_admin_login_attempts (attempt_id, email_hash, outcome, occurred_at) VALUES (?, ?, ?, ?)`,
        [input.attemptId, input.emailHash, input.outcome, input.occurredAt],
      );
      await insertPlatformAdminAuditEventRow(conn, input.auditEvent);
      if (input.session) {
        await execute(
          conn,
          `INSERT INTO platform_admin_sessions (session_id, admin_id, token_hash, realm, issued_at, expires_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            input.session.sessionId,
            input.session.adminId,
            input.session.tokenHash,
            input.session.realm,
            input.session.issuedAt,
            input.session.expiresAt,
            input.session.revokedAt,
          ],
        );
      }
    });
  }

  async createStepUp(input: CreateStepUpInput): Promise<PlatformAdminStepUpSessionRecord> {
    return runInTransaction(async (conn) => {
      await execute(
        conn,
        `INSERT INTO platform_admin_step_up_sessions (step_up_id, admin_id, session_id, scope, asserted_at, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        [input.stepUpId, input.adminId, input.sessionId, input.scope, input.assertedAt, input.expiresAt],
      );
      await insertPlatformAdminAuditEventRow(conn, input.auditEvent);
      return {
        stepUpId: input.stepUpId,
        adminId: input.adminId,
        sessionId: input.sessionId,
        scope: input.scope,
        assertedAt: input.assertedAt,
        expiresAt: input.expiresAt,
        consumedAt: null,
      };
    });
  }

  async recordDeniedStepUp(auditEvent: PlatformAdminAuditEvent): Promise<void> {
    await runInTransaction((conn) => insertPlatformAdminAuditEventRow(conn, auditEvent));
  }

  async consumeStepUp(input: ConsumeStepUpInput): Promise<boolean> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(
        conn,
        `UPDATE platform_admin_step_up_sessions
         SET consumed_at = ?
         WHERE step_up_id = ? AND admin_id = ? AND session_id = ? AND scope = ?
           AND consumed_at IS NULL AND expires_at > ?`,
        [input.consumedAt, input.stepUpId, input.adminId, input.sessionId, input.scope, input.consumedAt],
      ),
    );
    return rowCount > 0;
  }
}
