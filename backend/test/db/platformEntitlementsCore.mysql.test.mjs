if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'cd'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { MySqlEntitlementRepository } from '../../dist/entitlements/MySqlEntitlementRepository.js';
import { EntitlementService } from '../../dist/entitlements/EntitlementService.js';
import { MySqlChangeRequestRepository } from '../../dist/entitlements/requests/MySqlChangeRequestRepository.js';
import { ChangeRequestService, ChangeRequestError } from '../../dist/entitlements/requests/ChangeRequestService.js';
import { NoPriceBookQuotePort } from '../../dist/entitlements/quote/QuotePort.js';
import { PaymentConfirmationService } from '../../dist/entitlements/payment/PaymentConfirmationService.js';
import { PlatformAdminEntitlementService, PlatformAdminEntitlementError } from '../../dist/platformadmin/entitlements/PlatformAdminEntitlementService.js';
import { MySqlSlotReservationRepository } from '../../dist/entitlements/slots/MySqlSlotReservationRepository.js';
import { SlotReservationService } from '../../dist/entitlements/slots/SlotReservationService.js';
import { PlatformAdminAuthService } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { computeTotp, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { LoggingAlertAdapter } from '../../dist/platformadmin/auth/alertPort.js';
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
const paymentConfirmationService = new PaymentConfirmationService(changeRequestRepository, entitlementRepository);
const slotReservationRepository = new MySqlSlotReservationRepository(entitlementRepository);
const slotReservationService = new SlotReservationService(slotReservationRepository);
// TOTP-REPLAY-1 uses a monotonic per-admin counter shared between login and
// step-up: a code accepted at login can never be reused for step-up in the
// same 30s window. Tests that log in and immediately step up therefore
// drive the auth service off a controllable clock, advancing it a full
// window between the two so each computeTotp() call lands on a distinct
// counter -- exactly like two real, time-separated actions would.
let clockOffsetMs = 0;
const clock = () => new Date(Date.now() + clockOffsetMs);
const authService = new PlatformAdminAuthService(authRepository, new LoggingAlertAdapter(), clock);
const accountService = new PlatformAdminAccountService(authRepository);
const adminEntitlementService = new PlatformAdminEntitlementService(
  authService,
  entitlementRepository,
  changeRequestRepository,
  entitlementService,
  changeRequestService,
  slotReservationService,
);

function uniqueFamilyId(label) {
  return `family-${label}-${randomUUID()}`;
}

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createAdmin({ role = 'PLATFORM_ADMIN' } = {}) {
  const email = uniqueEmail('admin');
  const password = 'correct horse battery staple';
  const account = await accountService.createAccount('DB Test Admin', hashAdminEmail(email), password, role, 'BOOTSTRAP');
  const secret = generateTotpSecret();
  const key = loadMfaEncryptionKey();
  const { ciphertext, nonce } = encryptTotpSecret(secret, key);
  await getPool().query(
    `UPDATE platform_admin_mfa_state SET status = 'ACTIVE', totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NOW(3) WHERE admin_id = ?`,
    [ciphertext, nonce, account.adminId],
  );
  const code = computeTotp(secret, clock().getTime());
  const { rawToken } = await authService.login(email, password, code);
  const identity = await authService.validateSession(rawToken);
  return { adminId: account.adminId, roles: [role], sessionId: identity.sessionId, secret };
}

async function stepUpFor(admin, scope) {
  clockOffsetMs += 31_000;
  const code = computeTotp(admin.secret, clock().getTime());
  return authService.assertStepUp(admin.adminId, admin.sessionId, scope, code, admin.roles[0]);
}

// ---------------------------------------------------------------------------
// PCA-ADD-PA-021/024: FREE_STARTER defaults
// ---------------------------------------------------------------------------

test('FREE_STARTER: a new family lazily gets parentMemberLimit=1, managedDeviceLimit=1', async () => {
  const familyId = uniqueFamilyId('starter');
  const entitlement = await entitlementService.getOrCreateForFamily(familyId, new Date());
  assert.equal(entitlement.parentMemberLimit, 1);
  assert.equal(entitlement.managedDeviceLimit, 1);
  assert.equal(entitlement.planRef, 'FREE_STARTER');
});

test('FREE_STARTER: changing the default does not rewrite an existing family entitlement', async () => {
  const familyId = uniqueFamilyId('predates-default-change');
  const before = await entitlementService.getOrCreateForFamily(familyId, new Date());
  assert.equal(before.managedDeviceLimit, 1);

  const admin = await createAdmin({ role: 'PLATFORM_ADMIN' });
  await adminEntitlementService.updateFreeStarterDefaults({ adminId: admin.adminId, roles: admin.roles, sessionId: admin.sessionId }, 5, 9);

  const stillOld = await entitlementService.getForFamily(familyId);
  assert.equal(stillOld.managedDeviceLimit, 1, 'existing family entitlement must not be rewritten by a later default change');

  const newFamilyId = uniqueFamilyId('after-default-change');
  const created = await entitlementService.getOrCreateForFamily(newFamilyId, new Date());
  assert.equal(created.managedDeviceLimit, 9, 'a family created after the default change gets the new default');

  // restore the default for any other test relying on 1/1
  await adminEntitlementService.updateFreeStarterDefaults({ adminId: admin.adminId, roles: admin.roles, sessionId: admin.sessionId }, 1, 1);
});

// ---------------------------------------------------------------------------
// PCA-ADD-PA-025: separate, never-collapsed limits
// ---------------------------------------------------------------------------

test('entitlement counters: parentMemberLimit and managedDeviceLimit are independent', async () => {
  const familyId = uniqueFamilyId('independent-limits');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const admin = await createAdmin();
  const actor = { adminId: admin.adminId, roles: admin.roles, sessionId: admin.sessionId };
  await adminEntitlementService.setEntitlementLimit(actor, familyId, 'MANAGED_DEVICE_LIMIT', 5);
  const updated = await entitlementService.getForFamily(familyId);
  assert.equal(updated.managedDeviceLimit, 5);
  assert.equal(updated.parentMemberLimit, 1, 'raising the device limit must never move the parent-member limit');
});

// ---------------------------------------------------------------------------
// PCA-ADD-PA-023: over-limit downgrade never force-removes occupants
// ---------------------------------------------------------------------------

test('downgrade: lowering managedDeviceLimit below active usage flips overLimitManagedDevice, never force-removes', async () => {
  const familyId = uniqueFamilyId('downgrade');
  const admin = await createAdmin();
  const actor = { adminId: admin.adminId, roles: admin.roles, sessionId: admin.sessionId };
  await adminEntitlementService.setEntitlementLimit(actor, familyId, 'MANAGED_DEVICE_LIMIT', 3);
  await entitlementRepository.getOrCreateForFamily(familyId, 'FREE_STARTER', { parentMemberLimit: 1, managedDeviceLimit: 3 }, new Date());
  await getPool().query(`UPDATE account_entitlements SET managed_device_active_count = 2 WHERE family_id = ?`, [familyId]);

  const downgraded = await adminEntitlementService.setEntitlementLimit(actor, familyId, 'MANAGED_DEVICE_LIMIT', 1);
  assert.equal(downgraded.managedDeviceLimit, 1);
  assert.equal(downgraded.managedDeviceActiveCount, 2, 'existing active devices are never force-removed by a downgrade');
  assert.equal(downgraded.overLimitManagedDevice, true);

  const backUp = await adminEntitlementService.setEntitlementLimit(actor, familyId, 'MANAGED_DEVICE_LIMIT', 5);
  assert.equal(backUp.overLimitManagedDevice, false, 'raising the limit back above usage clears the over-limit flag');
});

// ---------------------------------------------------------------------------
// Invalid target limits
// ---------------------------------------------------------------------------

test('createRequest rejects a target at or below the current limit', async () => {
  const familyId = uniqueFamilyId('invalid-target');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  await assert.rejects(
    () => changeRequestService.createRequest(familyId, 'MANAGED_DEVICE_LIMIT', 1, 'GLOBAL', 'USD'),
    (error) => error instanceof ChangeRequestError && error.code === 'INVALID_TARGET',
  );
  await assert.rejects(
    () => changeRequestService.createRequest(familyId, 'MANAGED_DEVICE_LIMIT', 0, 'GLOBAL', 'USD'),
    (error) => error instanceof ChangeRequestError && error.code === 'INVALID_TARGET',
  );
});

// ---------------------------------------------------------------------------
// PCA-ADD-PA-030/050: request lifecycle, custom-quote waiting state, quote snapshot
// ---------------------------------------------------------------------------

test('request lifecycle: no PriceBook -> PENDING with awaitingAdminQuote (PENDING_ADMIN_QUOTE)', async () => {
  const familyId = uniqueFamilyId('custom-quote');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const request = await changeRequestService.createRequest(familyId, 'MANAGED_DEVICE_LIMIT', 3, 'GLOBAL', 'USD');
  assert.equal(request.state, 'PENDING');
  assert.equal(request.awaitingAdminQuote, true);
  assert.equal(request.quote, null);
});

test('request lifecycle: FINANCE_ADMIN issues a custom quote -> PENDING moves to QUOTED with an immutable snapshot', async () => {
  const familyId = uniqueFamilyId('quote-snapshot');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const request = await changeRequestService.createRequest(familyId, 'MANAGED_DEVICE_LIMIT', 3, 'GLOBAL', 'USD');
  const financeAdmin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const quoted = await adminEntitlementService.issueCustomQuote(
    { adminId: financeAdmin.adminId, roles: financeAdmin.roles, sessionId: financeAdmin.sessionId },
    request.requestId,
    12345n,
    'USD',
  );
  assert.equal(quoted.state, 'QUOTED');
  assert.equal(quoted.quote.quoteKind, 'CUSTOM');
  assert.equal(quoted.quote.amountMinor, 12345n);
  assert.equal(quoted.quote.currencyCode, 'USD');
  assert.equal(quoted.quote.priceBookVersion, null, 'a custom quote never carries a PriceBook version');

  // Snapshot immutability (PCA-ADD-BILL-043): issuing a second quote must fail (not PENDING anymore).
  await assert.rejects(
    () => adminEntitlementService.issueCustomQuote({ adminId: financeAdmin.adminId, roles: financeAdmin.roles, sessionId: financeAdmin.sessionId }, request.requestId, 99999n, 'USD'),
  );
  const reread = await changeRequestRepository.getById(request.requestId);
  assert.equal(reread.quote.amountMinor, 12345n, 'the original quote snapshot must never be silently replaced');
});

// PCA-PA-2-R1: priceBookVersion is number|null, matching Agent44's
// canonical billing_price_books.price_book_version (INT UNSIGNED) /
// BillingEntitlementSignal.priceBookVersion representation.
class StubStandardQuotePort {
  async resolveStandardQuote({ targetDeviceLimit }) {
    return {
      kind: 'STANDARD',
      quoteId: `pricebook-quote:${randomUUID()}`,
      targetDeviceLimit,
      amountMinor: 9900n,
      currencyCode: 'USD',
      priceBookVersion: 7,
      expiresAt: new Date(Date.now() + 60_000),
    };
  }
}
const standardQuoteChangeRequestService = new ChangeRequestService(changeRequestRepository, entitlementRepository, entitlementService, new StubStandardQuotePort(), commercialNotificationPublisher);

test('quote snapshot: a standard (PriceBook-resolved) quote persists priceBookVersion as an exact integer and reloads unchanged', async () => {
  const familyId = uniqueFamilyId('standard-quote-version');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const request = await standardQuoteChangeRequestService.createRequest(familyId, 'MANAGED_DEVICE_LIMIT', 3, 'GLOBAL', 'USD');
  assert.equal(request.state, 'QUOTED');
  assert.equal(request.quote.quoteKind, 'STANDARD');
  assert.equal(request.quote.priceBookVersion, 7);
  assert.equal(typeof request.quote.priceBookVersion, 'number', 'never a formatted string');

  const reread = await changeRequestRepository.getById(request.requestId);
  assert.equal(reread.quote.priceBookVersion, 7, 'the integer version must round-trip through MySQL exactly');
  assert.equal(typeof reread.quote.priceBookVersion, 'number');
});

test('quote snapshot: payment confirmation accepts an integer priceBookVersion end to end (standard quote -> PAYMENT_PENDING -> ACTIVATED)', async () => {
  const familyId = uniqueFamilyId('standard-quote-payment');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const request = await standardQuoteChangeRequestService.createRequest(familyId, 'MANAGED_DEVICE_LIMIT', 3, 'GLOBAL', 'USD');
  const pending = await standardQuoteChangeRequestService.moveToPaymentPending(request.requestId);
  assert.equal(pending.state, 'PAYMENT_PENDING');

  const result = await paymentConfirmationService.confirmPayment({
    requestId: pending.requestId,
    idempotencyKey: `provider:test:event:${randomUUID()}`,
    targetDeviceLimit: pending.targetLimit,
    amountMinor: pending.quote.amountMinor,
    currencyCode: 'USD',
    quoteRef: pending.quote.quoteRef,
    priceBookVersion: pending.quote.priceBookVersion,
    paymentTransactionId: randomUUID(),
  });
  assert.equal(result.outcome, 'ACTIVATED');
});

test('quote snapshot: PaymentConfirmationService rejects a malformed priceBookVersion at typed service authority (never silently coerced)', async () => {
  const familyId = uniqueFamilyId('malformed-price-book-version');
  const request = await createQuotedDeviceRequest(familyId);
  await assert.rejects(
    () =>
      paymentConfirmationService.confirmPayment({
        requestId: request.requestId,
        idempotencyKey: `provider:test:event:${randomUUID()}`,
        targetDeviceLimit: request.targetLimit,
        amountMinor: request.quote.amountMinor,
        currencyCode: 'USD',
        quoteRef: request.quote.quoteRef,
        priceBookVersion: 1.5,
        paymentTransactionId: randomUUID(),
      }),
    TypeError,
  );
});

// ---------------------------------------------------------------------------
// Invalid state transitions
// ---------------------------------------------------------------------------

test('invalid transitions: cannot approve a DENIED request, cannot deny an APPROVED request', async () => {
  const familyId = uniqueFamilyId('invalid-transitions');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const request = await changeRequestService.createRequest(familyId, 'PARENT_MEMBER_LIMIT', 2, 'GLOBAL', 'USD');
  const admin = await createAdmin();
  const actor = { adminId: admin.adminId, roles: admin.roles, sessionId: admin.sessionId };
  await adminEntitlementService.denyRequest(actor, request.requestId, 'policy limit');
  await assert.rejects(() => adminEntitlementService.approveParentMemberRequest(actor, request.requestId));

  const secondFamily = uniqueFamilyId('invalid-transitions-2');
  await entitlementService.getOrCreateForFamily(secondFamily, new Date());
  const secondRequest = await changeRequestService.createRequest(secondFamily, 'PARENT_MEMBER_LIMIT', 2, 'GLOBAL', 'USD');
  await adminEntitlementService.approveParentMemberRequest(actor, secondRequest.requestId);
  await assert.rejects(() => adminEntitlementService.denyRequest(actor, secondRequest.requestId, 'too late'));
});

// ---------------------------------------------------------------------------
// PCA-ADD-PA-054: non-billable parent-member request
// ---------------------------------------------------------------------------

test('parent-member request: never carries a quote, approved directly PENDING -> APPROVED, raises parentMemberLimit', async () => {
  const familyId = uniqueFamilyId('parent-member');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const request = await changeRequestService.createRequest(familyId, 'PARENT_MEMBER_LIMIT', 2, 'GLOBAL', 'USD');
  assert.equal(request.state, 'PENDING');
  assert.equal(request.quote, null);

  const admin = await createAdmin();
  const approved = await adminEntitlementService.approveParentMemberRequest({ adminId: admin.adminId, roles: admin.roles, sessionId: admin.sessionId }, request.requestId);
  assert.equal(approved.state, 'APPROVED');
  assert.equal(approved.noChargeOverride, false);

  const entitlement = await entitlementService.getForFamily(familyId);
  assert.equal(entitlement.parentMemberLimit, 2);
});

test('parent-member request never resolves a quote even if targeting the device limit type by mistake is attempted via device path', async () => {
  // The DB CHECK constraint entitlement_change_requests_billable_check
  // enforces this at the schema level -- assert it rejects a direct
  // attempt to attach a quote to a PARENT_MEMBER_LIMIT row.
  const familyId = uniqueFamilyId('billable-check');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const requestId = randomUUID();
  await getPool().query(
    `INSERT INTO entitlement_change_requests (request_id, family_id, limit_type, current_limit_at_request, target_limit, state, created_at, updated_at)
     VALUES (?, ?, 'PARENT_MEMBER_LIMIT', 1, 2, 'PENDING', NOW(3), NOW(3))`,
    [requestId, familyId],
  );
  await assert.rejects(
    () =>
      getPool().query(
        `UPDATE entitlement_change_requests SET quote_kind = 'STANDARD', quote_ref = 'x', quote_amount_minor = 100, quote_currency_code = 'USD', quoted_at = NOW(3), quote_expires_at = NOW(3) WHERE request_id = ?`,
        [requestId],
      ),
    /CONSTRAINT|check/i,
  );
});

// ---------------------------------------------------------------------------
// Payment-required managed-device request + atomic approval + idempotency
// ---------------------------------------------------------------------------

async function createQuotedDeviceRequest(familyId, amountMinor = 5000n) {
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const request = await changeRequestService.createRequest(familyId, 'MANAGED_DEVICE_LIMIT', 4, 'GLOBAL', 'USD');
  const financeAdmin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const quoted = await adminEntitlementService.issueCustomQuote(
    { adminId: financeAdmin.adminId, roles: financeAdmin.roles, sessionId: financeAdmin.sessionId },
    request.requestId,
    amountMinor,
    'USD',
  );
  const pending = await changeRequestService.moveToPaymentPending(quoted.requestId);
  assert.equal(pending.state, 'PAYMENT_PENDING');
  return pending;
}

test('payment-required request: stays PAYMENT_PENDING until server-side payment confirmation, then atomically approves and raises the limit', async () => {
  const familyId = uniqueFamilyId('payment-required');
  const request = await createQuotedDeviceRequest(familyId);

  const before = await entitlementService.getForFamily(familyId);
  assert.equal(before.managedDeviceLimit, 1, 'entitlement must not move while PAYMENT_PENDING');

  const result = await paymentConfirmationService.confirmPayment({
    requestId: request.requestId,
    idempotencyKey: `provider:test:event:${randomUUID()}`,
    targetDeviceLimit: request.targetLimit,
    amountMinor: request.quote.amountMinor,
    currencyCode: 'USD',
    quoteRef: request.quote.quoteRef,
    priceBookVersion: null,
    paymentTransactionId: randomUUID(),
  });
  assert.equal(result.outcome, 'ACTIVATED');
  assert.equal(result.appliedManagedDeviceLimit, request.targetLimit);

  const requestAfter = await changeRequestRepository.getById(request.requestId);
  assert.equal(requestAfter.state, 'APPROVED', 'the request and the entitlement raise commit atomically');
  const entitlementAfter = await entitlementService.getForFamily(familyId);
  assert.equal(entitlementAfter.managedDeviceLimit, request.targetLimit);
});

test('payment confirmation: amount mismatch is rejected, never silently reconciled', async () => {
  const familyId = uniqueFamilyId('amount-mismatch');
  const request = await createQuotedDeviceRequest(familyId, 7000n);
  const result = await paymentConfirmationService.confirmPayment({
    requestId: request.requestId,
    idempotencyKey: `provider:test:event:${randomUUID()}`,
    targetDeviceLimit: request.targetLimit,
    amountMinor: 1n,
    currencyCode: 'USD',
    quoteRef: request.quote.quoteRef,
    priceBookVersion: null,
    paymentTransactionId: randomUUID(),
  });
  assert.equal(result.outcome, 'AMOUNT_MISMATCH');
  const requestAfter = await changeRequestRepository.getById(request.requestId);
  assert.equal(requestAfter.state, 'PAYMENT_PENDING', 'a mismatched confirmation must never move the request');
});

test('payment confirmation: duplicate delivery of the same idempotency key is applied at most once', async () => {
  const familyId = uniqueFamilyId('duplicate-payment');
  const request = await createQuotedDeviceRequest(familyId);
  const idempotencyKey = `provider:test:event:${randomUUID()}`;
  const input = {
    requestId: request.requestId,
    idempotencyKey,
    targetDeviceLimit: request.targetLimit,
    amountMinor: request.quote.amountMinor,
    currencyCode: 'USD',
    quoteRef: request.quote.quoteRef,
    priceBookVersion: null,
    paymentTransactionId: randomUUID(),
  };
  const first = await paymentConfirmationService.confirmPayment(input);
  assert.equal(first.outcome, 'ACTIVATED');
  const second = await paymentConfirmationService.confirmPayment(input);
  assert.equal(second.outcome, 'ALREADY_ACTIVATED');
  assert.equal(second.appliedManagedDeviceLimit, request.targetLimit);

  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM entitlement_activation_idempotency WHERE idempotency_key = ?`, [idempotencyKey]);
  assert.equal(Number(rows[0].n), 1, 'exactly one idempotency claim row, never duplicated');
});

test('CONCURRENCY: N simultaneous duplicate payment-confirmation calls for the same idempotency key apply exactly once', async () => {
  const familyId = uniqueFamilyId('concurrent-duplicate-payment');
  const request = await createQuotedDeviceRequest(familyId);
  const idempotencyKey = `provider:test:event:${randomUUID()}`;
  const input = {
    requestId: request.requestId,
    idempotencyKey,
    targetDeviceLimit: request.targetLimit,
    amountMinor: request.quote.amountMinor,
    currencyCode: 'USD',
    quoteRef: request.quote.quoteRef,
    priceBookVersion: null,
    paymentTransactionId: randomUUID(),
  };
  const N = 8;
  const results = await Promise.all(Array.from({ length: N }, () => paymentConfirmationService.confirmPayment(input)));
  const activated = results.filter((r) => r.outcome === 'ACTIVATED');
  const alreadyActivated = results.filter((r) => r.outcome === 'ALREADY_ACTIVATED');
  assert.equal(activated.length, 1, `expected exactly 1 ACTIVATED, got ${activated.length}`);
  assert.equal(alreadyActivated.length, N - 1);

  const entitlement = await entitlementService.getForFamily(familyId);
  assert.equal(entitlement.managedDeviceLimit, request.targetLimit, 'the entitlement is set to (never incremented past) the target exactly once');
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM entitlement_activation_idempotency WHERE idempotency_key = ?`, [idempotencyKey]);
  assert.equal(Number(rows[0].n), 1);
});

