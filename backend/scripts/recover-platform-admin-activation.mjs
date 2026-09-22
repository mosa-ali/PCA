// PCA-PA-1 owner security recovery (2026-09-22): the ONE-TIME operator-run
// path that makes an already-existing APP_OWNER account re-activatable when
// its MFA enrollment never completed, so the account can never log in at all.
//
// WHY THIS IS NEEDED AT ALL (the structural hole it closes): login is a
// single atomic password+ TOTP call that requires MFA status to be EXACTLY
// 'ACTIVE' (see PlatformAdminAuthService.login's own header -- "an account
// whose MFA status is not exactly ACTIVE can never complete login,
// regardless of password correctness or TOTP presence"). An account left at
// PENDING_SETUP therefore cannot log in, and every authenticated path that
// could reissue its activation -- POST
// /platform-admin/admin-users/:adminId/activation,
// PlatformAdminAccountService.beginMfaEnrollment -- itself requires an
// already-authenticated APP_OWNER actor. That is a closed loop with no
// entrance. This script is the entrance, and it is the ONLY one: it is NOT
// wired into `npm start`/main.ts and is NOT reachable from any public route.
//
// WHY IT REUSES THE ORDINARY ACTIVATION LIFECYCLE RATHER THAN DOING THE
// WORK ITSELF: the owner must end up with a password only they have chosen
// and an authenticator entry only they have seen. The only code in this
// repository that guarantees both is the existing first-time activation
// flow, which is already the "lost QR" recovery boundary by construction:
//
//   MySqlPlatformAdminActivationRepository.issueActivationTokenOnConnection
//     revokes every unused token for the admin AND clears any pending TOTP
//     ciphertext/nonce in the SAME transaction, so an abandoned enrollment
//     URI can never activate the account after a replacement link is issued.
//
// The owner then opens the emailed link, the browser POSTs
// /platform-admin/activation/start (which generates a fresh TOTP secret and
// encrypts it with the real AES-256-GCM key), scans the otpauth:// URI, and
// POSTs /platform-admin/activation/complete with a password of their own
// choosing plus the first valid 6-digit code -- at which point the REAL
// hashPassword() credential and MFA status ACTIVE are written by
// MySqlPlatformAdminActivationRepository.complete, inside one transaction,
// with the existing ADMIN_MFA_ENROLLED audit event.
//
// CONSEQUENCE, AND THE POINT: this script never sees, generates, chooses,
// prints, logs or persists a password, a TOTP secret, an otpauth:// URI, or
// a 6-digit code. It does not read PLATFORM_ADMIN_MFA_ENC_KEY and never
// touches `password_credential`, `platform_admin_role_assignments`, or the
// MFA row's status. Its only writes are (a) one activation-token row, (b)
// one email-outbox row carrying the activation link, and (c) one audit
// event. Everything else happens through the application services the
// ordinary activation path already uses.
//
// ATOMICITY (SESSION 2C stranding-defect discipline, carried over from
// bootstrap-platform-owner.mjs): the token row, the outbox row and the audit
// event are committed by ONE transaction. A PRIOR version of the first-owner
// bootstrap issued the credential and the delivery message as two separate
// transactions; a failure in the second left a permanently un-activatable
// account behind with no authenticated recovery path. The same class of
// defect would apply here, so either all three durable writes commit or none
// of them do. The network delivery attempt happens strictly AFTER the
// transaction resolves and inside no transaction, exactly like every other
// outbox message.
//
// WHY THE OPERATOR INVARIANT IS SERIALIZED BY AN ADVISORY LOCK AND NOT BY ROW
// LOCKS: the invariant is "at most one live activation link exists for this
// admin", and two operators (or one operator running this twice) must not
// interleave the revoke/insert pair. The obvious implementation -- SELECT ...
// FOR UPDATE on the account and MFA rows -- is WRONG here, and quietly so:
// MySqlPlatformAdminActivationRepository.complete() locks activation_tokens,
// then mfa_state, then accounts; beginMfa() locks activation_tokens, then
// accounts, then mfa_state. A reissue that grabbed accounts first and then
// waited on mfa_state would form a real cycle against a concurrent activation
// completion holding mfa_state and waiting on accounts. MySQL would detect the
// deadlock and roll one statement back -- a degraded operator experience
// rather than corruption, but an avoidable one. Taking the same named advisory
// lock bootstrap-platform-owner.mjs uses for its own one-time invariant
// serializes this operation without touching row-lock order at all, and the
// destructive step stays guarded by issueActivationTokenOnConnection's own
// `WHERE ... status = 'PENDING_SETUP'` clauses.
//
// The lock name is DEDICATED, not the bootstrap's: this script does not mutate
// the "does an active APP_OWNER exist yet" invariant that
// bootstrap-platform-owner.mjs and promote-first-app-owner.mjs share, so
// serializing them against each other would block an unrelated operation.
//
// WHY actorAdminId IS NULL ON THE AUDIT EVENT: there is no authenticated
// actor -- that absence is the entire reason this script exists. NULL is the
// documented convention for a system/operator-granted change (see
// PlatformAdminAuditEvent.actorAdminId's own doc comment and migration
// 0005's comment for the original bootstrap). No synthetic actor is
// fabricated, because inventing an authenticated identity would be a worse
// lie in the audit log than an honest NULL.
//
// WHY THE EVENT TYPE IS AN EXISTING ONE (SETTING_CHANGED), NOT A NEW ONE:
// platform_admin_audit_events.event_type is a closed vocabulary enforced by
// a CHECK constraint, mirrored by hand between
// backend/src/platformadmin/audit/types.ts and migrations 0005/0014/0015.
// Adding a dedicated PLATFORM_ADMIN_ACTIVATION_REISSUED type would be a
// schema change (migration + regenerated
// schema/current_schema.sql, schema/schema_manifest.json,
// database/live-bootstrap/, docs/database/bootstrap/). That is deliberately
// out of scope for a narrowly-scoped operator script. SETTING_CHANGED is
// already the established type for a bounded administrative state change
// whose subject is identified by targetRef rather than by the type itself
// (see FreeAccessAdminService, which uses `parent_account_free_access:<id>`);
// the metadata below makes the action unambiguous to an auditor.
//
// OPERATOR CONTRACT (read before running):
//   * Requires the EXACT target account by email. Unknown, ambiguous
//     (more than one account sharing the hash — impossible under the current
//     unique index, which is exactly why it is refused rather than assumed
//     away), not-ACTIVE, not-PLATFORM_ADMIN, not-APP_OWNER, MFA-not-
//     PENDING_SETUP, and pending-TOTP-material-present all REFUSE. This is
//     not a general-purpose credential reset for any admin.
//   * Requiring the APP_OWNER role is deliberate: it stops this script from
//     being usable as a generic PLATFORM_ADMIN reset. Run
//     promote-first-app-owner.mjs first.
//   * Requires PLATFORM_ADMIN_RECOVERY_CONFIRM=REISSUE_ACTIVATION so it
//     cannot be run by accident or by a confused invocation.
//   * Re-running it is safe and is the documented recovery for a lost or
//     expired link: it revokes the previous unused token and issues a new
//     one. It never widens privilege and never changes a role.
//   * PLATFORM_ADMIN_RECOVERY_ALLOW_PENDING_MATERIAL=YES is the only escape
//     hatch, and it exists solely so an operator who has explicitly reviewed
//     existing pending enrollment material can clear it. Without it, the
//     presence of any TOTP ciphertext/nonce refuses.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { closePool, execute, getPool, runInTransaction } from '../dist/db/pool.js';
import { hashAdminEmail } from '../dist/platformadmin/auth/emailHash.js';
import { generateActivationToken } from '../dist/platformadmin/auth/PlatformAdminActivationService.js';
import { issueActivationTokenOnConnection } from '../dist/platformadmin/auth/MySqlPlatformAdminActivationRepository.js';
import { insertPlatformAdminAuditEventRow } from '../dist/platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { MySqlEmailOutboxRepository, insertEmailOutboxRowOnConnection } from '../dist/email/MySqlEmailOutboxRepository.js';
import { encryptOutboxContent } from '../dist/email/emailOutboxEncryption.js';
import { computeEmailIdempotencyKey } from '../dist/email/emailIdempotencyKey.js';
import { EMAIL_OUTBOX_CLAIM_LEASE_MS } from '../dist/email/emailTimingPolicy.js';
import { OUTBOX_MESSAGE_TTL_MS } from '../dist/email/EmailService.js';
import { attemptDeliveryAndRecordOutcome } from '../dist/email/EmailOutboxProcessor.js';
import { assertProductionEmailConfigurationComplete, resolveEmailProviderAdapter } from '../dist/email/emailProviderConfig.js';
import { RECOVERY_CONFIRMATION_VALUE, RecoveryRefusalError, evaluateRecoveryTarget } from './lib/platformAdminRecoveryVerdict.mjs';

