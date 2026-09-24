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
// THE FOUR DELIBERATE PROPERTIES
//
// 1. A COMPLETED FAMILY GENESIS, driven through the REAL ceremony. This
//    property is the OPPOSITE of what this header used to claim ("NO GENESIS
//    DEPENDENCY ... genesis status is REPORTED, not required"), and the change
//    is a correction, not a regression. That claim was written when
//    verifyEmail completed genesis as a side effect. PCA-DEC-020-R1 removed
//    that (email verification now establishes identity only), so an account
//    that stops at verification has NO family; login resolves `role: null`
//    (ParentAccountService.resolveFamilyRole fails closed on a null familyId)
//    and RealServiceAuthClient.toAuthenticatedSession refuses the session with
//    UNAUTHORIZED_FAMILY_SCOPE. The result was that the certified parent E2E
//    could authenticate and still never leave /login -- it could not pass at
//    all. Completing the real ceremony here (see ./lib/completeFamilyGenesis
//    .mjs) is what makes the certified assertions reachable, and it exercises
//    the genuine genesis path rather than bypassing it.
//
// 2. TEST-PROVIDER EMAIL ONLY, NEVER REAL DELIVERY. The verification and
//    genesis step-up codes are read back in-process through
//    TestSandboxEmailSender.lastCodeFor, which refuses to construct at all
//    outside test/development. No mail leaves the process. This is the same
//    sanctioned mechanism bootstrap-e2e-parent-account.mjs and seed-local.mjs
//    already use.
//
// 3. A PRE-ISSUED BROWSER GRANT -- the non-obvious one. Every explicit parent
//    login now requires a valid daily-login grant or an emailed step-up code
//    (see ParentAccountService.login: a successful password check is never
//    enough on its own). A Playwright browser process cannot receive that
//    email, and this repository deliberately exposes NO verification-code-read
//    route for one to reach, so a password-only UI sign-in can never reach
//    /dashboard against current source. The grant is therefore issued here and
//    handed to the browser as a cookie, exactly as if the user had already
//    completed a step-up in that browser. Only the domain-separated SHA-256
//    hash is persisted, matching production; the raw token exists solely in
//    this script's output manifest.
//
// 4. THE FAMILY THE PLATFORM-ADMIN SUITE ACTS ON IS THE GENESIS FAMILY. This
//    script used to INSERT a stand-alone families row by hand purely so the
//    admin suite had something to suspend and reactivate. Genesis now supplies
//    a real one, so the hand-made row is gone and both suites act on the same
//    family.
//
// NOTHING HERE WEAKENS A PRODUCTION CONTROL: the genesis ceremony is driven
// through the same ParentAccountService methods the production HTTP routes
// drive (only the verifier is substituted, as ./lib/completeFamilyGenesis.mjs
// documents), the grant is issued through the same repository method
// production uses, expires in 24h like production, and everything is deleted
// with the disposable database.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../dist/db/pool.js';
import { MySqlParentAccountRepository } from '../dist/parentaccount/MySqlParentAccountRepository.js';
import { createTestSandboxEmailSender } from '../dist/parentaccount/TestSandboxEmailSender.js';
import { P256DeviceSignatureVerifier } from '../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { completeFamilyGenesis, createDisposableGenesisParentAccountService, issueDailyLoginGrant } from './lib/completeFamilyGenesis.mjs';
import { PlatformAdminAccountService } from '../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../dist/platformadmin/auth/MySqlAuthRepository.js';
import { hashAdminEmail } from '../dist/platformadmin/auth/emailHash.js';
import { base32Encode, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../dist/platformadmin/auth/totp.js';

const DISPOSABLE_DATABASE_HOSTS = ['127.0.0.1', 'localhost', 'mysql'];
const TEST_EMAIL_DOMAIN = 'pca-e2e.test';
const TEST_PASSWORD = 'Correct Horse Battery Staple 2026!';
const PARENT_KEY = 'e2e-parent';
const SECOND_PARENT_KEY = 'e2e-cross-family';
// A VERIFIED parent that deliberately has NO family: the real-browser genesis
// spec (parent-web/e2e-real/genesis.spec.ts) performs the ceremony itself.
const GENESIS_PARENT_KEY = 'e2e-genesis';
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
// ONE sender instance, injected AND queried. TestSandboxEmailSender records mail
// in a per-INSTANCE array, so constructing a second one to read the code back
// searches an empty array and always returns null -- which would make this
// script throw before any browser test ran. bootstrap-e2e-parent-account.mjs and
// seed-local.mjs both share a single instance for exactly this reason.
const emailSender = createTestSandboxEmailSender();
// The REAL genesis ceremony, with a real P-256 verifier in place of
// production's fail-closed RejectingDeviceSignatureVerifier -- see
// ./lib/completeFamilyGenesis.mjs for why this substitution is the sanctioned
// one and why the substitution is made visible here rather than buried.
const parentAccountService = createDisposableGenesisParentAccountService({
  emailSender,
  verifier: new P256DeviceSignatureVerifier(),
});

async function provisionParent(key) {
  const email = `${key}@${TEST_EMAIL_DOMAIN}`;
  await parentAccountService.register(email, TEST_PASSWORD, TEST_PASSWORD);
  const verificationCode = emailSender.lastCodeFor(email);
  if (!verificationCode) refuse(`no verification code was recorded for ${key}.`);
  const verified = await parentAccountService.verifyEmail(email, verificationCode);
  if (!verified.accountId) refuse(`email verification did not yield an accountId for ${key}.`);

  // PCA-DEC-020-R1 made email verification identity-only. The browser suites
  // therefore complete the same family genesis ceremony a real parent would
  // complete next; otherwise the login response has no family role and the
  // Parent Web client correctly remains unauthenticated.
  const genesis = await completeFamilyGenesis({
    parentAccountService,
    emailSender,
    sessionToken: verified.rawSessionToken,
    email,
    password: TEST_PASSWORD,
  });
  if (!genesis.familyId) refuse(`family genesis did not yield a familyId for ${key}.`);
  // The genesis membership must be ACTIVE, or login would still resolve
  // `role: null` and the client would still refuse the session.
  const role = await parentAccountRepository.findActiveRole(verified.accountId, genesis.familyId);
  if (role === null) refuse(`the genesis administrator role was not resolvable for ${key}.`);
  const dailyLoginGrant = await issueDailyLoginGrant({ repository: parentAccountRepository, accountId: verified.accountId, now });
  return { email, accountId: verified.accountId, familyId: genesis.familyId, role, dailyLoginGrant };
}

const parent = await provisionParent(PARENT_KEY);
const secondParent = await provisionParent(SECOND_PARENT_KEY);

/** Verified, authenticated, pre-family (GENESIS_REQUIRED). Genesis is left to the browser. */
async function provisionPreFamilyParent(key) {
  const email = `${key}@${TEST_EMAIL_DOMAIN}`;
  await parentAccountService.register(email, TEST_PASSWORD, TEST_PASSWORD);
  const verificationCode = emailSender.lastCodeFor(email);
  if (!verificationCode) refuse(`no verification code was recorded for ${key}.`);
  const verified = await parentAccountService.verifyEmail(email, verificationCode);
  if (!verified.accountId) refuse(`email verification did not yield an accountId for ${key}.`);
  if (verified.familyId !== null) refuse(`${key} must start without a family.`);
  const dailyLoginGrant = await issueDailyLoginGrant({ repository: parentAccountRepository, accountId: verified.accountId, now });
  return { email, accountId: verified.accountId, familyId: null, dailyLoginGrant };
}
const genesisParent = await provisionPreFamilyParent(GENESIS_PARENT_KEY);

// --- The family the platform-admin suite acts on -------------------------
// The admin suite's suspend/reactivate round-trip needs a REAL families row to
// operate on: it clicks that family's own link in the accounts list and asserts
// the ACTIVE -> SUSPENDED -> ACTIVE transition actually persists to MySQL. With
// no such row, E2E_REAL_TEST_FAMILY_ID stays unset, the spec's own guard skips
// the step, and the zero-skip anti-vacuous-pass guard then fails the whole job
// -- so the admin suite could never certify. That is why this exists.
//
// GENESIS'S OWN ROW, NOT A SEPARATE BARE ONE. This script used to INSERT a
// stand-alone families row by hand (createFamilyIfAbsent(randomUUID())), because
// no genesis-completed family was available to it. Now that the parent account
// completes genesis, that ceremony's family IS a real families row written by
// production's own atomic transaction -- a second, hand-made family would be
// redundant and would force the admin suite to choose between two. This now
// points at the genesis family, which is also the family the parent E2E signs
// in to, so the suspend/reactivate round-trip acts on a family that genuinely
// has a parent member.
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
      genesisParent: { ...genesisParent, password: TEST_PASSWORD },
      operator: { email: adminEmail, password: TEST_PASSWORD, role: 'APP_OWNER', totpSecretBase32: base32Encode(totpSecret) },
      family: { familyId: testFamilyId },
      genesisCompleted: true,
    },
    null,
    2,
  ),
  'utf8',
);

console.log('Provisioned the disposable E2E accounts.');
console.log('Genesis completion state: completed for both parent fixtures; the genesis fixture is pre-family by design.');
console.log('Wrote the E2E fixture manifest.');

await closePool();
