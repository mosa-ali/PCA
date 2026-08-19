// PCA-ADD-PA-041 / PCA-ADD-BILL-020 (Writer65): real-MySQL tests proving
// DashboardReadModel.ts's new settlementSummary/serviceHealth fields are
// genuinely sourced from the Settlement domain (never fabricated), and the
// cross-batch USD-normalized rollup (recordUsdNormalization/usdRollup)
// applies exact-decimal-rate arithmetic through real BIGINT columns,
// correctly excludes non-USD batches with no recorded rate, and enforces
// RBAC + write-once immutability. Mirrors settlement.mysql.test.mjs's
// helpers/structure.
if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ab'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { closePool, getPool } from '../../dist/db/pool.js';
import { money } from '../../dist/billing/money.js';
import { MySqlSettlementRepository } from '../../dist/billing/settlement/MySqlSettlementRepository.js';
import { SettlementService } from '../../dist/billing/settlement/SettlementService.js';
import { SettlementError } from '../../dist/billing/settlement/types.js';
import { PlatformAdminSettlementService, PlatformAdminSettlementError } from '../../dist/platformadmin/settlement/PlatformAdminSettlementService.js';
import { registerSettlementRoutes } from '../../dist/http/routes/platformadmin/settlementRoutes.js';
import { registerPlatformAdminDashboardRoutes } from '../../dist/http/routes/platformadmin/dashboardRoutes.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { PaymentRepository } from '../../dist/billing/payment.js';
import { PlatformAdminAuthService } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { computeTotp, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { LoggingAlertAdapter } from '../../dist/platformadmin/auth/alertPort.js';
import { DashboardReadModel } from '../../dist/platformadmin/readmodels/DashboardReadModel.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const settlementRepository = new MySqlSettlementRepository();
const paymentRepository = new PaymentRepository();
const settlementService = new SettlementService(settlementRepository, paymentRepository);

const authRepository = new MySqlPlatformAdminAuthRepository();
const accountService = new PlatformAdminAccountService(authRepository);
let clockOffsetMs = 0;
const clock = () => new Date(Date.now() + clockOffsetMs);
const authService = new PlatformAdminAuthService(authRepository, new LoggingAlertAdapter(), clock);
const adminSettlementService = new PlatformAdminSettlementService(authService, settlementService, clock);

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createAdmin({ role = 'FINANCE_ADMIN' } = {}) {
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
  return { adminId: account.adminId, roles: [role], sessionId: identity.sessionId, secret, rawToken };
}

async function stepUpFor(admin, scope = 'SETTLEMENT_BANK_CONFIG') {
  clockOffsetMs += 31_000;
  const code = computeTotp(admin.secret, clock().getTime());
  const result = await authService.assertStepUp(admin.adminId, admin.sessionId, scope, code, admin.roles[0]);
  return result.stepUpId;
}

function actorOf(admin) {
  return { adminId: admin.adminId, roles: admin.roles, sessionId: admin.sessionId };
}

async function createActiveAccount(admin, currency = 'USD') {
  const stepUpId = await stepUpFor(admin);
  return adminSettlementService.createAccount(actorOf(admin), { providerRef: `secretref:${randomUUID()}`, displayLabel: `****${Math.floor(1000 + Math.random() * 8999)}`, settlementCurrency: currency, stepUpId });
}

async function openBatch(admin, account, { currency = 'USD', expectedGross, fees, received } = {}) {
  const stepUpId = await stepUpFor(admin);
  return adminSettlementService.openBatch(actorOf(admin), {
    settlementAccountRef: account.settlementAccountId,
    settlementCurrency: currency,
    periodStart: new Date('2026-03-01T00:00:00Z'),
    periodEnd: new Date('2026-03-08T00:00:00Z'),
    expectedGross: expectedGross ?? money(10_000n, currency),
    fees: fees ?? money(0n, currency),
    received: received ?? money(10_000n, currency),
    providerRef: `report:${randomUUID()}`,
    stepUpId,
  });
}

// ---------------------------------------------------------------------------
// DashboardReadModel: settlementSummary / serviceHealth are real, not fabricated
// ---------------------------------------------------------------------------

test('DashboardReadModel.build(): settlementSummary reflects real settlement_batches rows, and serviceHealth exposes the open UNDER_INVESTIGATION count plus per-account most-recent-batch status', async () => {
  const admin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const account = await createActiveAccount(admin, 'USD');

  const before = await new DashboardReadModel().build();
  const beforeUnderInvestigation = before.settlementSummary.summary.underInvestigationBatchCount;

  // A MATCHED batch (received == net).
  const matched = await openBatch(admin, account);
  assert.equal(matched.status, 'MATCHED');

  // An UNDER_INVESTIGATION batch (received != net) on the SAME account, with
  // a LATER period_end -- proves "most recent" is genuinely period_end-
  // ranked, not just "last inserted".
  const stepUpId = await stepUpFor(admin);
  const underInvestigation = await adminSettlementService.openBatch(actorOf(admin), {
    settlementAccountRef: account.settlementAccountId,
    settlementCurrency: 'USD',
    periodStart: new Date('2026-04-01T00:00:00Z'),
    periodEnd: new Date('2026-04-08T00:00:00Z'),
    expectedGross: money(10_000n, 'USD'),
    fees: money(0n, 'USD'),
    received: money(9_000n, 'USD'),
    providerRef: `report:${randomUUID()}`,
    stepUpId,
  });
  assert.equal(underInvestigation.status, 'UNDER_INVESTIGATION');

  const snapshot = await new DashboardReadModel().build();
  assert.equal(snapshot.settlementSummary.capability, 'AVAILABLE');
  assert.equal(snapshot.settlementSummary.summary.underInvestigationBatchCount, beforeUnderInvestigation + 1);
  const usdRow = snapshot.settlementSummary.summary.byCurrency.find((r) => r.currencyCode === 'USD');
  assert.ok(usdRow, 'expected a USD byCurrency row');

  assert.equal(snapshot.serviceHealth.capability, 'AVAILABLE');
  assert.equal(snapshot.serviceHealth.openReconciliationExceptions, snapshot.settlementSummary.summary.underInvestigationBatchCount);
  const accountRow = snapshot.serviceHealth.mostRecentBatchStatusByAccount.find((r) => r.settlementAccountId === account.settlementAccountId);
  assert.ok(accountRow, 'expected this account to appear in mostRecentBatchStatusByAccount');
  assert.equal(accountRow.mostRecentBatchStatus, 'UNDER_INVESTIGATION', 'the LATER (by period_end) batch must win, not the earlier MATCHED one');
});

test('DashboardReadModel.build(): operational/commercial dashboard metrics are sourced from metadata tables with explicit aging, outcome, and exception semantics', async () => {
  const now = new Date('2026-08-18T12:00:00.000Z');
  const before = await new DashboardReadModel().build(now);
  const familyRecent = randomUUID();
  const familyOlder = randomUUID();
  const familyWindowBoundary = randomUUID();
  const familyFuture = randomUUID();
  const planRef = `PLAN_${randomUUID().slice(0, 8)}`;
  const createdRecent = new Date('2026-08-17T12:00:00.000Z');
  const createdOlder = new Date('2026-08-01T12:00:00.000Z');
  const createdWindowBoundary = new Date('2025-09-01T00:00:00.000Z');
  const createdFuture = new Date('2026-08-19T00:00:00.000Z');

  await getPool().query(
    `INSERT INTO families (family_id, family_reference_hash, created_at)
     VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)`,
    [
      familyRecent, Buffer.from(randomUUID()), createdRecent,
      familyOlder, Buffer.from(randomUUID()), createdOlder,
      familyWindowBoundary, Buffer.from(randomUUID()), createdWindowBoundary,
      familyFuture, Buffer.from(randomUUID()), createdFuture,
    ],
  );
  await getPool().query(
    `INSERT INTO account_entitlements
       (family_id, plan_ref, parent_member_limit, managed_device_limit, managed_device_active_count, managed_device_reserved_count, created_at, updated_at)
     VALUES (?, ?, 2, 5, 2, 1, ?, ?), (?, ?, 1, 3, 1, 0, ?, ?)`,
    [familyRecent, planRef, createdRecent, createdRecent, familyOlder, planRef, createdOlder, createdOlder],
  );
  await getPool().query(
    `INSERT INTO entitlement_change_requests
       (request_id, family_id, limit_type, current_limit_at_request, target_limit, state, created_at, updated_at)
     VALUES
       (?, ?, 'MANAGED_DEVICE_LIMIT', 3, 4, 'PENDING', ?, ?),
       (?, ?, 'MANAGED_DEVICE_LIMIT', 3, 5, 'QUOTED', ?, ?),
       (?, ?, 'MANAGED_DEVICE_LIMIT', 3, 6, 'PAYMENT_PENDING', ?, ?)`,
    [
      randomUUID(), familyRecent, new Date('2026-08-08T12:00:00.000Z'), new Date('2026-08-08T12:00:00.000Z'),
      randomUUID(), familyRecent, new Date('2026-08-16T12:00:00.000Z'), new Date('2026-08-16T12:00:00.000Z'),
      randomUUID(), familyRecent, new Date('2026-08-18T06:00:00.000Z'), new Date('2026-08-18T06:00:00.000Z'),
    ],
  );
  await getPool().query(
    `INSERT INTO billing_payment_attempts
       (payment_attempt_id, account_ref, amount_minor, currency_code, status, created_at, updated_at)
     VALUES
       (?, ?, 1000, 'USD', 'CONFIRMED', ?, ?),
       (?, ?, 1000, 'USD', 'FAILED', ?, ?),
       (?, ?, 1000, 'USD', 'PENDING', ?, ?),
       (?, ?, 1000, 'USD', 'PENDING', ?, ?)`,
    [
      randomUUID(), familyRecent, createdRecent, createdRecent,
      randomUUID(), familyRecent, createdRecent, createdRecent,
      randomUUID(), familyRecent, new Date('2026-08-16T12:00:00.000Z'), new Date('2026-08-16T12:00:00.000Z'),
      randomUUID(), familyRecent, new Date('2026-08-16T12:00:00.000Z'), new Date('2026-08-18T11:30:00.000Z'),
    ],
  );
  await getPool().query(
    `INSERT INTO enrollment_invitations
       (invitation_id, family_id, token_hash, platform, requested_protection_mode, status, created_at, expires_at)
     VALUES (?, ?, ?, 'ANDROID', 'ANDROID_STANDARD', 'OPENED', ?, ?)`,
    [randomUUID(), familyRecent, randomUUID().replaceAll('-', '').padEnd(64, '0'), new Date('2026-08-01T12:00:00.000Z'), new Date('2026-08-10T12:00:00.000Z')],
  );
  await getPool().query(
    `INSERT INTO enrollment_invitations
       (invitation_id, family_id, token_hash, platform, requested_protection_mode, status, created_at, expires_at)
     VALUES
       (?, ?, ?, 'ANDROID', 'ANDROID_STANDARD', 'CREATED', ?, ?),
       (?, ?, ?, 'ANDROID', 'ANDROID_STANDARD', 'REDEEMED', ?, ?),
       (?, ?, ?, 'ANDROID', 'ANDROID_STANDARD', 'REVOKED', ?, ?),
       (?, ?, ?, 'ANDROID', 'ANDROID_STANDARD', 'OPENED', ?, ?)`,
    [
      randomUUID(), familyRecent, randomUUID().replaceAll('-', '').padEnd(64, '0'), new Date('2026-08-01T12:00:00.000Z'), new Date('2026-08-10T12:00:00.000Z'),
      randomUUID(), familyRecent, randomUUID().replaceAll('-', '').padEnd(64, '0'), new Date('2026-08-01T12:00:00.000Z'), new Date('2026-08-10T12:00:00.000Z'),
      randomUUID(), familyRecent, randomUUID().replaceAll('-', '').padEnd(64, '0'), new Date('2026-08-01T12:00:00.000Z'), new Date('2026-08-10T12:00:00.000Z'),
      randomUUID(), familyRecent, randomUUID().replaceAll('-', '').padEnd(64, '0'), new Date('2026-08-01T12:00:00.000Z'), new Date('2026-08-19T12:00:00.000Z'),
    ],
  );

  const snapshot = await new DashboardReadModel().build(now);
  const plan = snapshot.managedDeviceEntitlementByPlan.rows.find((row) => row.planRef === planRef);
  assert.deepEqual(plan, { planRef, used: 3, reserved: 1, limit: 8 });
  assert.equal(snapshot.accountGrowthByMonth.capability, 'AVAILABLE');
  const beforeAugust = before.accountGrowthByMonth.rows.find((row) => row.monthUtc === '2026-08-01');
  const afterAugust = snapshot.accountGrowthByMonth.rows.find((row) => row.monthUtc === '2026-08-01');
  assert.equal(afterAugust.created, (beforeAugust?.created ?? 0) + 2);
  const beforeSeptember = before.accountGrowthByMonth.rows.find((row) => row.monthUtc === '2025-09-01');
  const afterSeptember = snapshot.accountGrowthByMonth.rows.find((row) => row.monthUtc === '2025-09-01');
  assert.equal(afterSeptember.created, (beforeSeptember?.created ?? 0) + 1, 'the 12-month window starts at the first day of the month');
  assert.equal(snapshot.entitlementRequestAging.open, (before.entitlementRequestAging.open ?? 0) + 3);
  assert.equal(snapshot.entitlementRequestAging.buckets.lessThanOneDay, (before.entitlementRequestAging.buckets?.lessThanOneDay ?? 0) + 1);
  assert.equal(snapshot.entitlementRequestAging.buckets.oneToSevenDays, (before.entitlementRequestAging.buckets?.oneToSevenDays ?? 0) + 1);
  assert.equal(snapshot.entitlementRequestAging.buckets.sevenDaysOrMore, (before.entitlementRequestAging.buckets?.sevenDaysOrMore ?? 0) + 1);

  const usd = snapshot.paymentSummaryByCurrency.rows.find((row) => row.currencyCode === 'USD');
  const beforeUsd = before.paymentSummaryByCurrency.rows.find((row) => row.currencyCode === 'USD');
  assert.equal(usd.total, (beforeUsd?.total ?? 0) + 3);
  assert.equal(usd.succeeded, (beforeUsd?.succeeded ?? 0) + 1);
  assert.equal(usd.failed, (beforeUsd?.failed ?? 0) + 1);
  const beforeTerminal = (beforeUsd?.succeeded ?? 0) + (beforeUsd?.failed ?? 0);
  assert.equal(usd.successRate, ((beforeUsd?.succeeded ?? 0) + 1) / (beforeTerminal + 2));
  assert.equal(snapshot.exceptionQueues.stuckPaymentAttempts, (before.exceptionQueues.stuckPaymentAttempts ?? 0) + 1, 'recently updated PENDING attempts are not stuck');
  assert.equal(snapshot.exceptionQueues.expiredUnredeemedInvitations, (before.exceptionQueues.expiredUnredeemedInvitations ?? 0) + 2, 'redeemed and revoked invitations are not unredeemed exceptions');
  assert.equal(snapshot.operationalSignals.capability, 'UNAVAILABLE');
  assert.equal(snapshot.operationalSignals.crashRate, null);
});

test('HTTP: GET /platform-admin/dashboard applies billing and settlement redaction by role while retaining the permitted dashboard metadata', async () => {
  const cases = [
    { role: 'SUPPORT_ADMIN', canViewBilling: false, canViewSettlement: false },
    { role: 'PLATFORM_ADMIN', canViewBilling: false, canViewSettlement: false },
    { role: 'APP_OWNER', canViewBilling: true, canViewSettlement: true },
    { role: 'FINANCE_ADMIN', canViewBilling: true, canViewSettlement: true },
    { role: 'AUDITOR_READ_ONLY', canViewBilling: true, canViewSettlement: true },
  ];

  for (const expected of cases) {
    const admin = await createAdmin({ role: expected.role });
    const app = Fastify({ logger: false });
    registerPlatformAdminDashboardRoutes(app, { platformAdminAuthService: authService, rateLimiter: createRateLimiter() });
    await app.ready();
    try {
      const response = await app.inject({ method: 'GET', url: '/platform-admin/dashboard', headers: { authorization: `Bearer ${admin.rawToken}` } });
      assert.equal(response.statusCode, 200, expected.role);
      const body = response.json();
      assert.ok(body.accountsTotal, `${expected.role} receives account metadata`);
      assert.ok(body.accountGrowthByMonth, `${expected.role} receives the growth trend`);
      assert.ok(body.entitlementRequestAging, `${expected.role} receives request aging`);
      assert.ok(body.exceptionQueues, `${expected.role} receives the permitted exception queue container`);
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'familyId'), false, `${expected.role} never receives family identifiers`);
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'childActivity'), false, `${expected.role} never receives child activity`);
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'location'), false, `${expected.role} never receives location data`);
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'invoicesByStatusAndCurrency'), expected.canViewBilling, `${expected.role} invoice redaction`);
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'paymentAttemptsByStatusAndCurrency'), expected.canViewBilling, `${expected.role} payment-attempt redaction`);
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'paymentSummaryByCurrency'), expected.canViewBilling, `${expected.role} payment-summary redaction`);
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'refundsByCurrency'), expected.canViewBilling, `${expected.role} refund redaction`);
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'openDisputes'), expected.canViewBilling, `${expected.role} dispute redaction`);
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'settlementSummary'), expected.canViewSettlement, `${expected.role} settlement redaction`);
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'serviceHealth'), expected.canViewSettlement, `${expected.role} service-health redaction`);
      assert.equal(Object.prototype.hasOwnProperty.call(body.exceptionQueues, 'stuckPaymentAttempts'), expected.canViewBilling, `${expected.role} stuck-payment redaction`);
      assert.equal(Object.prototype.hasOwnProperty.call(body.exceptionQueues, 'unresolvedReconciliations'), expected.canViewSettlement, `${expected.role} reconciliation redaction`);
    } finally {
      await app.close();
    }
  }
});

