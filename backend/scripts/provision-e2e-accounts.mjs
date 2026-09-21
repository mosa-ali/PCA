// Deterministic provisioning for the real-backend E2E suites
// (parent-web/e2e-real and platform-admin-web/e2e-real). Runs only against a
// disposable database and only outside a production-sensitive runtime.
//
// WHY THIS EXISTS INSTEAD OF backend/scripts/seed-local.mjs
// seed-local.mjs is a broad developer fixture: it seeds families, invitations,
// billing invoices, settlement batches and disputes. Several of those sections
// dereference a familyId, which only exists once family GENESIS has completed,
// so its success depends on an unrelated subsystem. The E2E job needs exactly
// three things and nothing else, so depending on the rest made the job fail for
// reasons that had nothing to do with what it was certifying. This script is
// deliberately narrow: one verified account of each kind, plus the one piece of
// state a browser cannot obtain for itself (below).
//
// THE THREE DELIBERATE PROPERTIES
//
// 1. NO GENESIS DEPENDENCY. The verified account is selected and reported by
//    accountId, which verifyEmail always sets, never by familyId, which is only
//    set when genesis completes. Genesis status is REPORTED, not required.
//
// 2. TEST-PROVIDER EMAIL ONLY, NEVER REAL DELIVERY. The verification code is
//    read back in-process through TestSandboxEmailSender.lastCodeFor, which
//    refuses to construct at all outside test/development. No mail leaves the
//    process. This is the same sanctioned mechanism
//    bootstrap-e2e-parent-account.mjs and seed-local.mjs already use.
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
// NOTHING HERE WEAKENS A PRODUCTION CONTROL: the grant is issued through the
// same repository method production uses, expires in 24h like production, and
// is deleted with the disposable database.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../dist/db/pool.js';
import { AuthService } from '../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../dist/auth/MySqlAuthRepository.js';
import { ParentAccountService } from '../dist/parentaccount/ParentAccountService.js';
import { MySqlParentAccountRepository } from '../dist/parentaccount/MySqlParentAccountRepository.js';
import { createTestSandboxEmailSender } from '../dist/parentaccount/TestSandboxEmailSender.js';
import { generateDailyLoginGrant } from '../dist/parentaccount/dailyLoginGrant.js';
import { createEd25519DeviceSignatureVerifier } from '../dist/parentaccount/genesisDeviceSigner.js';
import { FamilyOwnerAttestationChainEngine } from '../dist/familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { MySqlFamilyAuthorityGenesisStore } from '../dist/familycommercial/authority/MySqlGenesisAnchorStore.js';
import { MySqlFamilyAuthorityAttestationChainStore } from '../dist/familycommercial/authority/MySqlAttestationChainStore.js';
import { PlatformAdminAccountService } from '../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../dist/platformadmin/auth/MySqlAuthRepository.js';
import { hashAdminEmail } from '../dist/platformadmin/auth/emailHash.js';
import { base32Encode, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../dist/platformadmin/auth/totp.js';

const GRANT_TTL_MS = 24 * 60 * 60 * 1000;
const DISPOSABLE_DATABASE_HOSTS = ['127.0.0.1', 'localhost', 'mysql'];
const TEST_EMAIL_DOMAIN = 'pca-e2e.test';
const TEST_PASSWORD = 'Correct Horse Battery Staple 2026!';
const PARENT_KEY = 'e2e-parent';
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

// --- The verified account -------------------------------------------------
// ONE sender instance, injected AND queried. TestSandboxEmailSender records mail
// in a per-INSTANCE array, so constructing a second one to read the code back
// searches an empty array and always returns null -- which would make this
// script throw before any browser test ran. bootstrap-e2e-parent-account.mjs and
// seed-local.mjs both share a single instance for exactly this reason.
const emailSender = createTestSandboxEmailSender();
const parentEmail = `${PARENT_KEY}@${TEST_EMAIL_DOMAIN}`;
const parentAccountService = new ParentAccountService({
  repository: new MySqlParentAccountRepository(),
  authService: new AuthService(new MySqlAuthRepository()),
  emailSender,
  familyGenesisEngine: new FamilyOwnerAttestationChainEngine(
    new MySqlFamilyAuthorityGenesisStore(),
    new MySqlFamilyAuthorityAttestationChainStore(),
    createEd25519DeviceSignatureVerifier(),
    () => new Date(),
  ),
});

await parentAccountService.register(parentEmail, TEST_PASSWORD, TEST_PASSWORD);
const verificationCode = emailSender.lastCodeFor(parentEmail);
if (!verificationCode) refuse('no verification code was recorded for the fixture address.');
const verified = await parentAccountService.verifyEmail(parentEmail, verificationCode);
if (!verified.accountId) refuse('email verification did not yield an accountId.');
const genesisCompleted = verified.familyId != null;

// --- The browser grant a Playwright process cannot obtain for itself ------
const grant = generateDailyLoginGrant();
await new MySqlParentAccountRepository().insertDailyLoginGrant({
  grantId: randomUUID(),
  accountId: verified.accountId,
  tokenHash: grant.tokenHash,
  purpose: 'PARENT_DAILY_LOGIN',
  createdAt: now,
  expiresAt: new Date(now.getTime() + GRANT_TTL_MS),
});

// --- The ACTIVE operator account with a known TOTP secret -----------------
// Mirrors seed-local.mjs's seedPlatformAdmin and bootstrap-platform-owner.mjs's
// documented precedent: MFA is activated directly because there is no
// self-service MFA-setup HTTP endpoint in this repository slice.
const adminRepository = new MySqlPlatformAdminAuthRepository();
const adminEmail = `${ADMIN_KEY}@${TEST_EMAIL_DOMAIN}`;
const adminAccount = await new PlatformAdminAccountService(adminRepository).createAccount(
  `E2E ${ADMIN_KEY}`,
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
      parent: { email: parentEmail, password: TEST_PASSWORD, dailyLoginGrant: grant.rawToken },
      operator: { email: adminEmail, password: TEST_PASSWORD, role: 'APP_OWNER', totpSecretBase32: base32Encode(totpSecret) },
      genesisCompleted,
    },
    null,
    2,
  ),
  'utf8',
);

console.log('Provisioned the disposable E2E accounts.');
console.log('Genesis completion state:', genesisCompleted ? 'completed' : 'not-completed');
console.log('Wrote the E2E fixture manifest.');

await closePool();
