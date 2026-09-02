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
//
// Coordinator B QA-harness-isolation pass: every auth-sensitive Playwright
// test gets its OWN dedicated account (parent or platform-admin), never a
// shared one -- reusing one account across many logins/failed-attempts
// accumulates real rate-limit/anti-replay state across a run (this is a
// deliberately working security control, not something to work around by
// weakening it) and was the actual cause of an earlier session's non-
// deterministic E2E failures. This script writes every credential/code it
// creates to a JSON manifest (QA_SEED_MANIFEST_PATH) so the Playwright
// specs can look accounts up by purpose-key instead of hardcoding emails
// or piping dozens of individual env vars.
process.env.PLATFORM_ADMIN_MFA_ENC_KEY ??= 'ab'.repeat(32);

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
import { PriceBookRepository, PriceBookService } from '../dist/billing/priceBook.js';
import { QuoteRepository, QuoteService } from '../dist/billing/quote.js';
import { PaymentRepository, PaymentService } from '../dist/billing/payment.js';
import { RefundRepository, RefundService } from '../dist/billing/refund.js';
import { DisputeRepository, DisputeService } from '../dist/billing/dispute.js';
import { InvoiceRepository, InvoiceService } from '../dist/billing/invoice.js';
import { money } from '../dist/billing/money.js';
import { createSandboxPaymentProvider } from '../dist/billing/provider/sandboxProvider.js';
import { SandboxStaticSecretResolver } from '../dist/billing/provider/secretResolver.js';
import { MySqlSettlementRepository } from '../dist/billing/settlement/MySqlSettlementRepository.js';
import { SettlementService } from '../dist/billing/settlement/SettlementService.js';
import { PlatformAdminSettlementService } from '../dist/platformadmin/settlement/PlatformAdminSettlementService.js';
import { PlatformAdminAuditService } from '../dist/platformadmin/audit/PlatformAdminAuditService.js';
import { MySqlPlatformAdminAuditRepository } from '../dist/platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { PlatformAdminAuthService } from '../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { LoggingAlertAdapter } from '../dist/platformadmin/auth/alertPort.js';
import { computeTotp } from '../dist/platformadmin/auth/totp.js';

const connectionString = process.env.PCA_DATABASE_URL;
if (!connectionString) throw new Error('PCA_DATABASE_URL is required.');
const url = new URL(connectionString);
if (!['127.0.0.1', 'localhost', 'mysql'].includes(url.hostname)) {
  throw new Error('Refusing to seed: PCA_DATABASE_URL must point to the disposable local/Compose database.');
}

const SEED_PASSWORD = 'Correct Horse Battery Staple 2026!';
const SEED_EMAIL_DOMAIN = 'pca-seed.test';

const manifest = { seedPassword: SEED_PASSWORD, parentAccounts: {}, adminAccounts: {}, codes: {}, invoices: {} };

// Progress reporting for a human watching the seed run. It deliberately reports
// only the purpose-key of what was seeded, never the identifiers or credential
// material themselves (familyId / accountId / adminId / invitationId / invoiceId,
// TOTP secrets, one-time verification and password-reset codes).
//
// This is a dev-only script, but its stdout is not a controlled store: it lands in
// terminal scrollback and in the log of any harness that shells out to it. Nothing
// downstream loses anything by the omission -- every one of those values is still
// written to the QA seed manifest (QA_SEED_MANIFEST_PATH / qa-seed-manifest.json),
// which is what parent-web's and platform-admin-web's e2e-qa-coordinator-b/
// qaManifest.ts actually read. No consumer has ever parsed this stdout.
function reportSeeded(label, detail) {
  console.log(detail ? `Seeded ${label} (${detail}).` : `Seeded ${label}.`);
}

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

async function registerAndVerifyFamily(key) {
  const email = `${key}@${SEED_EMAIL_DOMAIN}`;
  await parentAccountService.register(email, SEED_PASSWORD, SEED_PASSWORD);
  const code = emailSender.lastCodeFor(email);
  if (!code) throw new Error(`Seed failed: no verification code recorded for ${email}`);
  const outcome = await parentAccountService.verifyEmail(email, code);
  if (!outcome.familyId) throw new Error(`Seed failed: ${email} did not receive a genesis familyId`);
  manifest.parentAccounts[key] = { email, accountId: outcome.accountId, familyId: outcome.familyId };
  return outcome;
}

