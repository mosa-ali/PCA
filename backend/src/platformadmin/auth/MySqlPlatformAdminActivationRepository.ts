import { randomUUID } from 'node:crypto';
import { execute, runInTransaction, SoftFailure } from '../../db/pool.js';
import { insertPlatformAdminAuditEventRow } from '../audit/MySqlPlatformAdminAuditRepository.js';
import type { PlatformAdminActivationRepository, ActivationState } from './PlatformAdminActivationRepository.js';
import { PLATFORM_ADMIN_ACTIVATION_PURPOSE } from './PlatformAdminActivationRepository.js';
import type { PlatformAdminId } from './types.js';

interface TokenRow extends Record<string, unknown> { activation_id: string; admin_id: string; token_hash: string; created_at: Date; expires_at: Date; used_at: Date | null; revoked_at: Date | null; }
interface AccountRow extends Record<string, unknown> { admin_id: string; email_hash: Buffer; display_name: string; password_credential: string; status: string; created_at: Date; disabled_at: Date | null; }
interface MfaRow extends Record<string, unknown> { admin_id: string; status: string; totp_secret_ciphertext: Buffer | null; totp_secret_nonce: Buffer | null; activated_at: Date | null; created_at: Date; last_accepted_totp_counter: number | string | null; }

function state(token: TokenRow, account: AccountRow, mfa: MfaRow): ActivationState {
  return {
    token: { activationId: token.activation_id, adminId: token.admin_id, tokenHash: token.token_hash, createdAt: token.created_at, expiresAt: token.expires_at, usedAt: token.used_at, revokedAt: token.revoked_at },
    account: { adminId: account.admin_id, emailHash: account.email_hash, displayName: account.display_name, passwordCredential: account.password_credential, status: account.status as 'ACTIVE' | 'DISABLED', createdAt: account.created_at, disabledAt: account.disabled_at },
    mfa: { adminId: mfa.admin_id, status: mfa.status as 'PENDING_SETUP' | 'ACTIVE' | 'DISABLED', totpSecretCiphertext: mfa.totp_secret_ciphertext, totpSecretNonce: mfa.totp_secret_nonce, activatedAt: mfa.activated_at, createdAt: mfa.created_at, lastAcceptedTotpCounter: mfa.last_accepted_totp_counter === null ? null : Number(mfa.last_accepted_totp_counter) },
  };
}

export class MySqlPlatformAdminActivationRepository implements PlatformAdminActivationRepository {

  async issue(input: { activationId: string; adminId: PlatformAdminId; tokenHash: string; createdAt: Date; expiresAt: Date }): Promise<void> {
    await runInTransaction(async (conn) => {
      await execute(conn, `UPDATE platform_admin_activation_tokens SET revoked_at = ? WHERE admin_id = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL`, [input.createdAt, input.adminId, PLATFORM_ADMIN_ACTIVATION_PURPOSE]);
      // Reissue is also the lost-QR recovery boundary. Pending enrollment
      // material is invalidated in the same transaction as old-token
      // revocation, so an abandoned URI can never activate the account after
      // a replacement link is issued.
      await execute(conn, `UPDATE platform_admin_mfa_state SET totp_secret_ciphertext = NULL, totp_secret_nonce = NULL, activated_at = NULL, last_accepted_totp_counter = NULL WHERE admin_id = ? AND status = 'PENDING_SETUP'`, [input.adminId]);
      await execute(conn, `INSERT INTO platform_admin_activation_tokens (activation_id, admin_id, token_hash, purpose, created_at, expires_at, used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`, [input.activationId, input.adminId, input.tokenHash, PLATFORM_ADMIN_ACTIVATION_PURPOSE, input.createdAt, input.expiresAt]);
    });
  }

  async findUsable(tokenHash: string, now: Date): Promise<ActivationState | null> {
    return runInTransaction(async (conn) => {
      const { rows: tokens } = await execute<TokenRow>(conn, `SELECT * FROM platform_admin_activation_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`, [tokenHash, PLATFORM_ADMIN_ACTIVATION_PURPOSE, now]);
      const token = tokens[0]; if (!token) return null;
      const { rows: accounts } = await execute<AccountRow>(conn, `SELECT * FROM platform_admin_accounts WHERE admin_id = ?`, [token.admin_id]);
      const { rows: mfas } = await execute<MfaRow>(conn, `SELECT * FROM platform_admin_mfa_state WHERE admin_id = ?`, [token.admin_id]);
      if (!accounts[0] || !mfas[0]) return null;
      return state(token, accounts[0], mfas[0]);
    });
  }

