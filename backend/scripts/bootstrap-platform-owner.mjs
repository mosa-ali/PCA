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
// WHY MFA IS PROVISIONED ACTIVE HERE (never PENDING_SETUP): PCA-ADD-PA-016
// requires MFA to be mandatory with zero bypass -- PlatformAdminAuthService
// .login refuses to complete authentication for any account whose MFA
// status is not exactly ACTIVE. There is no unauthenticated "complete MFA
// setup" HTTP endpoint anywhere in this PCA-PA-1 lane (by design -- see
// this lane's final report), so if this script left the bootstrap account
// in PENDING_SETUP, that account would have no way to ever reach ACTIVE
// and would be permanently unable to log in. Provisioning the TOTP secret
// and activating MFA in this same one-time, operator-run, already-
// privileged script closes that gap safely: the operator is already
// trusted with direct database/environment access at this point, and the
// otpauth:// URI printed below lets them enroll it into an authenticator
// app immediately, in the same breath as account creation.
//
// KNOWN, DOCUMENTED SCOPE BOUNDARY: PlatformAdminAccountService.createAccount
// (used for any admin account created AFTER bootstrap, by a future
// workstream's tooling) has this exact same limitation -- it seeds MFA
// PENDING_SETUP because it has no operator-present TOTP secret to seed
// ACTIVE with, and there is still no self-service "complete MFA setup" HTTP
// flow to ever move it to ACTIVE. That is expected for this foundational
// lane and is flagged explicitly in the implementation report as a
// SHARED_INTEGRATION_REQUIRED-worthy gap for a later workstream (PCA-PA-3
// Platform Admin Web, most likely), not an oversight here.
import { randomBytes, randomUUID } from 'node:crypto';
import { hashAdminEmail } from '../dist/platformadmin/auth/emailHash.js';
import { hashPassword } from '../dist/platformadmin/auth/passwordCredential.js';
import { buildOtpauthUri, base32Encode, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../dist/platformadmin/auth/totp.js';
import { MySqlPlatformAdminAuthRepository } from '../dist/platformadmin/auth/MySqlAuthRepository.js';
import { closePool, getPool } from '../dist/db/pool.js';

const SAVE_NOW_BANNER =
  '\n=================================================================\n' +
  'SAVE THIS NOW -- IT WILL NOT BE SHOWN AGAIN.\n' +
  '=================================================================\n';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run bootstrap-platform-owner.mjs.`);
  return value;
}

function generateRandomPassword() {
  // 24+ characters of cryptographically random base64url content --
  // never a hardcoded default password.
  return randomBytes(24).toString('base64url');
}

async function assertNoExistingAppOwner(pool) {
  const [rows] = await pool.query(
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

async function main() {
  // PCA_DATABASE_URL is consumed by backend/src/db/pool.ts itself (see
  // getConnectionUri) -- required here up front for a clear, early error
  // rather than an opaque failure deep inside the repository layer.
  requireEnv('PCA_DATABASE_URL');
  const mfaEncKey = loadMfaEncryptionKey(); // throws synchronously if PLATFORM_ADMIN_MFA_ENC_KEY is absent/malformed -- fail-closed, per totp.ts's contract.
  const email = requireEnv('PLATFORM_ADMIN_BOOTSTRAP_EMAIL');

  const providedPassword = process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD;
  const password = providedPassword && providedPassword.length > 0 ? providedPassword : generateRandomPassword();
  const passwordWasGenerated = !providedPassword;

  const pool = getPool();
  await assertNoExistingAppOwner(pool);

  const repository = new MySqlPlatformAdminAuthRepository();
  const adminId = randomUUID();
  const now = new Date();
  const emailHash = hashAdminEmail(email);
  const passwordCredential = await hashPassword(password);

  const totpSecret = generateTotpSecret();
  const { ciphertext, nonce } = encryptTotpSecret(totpSecret, mfaEncKey);
  const secretBase32 = base32Encode(totpSecret);
  const otpauthUri = buildOtpauthUri(email, secretBase32);

  const correlationId = randomUUID();
  await repository.createAccount({
    adminId,
    emailHash,
    displayName: 'Platform Owner (bootstrap)',
    passwordCredential,
    createdAt: now,
    assignmentId: randomUUID(),
    role: 'APP_OWNER',
    grantedByAdminId: null, // NULL = system/bootstrap-granted, per migration 0005's comment.
    grantedAt: now,
    initialMfa: { status: 'ACTIVE', totpSecretCiphertext: ciphertext, totpSecretNonce: nonce, activatedAt: now, createdAt: now },
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

  console.log('Platform Administration APP_OWNER account created.');
  console.log(`adminId: ${adminId}`);
  console.log(`email: ${email}`);
  if (passwordWasGenerated) {
    console.log(SAVE_NOW_BANNER);
    console.log(`Generated password: ${password}`);
    console.log(SAVE_NOW_BANNER);
  } else {
    console.log('Password: (supplied via PLATFORM_ADMIN_BOOTSTRAP_PASSWORD)');
  }
  console.log(SAVE_NOW_BANNER);
  console.log('MFA enrollment URI (scan/enter into an authenticator app now):');
  console.log(otpauthUri);
  console.log(SAVE_NOW_BANNER);
}

main()
  .then(() => closePool())
  .catch(async (error) => {
    console.error(error.message);
    await closePool();
    process.exitCode = 1;
  });