const familyA = await registerAndVerifyFamily('owner-a');
reportSeeded('Family A', 'key=owner-a');

const familyB = await registerAndVerifyFamily('owner-b');
reportSeeded('Family B', 'key=owner-b');

// ---------------------------------------------------------------------
// Coordinator B: one dedicated, never-reused verified account per
// auth-sensitive Playwright test that performs a real login, so no test's
// login/failed-attempt history can accumulate against LOGIN_EMAIL_RATE_LIMIT
// (backend/src/parentaccount/policy.ts) and contaminate another test in the
// same run. Grouped by which spec file consumes them.
const AUTH_SPEC_KEYS = ['owner-login-ok', 'owner-deeplink', 'owner-forgot', 'owner-notpermitted'];
for (const key of AUTH_SPEC_KEYS) {
  const outcome = await registerAndVerifyFamily(key);
  reportSeeded('dedicated auth.spec.ts account', `key=${key}`);
}

// wrong-credentials test never succeeds a login for this account -- its
// anti-brute-force failure history must never leak onto any other test.
await registerAndVerifyFamily('owner-wrongpass');
reportSeeded('dedicated wrong-credentials test account', 'key=owner-wrongpass');

const CHILDREN_POLICY_ROUTE_KEYS = [
  'owner-cp-dashboard',
  'owner-cp-children',
  'owner-cp-requests',
  'owner-cp-members',
  'owner-cp-roles',
  'owner-cp-devices',
  'owner-cp-secstatus',
  'owner-cp-trustedbrowser',
  'owner-cp-notifications',
];
for (const key of CHILDREN_POLICY_ROUTE_KEYS) {
  const outcome = await registerAndVerifyFamily(key);
  reportSeeded('dedicated children-policy.spec.ts account', `key=${key}`);
}

const BILLING_SPEC_KEYS = ['owner-bill-sub', 'owner-bill-list', 'owner-bill-detail'];
for (const key of BILLING_SPEC_KEYS) {
  const outcome = await registerAndVerifyFamily(key);
  reportSeeded('dedicated billing.spec.ts account', `key=${key}`);
}

// QA writer-2 addition: a registered-but-NEVER-verified account, so
// /verify-email and the "resend verification" flow have a genuine pending
// row to exercise (every account above this point is already verified).
// Uses the same real register() call as every other seeded account; the
// only difference is this script deliberately never calls verifyEmail for
// it. The verification code itself is still readable at browser-QA time
// via the SAME TestSandboxEmailSender this script already uses (the
// backend process keeps it in memory), so Writer 3 can drive a real
// verify-email run against this account without this script guessing a
// code that would go stale.
const pendingEmail = `owner-pending@${SEED_EMAIL_DOMAIN}`;
await parentAccountService.register(pendingEmail, SEED_PASSWORD, SEED_PASSWORD);
const pendingVerificationCode = emailSender.lastCodeFor(pendingEmail);
manifest.parentAccounts['owner-pending'] = { email: pendingEmail };
manifest.codes.pendingVerificationCode = pendingVerificationCode;
reportSeeded('PENDING (unverified) parent account', 'key=owner-pending');