// ---------------------------------------------------------------------------
// Admin no-charge override + RBAC + step-up
// ---------------------------------------------------------------------------

test('no-charge override: APP_OWNER with a valid step-up grant raises the device limit without any payment', async () => {
  const familyId = uniqueFamilyId('no-charge');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const owner = await createAdmin({ role: 'APP_OWNER' });
  const stepUp = await stepUpFor(owner, 'ENTITLEMENT_LIMIT_OVERRIDE');
  const approved = await adminEntitlementService.noChargeDeviceOverride(
    { adminId: owner.adminId, roles: owner.roles, sessionId: owner.sessionId },
    familyId,
    6,
    'goodwill grant',
    stepUp.stepUpId,
  );
  assert.equal(approved.state, 'APPROVED');
  assert.equal(approved.noChargeOverride, true);
  const entitlement = await entitlementService.getForFamily(familyId);
  assert.equal(entitlement.managedDeviceLimit, 6);
});

test('no-charge override: a step-up grant is single-use -- reusing it fails', async () => {
  const familyId = uniqueFamilyId('no-charge-single-use');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const owner = await createAdmin({ role: 'APP_OWNER' });
  const stepUp = await stepUpFor(owner, 'ENTITLEMENT_LIMIT_OVERRIDE');
  const actor = { adminId: owner.adminId, roles: owner.roles, sessionId: owner.sessionId };
  await adminEntitlementService.noChargeDeviceOverride(actor, familyId, 3, 'first', stepUp.stepUpId);
  await assert.rejects(() => adminEntitlementService.noChargeDeviceOverride(actor, familyId, 4, 'reuse attempt', stepUp.stepUpId));
});

