import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool, execute, runInTransaction } from '../../dist/db/pool.js';

import { PriceBookService, PriceBookRepository } from '../../dist/billing/priceBook.js';
import { QuoteService, QuoteRepository, DEFAULT_QUOTE_VALIDITY_MS } from '../../dist/billing/quote.js';
import { PlanService, PlanRepository } from '../../dist/billing/plan.js';
import { SubscriptionService, SubscriptionRepository, DuplicateActiveSubscriptionError } from '../../dist/billing/subscription.js';
import { InvoiceService, InvoiceRepository } from '../../dist/billing/invoice.js';
import { PaymentMethodService, PaymentMethodRepository } from '../../dist/billing/paymentMethod.js';
import { PaymentService, PaymentRepository } from '../../dist/billing/payment.js';
import { RefundService, RefundRepository, RefundExceedsTransactionError } from '../../dist/billing/refund.js';
import { DisputeService, DisputeRepository } from '../../dist/billing/dispute.js';
import { BillingAuthorizationError } from '../../dist/billing/rbac.js';

import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { PlatformAdminAuditService } from '../../dist/platformadmin/audit/PlatformAdminAuditService.js';
import { MySqlPlatformAdminAuditRepository } from '../../dist/platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createAdmin(role) {
  const accountService = new PlatformAdminAccountService(new MySqlPlatformAdminAuthRepository());
  const account = await accountService.createAccount('DB Test Admin', hashAdminEmail(uniqueEmail('admin')), 'password-value', role, 'BOOTSTRAP');
  return account.adminId;
}