// QA writer-2 addition: a THIRD verified family, dedicated to the
// forgot-password/reset-password real-browser flow, with a genuine
// already-issued (not yet consumed) reset code -- created through the
// real requestPasswordReset() service call, not a fabricated row.
const familyC = await registerAndVerifyFamily('owner-resettable');
reportSeeded('Family C (password-reset target)', 'key=owner-resettable');
await parentAccountService.requestPasswordReset(`owner-resettable@${SEED_EMAIL_DOMAIN}`);
// lastCodeFor() defaults its `kind` param to 'VERIFICATION' -- this MUST be
// 'PASSWORD_RESET' here, or it silently returns this account's earlier
// registration verification code instead (same shape, wrong code: a real,
// reproducible bug found and fixed this session -- see
// docs/product-completion/PCA_QA_DEFECT_HANDOFF.md QA-B-005).
const pendingResetCode = emailSender.lastCodeFor(`owner-resettable@${SEED_EMAIL_DOMAIN}`, 'PASSWORD_RESET');
manifest.codes.pendingResetCode = pendingResetCode;
reportSeeded('pending password-reset code', 'key=owner-resettable');

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
  reportSeeded('invitation', `${ageUxTier}/${platform}, status=${record.status}`);
  return record;
}

await seedInvitation(familyA.familyId, 'seed-child-teen', 'TEEN', 'ANDROID', 'ANDROID_STANDARD');
await seedInvitation(familyA.familyId, 'seed-child-young', 'YOUNG_CHILD', 'ANDROID', 'ANDROID_PROTECTED');
await seedInvitation(familyB.familyId, 'seed-child-b', 'YOUNG_CHILD', 'ANDROID', 'ANDROID_STANDARD');

const authRepository = new MySqlPlatformAdminAuthRepository();
const platformAdminAccountService = new PlatformAdminAccountService(authRepository);