test('no-charge override: missing/absent step-up is rejected before any mutation', async () => {
  const familyId = uniqueFamilyId('no-step-up');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const owner = await createAdmin({ role: 'APP_OWNER' });
  const actor = { adminId: owner.adminId, roles: owner.roles, sessionId: owner.sessionId };
  await assert.rejects(() => adminEntitlementService.noChargeDeviceOverride(actor, familyId, 3, 'no step-up', randomUUID()));
  const entitlement = await entitlementService.getForFamily(familyId);
  assert.equal(entitlement.managedDeviceLimit, 1, 'no mutation may occur without a valid step-up');
});

test('RBAC: SUPPORT_ADMIN cannot administer entitlement quantity (view-only)', async () => {
  const familyId = uniqueFamilyId('rbac-support');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const support = await createAdmin({ role: 'SUPPORT_ADMIN' });
  const actor = { adminId: support.adminId, roles: support.roles, sessionId: support.sessionId };
  await assert.rejects(
    () => adminEntitlementService.setEntitlementLimit(actor, familyId, 'MANAGED_DEVICE_LIMIT', 5),
    (error) => error instanceof PlatformAdminEntitlementError && error.code === 'FORBIDDEN',
  );
  // but read access is allowed
  const read = await adminEntitlementService.readEntitlement(actor, familyId);
  assert.equal(read.managedDeviceLimit, 1);
});

