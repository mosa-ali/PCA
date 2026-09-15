// PCA-PA-1: one-time operator-run bootstrap for the FIRST Platform
// Administration APP_OWNER account. NOT wired into `npm start`/main.ts and
// NOT reachable from any public signup path -- run manually by an operator
// with direct database access, exactly once per environment.
//
// WHY NO SEPARATE "bootstrap_used" FLAG TABLE IS NEEDED: this script's own
// safety invariant (step 3 below) queries
// platform_admin_role_assignments for any row with
// role='APP_OWNER' AND revoked_at IS NULL joined to a non-disabled
// account. If one already exists, the script refuses to proceed. That
// query IS the "has bootstrap already run" signal -- a durable, already-
// persisted fact, not a separate piece of state that could itself drift
// out of sync with reality. Adding a dedicated flag table would only
// duplicate this check with a second source of truth that could disagree
// with the first.
//
// MFA intentionally starts PENDING_SETUP. The existing authenticated
// activation flow establishes the password, encrypts the TOTP secret with
// AES-256-GCM, and activates MFA only after the first valid code.
//
// ATOMIC BOOTSTRAP (SESSION 2C stranding-defect fix): account creation, the
// APP_OWNER role assignment, PENDING_SETUP MFA state, bootstrap audit
// events, the first activation token, AND the durable email-outbox row are
// all persisted by ONE call to createFirstOwnerBootstrap -- a single
// database transaction (see MySqlFirstOwnerBootstrapRepository.ts). A
// PRIOR version of this script called account creation and activation
// issuance as two SEPARATE transactions; a failure in the second one left
// a permanently active, permanently un-activatable APP_OWNER behind, with
// no authenticated recovery path (see
// docs/supervision/PCA_FIRST_APP_OWNER_BOOTSTRAP_DB_CERTIFICATION_2026-09-15.md
// for the reproduced finding). That gap is now closed: either everything
// durable this bootstrap needs commits together, or none of it does.
//
// The advisory lock is held from BEFORE the zero-owner precondition
// re-check through the end of that one transaction (commit or rollback),
// and released immediately after -- never before the transaction resolves,
// and never held across the network email-delivery attempt below, which
// happens afterward, outside both the lock and any DB transaction, exactly
// like any other outbox message's delivery.
//
// The script is deliberately not a normal login or signup path; once the
// account exists, reissuance is performed only through the approved,
// authenticated activation lifecycle.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { hashAdminEmail } from '../dist/platformadmin/auth/emailHash.js';
import { PENDING_ACTIVATION_CREDENTIAL } from '../dist/platformadmin/auth/passwordCredential.js';
import { createFirstOwnerBootstrap } from '../dist/platformadmin/auth/MySqlFirstOwnerBootstrapRepository.js';
import { generateActivationToken } from '../dist/platformadmin/auth/PlatformAdminActivationService.js';
import { closePool, getPool } from '../dist/db/pool.js';
import { assertProductionEmailConfigurationComplete, resolveEmailProviderAdapter } from '../dist/email/emailProviderConfig.js';
import { MySqlEmailOutboxRepository } from '../dist/email/MySqlEmailOutboxRepository.js';
import { encryptOutboxContent } from '../dist/email/emailOutboxEncryption.js';
import { computeEmailIdempotencyKey } from '../dist/email/emailIdempotencyKey.js';
import { EMAIL_OUTBOX_CLAIM_LEASE_MS } from '../dist/email/emailTimingPolicy.js';
import { attemptDeliveryAndRecordOutcome } from '../dist/email/EmailOutboxProcessor.js';
import { OUTBOX_MESSAGE_TTL_MS } from '../dist/email/EmailService.js';