// ---------------------------------------------------------------------------
// USD-normalized cross-batch rollup (PCA-ADD-BILL-020)
// ---------------------------------------------------------------------------

test('usdRollup: a USD batch is included at face value (implicit rate=1); a non-USD batch with NO recorded rate is correctly EXCLUDED, never coerced to a fabricated 1:1', async () => {
  const admin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const usdAccount = await createActiveAccount(admin, 'USD');
  const sarAccount = await createActiveAccount(admin, 'SAR');

  const before = await adminSettlementService.usdRollup(actorOf(admin));

  await openBatch(admin, usdAccount, { currency: 'USD', expectedGross: money(50_000n, 'USD'), fees: money(0n, 'USD'), received: money(50_000n, 'USD') });
  const sarBatch = await openBatch(admin, sarAccount, { currency: 'SAR', expectedGross: money(20_000n, 'SAR'), fees: money(0n, 'SAR'), received: money(20_000n, 'SAR') });

  const afterOpen = await adminSettlementService.usdRollup(actorOf(admin));
  assert.equal(BigInt(afterOpen.totalNetUsdMinor) - BigInt(before.totalNetUsdMinor), 50_000n, 'only the USD batch counted so far');
  assert.equal(afterOpen.excludedForMissingRateBatchCount - before.excludedForMissingRateBatchCount, 1, 'the un-rated SAR batch must be excluded, not defaulted to rate=1');

  // Now an admin records an exact administrator-supplied rate (never a
  // live-fetched one) for the SAR batch: 1 SAR = 0.2666666667 USD.
  const stepUpId = await stepUpFor(admin);
  const updated = await adminSettlementService.recordUsdNormalization(actorOf(admin), sarBatch.settlementBatchId, '0.2666666667', stepUpId);
  assert.equal(updated.settlementBatchId, sarBatch.settlementBatchId);

  const afterRate = await adminSettlementService.usdRollup(actorOf(admin));
  assert.equal(afterRate.excludedForMissingRateBatchCount, afterOpen.excludedForMissingRateBatchCount - 1, 'no longer excluded');
  assert.equal(afterRate.includedBatchCount, afterOpen.includedBatchCount + 1);
  // 20000 * 0.2666666667 = 5333.333334 -> truncated toward zero at the minor-unit (integer) boundary -> 5333.
  const expectedSarContribution = 5333n;
  assert.equal(BigInt(afterRate.totalNetUsdMinor) - BigInt(afterOpen.totalNetUsdMinor), expectedSarContribution);
});

