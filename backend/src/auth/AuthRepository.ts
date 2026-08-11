import type { ServiceAccountId, ServiceSessionRecord } from './types.js';

export interface AccountLookup {
  accountId: ServiceAccountId;
  disabledAt: Date | null;
}

export type ValidateSessionResult =
  | { outcome: 'VALID'; session: ServiceSessionRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'REVOKED' }
  | { outcome: 'ACCOUNT_DISABLED' };

/**
 * Persistence port for service accounts/sessions. Only a deterministic
 * in-memory implementation exists for tests; MySqlAuthRepository is the
 * production implementation.
 *
 * validateSession reads session and account state in one atomic query so a
 * session cannot be judged valid based on a stale (pre-disable) account
 * snapshot -- disabling an account takes effect on the very next
 * validation, not just future logins.
 */
export interface AuthRepository {
  findOrCreateAccount(accountReferenceHash: Buffer, now: Date): Promise<AccountLookup>;
  createSession(record: ServiceSessionRecord): Promise<void>;
  validateSession(tokenHash: string, now: Date): Promise<ValidateSessionResult>;
  revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
}
