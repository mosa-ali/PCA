import { createHash } from 'node:crypto';
import { execute, runInTransaction } from '../db/pool.js';
import type {
  ActivePasswordResetCode,
  ActiveVerificationCode,
  NewPasswordResetCode,
  NewPendingAccount,
  NewVerificationCode,
  ParentAccountRepository,
  VerifiedTransition,
} from './ParentAccountRepository.js';
import type { FreeAccessMode, ParentAccountId, ParentAccountRecord, ParentAccountStatus } from './types.js';

interface AccountRow {
  account_id: string;
  email_hash: Buffer;
  password_hash: string;
  status: ParentAccountStatus;
  family_id: string | null;
  service_account_id: string | null;
  free_access_mode: FreeAccessMode | null;
  free_access_duration_days: number | null;
  free_access_started_at: Date | null;
  free_access_expires_at: Date | null;
  default_parent_member_limit: number | null;
  default_managed_device_limit: number | null;
  created_at: Date;
  verified_at: Date | null;
  disabled_at: Date | null;
}

interface CodeRow {
  code_id: string;
  account_id: string;
  code_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  attempt_count: number;
}

/** parent_email_verification_codes only -- migration 0030's credential-binding column. parent_password_reset_codes deliberately has no such column (that flow's new credential is supplied at reset time). */
interface VerificationCodeRow extends CodeRow {
  password_hash: string | null;
}

// Same row shape as CodeRow -- kept as a distinct alias so a future
// divergence between the two tables' schemas doesn't silently type-check.
type ResetCodeRow = CodeRow;

function rowToRecord(row: AccountRow): ParentAccountRecord {
  return {
    accountId: row.account_id,
    emailHash: row.email_hash,
    passwordHash: row.password_hash,
    status: row.status,
    familyId: row.family_id,
    serviceAccountId: row.service_account_id,
    freeAccess:
      row.free_access_mode === null
        ? null
        : {
            mode: row.free_access_mode,
            durationDays: row.free_access_duration_days,
            startedAt: row.free_access_started_at as Date,
            expiresAt: row.free_access_expires_at,
            defaultParentMemberLimit: row.default_parent_member_limit as number,
            defaultManagedDeviceLimit: row.default_managed_device_limit as number,
          },
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
    disabledAt: row.disabled_at,
  };
}