test('recordUsdNormalization: rejects a USD batch (needs no rate), rejects re-recording once set (write-once/immutable), and requires SETTLEMENT_BANK_CONFIG step-up', async () => {
  const admin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const usdAccount = await createActiveAccount(admin, 'USD');
  const sarAccount = await createActiveAccount(admin, 'SAR');
  const usdBatch = await openBatch(admin, usdAccount, { currency: 'USD' });
  const sarBatch = await openBatch(admin, sarAccount, { currency: 'SAR' });

  const stepUp1 = await stepUpFor(admin);
  await assert.rejects(() => adminSettlementService.recordUsdNormalization(actorOf(admin), usdBatch.settlementBatchId, '1.0000000000', stepUp1), SettlementError);

  const stepUp2 = await stepUpFor(admin);
  await adminSettlementService.recordUsdNormalization(actorOf(admin), sarBatch.settlementBatchId, '0.2700000000', stepUp2);

  const stepUp3 = await stepUpFor(admin);
  await assert.rejects(() => adminSettlementService.recordUsdNormalization(actorOf(admin), sarBatch.settlementBatchId, '0.3000000000', stepUp3), SettlementError);

  // No step-up id at all -- must reject before ever touching the domain.
  await assert.rejects(() => adminSettlementService.recordUsdNormalization(actorOf(admin), sarBatch.settlementBatchId, '0.3000000000', 'not-a-real-step-up-id'));
});