  async beginMfa(input: { tokenHash: string; now: Date; ciphertext: Buffer; nonce: Buffer }): Promise<ActivationState | null> {
    return runInTransaction(async (conn) => {
      const { rows: tokens } = await execute<TokenRow>(conn, `SELECT * FROM platform_admin_activation_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? FOR UPDATE`, [input.tokenHash, PLATFORM_ADMIN_ACTIVATION_PURPOSE, input.now]);
      const token = tokens[0]; if (!token) return null;
      const { rows: accounts } = await execute<AccountRow>(conn, `SELECT * FROM platform_admin_accounts WHERE admin_id = ? FOR UPDATE`, [token.admin_id]);
      const { rows: mfas } = await execute<MfaRow>(conn, `SELECT * FROM platform_admin_mfa_state WHERE admin_id = ? FOR UPDATE`, [token.admin_id]);
      if (!accounts[0] || !mfas[0] || accounts[0].status !== 'ACTIVE' || mfas[0].status !== 'PENDING_SETUP') return null;
      if (Boolean(mfas[0].totp_secret_ciphertext) !== Boolean(mfas[0].totp_secret_nonce)) return null;
      // The row lock above makes this a single-winner initialization. A
      // concurrent/repeated start must fail rather than returning a URI for
      // a newly-generated secret that was not the one persisted.
      if (mfas[0].totp_secret_ciphertext || mfas[0].totp_secret_nonce) return null;
      await execute(conn, `UPDATE platform_admin_mfa_state SET totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NULL, last_accepted_totp_counter = NULL WHERE admin_id = ? AND status = 'PENDING_SETUP' AND totp_secret_ciphertext IS NULL AND totp_secret_nonce IS NULL`, [input.ciphertext, input.nonce, token.admin_id]);
      const { rows: refreshed } = await execute<MfaRow>(conn, `SELECT * FROM platform_admin_mfa_state WHERE admin_id = ?`, [token.admin_id]);
      return refreshed[0] ? state(token, accounts[0], refreshed[0]) : null;
    });
  }

  async complete(input: { tokenHash: string; now: Date; passwordCredential: string; acceptedTotpCounter: number }): Promise<boolean> {
    return runInTransaction(async (conn) => {
      const { rows: tokens } = await execute<TokenRow>(conn, `SELECT * FROM platform_admin_activation_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? FOR UPDATE`, [input.tokenHash, PLATFORM_ADMIN_ACTIVATION_PURPOSE, input.now]);
      const token = tokens[0]; if (!token) return false;
      const { rows: mfas } = await execute<MfaRow>(conn, `SELECT * FROM platform_admin_mfa_state WHERE admin_id = ? FOR UPDATE`, [token.admin_id]);
      const { rows: accounts } = await execute<AccountRow>(conn, `SELECT * FROM platform_admin_accounts WHERE admin_id = ? FOR UPDATE`, [token.admin_id]);
      const mfa = mfas[0]; const account = accounts[0];
      if (!mfa || !account || account.status !== 'ACTIVE' || mfa.status !== 'PENDING_SETUP' || !mfa.totp_secret_ciphertext || !mfa.totp_secret_nonce) return false;
      const { rowCount } = await execute(conn, `UPDATE platform_admin_accounts SET password_credential = ? WHERE admin_id = ? AND status = 'ACTIVE'`, [input.passwordCredential, token.admin_id]);
      if (rowCount !== 1) throw new SoftFailure('ACTIVATION_ATOMIC_FAILURE');
      const { rowCount: mfaCount } = await execute(conn, `UPDATE platform_admin_mfa_state SET status = 'ACTIVE', activated_at = ?, last_accepted_totp_counter = ? WHERE admin_id = ? AND status = 'PENDING_SETUP' AND (last_accepted_totp_counter IS NULL OR last_accepted_totp_counter < ?)`, [input.now, input.acceptedTotpCounter, token.admin_id, input.acceptedTotpCounter]);
      if (mfaCount !== 1) throw new SoftFailure('ACTIVATION_ATOMIC_FAILURE');
      const { rowCount: used } = await execute(conn, `UPDATE platform_admin_activation_tokens SET used_at = ? WHERE activation_id = ? AND used_at IS NULL AND revoked_at IS NULL`, [input.now, token.activation_id]);
      if (used !== 1) throw new SoftFailure('ACTIVATION_ATOMIC_FAILURE');
      await insertPlatformAdminAuditEventRow(conn, { eventId: randomUUID(), eventType: 'ADMIN_MFA_ENROLLED', actorAdminId: token.admin_id, actorRole: 'PLATFORM_ADMIN', targetRef: `admin:${token.admin_id}`, result: 'SUCCESS', occurredAt: input.now, correlationId: randomUUID(), metadata: { method: 'EMAIL_FIRST_TIME_ACTIVATION' } });
      return true;
    }).catch((error) => {
      if (error instanceof SoftFailure && error.outcome === 'ACTIVATION_ATOMIC_FAILURE') return false;
      throw error;
    });
  }
}
