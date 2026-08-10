import { randomUUID } from 'node:crypto';
import { runInTransaction } from '../db/pool.js';
import type { AccountLookup, AuthRepository, ValidateSessionResult } from './AuthRepository.js';
import type { ServiceSessionRecord } from './types.js';

interface AccountRow {
  account_id: string;
  disabled_at: Date | null;
}

interface SessionValidationRow {
  session_id: string;
  account_id: string;
  token_hash: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  account_disabled_at: Date | null;
}

export class PostgresAuthRepository implements AuthRepository {
  async findOrCreateAccount(accountReferenceHash: Buffer, now: Date): Promise<AccountLookup> {
    return runInTransaction(async (client) => {
      const inserted = await client.query<AccountRow>(
        `INSERT INTO service_accounts (account_id, account_reference_hash, created_at, disabled_at)
         VALUES ($1, $2, $3, NULL)
         ON CONFLICT (account_reference_hash) DO NOTHING
         RETURNING account_id, disabled_at`,
        [randomUUID(), accountReferenceHash, now],
      );
      if (inserted.rows[0]) {
        return { accountId: inserted.rows[0].account_id, disabledAt: inserted.rows[0].disabled_at };
      }
      const existing = await client.query<AccountRow>(
        `SELECT account_id, disabled_at FROM service_accounts WHERE account_reference_hash = $1`,
        [accountReferenceHash],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('account insert conflicted but no existing row was found');
      return { accountId: row.account_id, disabledAt: row.disabled_at };
    });
  }

  async createSession(record: ServiceSessionRecord): Promise<void> {
    await runInTransaction((client) =>
      client.query(
        `INSERT INTO service_sessions (session_id, account_id, token_hash, issued_at, expires_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [record.sessionId, record.accountId, record.tokenHash, record.issuedAt, record.expiresAt, record.revokedAt],
      ),
    );
  }

  /**
   * One query joins session and account state, so a session cannot be
   * validated against a stale, pre-disable snapshot of its account -- the
   * account's current disabled_at is read atomically with the session row.
   */
  async validateSession(tokenHash: string, now: Date): Promise<ValidateSessionResult> {
    const { rows } = await runInTransaction((client) =>
      client.query<SessionValidationRow>(
        `SELECT s.session_id, s.account_id, s.token_hash, s.issued_at, s.expires_at, s.revoked_at, a.disabled_at AS account_disabled_at
         FROM service_sessions s
         JOIN service_accounts a ON a.account_id = s.account_id
         WHERE s.token_hash = $1`,
        [tokenHash],
      ),
    );
    const row = rows[0];
    if (!row) return { outcome: 'NOT_FOUND' };
    if (row.revoked_at) return { outcome: 'REVOKED' };
    if (row.expires_at.getTime() <= now.getTime()) return { outcome: 'EXPIRED' };
    if (row.account_disabled_at) return { outcome: 'ACCOUNT_DISABLED' };
    return {
      outcome: 'VALID',
      session: {
        sessionId: row.session_id,
        accountId: row.account_id,
        tokenHash: row.token_hash,
        issuedAt: row.issued_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
      },
    };
  }

  /** Idempotent: WHERE revoked_at IS NULL means the first revocation's timestamp is always authoritative. */
  async revokeSession(tokenHash: string, revokedAt: Date): Promise<void> {
    await runInTransaction((client) =>
      client.query(`UPDATE service_sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL`, [
        tokenHash,
        revokedAt,
      ]),
    );
  }
}
