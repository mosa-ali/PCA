// PCA-BILL-2A-R1 correction, FIX 2: durable refund intent + recovery.
// Proves against a REAL MySQL database that a provider-confirmed refund
// ALWAYS has a durable local billing_refund_operations record, and that if
// RefundService.issueRefund fails AFTER the provider already confirmed,
// the operation is NOT lost -- it stays PROVIDER_CONFIRMED and a retry with
// the SAME idempotencyKey finalizes it WITHOUT ever calling the provider a
// second time.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool, execute, runInTransaction } from '../../dist/db/pool.js';

import { PriceBookService, PriceBookRepository } from '../../dist/billing/priceBook.js';
import { QuoteService, QuoteRepository } from '../../dist/billing/quote.js';
import { PaymentService, PaymentRepository } from '../../dist/billing/payment.js';
import { RefundService, RefundRepository } from '../../dist/billing/refund.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { PlatformAdminAuditService } from '../../dist/platformadmin/audit/PlatformAdminAuditService.js';
import { MySqlPlatformAdminAuditRepository } from '../../dist/platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { PaymentProviderRegistry } from '../../dist/billing/provider/providerRegistry.js';
import { createSandboxPaymentProvider } from '../../dist/billing/provider/sandboxProvider.js';
import { SandboxStaticSecretResolver } from '../../dist/billing/provider/secretResolver.js';
import { RefundOperationRepository, RefundOrchestrationService } from '../../dist/billing/refundOrchestration/RefundOrchestrationService.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createAdmin(role) {
  const accountService = new PlatformAdminAccountService(new MySqlPlatformAdminAuthRepository());
  const account = await accountService.createAccount('DB Test Admin', hashAdminEmail(uniqueEmail('admin')), 'password-value', role, 'BOOTSTRAP');
  return account.adminId;
}

/** Same test-fixture-only pattern as billingCore.mysql.test.mjs's createConsumedStepUp. */
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

const auditService = new PlatformAdminAuditService(new MySqlPlatformAdminAuditRepository());
const priceBookRepository = new PriceBookRepository();
const priceBookService = new PriceBookService(priceBookRepository, auditService);
const quoteRepository = new QuoteRepository();
const quoteService = new QuoteService(priceBookRepository, quoteRepository, auditService);
const paymentRepository = new PaymentRepository();
const paymentService = new PaymentService(paymentRepository, quoteService, auditService);
const refundService = new RefundService(new RefundRepository(), paymentRepository, auditService);

const sandboxProvider = createSandboxPaymentProvider(new SandboxStaticSecretResolver('refund-recovery-test-secret'), { NODE_ENV: 'test' });
const providerRegistry = new PaymentProviderRegistry();
providerRegistry.register(sandboxProvider);

const refundOperationRepository = new RefundOperationRepository();
const refundOrchestrationService = new RefundOrchestrationService(refundOperationRepository, refundService, paymentRepository, providerRegistry);

/** Creates a CONFIRMED PaymentTransaction of `amountMinor`/`currencyCode`, backed by a real sandbox provider payment (so provider.refund() has a genuine providerPaymentRef to act against). */
async function createConfirmedTransaction(amountMinor, currencyCode = 'USD') {
  const key = { commercialMarket: 'GLOBAL_OTHER', currencyCode, targetDeviceLimit: 500_000 + Math.floor(Math.random() * 100000) };
  const financeAdminId = await createAdmin('FINANCE_ADMIN');
  const actor = { adminId: financeAdminId, role: 'FINANCE_ADMIN' };
  const roles = ['FINANCE_ADMIN'];
  await priceBookService.publishPrice({ ...key, amountMinor }, actor, roles);
  const resolution = await quoteService.resolveStandardQuote(key.commercialMarket, key.currencyCode, key.targetDeviceLimit, new Date());
  assert.equal(resolution.kind, 'RESOLVED');

  const accountRef = `account-${randomUUID()}`;
  const attempt = await paymentService.createAttemptFromSnapshot({ accountRef, invoiceId: null, increaseRequestRef: null, paymentMethodId: null }, resolution.snapshot);

  const checkout = await sandboxProvider.createCheckout({ amountMinor, currencyCode, accountRef, paymentAttemptId: attempt.paymentAttemptId });
  sandboxProvider.simulateConfirm(checkout.providerCheckoutRef);
  const transaction = await paymentService.confirmPaymentAttempt(attempt.paymentAttemptId, 'TEST_SANDBOX', checkout.providerCheckoutRef, actor);

  return { transaction, financeAdminId, actor, roles, providerPaymentRef: checkout.providerCheckoutRef };
}