// Same 30-minute window PlatformAdminActivationService.issueActivation uses.
// Deliberately duplicated rather than imported-and-re-exported: the service
// does not export its constant, and widening that module's public surface for
// a one-off operator script would be the larger change.
const ACTIVATION_TTL_MS = 30 * 60_000;

// Re-exported so callers/tests that already reach for the script keep one
// entry point; the definitions live in the pure module above.
export { RECOVERY_CONFIRMATION_VALUE, RecoveryRefusalError, evaluateRecoveryTarget };

function requireEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required to run recover-platform-admin-activation.mjs.`);
  return value;
}

/**
 * Advisory lock name for this script's one-time operator invariant. Exported
 * so tests can pin that the lock is acquired, is held across the write, and is
 * released before the network delivery attempt.
 */
export const ACTIVATION_RECOVERY_LOCK_NAME = 'pca:platform-admin-activation-recovery';
const LOCK_TIMEOUT_SECONDS = 30;

// Same acquire/release shape (and the same GET_LOCK/RELEASE_LOCK pair)
// bootstrap-platform-owner.mjs uses -- reusing the idiom rather than inventing
// a second serialization mechanism for the same kind of one-time operator run.
async function acquireRecoveryLock(pool) {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [ACTIVATION_RECOVERY_LOCK_NAME, LOCK_TIMEOUT_SECONDS]);
    if (!rows[0] || Number(rows[0].acquired) !== 1) throw new Error('Unable to acquire the Platform Admin activation recovery lock.');
    return connection;
  } catch (error) {
    connection.release();
    throw error instanceof Error ? error : new Error('Unable to acquire the Platform Admin activation recovery lock.');
  }
}

async function releaseRecoveryLock(connection) {
  try {
    const [rows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [ACTIVATION_RECOVERY_LOCK_NAME]);
    if (!rows[0] || Number(rows[0].released) !== 1) throw new Error('Unable to release the Platform Admin activation recovery lock.');
  } finally {
    connection.release();
  }
}

// Deliberately takes NO row locks. See this file's header: locking the account
// or MFA row here would invert the lock order PlatformAdminActivationRepository
// .complete() relies on, so serialization belongs to the advisory lock taken by
// runRecovery and the destructive step stays guarded by the repository's own
// WHERE clauses.
async function readTargetState(conn, emailHash) {
  const { rows: accountRows } = await execute(
    conn,
    `SELECT admin_id, status FROM platform_admin_accounts WHERE email_hash = ?`,
    [emailHash],
  );
  const adminId = accountRows.length > 0 ? accountRows[0].admin_id : null;
  const { rows: roleRows } = adminId
    ? await execute(conn, `SELECT role FROM platform_admin_role_assignments WHERE admin_id = ? AND revoked_at IS NULL ORDER BY role`, [adminId])
    : { rows: [] };
  const { rows: mfaRows } = adminId
    ? await execute(conn, `SELECT status, totp_secret_ciphertext, totp_secret_nonce FROM platform_admin_mfa_state WHERE admin_id = ?`, [adminId])
    : { rows: [] };
  return {
    accounts: accountRows.map((row) => ({ adminId: row.admin_id, status: row.status })),
    activeRoles: roleRows.map((row) => row.role),
    mfa: mfaRows.length > 0
      ? {
          status: mfaRows[0].status,
        // The two columns are set and cleared together by the activation
        // repository; either one being non-null means enrollment material
        // exists and a reissue would destroy it.
        totpMaterialPresent: mfaRows[0].totp_secret_ciphertext !== null || mfaRows[0].totp_secret_nonce !== null,
      }
      : null,
  };
}

export async function runRecovery(env = process.env) {
  // PCA_DATABASE_URL is consumed by backend/src/db/pool.ts itself -- required
  // here up front for a clear, early error rather than an opaque failure
  // deep inside the repository layer.
  requireEnv(env, 'PCA_DATABASE_URL');
  const email = requireEnv(env, 'PLATFORM_ADMIN_RECOVERY_EMAIL').trim().toLowerCase();
  if (requireEnv(env, 'PLATFORM_ADMIN_RECOVERY_CONFIRM') !== RECOVERY_CONFIRMATION_VALUE) {
    throw new Error(`PLATFORM_ADMIN_RECOVERY_CONFIRM must be exactly ${RECOVERY_CONFIRMATION_VALUE}.`);
  }
  const base = requireEnv(env, 'PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL');
  if (env.NODE_ENV === 'production' && !/^https:\/\//i.test(base)) {
    throw new Error('PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL must be HTTPS in production.');
  }
  assertProductionEmailConfigurationComplete(env);
  const provider = resolveEmailProviderAdapter(env);
  const allowPendingMaterial = env.PLATFORM_ADMIN_RECOVERY_ALLOW_PENDING_MATERIAL === 'YES';

  const emailHash = hashAdminEmail(email);
  const now = new Date();

  // Everything below is pure local computation (UUIDs, HMAC, AES-256-GCM),
  // done BEFORE the advisory lock is taken so the lock is held for as short a
  // window as possible: only the precondition re-check and one DB transaction.
  const { rawToken, tokenHash } = generateActivationToken();
  const activationId = randomUUID();
  const activationExpiresAt = new Date(now.getTime() + ACTIVATION_TTL_MS);
  const url = `${base.replace(/\/$/, '')}?token=${encodeURIComponent(rawToken)}`;
  // Same payload/idempotency-key shape EmailService.sendPlatformAdminActivationLink
  // uses -- idempotencyKey is keyed by the raw token (never the URL), so a
  // re-run with a fresh token is a new message rather than a suppressed one.
  const payload = { toEmail: email, kind: 'PLATFORM_ADMIN_ACTIVATION', code: url };
  const encryptedPayload = encryptOutboxContent(JSON.stringify(payload), env);
  const idempotencyKey = computeEmailIdempotencyKey('PLATFORM_ADMIN_ACTIVATION', email, rawToken, env);
  const outboxId = randomUUID();
  const outboxExpiresAt = new Date(now.getTime() + OUTBOX_MESSAGE_TTL_MS);
  const correlationId = randomUUID();

  const pool = getPool();
  const lock = await acquireRecoveryLock(pool);
  let committed;
  let roles;
  try {
    // Read-only preflight on the lock connection: refuse BEFORE writing
    // anything durable, so an operator pointed at the wrong account gets a
    // reason rather than a side effect. Deliberately not `FOR UPDATE` -- see
    // readTargetState's own comment.
    const preflight = await readTargetState(lock, emailHash);
    const preflightVerdict = evaluateRecoveryTarget(preflight, { allowPendingMaterial });
    if (!preflightVerdict.allowed) throw new RecoveryRefusalError(preflightVerdict.reason);
    roles = preflightVerdict.roles;

    committed = await runInTransaction(async (conn) => {
      // Re-read and re-decide inside the transaction. The preflight above is a
      // courtesy to the operator, not the safety boundary: an account state
      // change between the preflight and here must still be caught, and the
      // evalutation is what makes that catch possible.
      const reread = await readTargetState(conn, emailHash);
      const verdict = evaluateRecoveryTarget(reread, { allowPendingMaterial });
      if (!verdict.allowed) throw new RecoveryRefusalError(verdict.reason);

      await issueActivationTokenOnConnection(conn, {
        activationId,
        adminId: verdict.adminId,
        tokenHash,
        createdAt: now,
        expiresAt: activationExpiresAt,
      });
      const outboxOutcome = await insertEmailOutboxRowOnConnection(conn, {
        outboxId,
        idempotencyKey,
        encryptedPayload,
        createdAt: now,
        expiresAt: outboxExpiresAt,
        initialClaimableAt: new Date(now.getTime() + EMAIL_OUTBOX_CLAIM_LEASE_MS),
      });
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'SETTING_CHANGED',
        actorAdminId: null, // NULL = operator/system-initiated, see this file's header.
        actorRole: null,
        targetRef: `admin:${verdict.adminId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId,
        // Non-secret, non-identifying operational metadata only. Deliberately
        // NOT here: the email address, the raw token, the activation URL, or
        // anything derived from PLATFORM_ADMIN_MFA_ENC_KEY.
        metadata: {
          change: 'PLATFORM_ADMIN_ACTIVATION_REISSUED',
          source: 'OPERATOR_CREDENTIAL_RECOVERY',
          roles: verdict.roles,
          mfaStatusBefore: 'PENDING_SETUP',
          mfaStatusAfter: 'PENDING_SETUP',
          clearedPendingTotpMaterial: verdict.clearedPendingTotpMaterial,
          passwordCredentialChanged: false,
          tokenRevokedBeforeIssue: true,
        },
      });
      return { adminId: verdict.adminId, outboxOutcome };
    });
  } finally {
    // Released the moment the transaction has committed OR rolled back, and
    // never held across the network delivery attempt below.
    await releaseRecoveryLock(lock);
  }

  // Transaction already committed, lock already released: this immediate
  // delivery attempt is a real network call and must never happen inside a DB
  // transaction or while holding the advisory lock. If it fails, the
  // already-durable outbox row stays retryable by the background
  // EmailOutboxWorker -- the owner is not stranded.
  const deliveryOutcome = await attemptDeliveryAndRecordOutcome(
    { repository: new MySqlEmailOutboxRepository(), providerAdapter: provider, env },
    { outboxId, attemptCount: 0, expiresAt: outboxExpiresAt },
    payload,
    now,
  );

  return {
    adminId: committed.adminId,
    roles,
    outboxOutcome: committed.outboxOutcome,
    deliveryOutcome,
    providerName: provider.providerName,
    activationExpiresAt,
  };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  runRecovery()
    // Deliberately prints ONLY non-sensitive facts. No token, no URL, no
    // email address, no otpauth URI, no code, no secret of any kind.
    .then((result) => console.log(
      `PLATFORM_ADMIN_ACTIVATION_REISSUED=YES TARGET_REF=admin:${result.adminId} `
      + `OUTBOX=${result.outboxOutcome} DELIVERY=${result.deliveryOutcome} PROVIDER=${result.providerName} `
      + `EXPIRES_AT=${result.activationExpiresAt.toISOString()} NEXT_STEP=OWNER_OPENS_EMAILED_LINK`,
    ))
    .then(() => closePool())
    .catch(async (error) => {
      if (error instanceof RecoveryRefusalError) {
        console.error(`PLATFORM_ADMIN_ACTIVATION_REISSUED=NO REASON=${error.reason}`);
      } else {
        console.error(error instanceof Error ? error.message : 'Platform Admin activation recovery failed.');
      }
      await closePool();
      process.exitCode = 1;
    });
}