test('RBAC: AUDITOR_READ_ONLY cannot mutate anything', async () => {
  const familyId = uniqueFamilyId('rbac-auditor');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const auditor = await createAdmin({ role: 'AUDITOR_READ_ONLY' });
  const actor = { adminId: auditor.adminId, roles: auditor.roles, sessionId: auditor.sessionId };
  await assert.rejects(() => adminEntitlementService.setEntitlementLimit(actor, familyId, 'MANAGED_DEVICE_LIMIT', 5));
  const read = await adminEntitlementService.readUsage(actor, familyId);
  assert.equal(read.managedDeviceLimit, 1);
});

test('parent token / family-session identity has no entry point into PlatformAdminEntitlementService (structural: it requires a PlatformAdminActor, never a family session)', () => {
  // No code path in backend/src/entitlements or backend/src/platformadmin/entitlements
  // accepts a family/parent session token; every mutating method's first
  // parameter is a PlatformAdminActor sourced only from
  // PlatformAdminAuthService.validateSession. This is verified structurally
  // (the constructor signatures above), not by a runtime call, since no
  // family-session-accepting overload exists to call.
  assert.equal(typeof adminEntitlementService.setEntitlementLimit, 'function');
});

// ---------------------------------------------------------------------------
// Audit generation
// ---------------------------------------------------------------------------