test('MySQL: refund orchestration -- CREATED row exists BEFORE the provider is ever called (durable intent)', async () => {
  const { transaction, financeAdminId, providerPaymentRef } = await createConfirmedTransaction(5000n, 'USD');
  const stepUpId = await createConsumedStepUp(financeAdminId, 'REFUND');
  const idempotencyKey = `refund:${randomUUID()}`;

  const claimOnly = await refundOperationRepository.claimOperation(
    { paymentTransactionId: transaction.paymentTransactionId, amountMinor: 1000n, currencyCode: 'USD', reasonCode: 'REQUESTED_BY_CUSTOMER', reasonNote: null, stepUpSessionId: stepUpId, idempotencyKey, provider: 'TEST_SANDBOX' },
    financeAdminId,
    new Date(),
  );
  assert.equal(claimOnly.isNew, true);
  assert.equal(claimOnly.operation.state, 'CREATED');

  const [rows] = await getPool().query(`SELECT state FROM billing_refund_operations WHERE refund_operation_id = ?`, [claimOnly.operation.refundOperationId]);
  assert.equal(rows[0].state, 'CREATED', 'a durable CREATED row must exist even before provider.refund is ever called');
  assert.equal(sandboxProvider.getRefundCallCountForTest(providerPaymentRef), 0);
});

test('MySQL: refund recovery -- provider confirms, RefundService.issueRefund is forced to fail, the operation stays PROVIDER_CONFIRMED (not lost), and a retry finalizes WITHOUT a second provider call', async () => {
  const { transaction, financeAdminId, actor, roles, providerPaymentRef } = await createConfirmedTransaction(5000n, 'USD');
  const stepUpId = await createConsumedStepUp(financeAdminId, 'REFUND');
  const idempotencyKey = `refund:${randomUUID()}`;

  // Force RefundService.issueRefund to fail on the FIRST attempt by
  // pre-seeding a conflicting billing_refunds row directly (bypassing the
  // orchestration layer, simulating a legacy/out-of-band refund) so that
  // issueRefund's own cumulative check (alreadyRefunded + this amount >
  // transaction total) genuinely throws RefundExceedsTransactionError --
  // a real DB-level failure condition, not a mocked one.
  const conflictingStepUp = await createConsumedStepUp(financeAdminId, 'REFUND');
  await runInTransaction((conn) =>
    execute(
      conn,
      `INSERT INTO billing_refunds (refund_id, payment_transaction_id, amount_minor, currency_code, reason_code, reason_note, initiated_by_admin_id, step_up_session_id, entitlement_treatment, status, created_at)
       VALUES (?, ?, 4500, 'USD', 'CONFLICTING_TEST_ROW', NULL, ?, ?, 'NOT_APPLICABLE', 'RECORDED', NOW(3))`,
      [randomUUID(), transaction.paymentTransactionId, financeAdminId, conflictingStepUp],
    ),
  );

  const first = await refundOrchestrationService.initiateRefund(
    { paymentTransactionId: transaction.paymentTransactionId, amountMinor: 1000n, currencyCode: 'USD', reasonCode: 'REQUESTED_BY_CUSTOMER', reasonNote: null, stepUpSessionId: stepUpId, idempotencyKey, provider: 'TEST_SANDBOX' },
    actor,
    roles,
  );
  assert.equal(first.outcome, 'PENDING_FINALIZATION', 'issueRefund must fail AFTER the provider already confirmed');
  assert.equal(first.operation.state, 'PROVIDER_CONFIRMED');
  assert.ok(first.operation.providerRefundRef, 'the provider refund ref must already be durably recorded');

  const [rowsAfterFailure] = await getPool().query(`SELECT state, provider_refund_ref FROM billing_refund_operations WHERE refund_operation_id = ?`, [first.operation.refundOperationId]);
  assert.equal(rowsAfterFailure[0].state, 'PROVIDER_CONFIRMED', 'the operation must NOT be lost -- it stays PROVIDER_CONFIRMED, durable');
  const refundCallCountAfterFirst = sandboxProvider.getRefundCallCountForTest(providerPaymentRef);
  assert.equal(refundCallCountAfterFirst, 1, 'exactly one provider.refund() call so far');

  // Correct the conflict (simulate resolving the out-of-band discrepancy) and retry with the SAME idempotencyKey.
  await getPool().query(`DELETE FROM billing_refunds WHERE reason_code = 'CONFLICTING_TEST_ROW' AND payment_transaction_id = ?`, [transaction.paymentTransactionId]);

  const second = await refundOrchestrationService.initiateRefund(
    { paymentTransactionId: transaction.paymentTransactionId, amountMinor: 1000n, currencyCode: 'USD', reasonCode: 'REQUESTED_BY_CUSTOMER', reasonNote: null, stepUpSessionId: stepUpId, idempotencyKey, provider: 'TEST_SANDBOX' },
    actor,
    roles,
  );
  assert.equal(second.outcome, 'FINALIZED');
  assert.equal(second.operation.state, 'FINALIZED');
  assert.equal(second.refund.amount.amountMinor, 1000n);

  // The provider must NEVER have been called a second time -- the retry
  // resumed directly from PROVIDER_CONFIRMED.
  assert.equal(sandboxProvider.getRefundCallCountForTest(providerPaymentRef), refundCallCountAfterFirst, 'provider.refund() must NOT be called again on retry from PROVIDER_CONFIRMED');

  const [rowsAfterRetry] = await getPool().query(`SELECT state, refund_id FROM billing_refund_operations WHERE refund_operation_id = ?`, [first.operation.refundOperationId]);
  assert.equal(rowsAfterRetry[0].state, 'FINALIZED');
  assert.equal(rowsAfterRetry[0].refund_id, second.refund.refundId);
});

