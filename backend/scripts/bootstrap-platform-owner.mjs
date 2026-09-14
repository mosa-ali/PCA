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
// The script is deliberately not a normal login or signup path; once the
// account exists, reissuance is performed only through the approved,
// authenticated activation lifecycle.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { hashAdminEmail } from '../dist/platformadmin/auth/emailHash.js';
import { PENDING_ACTIVATION_CREDENTIAL } from '../dist/platformadmin/auth/passwordCredential.js';
import { MySqlPlatformAdminAuthRepository } from '../dist/platformadmin/auth/MySqlAuthRepository.js';
import { MySqlPlatformAdminActivationRepository } from '../dist/platformadmin/auth/MySqlPlatformAdminActivationRepository.js';
import { generateActivationToken } from '../dist/platformadmin/auth/PlatformAdminActivationService.js';
import { closePool, getPool } from '../dist/db/pool.js';
import { EmailService } from '../dist/email/EmailService.js';
import { MySqlEmailOutboxRepository } from '../dist/email/MySqlEmailOutboxRepository.js';
import { assertProductionEmailConfigurationComplete, resolveEmailProviderAdapter } from '../dist/email/emailProviderConfig.js';

export const FIRST_OWNER_BOOTSTRAP_LOCK_NAME = 'pca:first-app-owner-bootstrap';
const LOCK_TIMEOUT_SECONDS = 30;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run bootstrap-platform-owner.mjs.`);
  return value;
}

async function acquireBootstrapLock(pool) {
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

async function releaseBootstrapLock(connection) {
  try {
    const [rows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [FIRST_OWNER_BOOTSTRAP_LOCK_NAME]);
    if (!rows[0] || Number(rows[0].released) !== 1) throw new Error('Unable to release first-owner bootstrap lock.');
  } finally {
    connection.release();
  }
}

async function assertNoExistingAppOwner(connection) {
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

  const pool = getPool();
  const lock = await acquireBootstrapLock(pool);
  try {
    await assertNoExistingAppOwner(lock);
    const repository = new MySqlPlatformAdminAuthRepository();
    const adminId = randomUUID();
    const now = new Date();
    const emailHash = hashAdminEmail(email);
    const correlationId = randomUUID();
    await repository.createAccount({
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
    });
    const { rawToken, tokenHash } = generateActivationToken();
    const activationRepository = new MySqlPlatformAdminActivationRepository();
    const createdAt = new Date();
    await activationRepository.issue({ activationId: randomUUID(), adminId, tokenHash, createdAt, expiresAt: new Date(createdAt.getTime() + 30 * 60_000) });
    const emailSender = new EmailService({ repository: new MySqlEmailOutboxRepository(), providerAdapter: provider, env: process.env });
    const url = `${(base ?? 'http://localhost:4100/platform-admin/activate').replace(/\/$/, '')}?token=${encodeURIComponent(rawToken)}`;
    await emailSender.sendPlatformAdminActivationLink(email, url, rawToken);
    return { providerName: provider.providerName };
  } finally {
    await releaseBootstrapLock(lock);
  }
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