test('RBAC: SUPPORT_ADMIN and AUDITOR_READ_ONLY cannot record a USD-normalization rate (MUTATE_SETTLEMENT_ACCOUNT denies both)', async () => {
  const financeAdmin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const sarAccount = await createActiveAccount(financeAdmin, 'SAR');
  const sarBatch = await openBatch(financeAdmin, sarAccount, { currency: 'SAR' });

  for (const role of ['SUPPORT_ADMIN', 'AUDITOR_READ_ONLY']) {
    const admin = await createAdmin({ role });
    await assert.rejects(() => adminSettlementService.recordUsdNormalization(actorOf(admin), sarBatch.settlementBatchId, '0.2700000000', 'irrelevant'), PlatformAdminSettlementError);
  }
});

test('HTTP: POST /platform-admin/settlement/batches/:id/usd-normalization then GET /usd-rollup round-trips through the real route module', async () => {
  const admin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const sarAccount = await createActiveAccount(admin, 'SAR');
  const sarBatch = await openBatch(admin, sarAccount, { currency: 'SAR', expectedGross: money(1_000n, 'SAR'), fees: money(0n, 'SAR'), received: money(1_000n, 'SAR') });
  const stepUpId = await stepUpFor(admin);

  const app = Fastify({ logger: false });
  registerSettlementRoutes(app, { platformAdminAuthService: authService, platformAdminSettlementService: adminSettlementService, rateLimiter: createRateLimiter() });
  await app.ready();
  try {
    const postResponse = await app.inject({
      method: 'POST',
      url: `/platform-admin/settlement/batches/${sarBatch.settlementBatchId}/usd-normalization`,
      headers: { authorization: `Bearer ${admin.rawToken}` },
      payload: { rate: '0.2700000000', stepUpId },
    });
    assert.equal(postResponse.statusCode, 200);

    const rollupResponse = await app.inject({ method: 'GET', url: '/platform-admin/settlement/usd-rollup', headers: { authorization: `Bearer ${admin.rawToken}` } });
    assert.equal(rollupResponse.statusCode, 200);
    const body = rollupResponse.json();
    assert.ok(BigInt(body.totalNetUsdMinor) >= 270n);

    const healthResponse = await app.inject({ method: 'GET', url: '/platform-admin/settlement/account-health', headers: { authorization: `Bearer ${admin.rawToken}` } });
    assert.equal(healthResponse.statusCode, 200);
    const healthBody = healthResponse.json();
    const row = healthBody.items.find((r) => r.settlementAccountId === sarAccount.settlementAccountId);
    assert.ok(row);
    assert.equal(row.mostRecentBatch.settlementBatchId, sarBatch.settlementBatchId);
  } finally {
    await app.close();
  }
});

test.after(async () => {
  await closePool();
});