export const FIRST_OWNER_BOOTSTRAP_LOCK_NAME = 'pca:first-app-owner-bootstrap';
const LOCK_TIMEOUT_SECONDS = 30;
const ACTIVATION_TTL_MS = 30 * 60_000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run bootstrap-platform-owner.mjs.`);
  return value;
}

// Exported so scripts/promote-first-app-owner.mjs (the "grant APP_OWNER to
// an existing, already-ACTIVE Platform Admin" variant of the first-owner
// problem, per the 2026-09-15 owner architecture decision) reuses the
// IDENTICAL lock/precondition code, not a duplicate copy -- both scripts
// mutate the same "does an active owner exist yet" invariant and MUST
// serialize against each other, not just against themselves.
export async function acquireBootstrapLock(pool) {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [FIRST_OWNER_BOOTSTRAP_LOCK_NAME, LOCK_TIMEOUT_SECONDS]);
    if (!rows[0] || Number(rows[0].acquired) !== 1) throw new Error('Unable to acquire first-owner bootstrap lock.');
    return connection;
  } catch (error) {
    connection.release();
    throw error instanceof Error ? error : new Error('Unable to acquire first-owner bootstrap lock.');
  }
}

export async function releaseBootstrapLock(connection) {
  try {
    const [rows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [FIRST_OWNER_BOOTSTRAP_LOCK_NAME]);
    if (!rows[0] || Number(rows[0].released) !== 1) throw new Error('Unable to release first-owner bootstrap lock.');
  } finally {
    connection.release();
  }
}

export async function assertNoExistingAppOwner(connection) {
  const [rows] = await connection.query(
    `SELECT ra.admin_id
     FROM platform_admin_role_assignments ra
     JOIN platform_admin_accounts a ON a.admin_id = ra.admin_id
     WHERE ra.role = 'APP_OWNER' AND ra.revoked_at IS NULL AND a.status = 'ACTIVE'
     LIMIT 1`,
  );
  if (rows.length > 0) {
    throw new Error(
      'An active APP_OWNER account already exists. bootstrap-platform-owner.mjs is a one-time operation and refuses to run again -- use PlatformAdminAccountService.assignRole (via an authenticated APP_OWNER) to grant additional APP_OWNER accounts instead.',
    );
  }
}

export async function runBootstrap() {
  // PCA_DATABASE_URL is consumed by backend/src/db/pool.ts itself (see
  // getConnectionUri) -- required here up front for a clear, early error
  // rather than an opaque failure deep inside the repository layer.
  requireEnv('PCA_DATABASE_URL');
  const email = requireEnv('PLATFORM_ADMIN_BOOTSTRAP_EMAIL').trim().toLowerCase();
  assertProductionEmailConfigurationComplete(process.env);
  const provider = resolveEmailProviderAdapter(process.env);
  const base = process.env.PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL;
  if (!base || (process.env.NODE_ENV === 'production' && !/^https:\/\//i.test(base))) throw new Error('PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL must be HTTPS in production.');

  // Everything below is pure local computation (UUIDs, HMAC/AES-256-GCM) --
  // deliberately done BEFORE acquiring the advisory lock, so the lock (and
  // the dedicated pool connection it holds) is held for as short a window
  // as possible: only the precondition re-check and one DB transaction.
  const adminId = randomUUID();
  const now = new Date();
  const emailHash = hashAdminEmail(email);
  const correlationId = randomUUID();
  const { rawToken, tokenHash } = generateActivationToken();
  const activationExpiresAt = new Date(now.getTime() + ACTIVATION_TTL_MS);
  const url = `${(base ?? 'http://localhost:4100/platform-admin/activate').replace(/\/$/, '')}?token=${encodeURIComponent(rawToken)}`;
  // Same payload/idempotency-key shape EmailService.sendPlatformAdminActivationLink
  // uses -- idempotencyKey is keyed by the raw token (never the URL), matching
  // enqueueAndAttempt's own `idempotencyValue = token` argument for this call site.
  const payload = { toEmail: email, kind: 'PLATFORM_ADMIN_ACTIVATION', code: url };
  const encryptedPayload = encryptOutboxContent(JSON.stringify(payload), process.env);
  const idempotencyKey = computeEmailIdempotencyKey('PLATFORM_ADMIN_ACTIVATION', email, rawToken, process.env);
  const outboxId = randomUUID();
  const outboxExpiresAt = new Date(now.getTime() + OUTBOX_MESSAGE_TTL_MS);

  const pool = getPool();
  const lock = await acquireBootstrapLock(pool);
  let bootstrapResult;
  try {
    await assertNoExistingAppOwner(lock);
    bootstrapResult = await createFirstOwnerBootstrap({
      account: {
        adminId,
        emailHash,
        displayName: 'Platform Owner (bootstrap)',
        passwordCredential: PENDING_ACTIVATION_CREDENTIAL,
        createdAt: now,
        assignmentId: randomUUID(),
        role: 'APP_OWNER',
        grantedByAdminId: null, // NULL = system/bootstrap-granted, per migration 0005's comment.
        grantedAt: now,
        initialMfa: { status: 'PENDING_SETUP', totpSecretCiphertext: null, totpSecretNonce: null, activatedAt: null, createdAt: now },
        auditEvents: [
          {
            eventId: randomUUID(),
            eventType: 'ADMIN_CREATED',
            actorAdminId: null,
            actorRole: null,
            targetRef: `admin:${adminId}`,
            result: 'SUCCESS',
            occurredAt: now,
            correlationId,
            metadata: { source: 'BOOTSTRAP' },
          },
          {
            eventId: randomUUID(),
            eventType: 'ADMIN_ROLE_CHANGED',
            actorAdminId: null,
            actorRole: null,
            targetRef: `admin:${adminId}`,
            result: 'SUCCESS',
            occurredAt: now,
            correlationId,
            metadata: { action: 'GRANTED', role: 'APP_OWNER', source: 'BOOTSTRAP' },
          },
        ],
      },
      activation: { activationId: randomUUID(), tokenHash, createdAt: now, expiresAt: activationExpiresAt },
      outboxEmail: {
        outboxId,
        idempotencyKey,
        encryptedPayload,
        createdAt: now,
        expiresAt: outboxExpiresAt,
        initialClaimableAt: new Date(now.getTime() + EMAIL_OUTBOX_CLAIM_LEASE_MS),
      },
    });
  } finally {
    // Released the moment the atomic bootstrap transaction has committed OR
    // rolled back -- on a throw above, nothing durable was created, so
    // there is nothing left to deliver and the function exits here.
    await releaseBootstrapLock(lock);
  }

  // Transaction already committed, lock already released: this immediate
  // delivery attempt is a real network call and must never happen inside a
  // DB transaction or while holding the advisory lock. If it fails, the
  // already-durable outbox row (see above) remains retryable by the
  // background EmailOutboxWorker -- the APP_OWNER is not stranded.
  await attemptDeliveryAndRecordOutcome(
    { repository: new MySqlEmailOutboxRepository(), providerAdapter: provider, env: process.env },
    { outboxId, attemptCount: 0, expiresAt: outboxExpiresAt },
    payload,
    now,
  );

  return { providerName: provider.providerName, outboxOutcome: bootstrapResult.outboxOutcome };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  runBootstrap()
    .then((result) => console.log(`FIRST_OWNER_BOOTSTRAP=ACTIVATION_ISSUED PROVIDER=${result.providerName}`))
    .then(() => closePool())
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : 'First-owner bootstrap failed.');
      await closePool();
      process.exitCode = 1;
    });
}
