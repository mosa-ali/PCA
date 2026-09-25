import { randomUUID } from 'node:crypto';
import { execute, isDuplicateEntry, runInTransaction } from '../../db/pool.js';
import type {
  CommercialStepUpOperation,
  FailurePolicy,
  ParentMfaRecoveryCode,
  ParentMfaRepository,
  ParentMfaStateRecord,
  ParentMfaTicketPurpose,
  ParentSecurityEventType,
} from './ParentMfaRepository.js';

interface StateRow {
  account_id: string;
  status: 'NOT_ENROLLED' | 'ACTIVE';
  totp_secret_ciphertext: Buffer | null;
  totp_secret_nonce: Buffer | null;
  pending_secret_ciphertext: Buffer | null;
  pending_secret_nonce: Buffer | null;
  pending_created_at: Date | null;
  last_accepted_totp_counter: number | string | null;
  grace_started_at: Date;
  grace_expires_at: Date;
  enrolled_at: Date | null;
  failed_attempt_count: number;
  failure_window_started_at: Date | null;
  locked_until: Date | null;
  reset_count: number;
  recovery_hold_started_at: Date | null;
  recovery_hold_expires_at: Date | null;
}

function toRecord(row: StateRow): ParentMfaStateRecord {
  return {
    accountId: row.account_id,
    status: row.status,
    totpSecretCiphertext: row.totp_secret_ciphertext,
    totpSecretNonce: row.totp_secret_nonce,
    pendingSecretCiphertext: row.pending_secret_ciphertext,
    pendingSecretNonce: row.pending_secret_nonce,
    pendingCreatedAt: row.pending_created_at,
    lastAcceptedTotpCounter: row.last_accepted_totp_counter === null ? null : Number(row.last_accepted_totp_counter),
    graceStartedAt: row.grace_started_at,
    graceExpiresAt: row.grace_expires_at,
    enrolledAt: row.enrolled_at,
    failedAttemptCount: Number(row.failed_attempt_count),
    failureWindowStartedAt: row.failure_window_started_at,
    lockedUntil: row.locked_until,
    resetCount: Number(row.reset_count),
    recoveryHoldStartedAt: row.recovery_hold_started_at,
    recoveryHoldExpiresAt: row.recovery_hold_expires_at,
  };
}