async function seedPlatformAdmin(role, key) {
  const email = `${key}@${SEED_EMAIL_DOMAIN}`;
  const account = await platformAdminAccountService.createAccount(
    `Seed ${key}`,
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
  const mfaKey = loadMfaEncryptionKey();
  const { ciphertext, nonce } = encryptTotpSecret(secret, mfaKey);
  await getPool().query(
    `UPDATE platform_admin_mfa_state SET status = 'ACTIVE', totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NOW(3) WHERE admin_id = ?`,
    [ciphertext, nonce, account.adminId],
  );
  const totpSecretBase32 = base32Encode(secret);
  manifest.adminAccounts[key] = { email, role, adminId: account.adminId, totpSecretBase32 };
  reportSeeded('platform admin', `${role}, key=${key}`);
  return { ...account, email, totpSecret: secret };
}

// ---------------------------------------------------------------------
// Coordinator B: canonical one-per-role admins (used where only ONE login
// for that role is needed), PLUS a dedicated account per Playwright test
// that performs its own real login -- avoids TOTP-counter replay
// collisions (backend/src/platformadmin/auth/PlatformAdminAuthService.ts's
// TOTP-REPLAY-1: the same 30s window's counter cannot be claimed twice,
// even across unrelated logins for the same admin) when many tests for the
// same role run in close sequence. This is a real, correctly-working
// anti-replay control -- the fix is more distinct admins, never weakening
// the control.
const ADMIN_SPECS = [
  { role: 'APP_OWNER', key: 'app_owner' },
  { role: 'PLATFORM_ADMIN', key: 'platform_admin' },
  { role: 'FINANCE_ADMIN', key: 'finance_admin' },
  { role: 'SUPPORT_ADMIN', key: 'support_admin' },
  { role: 'AUDITOR_READ_ONLY', key: 'auditor_read_only' },
  // personas.spec.ts: settings-RBAC test, one dedicated account per role
  { role: 'APP_OWNER', key: 'app_owner_settings' },
  { role: 'PLATFORM_ADMIN', key: 'platform_admin_settings' },
  { role: 'FINANCE_ADMIN', key: 'finance_admin_settings' },
  { role: 'SUPPORT_ADMIN', key: 'support_admin_settings' },
  { role: 'AUDITOR_READ_ONLY', key: 'auditor_read_only_settings' },
  // admin-audit.spec.ts: one dedicated APP_OWNER per test
  { role: 'APP_OWNER', key: 'app_owner_accounts_route' },
  { role: 'APP_OWNER', key: 'app_owner_adminusers_route' },
  { role: 'APP_OWNER', key: 'app_owner_audit_route' },
  { role: 'APP_OWNER', key: 'app_owner_entitlements_route' },
  // billing-settlement.spec.ts: one dedicated FINANCE_ADMIN per test
  { role: 'FINANCE_ADMIN', key: 'finance_admin_plans_route' },
  { role: 'FINANCE_ADMIN', key: 'finance_admin_pricing_route' },
  { role: 'FINANCE_ADMIN', key: 'finance_admin_quotes_route' },
  { role: 'FINANCE_ADMIN', key: 'finance_admin_invoices_route' },
  { role: 'FINANCE_ADMIN', key: 'finance_admin_payments_route' },
  { role: 'FINANCE_ADMIN', key: 'finance_admin_settlacct_route' },
  { role: 'FINANCE_ADMIN', key: 'finance_admin_settlbatch_route' },
  { role: 'FINANCE_ADMIN', key: 'finance_admin_settlrecon_route' },
  { role: 'FINANCE_ADMIN', key: 'finance_admin_paymentsbadges_test' },
  { role: 'FINANCE_ADMIN', key: 'finance_admin_reconbatch_test' },
  // dedicated explicit TOTP-replay-rejection security test (Section 3's
  // "explicitly test replay rejection separately" requirement)
  { role: 'APP_OWNER', key: 'app_owner_replay_test' },
];

const seededAdmins = {};
for (const spec of ADMIN_SPECS) {
  seededAdmins[spec.key] = await seedPlatformAdmin(spec.role, spec.key);
}

// ---------------------------------------------------------------------
// Billing/settlement fixtures (PCA product-completion programme, Writer
// P0-review browser-gap closure pass): a FAILED payment attempt, a
// refunded transaction, an OPEN dispute, and an UNDER_INVESTIGATION
// settlement reconciliation batch -- so platform-admin-web's
// /billing/payments and /settlement/reconciliation pages have real,
// non-healthy rows to render (previously every seeded payment was a
// plain CONFIRMED/MATCHED happy path, so their status-badge/money-
// formatting fixes had never been exercised against the states they
// actually exist to distinguish).
//
// Built entirely through the SAME real service/repository classes
// backend/src/main.ts wires in production -- same discipline as every
// other fixture in this script. The one test-only substitution is
// TestSandboxPaymentProvider (TEST_SANDBOX), which production's
// createDefaultProviderRegistry() deliberately leaves unregistered
// (see main.ts's own comment: no real payment provider is selected in
// production yet -- an explicit, honest external gate, not a silent
// stub) -- exactly the same class of sanctioned test-only substitution
// this script already uses for TestSandboxEmailSender above. A real
// step-up grant is required for every settlement mutation and refund,
// matching this repo's real MySQL test suite: settlement mutations
// consume a genuinely-issued (login + TOTP + assertStepUp) grant
// end-to-end, exactly like backend/test/db/settlement.mysql.test.mjs's
// own `stepUpFor` helper; issueRefund takes an ALREADY-consumed step-up
// id as an input (per refund.ts's own header: the real HTTP route calls
// consumeStepUp itself before calling issueRefund) -- creating that
// consumed row directly is the same established convention already used
// in backend/test/db/billingCore.mysql.test.mjs and
// refundBalanceRaceConcurrency.mysql.test.mjs's own `createConsumedStepUp`
// helpers, not a new invention.
//
// This section uses the CANONICAL finance_admin identity for its
// service-level actor objects (financeActor/financeRoles) -- these are
// direct in-process service calls carrying an explicit actor, not real
// HTTP logins, so they never contend with any Playwright test's own TOTP
// window or session budget for the canonical account.
const financeAdmin = seededAdmins.finance_admin;

const platformAdminAuditService = new PlatformAdminAuditService(new MySqlPlatformAdminAuditRepository());
const priceBookRepository = new PriceBookRepository();
const priceBookService = new PriceBookService(priceBookRepository, platformAdminAuditService);
const quoteService = new QuoteService(priceBookRepository, new QuoteRepository(), platformAdminAuditService);
const paymentRepository = new PaymentRepository();
const paymentService = new PaymentService(paymentRepository, quoteService, platformAdminAuditService);
const refundService = new RefundService(new RefundRepository(), paymentRepository, platformAdminAuditService);
const disputeService = new DisputeService(new DisputeRepository());
const settlementService = new SettlementService(new MySqlSettlementRepository(), paymentRepository);
const platformAdminAuthService = new PlatformAdminAuthService(authRepository, new LoggingAlertAdapter());
const platformAdminSettlementService = new PlatformAdminSettlementService(platformAdminAuthService, settlementService);
const sandboxProvider = createSandboxPaymentProvider(new SandboxStaticSecretResolver('seed-local-sandbox-secret'), { NODE_ENV: 'development' });

const financeActor = { adminId: financeAdmin.adminId, role: 'FINANCE_ADMIN' };
const financeRoles = ['FINANCE_ADMIN'];

/** Same convention as backend/test/db/billingCore.mysql.test.mjs's own createConsumedStepUp helper -- see this section's header comment. */
async function createConsumedStepUp(adminId, scope) {
  const sessionId = randomUUID();
  const stepUpId = randomUUID();
  const now = new Date();
  await getPool().query(
    `INSERT INTO platform_admin_sessions (session_id, admin_id, token_hash, realm, issued_at, expires_at, revoked_at) VALUES (?, ?, ?, 'PLATFORM_ADMIN', ?, ?, NULL)`,
    [sessionId, adminId, randomUUID().replace(/-/g, '').padEnd(64, '0'), now, new Date(now.getTime() + 3600_000)],
  );
  await getPool().query(
    `INSERT INTO platform_admin_step_up_sessions (step_up_id, admin_id, session_id, scope, asserted_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [stepUpId, adminId, sessionId, scope, now, new Date(now.getTime() + 300_000), now],
  );
  return stepUpId;
}

/**
 * Blocks until at least `marginMs` remain before the NEXT TOTP step
 * boundary (or just crossed into a fresh one), so a code computed right
 * after this returns is never validated a moment after its window has
 * already rolled over -- the same "wait for a genuinely fresh window"
 * discipline this repo's real-E2E suites already use for exactly this
 * flake class.
 */
async function ensureComfortablyInsideTotpWindow(marginMs = 5_000) {
  const msIntoStep = Date.now() % 30_000;
  const msRemaining = 30_000 - msIntoStep;
  if (msRemaining < marginMs) {
    await new Promise((resolve) => setTimeout(resolve, msRemaining + 1_000));
  }
}

/**
 * ONE real login -> ONE session, reused for as many step-ups as needed --
 * mirrors backend/test/db/settlement.mysql.test.mjs's own createAdmin()
 * (logs in once) + stepUpFor() (reuses that session, called repeatedly)
 * split exactly. Logging in a SECOND time for the same admin to obtain a
 * second step-up is NOT the established pattern anywhere in this
 * codebase's real MySQL test suite and empirically fails here (a repeat
 * login for an admin with an already-active session is rejected) --
 * this was the actual bug in an earlier version of this script, which
 * called login() once per step-up instead of once per admin session.
 */
async function loginAdmin(admin) {
  await ensureComfortablyInsideTotpWindow();
  const code = computeTotp(admin.totpSecret, Date.now());
  const { rawToken } = await platformAdminAuthService.login(admin.email, SEED_PASSWORD, code);
  const identity = await platformAdminAuthService.validateSession(rawToken);
  return identity.sessionId;
}

/** A REAL, genuinely-issued, not-yet-consumed step-up grant against an already-logged-in session -- required for settlement mutations, which consume it themselves (PlatformAdminSettlementService.stepUp -> authService.consumeStepUp). */
async function realStepUpFor(admin, sessionId, scope) {
  // A fresh TOTP window is required for each assertStepUp call (the login -- or a previous step-up -- already claimed the prior window's counter; counters are shared across login/step-up per admin).
  await new Promise((resolve) => setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 1_000));
  await ensureComfortablyInsideTotpWindow();
  const stepUpCode = computeTotp(admin.totpSecret, Date.now());
  const result = await platformAdminAuthService.assertStepUp(admin.adminId, sessionId, scope, stepUpCode, 'FINANCE_ADMIN');
  return result.stepUpId;
}

async function publishPriceAndCreateAttempt({ market, currencyCode, amountMinor, accountRef }) {
  const targetDeviceLimit = 800_000 + Math.floor(Math.random() * 100_000);
  await priceBookService.publishPrice({ commercialMarket: market, currencyCode, targetDeviceLimit, amountMinor }, financeActor, financeRoles);
  const resolution = await quoteService.resolveStandardQuote(market, currencyCode, targetDeviceLimit, new Date());
  if (resolution.kind !== 'RESOLVED') throw new Error(`Seed failed: quote resolution was ${resolution.kind}, expected RESOLVED`);
  return paymentService.createAttemptFromSnapshot({ accountRef, invoiceId: null, increaseRequestRef: null, paymentMethodId: null }, resolution.snapshot);
}

// 1) A FAILED payment attempt -- platform-admin-web's /billing/payments
// "attempts" tab must show this with a real badge-danger status, not
// identical plain text to a healthy CONFIRMED row.
const failedAttempt = await publishPriceAndCreateAttempt({
  market: 'GLOBAL_OTHER', currencyCode: 'USD', amountMinor: 2999n, accountRef: `account-seed-failed-${randomUUID()}`,
});
await paymentService.markFailed(failedAttempt.paymentAttemptId);
console.log('Seeded FAILED payment attempt:', { paymentAttemptId: failedAttempt.paymentAttemptId });

// 2) A refunded transaction -- confirm a real payment, then issue a real
// partial refund against it, so the "refunds" tab has a genuine RECORDED
// row (not empty).
const refundAttempt = await publishPriceAndCreateAttempt({
  market: 'GLOBAL_OTHER', currencyCode: 'USD', amountMinor: 5000n, accountRef: `account-seed-refund-${randomUUID()}`,
});
const refundCheckout = await sandboxProvider.createCheckout({ amountMinor: 5000n, currencyCode: 'USD', accountRef: `account-seed-refund-${refundAttempt.paymentAttemptId}`, paymentAttemptId: refundAttempt.paymentAttemptId });
sandboxProvider.simulateConfirm(refundCheckout.providerCheckoutRef);
const refundTransaction = await paymentService.confirmPaymentAttempt(refundAttempt.paymentAttemptId, 'TEST_SANDBOX', refundCheckout.providerCheckoutRef, financeActor);
const refundStepUpId = await createConsumedStepUp(financeAdmin.adminId, 'REFUND');
const refund = await refundService.issueRefund(
  { paymentTransactionId: refundTransaction.paymentTransactionId, amountMinor: 2000n, currencyCode: 'USD', reasonCode: 'REQUESTED_BY_CUSTOMER', reasonNote: 'Seed fixture: partial refund', stepUpSessionId: refundStepUpId, entitlementTreatment: 'NOT_APPLICABLE' },
  financeActor,
  financeRoles,
);
console.log('Seeded refunded payment:', { paymentTransactionId: refundTransaction.paymentTransactionId, refundId: refund.refundId });

// 3) An OPEN dispute -- confirm a separate real payment, then open a
// dispute against it, so the "disputes" tab has a genuine badge-danger
// row.
const disputeAttempt = await publishPriceAndCreateAttempt({
  market: 'GLOBAL_OTHER', currencyCode: 'USD', amountMinor: 4500n, accountRef: `account-seed-dispute-${randomUUID()}`,
});
const disputeCheckout = await sandboxProvider.createCheckout({ amountMinor: 4500n, currencyCode: 'USD', accountRef: `account-seed-dispute-${disputeAttempt.paymentAttemptId}`, paymentAttemptId: disputeAttempt.paymentAttemptId });
sandboxProvider.simulateConfirm(disputeCheckout.providerCheckoutRef);
const disputeTransaction = await paymentService.confirmPaymentAttempt(disputeAttempt.paymentAttemptId, 'TEST_SANDBOX', disputeCheckout.providerCheckoutRef, financeActor);
const dispute = await disputeService.openDispute(disputeTransaction.paymentTransactionId, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), financeRoles, new Date());
console.log('Seeded OPEN dispute:', { disputeId: dispute.disputeId, paymentTransactionId: disputeTransaction.paymentTransactionId });

// 4) An UNDER_INVESTIGATION settlement reconciliation batch -- opening a
// batch whose `received` does not equal `expectedGross - fees` is itself
// what produces this status (SettlementService.openBatch's own state-
// machine rule), giving /settlement/reconciliation a real, non-zero
// differenceMinor to render as formatted money.
const settlementSessionId = await loginAdmin(financeAdmin);
const settlementStepUp1 = await realStepUpFor(financeAdmin, settlementSessionId, 'SETTLEMENT_BANK_CONFIG');
const settlementAccount = await platformAdminSettlementService.createAccount(
  { adminId: financeAdmin.adminId, roles: financeRoles, sessionId: settlementSessionId },
  { providerRef: `secretref:${randomUUID()}`, displayLabel: '****4242', settlementCurrency: 'USD', stepUpId: settlementStepUp1 },
);
const settlementStepUp2 = await realStepUpFor(financeAdmin, settlementSessionId, 'SETTLEMENT_BANK_CONFIG');
const settlementBatch = await platformAdminSettlementService.openBatch(
  { adminId: financeAdmin.adminId, roles: financeRoles, sessionId: settlementSessionId },
  {
    settlementAccountRef: settlementAccount.settlementAccountId,
    settlementCurrency: 'USD',
    periodStart: new Date('2026-01-01T00:00:00Z'),
    periodEnd: new Date('2026-01-08T00:00:00Z'),
    expectedGross: money(100000n, 'USD'),
    fees: money(0n, 'USD'),
    received: money(97500n, 'USD'),
    providerRef: `report:${randomUUID()}`,
    stepUpId: settlementStepUp2,
  },
);
if (settlementBatch.status !== 'UNDER_INVESTIGATION') {
  throw new Error(`Seed failed: expected settlement batch status UNDER_INVESTIGATION, got ${settlementBatch.status}`);
}
console.log('Seeded UNDER_INVESTIGATION settlement batch:', { settlementBatchId: settlementBatch.settlementBatchId, differenceMinor: settlementBatch.differenceMinor?.toString?.() ?? settlementBatch.differenceMinor });

// 5) A plain CONFIRMED payment in the GULF market/SAR currency -- every
// other seeded payment above is USD/GLOBAL_OTHER; this gives platform-
// admin-web's money/currency formatting a genuine non-USD row to render
// (SUPPORTED_CURRENCIES is USD/SAR/YER only -- see billing/currency.ts's
// own header for why EUR is deliberately not one of them) and gives this
// batch of fixtures one healthy/happy-path payment alongside the FAILED/
// refunded/disputed ones above, so a reviewer can tell a "nothing wrong"
// badge apart from the exceptional ones.
const gulfAttempt = await publishPriceAndCreateAttempt({
  market: 'GULF', currencyCode: 'SAR', amountMinor: 15000n, accountRef: `account-seed-gulf-${randomUUID()}`,
});
const gulfCheckout = await sandboxProvider.createCheckout({ amountMinor: 15000n, currencyCode: 'SAR', accountRef: `account-seed-gulf-${gulfAttempt.paymentAttemptId}`, paymentAttemptId: gulfAttempt.paymentAttemptId });
sandboxProvider.simulateConfirm(gulfCheckout.providerCheckoutRef);
const gulfTransaction = await paymentService.confirmPaymentAttempt(gulfAttempt.paymentAttemptId, 'TEST_SANDBOX', gulfCheckout.providerCheckoutRef, financeActor);
console.log('Seeded CONFIRMED SAR/GULF payment:', { paymentTransactionId: gulfTransaction.paymentTransactionId });

// 6) A PAID and an OPEN invoice for each dedicated billing.spec.ts account
// (owner-bill-sub/owner-bill-list/owner-bill-detail) AND for Family A
// (kept for backward-compat with anything that still expects it) --
// parent-web's /invoices list (FamilyInvoiceReadRepository.listForFamily,
// accountRef === familyId) and platform-admin-web's billing invoice views
// both need real rows in more than one status. Built through the real
// InvoiceService (same discipline as every other fixture here);
// InvoiceService exposes only createInvoice (always starts DRAFT) and
// markPaid, with no DRAFT->OPEN transition method yet, so the OPEN row
// uses one direct SQL UPDATE -- the EXACT statement
// InvoiceRepository.updateStatus itself runs -- mirroring this script's
// own established precedent above (MFA activation, step-up session rows)
// for state with no service-level mutation surface.
const invoiceService = new InvoiceService(new InvoiceRepository());

async function seedPaidAndOpenInvoice(familyId, key) {
  const paidInvoice = await invoiceService.createInvoice({
    accountRef: familyId,
    subscriptionId: null,
    currencyCode: 'USD',
    dueAt: new Date('2026-02-01T00:00:00Z'),
    periodStart: new Date('2026-01-01T00:00:00Z'),
    periodEnd: new Date('2026-01-31T00:00:00Z'),
    lines: [{ description: 'Monthly plan charge', lineType: 'PLAN_CHARGE', amountMinor: 2999n, currencyCode: 'USD', quantity: 1, planId: null, priceBookId: null }],
  }, financeRoles);
  await invoiceService.markPaid(paidInvoice.invoiceId, financeRoles);

  const openInvoice = await invoiceService.createInvoice({
    accountRef: familyId,
    subscriptionId: null,
    currencyCode: 'USD',
    dueAt: new Date('2026-09-15T00:00:00Z'),
    periodStart: new Date('2026-08-01T00:00:00Z'),
    periodEnd: new Date('2026-08-31T00:00:00Z'),
    lines: [{ description: 'Monthly plan charge', lineType: 'PLAN_CHARGE', amountMinor: 2999n, currencyCode: 'USD', quantity: 1, planId: null, priceBookId: null }],
  }, financeRoles);
  await getPool().query(`UPDATE billing_invoices SET status = 'OPEN' WHERE invoice_id = ?`, [openInvoice.invoiceId]);

  manifest.invoices[key] = { paidInvoiceId: paidInvoice.invoiceId, openInvoiceId: openInvoice.invoiceId, familyId };
  reportSeeded('PAID + OPEN invoice', `key=${key}`);
}

await seedPaidAndOpenInvoice(familyA.familyId, 'owner-a');
for (const key of BILLING_SPEC_KEYS) {
  await seedPaidAndOpenInvoice(manifest.parentAccounts[key].familyId, key);
}

const [[{ familyCount }]] = await getPool().query('SELECT COUNT(*) AS familyCount FROM families');
const [[{ accountCount }]] = await getPool().query('SELECT COUNT(*) AS accountCount FROM parent_accounts');
const [[{ adminCount }]] = await getPool().query('SELECT COUNT(*) AS adminCount FROM platform_admin_accounts');
const [[{ invitationCount }]] = await getPool().query('SELECT COUNT(*) AS invitationCount FROM enrollment_invitations');
const [[{ paymentAttemptCount }]] = await getPool().query('SELECT COUNT(*) AS paymentAttemptCount FROM billing_payment_attempts');
const [[{ refundCount }]] = await getPool().query('SELECT COUNT(*) AS refundCount FROM billing_refunds');
const [[{ disputeCount }]] = await getPool().query('SELECT COUNT(*) AS disputeCount FROM billing_disputes');
const [[{ settlementBatchCount }]] = await getPool().query('SELECT COUNT(*) AS settlementBatchCount FROM settlement_batches');
const [[{ invoiceCount }]] = await getPool().query('SELECT COUNT(*) AS invoiceCount FROM billing_invoices');
console.log('Seed complete.', { familyCount, accountCount, adminCount, invitationCount, paymentAttemptCount, refundCount, disputeCount, settlementBatchCount, invoiceCount });

const manifestPath = process.env.QA_SEED_MANIFEST_PATH ?? fileURLToPath(new URL('../qa-seed-manifest.json', import.meta.url));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log('Wrote QA seed manifest:', manifestPath);

await closePool();