test('MySQL: refund orchestration idempotency -- a duplicate idempotencyKey after FINALIZED returns the same result, never a second billing_refunds row', async () => {
  const { transaction, financeAdminId, actor, roles } = await createConfirmedTransaction(3000n, 'USD');
  const stepUpId = await createConsumedStepUp(financeAdminId, 'REFUND');
  const idempotencyKey = `refund:${randomUUID()}`;
  const input = { paymentTransactionId: transaction.paymentTransactionId, amountMinor: 500n, currencyCode: 'USD', reasonCode: 'REQUESTED_BY_CUSTOMER', reasonNote: null, stepUpSessionId: stepUpId, idempotencyKey, provider: 'TEST_SANDBOX' };

  const first = await refundOrchestrationService.initiateRefund(input, actor, roles);
  assert.equal(first.outcome, 'FINALIZED');
  const second = await refundOrchestrationService.initiateRefund(input, actor, roles);
  assert.equal(second.outcome, 'FINALIZED');
  assert.equal(second.refund.refundId, first.refund.refundId, 'the SAME billing_refunds row must be returned, never a new one');

  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_refunds WHERE payment_transaction_id = ?`, [transaction.paymentTransactionId]);
  assert.equal(Number(rows[0].n), 1);
  const [opRows] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_refund_operations WHERE idempotency_key = ?`, [idempotencyKey]);
  assert.equal(Number(opRows[0].n), 1);
});

test('MySQL: refund orchestration -- provider FAILED status is durably recorded as FAILED, RefundService.issueRefund never called', async () => {
  const { transaction, financeAdminId, actor, roles, providerPaymentRef } = await createConfirmedTransaction(2000n, 'USD');
  const stepUpId = await createConsumedStepUp(financeAdminId, 'REFUND');
  const idempotencyKey = `refund:${randomUUID()}`;

  // Force provider.refund() to report FAILED: the sandbox adapter returns
  // FAILED whenever the underlying payment state is not CONFIRMED --
  // simulate this by cancelling the sandbox payment first via a SEPARATE
  // payment/providerPaymentRef so the transaction's own confirmed state is
  // untouched, but the refund target itself has been moved out of
  // CONFIRMED (mirrors a genuine provider-side "this payment can no longer
  // be refunded" condition).
  sandboxProvider.simulateCancel(providerPaymentRef);

  const result = await refundOrchestrationService.initiateRefund(
    { paymentTransactionId: transaction.paymentTransactionId, amountMinor: 500n, currencyCode: 'USD', reasonCode: 'REQUESTED_BY_CUSTOMER', reasonNote: null, stepUpSessionId: stepUpId, idempotencyKey, provider: 'TEST_SANDBOX' },
    actor,
    roles,
  );
  assert.equal(result.outcome, 'PROVIDER_REFUND_FAILED');
  assert.equal(result.operation.state, 'FAILED');

  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM billing_refunds WHERE payment_transaction_id = ?`, [transaction.paymentTransactionId]);
  assert.equal(Number(rows[0].n), 0, 'RefundService.issueRefund must never be called for a provider-rejected refund');
});

test.after(async () => {
  await closePool();
});