export class MySqlParentMfaRepository implements ParentMfaRepository {
  async findState(accountId: string): Promise<ParentMfaStateRecord | null> {
    const { rows } = await runInTransaction((conn) => execute<StateRow>(conn, `SELECT * FROM parent_mfa_state WHERE account_id = ?`, [accountId]));
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async startGraceIfAbsent(accountId: string, startedAt: Date, expiresAt: Date): Promise<boolean> {
    // A plain INSERT: the primary key makes exactly one caller win. Neither
    // INSERT IGNORE (swallows FK/CHECK failures) nor ON DUPLICATE KEY (mysql2
    // sets CLIENT_FOUND_ROWS, so a no-op duplicate also reports 1 row) can
    // tell the creator apart from a loser; only the duplicate-key error can.
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO parent_mfa_state (account_id, status, grace_started_at, grace_expires_at, created_at, updated_at)
           VALUES (?, 'NOT_ENROLLED', ?, ?, ?, ?)`,
          [accountId, startedAt, expiresAt, startedAt, startedAt],
        ),
      );
      return true;
    } catch (error) {
      if (isDuplicateEntry(error)) return false;
      throw error;
    }
  }

  async savePendingSecret(accountId: string, ciphertext: Buffer, nonce: Buffer, now: Date): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `UPDATE parent_mfa_state SET pending_secret_ciphertext = ?, pending_secret_nonce = ?, pending_created_at = ?, updated_at = ?
         WHERE account_id = ? AND status = 'NOT_ENROLLED'`,
        [ciphertext, nonce, now, now, accountId],
      ),
    );
  }

  async activatePendingSecret(accountId: string, expectedPendingCiphertext: Buffer, counter: number, now: Date): Promise<boolean> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(
        conn,
        `UPDATE parent_mfa_state
            SET status = 'ACTIVE',
                totp_secret_ciphertext = pending_secret_ciphertext,
                totp_secret_nonce = pending_secret_nonce,
                pending_secret_ciphertext = NULL, pending_secret_nonce = NULL, pending_created_at = NULL,
                last_accepted_totp_counter = ?, enrolled_at = ?,
                failed_attempt_count = 0, failure_window_started_at = NULL, locked_until = NULL,
                updated_at = ?
          WHERE account_id = ? AND status = 'NOT_ENROLLED' AND pending_secret_ciphertext = ?`,
        [counter, now, now, accountId, expectedPendingCiphertext],
      ),
    );
    return rowCount === 1;
  }

  async claimTotpCounter(accountId: string, counter: number, now: Date): Promise<boolean> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(
        conn,
        `UPDATE parent_mfa_state SET last_accepted_totp_counter = ?, updated_at = ?
          WHERE account_id = ? AND status = 'ACTIVE' AND (last_accepted_totp_counter IS NULL OR last_accepted_totp_counter < ?)`,
        [counter, now, accountId, counter],
      ),
    );
    return rowCount === 1;
  }

  async recordFailure(accountId: string, now: Date, policy: FailurePolicy): Promise<{ locked: boolean }> {
    return runInTransaction(async (conn) => {
      const { rows } = await execute<StateRow>(conn, `SELECT * FROM parent_mfa_state WHERE account_id = ? FOR UPDATE`, [accountId]);
      const row = rows[0];
      if (!row) return { locked: false };
      const windowFresh = row.failure_window_started_at !== null && now.getTime() - row.failure_window_started_at.getTime() < policy.windowMs;
      const count = windowFresh ? Number(row.failed_attempt_count) + 1 : 1;
      const windowStart = windowFresh ? row.failure_window_started_at : now;
      const locked = count >= policy.threshold;
      const lockedUntil = locked ? new Date(now.getTime() + policy.lockMs) : row.locked_until;
      await execute(
        conn,
        `UPDATE parent_mfa_state SET failed_attempt_count = ?, failure_window_started_at = ?, locked_until = ?, updated_at = ? WHERE account_id = ?`,
        [locked ? 0 : count, locked ? null : windowStart, lockedUntil, now, accountId],
      );
      return { locked };
    });
  }

  async clearFailures(accountId: string, now: Date): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `UPDATE parent_mfa_state SET failed_attempt_count = 0, failure_window_started_at = NULL, updated_at = ?
          WHERE account_id = ? AND (failed_attempt_count <> 0 OR failure_window_started_at IS NOT NULL)`,
        [now, accountId],
      ),
    );
  }

  async resetEnrollment(accountId: string, now: Date): Promise<boolean> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(
        conn,
        `UPDATE parent_mfa_state
            SET status = 'NOT_ENROLLED',
                totp_secret_ciphertext = NULL, totp_secret_nonce = NULL,
                pending_secret_ciphertext = NULL, pending_secret_nonce = NULL, pending_created_at = NULL,
                enrolled_at = NULL,
                grace_expires_at = GREATEST(grace_started_at, LEAST(grace_expires_at, ?)),
                failed_attempt_count = 0, failure_window_started_at = NULL, locked_until = NULL,
                reset_count = reset_count + 1, updated_at = ?
          WHERE account_id = ? AND status = 'ACTIVE'`,
        [now, now, accountId],
      ),
    );
    return rowCount === 1;
  }

  async insertTicket(record: { ticketId: string; accountId: string; tokenHash: string; purpose: ParentMfaTicketPurpose; createdAt: Date; expiresAt: Date }): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO parent_mfa_enrollment_tickets (ticket_id, account_id, token_hash, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [record.ticketId, record.accountId, record.tokenHash, record.purpose, record.createdAt, record.expiresAt],
      ),
    );
  }

  async findLiveTicket(tokenHash: string, now: Date): Promise<{ ticketId: string; accountId: string; purpose: ParentMfaTicketPurpose } | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<{ ticket_id: string; account_id: string; purpose: ParentMfaTicketPurpose }>(
        conn,
        `SELECT ticket_id, account_id, purpose FROM parent_mfa_enrollment_tickets WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
        [tokenHash, now],
      ),
    );
    const row = rows[0];
    return row ? { ticketId: row.ticket_id, accountId: row.account_id, purpose: row.purpose } : null;
  }

  async consumeTicket(ticketId: string, now: Date): Promise<boolean> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(conn, `UPDATE parent_mfa_enrollment_tickets SET consumed_at = ? WHERE ticket_id = ? AND consumed_at IS NULL AND expires_at > ?`, [now, ticketId, now]),
    );
    return rowCount === 1;
  }

  async insertRecoveryCode(record: { codeId: string; accountId: string; codeHash: string; createdAt: Date; expiresAt: Date }): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO parent_mfa_recovery_codes (code_id, account_id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
        [record.codeId, record.accountId, record.codeHash, record.createdAt, record.expiresAt],
      ),
    );
  }

  async findLatestRecoveryCode(accountId: string): Promise<ParentMfaRecoveryCode | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<{ code_id: string; account_id: string; code_hash: string; expires_at: Date; consumed_at: Date | null; attempt_count: number }>(
        conn,
        `SELECT * FROM parent_mfa_recovery_codes WHERE account_id = ? ORDER BY created_at DESC, code_id DESC LIMIT 1`,
        [accountId],
      ),
    );
    const row = rows[0];
    if (!row) return null;
    return { codeId: row.code_id, accountId: row.account_id, codeHash: row.code_hash, expiresAt: row.expires_at, consumedAt: row.consumed_at, attemptCount: Number(row.attempt_count) };
  }

  async incrementRecoveryAttempt(codeId: string): Promise<void> {
    await runInTransaction((conn) => execute(conn, `UPDATE parent_mfa_recovery_codes SET attempt_count = attempt_count + 1 WHERE code_id = ? AND attempt_count < 8`, [codeId]));
  }

  async consumeRecoveryCode(codeId: string, now: Date): Promise<boolean> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(conn, `UPDATE parent_mfa_recovery_codes SET consumed_at = ? WHERE code_id = ? AND consumed_at IS NULL`, [now, codeId]),
    );
    return rowCount === 1;
  }

  async applyRecoveryCode(input: { codeId: string; accountId: string; serviceAccountId: string | null; now: Date; holdExpiresAt: Date }): Promise<{ status: 'PENDING'; recoveryAvailableAt: Date; started: boolean } | { status: 'READY' }> {
    return runInTransaction(async (conn) => {
      const { rows: states } = await execute<StateRow>(conn, `SELECT * FROM parent_mfa_state WHERE account_id = ? FOR UPDATE`, [input.accountId]);
      const state = states[0];
      if (!state || state.status !== 'ACTIVE') throw new Error('MFA recovery state missing or inactive');
      const { rows: codes } = await execute<{ code_id: string; consumed_at: Date | null; expires_at: Date; attempt_count: number }>(
        conn,
        `SELECT code_id, consumed_at, expires_at, attempt_count FROM parent_mfa_recovery_codes WHERE code_id = ? AND account_id = ? FOR UPDATE`,
        [input.codeId, input.accountId],
      );
      const code = codes[0];
      if (!code || code.consumed_at !== null || code.expires_at.getTime() <= input.now.getTime() || Number(code.attempt_count) >= 8) throw new Error('MFA recovery code unavailable');
      const { rowCount } = await execute(conn, `UPDATE parent_mfa_recovery_codes SET consumed_at = ? WHERE code_id = ? AND consumed_at IS NULL`, [input.now, input.codeId]);
      if (rowCount !== 1) throw new Error('MFA recovery code already consumed');

      const activeHold = state.recovery_hold_expires_at !== null && state.recovery_hold_expires_at.getTime() > input.now.getTime();
      const pendingUntil = activeHold ? state.recovery_hold_expires_at as Date : input.holdExpiresAt;
      const started = !activeHold && state.recovery_hold_expires_at === null;
      if (started) {
        await execute(conn, `UPDATE parent_mfa_state SET recovery_hold_started_at = ?, recovery_hold_expires_at = ?, updated_at = ? WHERE account_id = ?`, [input.now, input.holdExpiresAt, input.now, input.accountId]);
        await execute(conn, `INSERT INTO parent_account_security_events (event_id, account_id, event_type, detail, occurred_at) VALUES (?, ?, 'MFA_RECOVERY_PENDING', NULL, ?)`, [randomUUID(), input.accountId, input.now]);
      } else if (!activeHold) {
        // Deadline has arrived: only this fresh code can complete recovery.
        await execute(conn, `UPDATE parent_mfa_state
          SET status = 'NOT_ENROLLED', totp_secret_ciphertext = NULL, totp_secret_nonce = NULL,
              pending_secret_ciphertext = NULL, pending_secret_nonce = NULL, pending_created_at = NULL,
              enrolled_at = NULL, recovery_hold_started_at = NULL, recovery_hold_expires_at = NULL,
              grace_expires_at = GREATEST(grace_started_at, LEAST(grace_expires_at, ?)),
              failed_attempt_count = 0, failure_window_started_at = NULL, locked_until = NULL,
              reset_count = reset_count + 1, updated_at = ? WHERE account_id = ? AND status = 'ACTIVE'`, [input.now, input.now, input.accountId]);
        await execute(conn, `INSERT INTO parent_account_security_events (event_id, account_id, event_type, detail, occurred_at) VALUES (?, ?, 'MFA_RESET', NULL, ?), (?, ?, 'MFA_RECOVERY_COMPLETED', NULL, ?)`, [randomUUID(), input.accountId, input.now, randomUUID(), input.accountId, input.now]);
      }

      // Every recovery checkpoint kills all existing authentication material.
      await execute(conn, `UPDATE parent_mfa_recovery_codes SET consumed_at = COALESCE(consumed_at, ?) WHERE account_id = ?`, [input.now, input.accountId]);
      await execute(conn, `UPDATE parent_daily_login_grants SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL`, [input.now, input.accountId]);
      await execute(conn, `UPDATE parent_login_step_up_codes SET consumed_at = COALESCE(consumed_at, ?) WHERE account_id = ?`, [input.now, input.accountId]);
      await execute(conn, `UPDATE parent_mfa_step_up_grants SET consumed_at = COALESCE(consumed_at, ?) WHERE account_id = ?`, [input.now, input.accountId]);
      if (input.serviceAccountId !== null) await execute(conn, `UPDATE service_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL`, [input.now, input.serviceAccountId]);

      if (activeHold || started) return { status: 'PENDING' as const, recoveryAvailableAt: pendingUntil, started };
      return { status: 'READY' as const };
    });
  }

  async insertStepUpGrant(record: { grantId: string; accountId: string; familyId: string; operation: CommercialStepUpOperation; tokenHash: string; createdAt: Date; expiresAt: Date }): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO parent_mfa_step_up_grants (grant_id, account_id, family_id, operation, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [record.grantId, record.accountId, record.familyId, record.operation, record.tokenHash, record.createdAt, record.expiresAt],
      ),
    );
  }

  async consumeStepUpGrant(input: { tokenHash: string; accountId: string; familyId: string; operation: CommercialStepUpOperation; now: Date }): Promise<boolean> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(
        conn,
        `UPDATE parent_mfa_step_up_grants SET consumed_at = ?
          WHERE token_hash = ? AND account_id = ? AND family_id = ? AND operation = ? AND consumed_at IS NULL AND expires_at > ?`,
        [input.now, input.tokenHash, input.accountId, input.familyId, input.operation, input.now],
      ),
    );
    return rowCount === 1;
  }

  async recordSecurityEvent(accountId: string, eventType: ParentSecurityEventType, detail: string | null, occurredAt: Date): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO parent_account_security_events (event_id, account_id, event_type, detail, occurred_at) VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), accountId, eventType, detail, occurredAt],
      ),
    );
  }
}
