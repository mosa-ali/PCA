// Deterministic provisioning for the real-backend E2E suites
// (parent-web/e2e-real and platform-admin-web/e2e-real). Runs only against a
// disposable database and only outside a production-sensitive runtime.
//
// WHY THIS EXISTS INSTEAD OF backend/scripts/seed-local.mjs
// seed-local.mjs is a broad developer fixture: it seeds families, invitations,
// billing invoices, settlement batches and disputes. The E2E job needs exactly
// three things and nothing else, so depending on the rest made the job fail for
// reasons that had nothing to do with what it was certifying. This script is
// deliberately narrow: two verified parent accounts, one active operator, plus
// the one piece of
// state a browser cannot obtain for itself (below).
//
// THE DELIBERATE PROPERTIES (PCA-DEC-037, 2026-09-24 -- Parent Genesis removed)
//
// 1. THE REAL PARENT JOURNEY. Each parent is registered, verified and signed in
//    through the same ParentAccountService methods the HTTP routes drive. The
//    first sign-in provisions the family server-side (ADMINISTRATOR
//    membership, ACTIVE scope) and starts the one 3-day MFA grace window.
//
// 2. TEST-PROVIDER EMAIL ONLY, NEVER REAL DELIVERY. Verification and login
//    codes are read back in-process through TestSandboxEmailSender.lastCodeFor,
//    which refuses to construct outside test/development.
//
// 3. A BROWSER GRANT FOR THE GRACE-PERIOD PARENTS. Completing the emailed login
//    code yields the production daily grant; it is handed to the browser as a
//    cookie so a Playwright process (which cannot read mail) signs in exactly as
//    a returning browser would during grace. Only its hash is persisted.
//
// 4. ONE PARENT WITH AN AUTHENTICATOR. `mfaParent` has completed TOTP
//    enrollment through the real endpoints; the manifest carries its base32
//    secret so the real-browser MFA spec can act as the authenticator app. No
//    grant can bypass its TOTP, by design.
//
// 5. THE FAMILY THE PLATFORM-ADMIN SUITE ACTS ON is the primary parent's
//    provisioned family.
//
// NOTHING HERE WEAKENS A PRODUCTION CONTROL: every step is the production code
// path, grants expire in 24h, and everything is deleted with the disposable
// database. PCA_PARENT_MFA_ENC_KEY must match the backend under test.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../dist/db/pool.js';
import { MySqlParentAccountRepository } from '../dist/parentaccount/MySqlParentAccountRepository.js';
import { createTestSandboxEmailSender } from '../dist/parentaccount/TestSandboxEmailSender.js';
import { createDisposableParentAccountService, enrollParentAuthenticator, provisionSignedInParent } from './lib/provisionParentAccount.mjs';
import { PlatformAdminAccountService } from '../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../dist/platformadmin/auth/MySqlAuthRepository.js';
import { hashAdminEmail } from '../dist/platformadmin/auth/emailHash.js';
import { base32Encode, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../dist/platformadmin/auth/totp.js';

const DISPOSABLE_DATABASE_HOSTS = ['127.0.0.1', 'localhost', 'mysql'];
const TEST_EMAIL_DOMAIN = 'pca-e2e.test';
const TEST_PASSWORD = 'Correct Horse Battery Staple 2026!';
const PARENT_KEY = 'e2e-parent';
const SECOND_PARENT_KEY = 'e2e-cross-family';
// A parent that has already enrolled an authenticator app (TOTP on every login).
const MFA_PARENT_KEY = 'e2e-mfa';
const ADMIN_KEY = 'e2e-owner';

function refuse(reason) {
  throw new Error(`Refusing to provision E2E fixtures: ${reason}`);
}

const connectionString = process.env.PCA_DATABASE_URL;
if (!connectionString) refuse('PCA_DATABASE_URL is required.');
const databaseHost = new URL(connectionString).hostname;
if (!DISPOSABLE_DATABASE_HOSTS.includes(databaseHost)) {
  refuse('PCA_DATABASE_URL must point at the disposable local/Compose database.');
}
if (process.env.NODE_ENV === 'production') {
  refuse('this script is a test fixture and must never run in production.');
}

const now = new Date();
// One repository instance, shared by the account/authority steps below -- it is
// stateless (it borrows the shared pool), so sharing it is a clarity choice
// rather than a requirement.
const parentAccountRepository = new MySqlParentAccountRepository();

// --- The verified parent accounts -----------------------------------------
// ONE sender instance, injected AND queried: TestSandboxEmailSender records mail
// per INSTANCE, so a second instance would always read back null.
const emailSender = createTestSandboxEmailSender();
const parentAccountService = createDisposableParentAccountService({ emailSender });

async function provisionParent(key) {
  const email = `${key}@${TEST_EMAIL_DOMAIN}`;
  const signedIn = await provisionSignedInParent({ service: parentAccountService, emailSender, email, password: TEST_PASSWORD });
  const role = await parentAccountRepository.findActiveRole(signedIn.accountId, signedIn.familyId);
  if (role !== 'ADMINISTRATOR') refuse(`the provisioned ADMINISTRATOR role was not resolvable for ${key}.`);
  return { email, accountId: signedIn.accountId, familyId: signedIn.familyId, role, graceExpiresAt: signedIn.graceExpiresAt, dailyLoginGrant: signedIn.dailyLoginGrant, sessionToken: signedIn.sessionToken };
}

const { sessionToken: _parentSession, ...parent } = await provisionParent(PARENT_KEY);
const { sessionToken: _secondSession, ...secondParent } = await provisionParent(SECOND_PARENT_KEY);
const mfaProvisioned = await provisionParent(MFA_PARENT_KEY);
const mfaTotpSecretBase32 = await enrollParentAuthenticator({
  service: parentAccountService,
  sessionToken: mfaProvisioned.sessionToken,
  email: mfaProvisioned.email,
  password: TEST_PASSWORD,
});
// Enrollment revokes every browser grant; the manifest must not carry a dead one.
const { sessionToken: _mfaSession, dailyLoginGrant: _revokedGrant, ...mfaParent } = mfaProvisioned;

// --- The family the platform-admin suite acts on -------------------------
// The admin suite's suspend/reactivate round-trip needs a REAL families row to
// operate on: it clicks that family's own link in the accounts list and asserts
// the ACTIVE -> SUSPENDED -> ACTIVE transition actually persists to MySQL. With
// no such row, E2E_REAL_TEST_FAMILY_ID stays unset, the spec's own guard skips
// the step, and the zero-skip anti-vacuous-pass guard then fails the whole job
// -- so the admin suite could never certify. That is why this exists.
//
// The primary parent's server-provisioned family is a real families row with a
// real ADMINISTRATOR member, so the suspend/reactivate round-trip acts on a
// family that genuinely has a parent.
const testFamilyId = parent.familyId;

// --- The ACTIVE operator account with a known TOTP secret -----------------
// Mirrors seed-local.mjs's seedPlatformAdmin and bootstrap-platform-owner.mjs's
// documented precedent: MFA is activated directly because there is no
// self-service MFA-setup HTTP endpoint in this repository slice.
const adminRepository = new MySqlPlatformAdminAuthRepository();
const adminEmail = `${ADMIN_KEY}@${TEST_EMAIL_DOMAIN}`;
// The display name is the SAME one bootstrap-platform-owner.mjs writes, on
// purpose: platform-admin-web/e2e-real/realBackend.spec.ts's documented
// precondition is "exactly one bootstrap APP_OWNER account created via
// backend/scripts/bootstrap-platform-owner.mjs", and its admin-users step
// asserts that real row is listed. A fixture that created the same authority
// under a different display name satisfied everything except that assertion,
// which then failed against a list that was in fact correct. Writing the
// bootstrap identity here keeps the spec's stated precondition true instead of
// teaching the spec to expect a fixture-shaped name.
const adminAccount = await new PlatformAdminAccountService(adminRepository).createAccount(
  'Platform Owner (bootstrap)',
  hashAdminEmail(adminEmail),
  TEST_PASSWORD,
  'APP_OWNER',
  'BOOTSTRAP',
);
const totpSecret = generateTotpSecret();
const encryptedSecret = encryptTotpSecret(totpSecret, loadMfaEncryptionKey());
await getPool().query(
  `UPDATE platform_admin_mfa_state SET status = 'ACTIVE', totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NOW(3) WHERE admin_id = ?`,
  [encryptedSecret.ciphertext, encryptedSecret.nonce, adminAccount.adminId],
);

// --- Output ---------------------------------------------------------------
// The manifest is the only place identifier material is written, exactly as
// seed-local.mjs's QA seed manifest is. Stdout deliberately reports no
// addresses, no codes and no tokens: it lands in terminal scrollback and in the
// log of whatever harness invokes this script.
const manifestPath = process.env.QA_E2E_MANIFEST_PATH ?? fileURLToPath(new URL('../qa-e2e-manifest.json', import.meta.url));
await writeFile(
  manifestPath,
  JSON.stringify(
    {
      generatedAtUtc: now.toISOString(),
      parent: { ...parent, password: TEST_PASSWORD },
      secondParent: { ...secondParent, password: TEST_PASSWORD },
      mfaParent: { ...mfaParent, password: TEST_PASSWORD, totpSecretBase32: mfaTotpSecretBase32 },
      operator: { email: adminEmail, password: TEST_PASSWORD, role: 'APP_OWNER', totpSecretBase32: base32Encode(totpSecret) },
      family: { familyId: testFamilyId },
    },
    null,
    2,
  ),
  'utf8',
);

console.log('Provisioned the disposable E2E accounts.');
console.log('Parent fixtures: two inside the MFA grace window, one with an enrolled authenticator.');
console.log('Wrote the E2E fixture manifest.');

await closePool();
