// PCA R3 Prompt-1 local validation: deterministic, TEST-ONLY synthetic
// seed data for the disposable local MySQL instance. Never run against a
// non-local/non-Compose database (verify-mysql.mjs's own hostname
// allowlist pattern is mirrored below for the same reason).
//
// Uses the SAME real service/repository classes backend/src/main.ts wires
// in production (ParentAccountService + MySqlParentAccountRepository +
// AuthService + FamilyOwnerAttestationChainEngine + PlatformAdminAccountService),
// so every seeded account is created through the actual business logic
// (real password hashing, real email-verification-code flow, real
// server-side family genesis) rather than hand-crafted SQL rows. The one
// substitution is the email sender: TestSandboxEmailSender (NODE_ENV=test
// or development only) so this script can read back the verification code
// it "sent", exactly like backend/test/parentaccount/e2e.*.test.mjs does.
process.env.PLATFORM_ADMIN_MFA_ENC_KEY ??= 'ab'.repeat(32);

import { getPool, closePool } from '../dist/db/pool.js';
import { AuthService } from '../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../dist/auth/MySqlAuthRepository.js';
import { ParentAccountService } from '../dist/parentaccount/ParentAccountService.js';
import { MySqlParentAccountRepository } from '../dist/parentaccount/MySqlParentAccountRepository.js';
import { createTestSandboxEmailSender } from '../dist/parentaccount/TestSandboxEmailSender.js';
import { FamilyOwnerAttestationChainEngine } from '../dist/familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { MySqlFamilyAuthorityGenesisStore } from '../dist/familycommercial/authority/MySqlGenesisAnchorStore.js';
import { MySqlFamilyAuthorityAttestationChainStore } from '../dist/familycommercial/authority/MySqlAttestationChainStore.js';
// PCA-DEC-020: production wires RejectingDeviceSignatureVerifier here
// (unconditional fail-closed, pending human security review of the real
// CRYPTO_SUITE) -- registering an account in real production today
// therefore never actually completes family genesis. This script instead
// uses the SAME sanctioned test-only substitution
// backend/test/parentaccount/e2e.registrationToOwnerMutation.test.mjs
// already established: a genuinely real Ed25519 verifier (not a fake
// "always allow"), just not the one selected for production pending that
// review. See genesisDeviceSigner.ts's own header for the full rationale.
import { createEd25519DeviceSignatureVerifier } from '../dist/parentaccount/genesisDeviceSigner.js';
import { PlatformAdminAccountService } from '../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../dist/platformadmin/auth/MySqlAuthRepository.js';
import { hashAdminEmail } from '../dist/platformadmin/auth/emailHash.js';
import { base32Encode, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../dist/platformadmin/auth/totp.js';
import { InvitationService } from '../dist/invitation/InvitationService.js';
import { MySqlInvitationRepository } from '../dist/invitation/MySqlInvitationRepository.js';

const connectionString = process.env.PCA_DATABASE_URL;
if (!connectionString) throw new Error('PCA_DATABASE_URL is required.');
const url = new URL(connectionString);
if (!['127.0.0.1', 'localhost', 'mysql'].includes(url.hostname)) {
  throw new Error('Refusing to seed: PCA_DATABASE_URL must point to the disposable local/Compose database.');
}

const SEED_PASSWORD = 'Correct Horse Battery Staple 2026!';

const authService = new AuthService(new MySqlAuthRepository());
const emailSender = createTestSandboxEmailSender();
const familyAuthorityChainEngine = new FamilyOwnerAttestationChainEngine(
  new MySqlFamilyAuthorityGenesisStore(),
  new MySqlFamilyAuthorityAttestationChainStore(),
  createEd25519DeviceSignatureVerifier(),
  () => new Date(),
);
const parentAccountService = new ParentAccountService({
  repository: new MySqlParentAccountRepository(),
  authService,
  emailSender,
  familyGenesisEngine: familyAuthorityChainEngine,
});

async function registerAndVerifyFamily(email) {
  await parentAccountService.register(email, SEED_PASSWORD, SEED_PASSWORD);
  const code = emailSender.lastCodeFor(email);
  if (!code) throw new Error(`Seed failed: no verification code recorded for ${email}`);
  const outcome = await parentAccountService.verifyEmail(email, code);
  if (!outcome.familyId) throw new Error(`Seed failed: ${email} did not receive a genesis familyId`);
  return outcome;
}

const familyA = await registerAndVerifyFamily('owner-a@pca-seed.test');
console.log('Seeded Family A:', { accountId: familyA.accountId, familyId: familyA.familyId });

const familyB = await registerAndVerifyFamily('owner-b@pca-seed.test');
console.log('Seeded Family B:', { accountId: familyB.accountId, familyId: familyB.familyId });

// Family A: Arabic-language preference (the second seeded family, B, stays
// on the default English preference) -- gives real browser EN/AR coverage
// without needing to fabricate any preference row structure by hand.
await getPool().query(
  `INSERT INTO parent_account_preferences (account_id, language_code, updated_at) VALUES (?, 'ar', NOW(3))
   ON DUPLICATE KEY UPDATE language_code = 'ar', updated_at = NOW(3)`,
  [familyA.accountId],
);

// Device enrollment (PCA-ADD-ENR-014/142 family): the invitation layer is
// real, server-side-only state -- createInvitation is exactly what
// backend/src/http/routes/invitationRoutes.ts calls -- and gives the
// Devices page genuine "pending invitation" rows to render without
// fabricating a device's own Ed25519 key material or pairing state, which
// can only legitimately be generated ON a real device (the invitation
// token itself is the one-time secret a real Android/iOS client would
// redeem; seeding a fake redemption would mean seeding a fake device
// identity, which this script deliberately does not do).
const invitationService = new InvitationService(new MySqlInvitationRepository());

async function seedInvitation(familyId, childProfileId, ageUxTier, platform, requestedProtectionMode) {
  const { record } = await invitationService.createInvitation({
    familyId,
    platform,
    requestedProtectionMode,
    childProfileId,
    ageUxTier,
  });
  console.log('Seeded invitation:', { familyId, childProfileId, ageUxTier, platform, invitationId: record.invitationId, status: record.status });
  return record;
}

await seedInvitation(familyA.familyId, 'seed-child-teen', 'TEEN', 'ANDROID', 'ANDROID_STANDARD');
await seedInvitation(familyA.familyId, 'seed-child-young', 'YOUNG_CHILD', 'ANDROID', 'ANDROID_PROTECTED');
await seedInvitation(familyB.familyId, 'seed-child-b', 'YOUNG_CHILD', 'ANDROID', 'ANDROID_STANDARD');

const authRepository = new MySqlPlatformAdminAuthRepository();
const platformAdminAccountService = new PlatformAdminAccountService(authRepository);

async function seedPlatformAdmin(role) {
  const email = `${role.toLowerCase()}@pca-seed.test`;
  const account = await platformAdminAccountService.createAccount(
    `Seed ${role}`,
    hashAdminEmail(email),
    SEED_PASSWORD,
    role,
    'BOOTSTRAP',
  );
  // Activate MFA directly (matches scripts/bootstrap-platform-owner.mjs's
  // own documented precedent -- there is no self-service MFA-setup HTTP
  // endpoint in this repository slice yet) so this seeded account can
  // actually complete a real login for DB-parity/negative-test checks.
  const secret = generateTotpSecret();
  const key = loadMfaEncryptionKey();
  const { ciphertext, nonce } = encryptTotpSecret(secret, key);
  await getPool().query(
    `UPDATE platform_admin_mfa_state SET status = 'ACTIVE', totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NOW(3) WHERE admin_id = ?`,
    [ciphertext, nonce, account.adminId],
  );
  console.log(`Seeded platform admin (${role}):`, { adminId: account.adminId, email, totpSecretBase32: base32Encode(secret) });
  return { ...account, email, totpSecret: secret };
}

for (const role of ['APP_OWNER', 'FINANCE_ADMIN', 'SUPPORT_ADMIN']) {
  await seedPlatformAdmin(role);
}

const [[{ familyCount }]] = await getPool().query('SELECT COUNT(*) AS familyCount FROM families');
const [[{ accountCount }]] = await getPool().query('SELECT COUNT(*) AS accountCount FROM parent_accounts');
const [[{ adminCount }]] = await getPool().query('SELECT COUNT(*) AS adminCount FROM platform_admin_accounts');
const [[{ invitationCount }]] = await getPool().query('SELECT COUNT(*) AS invitationCount FROM enrollment_invitations');
console.log('Seed complete.', { familyCount, accountCount, adminCount, invitationCount });

await closePool();