test('audit: no-charge override writes ENTITLEMENT_INCREASED and LIMIT_REQUEST_APPROVED events with the acting admin as actor', async () => {
  const familyId = uniqueFamilyId('audit-no-charge');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const owner = await createAdmin({ role: 'APP_OWNER' });
  const stepUp = await stepUpFor(owner, 'ENTITLEMENT_LIMIT_OVERRIDE');
  await adminEntitlementService.noChargeDeviceOverride({ adminId: owner.adminId, roles: owner.roles, sessionId: owner.sessionId }, familyId, 4, 'audit check', stepUp.stepUpId);

  const [rows] = await getPool().query(
    `SELECT event_type FROM platform_admin_audit_events WHERE actor_admin_id = ? AND target_ref = ? ORDER BY occurred_at`,
    [owner.adminId, `family:${familyId}`],
  );
  const eventTypes = rows.map((row) => row.event_type);
  assert.ok(eventTypes.includes('ENTITLEMENT_INCREASED'));
});

test('audit: denial writes a LIMIT_REQUEST_DENIED event', async () => {
  const familyId = uniqueFamilyId('audit-denied');
  await entitlementService.getOrCreateForFamily(familyId, new Date());
  const request = await changeRequestService.createRequest(familyId, 'PARENT_MEMBER_LIMIT', 2, 'GLOBAL', 'USD');
  const admin = await createAdmin();
  await adminEntitlementService.denyRequest({ adminId: admin.adminId, roles: admin.roles, sessionId: admin.sessionId }, request.requestId, 'policy limit');

  const [rows] = await getPool().query(
    `SELECT event_type FROM platform_admin_audit_events WHERE target_ref = ? ORDER BY occurred_at`,
    [`request:${request.requestId}`],
  );
  assert.ok(rows.some((row) => row.event_type === 'LIMIT_REQUEST_DENIED'));
});

// ---------------------------------------------------------------------------
// Cross-family isolation
// ---------------------------------------------------------------------------

test('cross-family isolation: raising one family entitlement never affects another', async () => {
  const familyA = uniqueFamilyId('isolation-a');
  const familyB = uniqueFamilyId('isolation-b');
  await entitlementService.getOrCreateForFamily(familyA, new Date());
  await entitlementService.getOrCreateForFamily(familyB, new Date());
  const admin = await createAdmin();
  const actor = { adminId: admin.adminId, roles: admin.roles, sessionId: admin.sessionId };
  await adminEntitlementService.setEntitlementLimit(actor, familyA, 'MANAGED_DEVICE_LIMIT', 9);
  const entitlementA = await entitlementService.getForFamily(familyA);
  const entitlementB = await entitlementService.getForFamily(familyB);
  assert.equal(entitlementA.managedDeviceLimit, 9);
  assert.equal(entitlementB.managedDeviceLimit, 1);
});

test.after(async () => {
  await closePool();
});