export class MySqlParentAccountRepository implements ParentAccountRepository {
  async createPendingAccount(record: NewPendingAccount): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO parent_accounts (account_id, email_hash, password_hash, status, created_at)
         VALUES (?, ?, ?, 'PENDING_VERIFICATION', ?)`,
        [record.accountId, record.emailHash, record.passwordHash, record.createdAt],
      ),
    );
  }

  async findByEmailHash(emailHash: Buffer): Promise<ParentAccountRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<AccountRow>(conn, `SELECT * FROM parent_accounts WHERE email_hash = ?`, [emailHash]),
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async findById(accountId: ParentAccountId): Promise<ParentAccountRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<AccountRow>(conn, `SELECT * FROM parent_accounts WHERE account_id = ?`, [accountId]),
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async findByServiceAccountId(serviceAccountId: string): Promise<ParentAccountRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<AccountRow>(conn, `SELECT * FROM parent_accounts WHERE service_account_id = ?`, [serviceAccountId]),
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async insertVerificationCode(record: NewVerificationCode): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO parent_email_verification_codes (code_id, account_id, code_hash, password_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [record.codeId, record.accountId, record.codeHash, record.passwordHash, record.createdAt, record.expiresAt],
      ),
    );
  }

  async findRecentVerificationCodes(accountId: ParentAccountId, limit: number): Promise<ActiveVerificationCode[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<VerificationCodeRow>(
        conn,
        `SELECT * FROM parent_email_verification_codes WHERE account_id = ? ORDER BY created_at DESC, code_id DESC LIMIT ?`,
        [accountId, limit],
      ),
    );
    return rows.map((row) => ({
      codeId: row.code_id,
      accountId: row.account_id,
      codeHash: row.code_hash,
      passwordHash: row.password_hash,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      attemptCount: row.attempt_count,
    }));
  }

  async incrementVerificationAttempt(codeId: string): Promise<void> {
    await runInTransaction((conn) =>
      execute(conn, `UPDATE parent_email_verification_codes SET attempt_count = attempt_count + 1 WHERE code_id = ?`, [codeId]),
    );
  }

  async consumeVerificationCodeIfUnconsumed(codeId: string, consumedAt: Date): Promise<boolean> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(conn, `UPDATE parent_email_verification_codes SET consumed_at = ? WHERE code_id = ? AND consumed_at IS NULL`, [
        consumedAt,
        codeId,
      ]),
    );
    return rowCount > 0;
  }

  async markVerified(transition: VerifiedTransition): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        // password_hash = COALESCE(?, password_hash): the credential the
        // consumed verification code was ISSUED for becomes the account's
        // credential at the same instant the account becomes VERIFIED (see
        // migration 0030). A NULL (pre-0030 row) leaves the existing
        // credential exactly as it was.
        `UPDATE parent_accounts
         SET status = 'VERIFIED', verified_at = ?, family_id = ?, password_hash = COALESCE(?, password_hash),
             free_access_mode = ?, free_access_duration_days = ?,
             free_access_started_at = ?, free_access_expires_at = ?, default_parent_member_limit = ?, default_managed_device_limit = ?
         WHERE account_id = ? AND status = 'PENDING_VERIFICATION'`,
        [
          transition.verifiedAt,
          transition.familyId,
          transition.passwordHash,
          transition.freeAccess.mode,
          transition.freeAccess.durationDays,
          transition.freeAccess.startedAt,
          transition.freeAccess.expiresAt,
          transition.freeAccess.defaultParentMemberLimit,
          transition.freeAccess.defaultManagedDeviceLimit,
          transition.accountId,
        ],
      ),
    );
  }

  async insertPasswordResetCode(record: NewPasswordResetCode): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO parent_password_reset_codes (code_id, account_id, code_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [record.codeId, record.accountId, record.codeHash, record.createdAt, record.expiresAt],
      ),
    );
  }

  async findLatestPasswordResetCode(accountId: ParentAccountId): Promise<ActivePasswordResetCode | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<ResetCodeRow>(
        conn,
        `SELECT * FROM parent_password_reset_codes WHERE account_id = ? ORDER BY created_at DESC, code_id DESC LIMIT 1`,
        [accountId],
      ),
    );
    const row = rows[0];
    if (!row) return null;
    return {
      codeId: row.code_id,
      accountId: row.account_id,
      codeHash: row.code_hash,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      attemptCount: row.attempt_count,
    };
  }

  async incrementPasswordResetAttempt(codeId: string): Promise<void> {
    await runInTransaction((conn) =>
      execute(conn, `UPDATE parent_password_reset_codes SET attempt_count = attempt_count + 1 WHERE code_id = ?`, [codeId]),
    );
  }

  async consumePasswordResetCodeIfUnconsumed(codeId: string, consumedAt: Date): Promise<boolean> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(conn, `UPDATE parent_password_reset_codes SET consumed_at = ? WHERE code_id = ? AND consumed_at IS NULL`, [
        consumedAt,
        codeId,
      ]),
    );
    return rowCount > 0;
  }

  async updatePasswordHash(accountId: ParentAccountId, passwordHash: string): Promise<void> {
    await runInTransaction((conn) =>
      execute(conn, `UPDATE parent_accounts SET password_hash = ? WHERE account_id = ? AND status = 'VERIFIED'`, [
        passwordHash,
        accountId,
      ]),
    );
  }

  async setServiceAccountIdIfAbsent(accountId: ParentAccountId, serviceAccountId: string): Promise<void> {
    await runInTransaction((conn) =>
      execute(conn, `UPDATE parent_accounts SET service_account_id = ? WHERE account_id = ? AND service_account_id IS NULL`, [
        serviceAccountId,
        accountId,
      ]),
    );
  }

  /**
   * Direct, narrowly-scoped write against the SAME `service_sessions` table
   * backend/src/auth/MySqlAuthRepository.ts owns (see this domain's
   * ParentAccountRepository.ts header for why: no existing AuthRepository
   * method revokes every session for an account, and this lane does not
   * edit backend/src/auth/**). Identical WHERE/SET shape to
   * MySqlAuthRepository.revokeSession, just keyed by account_id.
   */
  async revokeAllServiceSessionsFor(serviceAccountId: string, revokedAt: Date): Promise<number> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(conn, `UPDATE service_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL`, [
        revokedAt,
        serviceAccountId,
      ]),
    );
    return rowCount;
  }

  /** See ParentAccountRepository.ts's own doc comment: read-only lookup against the SHARED `families` table (owned by platformadmin/accounts) for the login-time suspend check. */
  async findFamilyStatus(familyId: string): Promise<'ACTIVE' | 'SUSPENDED' | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<{ status: 'ACTIVE' | 'SUSPENDED' }>(conn, `SELECT status FROM families WHERE family_id = ?`, [familyId]),
    );
    return rows[0] ? rows[0].status : null;
  }

  /** See ParentAccountRepository.ts's own doc comment for why this direct, narrowly-scoped write against the SHARED service_account_family_scopes table exists here. */
  async grantFamilyScopeIfAbsent(serviceAccountId: string, familyId: string, now: Date): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO service_account_family_scopes (account_id, family_id, status, created_at)
         VALUES (?, ?, 'ACTIVE', ?)
         ON DUPLICATE KEY UPDATE status = 'ACTIVE'`,
        [serviceAccountId, familyId, now],
      ),
    );
  }

  /**
   * See ParentAccountRepository.ts's own doc comment for why this direct,
   * narrowly-scoped write against the SHARED `families` table exists here.
   * `family_reference_hash` only needs to be a stable, unique-per-family
   * value (the column's sole constraint, migration 0001) -- this domain
   * has no separate external family reference to hash, so it deterministically
   * derives one from familyId itself, exactly as `emailHash.ts` derives
   * `email_hash` from an email rather than storing a second independent
   * identifier.
   */
  async createFamilyIfAbsent(familyId: string, now: Date): Promise<void> {
    const familyReferenceHash = createHash('sha256').update(familyId, 'utf8').digest();
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO families (family_id, family_reference_hash, created_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE family_id = family_id`,
        [familyId, familyReferenceHash, now],
      ),
    );
  }
}
