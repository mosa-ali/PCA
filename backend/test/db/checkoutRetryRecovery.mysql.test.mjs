// PCA-BILL-2A-R1 correction, FIX 1: checkout split-state / idempotent
// retry. Proves the required invariant against a REAL MySQL database: a
// checkout session is only ever returned to the client once local state
// (PaymentAttempt + provider checkout ref + request PAYMENT_PENDING
// transition) is durably consistent, and a retried checkout-create call
// for the SAME requestId never creates a second PaymentAttempt or a
// second distinct provider-side checkout object.
if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'cd'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { MySqlEntitlementRepository } from '../../dist/entitlements/MySqlEntitlementRepository.js';
import { EntitlementService } from '../../dist/entitlements/EntitlementService.js';
import { MySqlChangeRequestRepository } from '../../dist/entitlements/requests/MySqlChangeRequestRepository.js';
import { ChangeRequestService } from '../../dist/entitlements/requests/ChangeRequestService.js';
import { NoPriceBookQuotePort } from '../../dist/entitlements/quote/QuotePort.js';
import { PlatformAdminEntitlementService } from '../../dist/platformadmin/entitlements/PlatformAdminEntitlementService.js';
import { MySqlSlotReservationRepository } from '../../dist/entitlements/slots/MySqlSlotReservationRepository.js';
import { SlotReservationService } from '../../dist/entitlements/slots/SlotReservationService.js';
import { PlatformAdminAuthService } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { computeTotp, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { LoggingAlertAdapter } from '../../dist/platformadmin/auth/alertPort.js';
import { PriceBookRepository } from '../../dist/billing/priceBook.js';
import { QuoteRepository, QuoteService } from '../../dist/billing/quote.js';
import { PaymentRepository, PaymentService } from '../../dist/billing/payment.js';
import { PlatformAdminAuditService } from '../../dist/platformadmin/audit/PlatformAdminAuditService.js';
import { MySqlPlatformAdminAuditRepository } from '../../dist/platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { PaymentProviderRegistry } from '../../dist/billing/provider/providerRegistry.js';
import { createSandboxPaymentProvider } from '../../dist/billing/provider/sandboxProvider.js';
import { SandboxStaticSecretResolver } from '../../dist/billing/provider/secretResolver.js';
import { CheckoutService, CheckoutError } from '../../dist/billing/checkout/CheckoutService.js';
import { CommercialNotificationRepository } from '../../dist/commercialnotifications/CommercialNotificationRepository.js';
import { MySqlCommercialNotificationPublisher } from '../../dist/commercialnotifications/CommercialNotificationPublisher.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const authRepository = new MySqlPlatformAdminAuthRepository();
const entitlementRepository = new MySqlEntitlementRepository();
const changeRequestRepository = new MySqlChangeRequestRepository();
const entitlementService = new EntitlementService(entitlementRepository, changeRequestRepository);
const quotePort = new NoPriceBookQuotePort();
const commercialNotificationPublisher = new MySqlCommercialNotificationPublisher(new CommercialNotificationRepository());
const changeRequestService = new ChangeRequestService(changeRequestRepository, entitlementRepository, entitlementService, quotePort, commercialNotificationPublisher);
const slotReservationRepository = new MySqlSlotReservationRepository(entitlementRepository);
const slotReservationService = new SlotReservationService(slotReservationRepository);
const authService = new PlatformAdminAuthService(authRepository, new LoggingAlertAdapter());
const accountService = new PlatformAdminAccountService(authRepository);
const adminEntitlementService = new PlatformAdminEntitlementService(
  authService,
  entitlementRepository,
  changeRequestRepository,
  entitlementService,
  changeRequestService,
  slotReservationService,
);

const platformAdminAuditService = new PlatformAdminAuditService(new MySqlPlatformAdminAuditRepository());
const priceBookRepository = new PriceBookRepository();
const quoteRepository = new QuoteRepository();
const quoteService = new QuoteService(priceBookRepository, quoteRepository, platformAdminAuditService);
const paymentRepository = new PaymentRepository();
const paymentService = new PaymentService(paymentRepository, quoteService, platformAdminAuditService);

const sandboxProvider = createSandboxPaymentProvider(new SandboxStaticSecretResolver('checkout-retry-test-secret'), { NODE_ENV: 'test' });
const providerRegistry = new PaymentProviderRegistry();
providerRegistry.register(sandboxProvider);

function uniqueFamilyId(label) {
  return `family-${label}-${randomUUID()}`;
}

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createFinanceAdmin() {
  const email = uniqueEmail('admin');
  const password = 'correct horse battery staple';
  const account = await accountService.createAccount('DB Test Admin', hashAdminEmail(email), password, 'FINANCE_ADMIN', 'BOOTSTRAP');
  const secret = generateTotpSecret();
  const key = loadMfaEncryptionKey();
  const { ciphertext, nonce } = encryptTotpSecret(secret, key);
  await getPool().query(
    `UPDATE platform_admin_mfa_state SET status = 'ACTIVE', totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NOW(3) WHERE admin_id = ?`,
    [ciphertext, nonce, account.adminId],
  );
  const code = computeTotp(secret, Date.now());
  const { rawToken } = await authService.login(email, password, code);
  const identity = await authService.validateSession(rawToken);
  return { adminId: account.adminId, roles: ['FINANCE_ADMIN'], sessionId: identity.sessionId };
}

/** Builds a QUOTED (not yet PAYMENT_PENDING) MANAGED_DEVICE_LIMIT change-request -- the exact starting state CheckoutService.createCheckoutSession requires. */
async function createQuotedRequest(familyId, amountMinor = 5000n) {
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const request = await changeRequestService.createRequest(familyId, 'MANAGED_DEVICE_LIMIT', 4, 'GLOBAL', 'USD');
  const financeAdmin = await createFinanceAdmin();
  const quoted = await adminEntitlementService.issueCustomQuote(financeAdmin, request.requestId, amountMinor, 'USD');
  assert.equal(quoted.state, 'QUOTED');
  return quoted;
}

async function countAttemptsForRequest(requestId) {
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_payment_attempts WHERE increase_request_ref = ?`, [requestId]);
  return Number(rows[0].n);
}

// A ChangeRequestService double whose moveToPaymentPending always throws --
// simulates step 5 failing AFTER the PaymentAttempt + provider checkout ref
// (steps 1-4) already durably succeeded, without touching the accepted
// ChangeRequestService.ts file itself.
class AlwaysFailingMoveToPaymentPending {
  async moveToPaymentPending() {
    throw new Error('SIMULATED: moveToPaymentPending failure (checkout-retry test)');
  }
}

test('MySQL: checkout-retry recovery -- provider checkout succeeds, moveToPaymentPending forced to fail, then a retry reaches PAYMENT_PENDING with exactly ONE PaymentAttempt and ONE provider checkout ref', async () => {
  const familyId = uniqueFamilyId('checkout-retry');
  const request = await createQuotedRequest(familyId);

  const failingCheckoutService = new CheckoutService(
    changeRequestRepository,
    new AlwaysFailingMoveToPaymentPending(),
    paymentService,
    paymentRepository,
    providerRegistry,
  );

  await assert.rejects(
    () => failingCheckoutService.createCheckoutSession({ familyId, requestId: request.requestId }),
    (error) => error instanceof CheckoutError && error.code === 'LIFECYCLE_TRANSITION_FAILED',
  );

  // After the forced failure: exactly one PaymentAttempt exists, PENDING,
  // carrying a real provider checkout ref -- durable, not lost -- and the
  // request itself is still QUOTED (step 5 never completed).
  assert.equal(await countAttemptsForRequest(request.requestId), 1, 'exactly one PaymentAttempt must exist after the forced failure');
  const afterFailure = await changeRequestRepository.getById(request.requestId);
  assert.equal(afterFailure.state, 'QUOTED', 'the request must still be QUOTED -- step 5 never completed');

  const [attemptRowsAfterFailure] = await getPool().query(
    `SELECT status, provider, provider_reference FROM billing_payment_attempts WHERE increase_request_ref = ?`,
    [request.requestId],
  );
  assert.equal(attemptRowsAfterFailure[0].status, 'PENDING');
  assert.equal(attemptRowsAfterFailure[0].provider, 'TEST_SANDBOX');
  const providerCheckoutRef = attemptRowsAfterFailure[0].provider_reference;
  assert.ok(providerCheckoutRef, 'a real provider checkout ref must already be durably persisted');
  assert.equal(sandboxProvider.getCheckoutCountForTest(), 1, 'exactly one distinct provider-side checkout object must have been minted so far');

  // Retry with the REAL ChangeRequestService: must detect the existing
  // attempt+ref, skip re-creating anything, and reach PAYMENT_PENDING.
  const realCheckoutService = new CheckoutService(changeRequestRepository, changeRequestService, paymentService, paymentRepository, providerRegistry);
  const result = await realCheckoutService.createCheckoutSession({ familyId, requestId: request.requestId });
  assert.equal(result.status, 'PENDING');
  assert.equal(result.provider, 'TEST_SANDBOX');

  assert.equal(await countAttemptsForRequest(request.requestId), 1, 'the retry must NEVER create a second PaymentAttempt');
  assert.equal(sandboxProvider.getCheckoutCountForTest(), 1, 'the retry must NEVER mint a second distinct provider-side checkout object (idempotency key honored)');

  const [attemptRowsAfterRetry] = await getPool().query(
    `SELECT provider_reference FROM billing_payment_attempts WHERE increase_request_ref = ?`,
    [request.requestId],
  );
  assert.equal(attemptRowsAfterRetry[0].provider_reference, providerCheckoutRef, 'the SAME provider checkout ref must be reused, never replaced');

  const afterRetry = await changeRequestRepository.getById(request.requestId);
  assert.equal(afterRetry.state, 'PAYMENT_PENDING', 'the retry must reach PAYMENT_PENDING');
});

test('MySQL: a second, independent createCheckoutSession call for the SAME requestId after full success is a safe idempotent no-op (reuses the same attempt/status)', async () => {
  const familyId = uniqueFamilyId('checkout-full');
  const request = await createQuotedRequest(familyId);
  const checkoutService = new CheckoutService(changeRequestRepository, changeRequestService, paymentService, paymentRepository, providerRegistry);

  const checkoutCountBefore = sandboxProvider.getCheckoutCountForTest();
  const first = await checkoutService.createCheckoutSession({ familyId, requestId: request.requestId });
  assert.equal(first.status, 'PENDING');
  assert.equal(await countAttemptsForRequest(request.requestId), 1);
  assert.equal(sandboxProvider.getCheckoutCountForTest(), checkoutCountBefore + 1);

  // A second call after the request already reached PAYMENT_PENDING: no
  // attempt lookup would find a QUOTED-only state to (re)create from, and
  // the record itself is already PAYMENT_PENDING -- must not throw, must
  // not create a second attempt, must return the SAME attempt/ref.
  const second = await checkoutService.createCheckoutSession({ familyId, requestId: request.requestId });
  assert.equal(second.paymentAttemptId, first.paymentAttemptId);
  assert.equal(second.redirectUrl, first.redirectUrl);
  assert.equal(await countAttemptsForRequest(request.requestId), 1, 'still exactly one PaymentAttempt');
  assert.equal(sandboxProvider.getCheckoutCountForTest(), checkoutCountBefore + 1, 'no new provider-side checkout object was minted on the idempotent second call');
});

test.after(async () => {
  await closePool();
});