/** Test-fixture-only helper: inserts a CONSUMED step-up grant row directly, standing in for a real PlatformAdminAuthService.assertStepUp()+consumeStepUp() flow (already covered by platformadmin's own test suite) -- this lane's tests exercise Billing's OWN FK/behavioral requirement that a refund references a genuine, consumed step-up grant, not the TOTP mechanism itself. */
async function createConsumedStepUp(adminId, scope) {
  const sessionId = randomUUID();
  const stepUpId = randomUUID();
  const now = new Date();
  await runInTransaction(async (conn) => {
    await execute(conn, `INSERT INTO platform_admin_sessions (session_id, admin_id, token_hash, realm, issued_at, expires_at, revoked_at) VALUES (?, ?, ?, 'PLATFORM_ADMIN', ?, ?, NULL)`, [
      sessionId,
      adminId,
      randomUUID().replace(/-/g, '').padEnd(64, '0'),
      now,
      new Date(now.getTime() + 3600_000),
    ]);
    await execute(
      conn,
      `INSERT INTO platform_admin_step_up_sessions (step_up_id, admin_id, session_id, scope, asserted_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [stepUpId, adminId, sessionId, scope, now, new Date(now.getTime() + 300_000), now],
    );
  });
  return stepUpId;
}

function buildServices() {
  const auditService = new PlatformAdminAuditService(new MySqlPlatformAdminAuditRepository());
  const priceBookRepository = new PriceBookRepository();
  const priceBookService = new PriceBookService(priceBookRepository, auditService);
  const quoteRepository = new QuoteRepository();
  const quoteService = new QuoteService(priceBookRepository, quoteRepository, auditService);
  const paymentRepository = new PaymentRepository();
  const paymentService = new PaymentService(paymentRepository, quoteService, auditService);
  const refundService = new RefundService(new RefundRepository(), paymentRepository, auditService);
  return {
    auditService,
    priceBookService,
    quoteService,
    planService: new PlanService(new PlanRepository()),
    subscriptionService: new SubscriptionService(new SubscriptionRepository()),
    invoiceService: new InvoiceService(new InvoiceRepository()),
    paymentMethodService: new PaymentMethodService(new PaymentMethodRepository()),
    paymentService,
    refundService,
    disputeService: new DisputeService(new DisputeRepository()),
  };
}

test('MySQL: currency and commercial market seed data is exactly USD/SAR/YER and YEMEN/GULF/GLOBAL_OTHER with the mandated default-currency mapping', async () => {
  const [[currencyRows], [marketRows]] = await Promise.all([
    getPool().query(`SELECT currency_code, enabled FROM billing_currencies ORDER BY currency_code`),
    getPool().query(`SELECT commercial_market, default_currency_code FROM billing_commercial_markets ORDER BY commercial_market`),
  ]);
  assert.deepEqual(
    currencyRows.map((r) => r.currency_code),
    ['SAR', 'USD', 'YER'],
  );
  assert.ok(currencyRows.every((r) => r.enabled === 1));
  const marketMap = Object.fromEntries(marketRows.map((r) => [r.commercial_market, r.default_currency_code]));
  assert.deepEqual(marketMap, { GLOBAL_OTHER: 'USD', GULF: 'SAR', YEMEN: 'YER' });
});

test('MySQL: EUR is not present in billing_currencies (initial three-currency scope, PCA-DEC-024)', async () => {
  const [rows] = await getPool().query(`SELECT currency_code FROM billing_currencies WHERE currency_code = 'EUR'`);
  assert.equal(rows.length, 0);
});

test('MySQL: an unresolved standard quote for a targetDeviceLimit with no PriceBook row returns REQUIRES_CUSTOM_QUOTE, never invented fallback pricing', async () => {
  const { quoteService } = buildServices();
  const resolution = await quoteService.resolveStandardQuote('GLOBAL_OTHER', 'USD', 999_000 + Math.floor(Math.random() * 1000), new Date());
  assert.equal(resolution.kind, 'REQUIRES_CUSTOM_QUOTE');
});

test('MySQL: Plan versioning creates a new version rather than mutating an existing row', async () => {
  const roles = ['APP_OWNER'];
  const { planService } = buildServices();
  const planCode = `TEST_PLAN_${randomUUID()}`;
  const base = { planCode, status: 'ACTIVE', billingCadence: 'MONTHLY', defaultParentMemberLimit: 1, defaultManagedDeviceLimit: 1, priceBookId: null };
  const v1 = await planService.createNewVersion(base, roles);
  const v2 = await planService.createNewVersion({ ...base, defaultManagedDeviceLimit: 2 }, roles);
  assert.equal(v1.planVersion, 1);
  assert.equal(v2.planVersion, 2);
  const versions = await planService.listVersions(planCode, roles);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].defaultManagedDeviceLimit, 1, 'version 1 must remain unchanged');
});

test('MySQL: at most one ACTIVE subscription per account -- a genuine DB-level constraint, not just an application check', async () => {
  const roles = ['APP_OWNER'];
  const { planService, subscriptionService } = buildServices();
  const plan = await planService.createNewVersion(
    { planCode: `SUB_PLAN_${randomUUID()}`, status: 'ACTIVE', billingCadence: 'MONTHLY', defaultParentMemberLimit: 1, defaultManagedDeviceLimit: 1, priceBookId: null },
    roles,
  );
  const accountRef = `account-${randomUUID()}`;
  const now = new Date();
  const period = { currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600_000) };

  await subscriptionService.createSubscription({ accountRef, planId: plan.planId, status: 'ACTIVE', paymentMethodId: null, ...period }, roles);
  await assert.rejects(
    () => subscriptionService.createSubscription({ accountRef, planId: plan.planId, status: 'TRIALING', paymentMethodId: null, ...period }, roles),
    DuplicateActiveSubscriptionError,
  );

  // A CANCELED subscription for the same account does NOT collide (only TRIALING/ACTIVE/PAST_DUE occupy the slot).
  await subscriptionService.cancelSubscription((await subscriptionService.getActiveForAccount(accountRef, roles)).subscriptionId, roles);
  await assert.doesNotReject(() => subscriptionService.createSubscription({ accountRef, planId: plan.planId, status: 'ACTIVE', paymentMethodId: null, ...period }, roles));
});

// ---------------------------------------------------------------------------
// migrations/0031_billing_subscription_auto_renew.sql
// ---------------------------------------------------------------------------

test('MySQL: billing_subscriptions.auto_renew has the documented schema shape -- TINYINT(1) NOT NULL DEFAULT 1', async () => {
  const [rows] = await getPool().query(
    `SELECT column_type AS column_type, is_nullable AS is_nullable, column_default AS column_default
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'billing_subscriptions' AND column_name = 'auto_renew'`,
  );
  assert.equal(rows.length, 1, 'billing_subscriptions.auto_renew must exist');
  assert.equal(rows[0].column_type, 'tinyint(1)');
  assert.equal(rows[0].is_nullable, 'NO');
  assert.equal(String(rows[0].column_default), '1');
});

test('MySQL: a newly created subscription defaults to auto_renew = 1 (opted in) with no caller input required', async () => {
  const roles = ['APP_OWNER'];
  const { planService, subscriptionService } = buildServices();
  const plan = await planService.createNewVersion(
    { planCode: `AUTORENEW_DEFAULT_PLAN_${randomUUID()}`, status: 'ACTIVE', billingCadence: 'MONTHLY', defaultParentMemberLimit: 1, defaultManagedDeviceLimit: 1, priceBookId: null },
    roles,
  );
  const accountRef = `account-${randomUUID()}`;
  const now = new Date();
  const period = { currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600_000) };
  await subscriptionService.createSubscription({ accountRef, planId: plan.planId, status: 'ACTIVE', paymentMethodId: null, ...period }, roles);
  const [rows] = await getPool().query(`SELECT auto_renew FROM billing_subscriptions WHERE account_ref = ?`, [accountRef]);
  assert.equal(rows[0].auto_renew, 1);
});

test('MySQL: SubscriptionRepository.updateAutoRenew is transactional and idempotent against a real connection -- repeat calls with the same value never error', async () => {
  const roles = ['APP_OWNER'];
  const { planService, subscriptionService } = buildServices();
  const subscriptionRepository = new SubscriptionRepository();
  const plan = await planService.createNewVersion(
    { planCode: `AUTORENEW_TOGGLE_PLAN_${randomUUID()}`, status: 'ACTIVE', billingCadence: 'MONTHLY', defaultParentMemberLimit: 1, defaultManagedDeviceLimit: 1, priceBookId: null },
    roles,
  );
  const accountRef = `account-${randomUUID()}`;
  const now = new Date();
  const period = { currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 3600_000) };
  const subscription = await subscriptionService.createSubscription({ accountRef, planId: plan.planId, status: 'ACTIVE', paymentMethodId: null, ...period }, roles);
  assert.equal(subscription.autoRenew, true, 'toDomain must map the TINYINT(1) default to a real boolean, not a truthy 1');

  await runInTransaction((conn) => subscriptionRepository.updateAutoRenew(conn, subscription.subscriptionId, false));
  await assert.doesNotReject(() => runInTransaction((conn) => subscriptionRepository.updateAutoRenew(conn, subscription.subscriptionId, false)));
  const afterCancel = await runInTransaction((conn) => subscriptionRepository.findById(conn, subscription.subscriptionId));
  assert.equal(afterCancel.autoRenew, false);

  await runInTransaction((conn) => subscriptionRepository.updateAutoRenew(conn, subscription.subscriptionId, true));
  const afterResume = await runInTransaction((conn) => subscriptionRepository.findById(conn, subscription.subscriptionId));
  assert.equal(afterResume.autoRenew, true, 'cancel/resume are symmetric -- toggling back on must work, not just off');
});

test('MySQL: Invoice totals are computed via exact integer arithmetic across multiple InvoiceLines', async () => {
  const roles = ['APP_OWNER'];
  const { invoiceService } = buildServices();
  const invoice = await invoiceService.createInvoice(
    {
      accountRef: `account-${randomUUID()}`,
      subscriptionId: null,
      currencyCode: 'USD',
      dueAt: null,
      periodStart: null,
      periodEnd: null,
      lines: [
        { description: 'Family Standard -- monthly', lineType: 'PLAN_CHARGE', amountMinor: 1234n, currencyCode: 'USD', quantity: 1, planId: null, priceBookId: null },
        { description: 'Device limit increase', lineType: 'DEVICE_LIMIT_INCREASE', amountMinor: 500n, currencyCode: 'USD', quantity: 2, planId: null, priceBookId: null },
      ],
    },
    roles,
  );
  assert.equal(invoice.total.amountMinor, 1234n + 500n * 2n);
  assert.equal(invoice.total.currencyCode, 'USD');
});

test('MySQL: full flow -- publish price, resolve quote, create attempt, confirm payment (idempotent), issue refund, build entitlement signal', async () => {
  const financeAdminId = await createAdmin('FINANCE_ADMIN');
  const actor = { adminId: financeAdminId, role: 'FINANCE_ADMIN' };
  const roles = ['FINANCE_ADMIN'];
  const { priceBookService, quoteService, paymentService, refundService, auditService } = buildServices();

  const key = { commercialMarket: 'YEMEN', currencyCode: 'YER', targetDeviceLimit: 300_000 + Math.floor(Math.random() * 10000) };
  await priceBookService.publishPrice({ ...key, amountMinor: 4200n }, actor, roles);
  const resolution = await quoteService.resolveStandardQuote(key.commercialMarket, key.currencyCode, key.targetDeviceLimit, new Date());
  assert.equal(resolution.kind, 'RESOLVED');

  const accountRef = `account-${randomUUID()}`;
  const increaseRequestRef = `req-${randomUUID()}`;
  const attempt = await paymentService.createAttemptFromSnapshot({ accountRef, invoiceId: null, increaseRequestRef, paymentMethodId: null }, resolution.snapshot);
  assert.equal(attempt.status, 'CREATED');

  // Server-side confirmation (never a client redirect) -- called twice to prove idempotency (PCA-ADD-BILL-046's discipline restated for this lane's own confirm path).
  const tx1 = await paymentService.confirmPaymentAttempt(attempt.paymentAttemptId, 'TEST_PROVIDER', `ref-${randomUUID()}`, actor);
  const tx2 = await paymentService.confirmPaymentAttempt(attempt.paymentAttemptId, 'TEST_PROVIDER', `ref-should-be-ignored`, actor);
  assert.equal(tx1.paymentTransactionId, tx2.paymentTransactionId, 'a duplicate confirm call must not create a second PaymentTransaction');

  const [txCountRows] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_payment_transactions WHERE payment_attempt_id = ?`, [attempt.paymentAttemptId]);
  assert.equal(Number(txCountRows[0].n), 1);

  // Entitlement output contract -- read-only projection, never a write.
  const signal = await paymentService.toEntitlementSignal(attempt.paymentAttemptId);
  assert.equal(signal.increaseRequestRef, increaseRequestRef);
  assert.equal(signal.amountMinor, 4200n);
  assert.equal(signal.currencyCode, 'YER');
  assert.equal(signal.paymentAttemptStatus, 'CONFIRMED');
  assert.equal(signal.paymentTransactionId, tx1.paymentTransactionId);

  // Refund: requires a genuine consumed step-up grant (constraint 29).
  const stepUpId = await createConsumedStepUp(financeAdminId, 'REFUND');
  const refund = await refundService.issueRefund(
    { paymentTransactionId: tx1.paymentTransactionId, amountMinor: 1000n, currencyCode: 'YER', reasonCode: 'REQUESTED_BY_CUSTOMER', reasonNote: 'partial refund', stepUpSessionId: stepUpId, entitlementTreatment: 'ENTITLEMENT_UNCHANGED' },
    actor,
    roles,
  );
  assert.equal(refund.amount.amountMinor, 1000n);
  assert.equal(refund.entitlementTreatment, 'ENTITLEMENT_UNCHANGED');

  // Refunding more than the remaining balance must fail cleanly.
  await assert.rejects(
    () =>
      refundService.issueRefund(
        { paymentTransactionId: tx1.paymentTransactionId, amountMinor: 4000n, currencyCode: 'YER', reasonCode: 'REQUESTED_BY_CUSTOMER', reasonNote: null, stepUpSessionId: stepUpId, entitlementTreatment: 'NOT_APPLICABLE' },
        actor,
        roles,
      ),
    RefundExceedsTransactionError,
  );

  // Audit trail: PRICE_BOOK_CHANGED, QUOTE_ISSUED (none here, standard path), PAYMENT_CONFIRMED, PAYMENT_REFUNDED all recorded for this actor.
  const events = await auditService.queryForRole(['FINANCE_ADMIN'], financeAdminId, { limit: 50 });
  const eventTypes = events.map((e) => e.eventType);
  assert.ok(eventTypes.includes('PRICE_BOOK_CHANGED'));
  assert.ok(eventTypes.includes('PAYMENT_CONFIRMED'));
  assert.ok(eventTypes.includes('PAYMENT_REFUNDED'));
  // Confirm the duplicate confirm call did NOT emit a second PAYMENT_CONFIRMED event.
  assert.equal(eventTypes.filter((t) => t === 'PAYMENT_CONFIRMED').length, 1);
});

test('MySQL RBAC: SUPPORT_ADMIN cannot view payment instruments or issue a refund; PLATFORM_ADMIN can view but not mutate a price book', async () => {
  const appOwnerId = await createAdmin('APP_OWNER');
  const actor = { adminId: appOwnerId, role: 'APP_OWNER' };
  const { priceBookService, paymentMethodService, refundService } = buildServices();

  await assert.rejects(() => paymentMethodService.listForAccount('account-x', ['SUPPORT_ADMIN']), BillingAuthorizationError);
  await assert.rejects(
    () =>
      refundService.issueRefund(
        { paymentTransactionId: 'nonexistent', amountMinor: 1n, currencyCode: 'USD', reasonCode: 'X', reasonNote: null, stepUpSessionId: 'x', entitlementTreatment: 'NOT_APPLICABLE' },
        actor,
        ['SUPPORT_ADMIN'],
      ),
    BillingAuthorizationError,
  );

  const key = { commercialMarket: 'GLOBAL_OTHER', currencyCode: 'USD', targetDeviceLimit: 800_000 + Math.floor(Math.random() * 10000) };
  await priceBookService.publishPrice({ ...key, amountMinor: 100n }, actor, ['APP_OWNER']);
  const activePrice = await priceBookService.getActiveAt(key.commercialMarket, key.currencyCode, key.targetDeviceLimit, new Date(), ['PLATFORM_ADMIN']);
  assert.ok(activePrice, 'PLATFORM_ADMIN must be able to VIEW an active price');
  await assert.rejects(() => priceBookService.publishPrice({ ...key, amountMinor: 200n }, actor, ['PLATFORM_ADMIN']), BillingAuthorizationError);
});

test.after(async () => {
  await closePool();
});
