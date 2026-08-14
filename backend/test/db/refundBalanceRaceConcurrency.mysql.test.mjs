// PCA-BILL-2A-R1 correction, FIX 3: cumulative-refund balance concurrency
// race. `RefundService.issueRefund`'s own cumulative check (refund.ts, an
// accepted PCA-BILL-1 file this lane does not edit) sums prior refunds
// inside a transaction but never locks the parent PaymentTransaction row
// first -- under this codebase's standard READ COMMITTED isolation
// (db/pool.ts), two concurrent transactions can both read the same
// "already refunded" sum before either commits, both pass the check, and
// both insert.
//
// This test proves, with TWO REAL, INDEPENDENT, CONCURRENT MySQL
// connections/transactions (via RefundOrchestrationService.initiateRefund,
// racing via Promise.all -- the exact style
// billingCoreProviderEventConcurrency.mysql.test.mjs already established
// for this codebase's other UNIQUE-constraint/row-lock concurrency proofs)
// that the arbitration this lane moved to `billing_refund_operations`
// (a `SELECT ... FOR UPDATE` lock on the EXISTING billing_payment_transactions
// row, held for the duration of the balance check + CREATED insert) DOES
// close this race: remaining refundable balance = 1000, two concurrent
// refund attempts of 700 each (combined 1400 > 1000) -- only the
// allowable one may ever reach `provider.refund`, never both.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';

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
import { execute, runInTransaction } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createAdmin(role) {
  const accountService = new PlatformAdminAccountService(new MySqlPlatformAdminAuthRepository());
  const account = await accountService.createAccount('DB Test Admin', hashAdminEmail(uniqueEmail('admin')), 'password-value', role, 'BOOTSTRAP');
  return account.adminId;
}

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

const sandboxProvider = createSandboxPaymentProvider(new SandboxStaticSecretResolver('refund-race-test-secret'), { NODE_ENV: 'test' });
const providerRegistry = new PaymentProviderRegistry();
providerRegistry.register(sandboxProvider);

const refundOperationRepository = new RefundOperationRepository();
const refundOrchestrationService = new RefundOrchestrationService(refundOperationRepository, refundService, paymentRepository, providerRegistry);

async function createConfirmedTransaction(amountMinor, currencyCode = 'USD') {
  const key = { commercialMarket: 'GLOBAL_OTHER', currencyCode, targetDeviceLimit: 700_000 + Math.floor(Math.random() * 100000) };
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

test('MySQL CONCURRENCY: two concurrent refund attempts whose combined amount exceeds the remaining refundable balance -- only the allowable one ever reaches provider.refund', async () => {
  const { transaction, financeAdminId, actor, roles, providerPaymentRef } = await createConfirmedTransaction(1000n, 'USD');
  const stepUpIdA = await createConsumedStepUp(financeAdminId, 'REFUND');
  const stepUpIdB = await createConsumedStepUp(financeAdminId, 'REFUND');

  const inputA = {
    paymentTransactionId: transaction.paymentTransactionId,
    amountMinor: 700n,
    currencyCode: 'USD',
    reasonCode: 'REQUESTED_BY_CUSTOMER',
    reasonNote: 'race-a',
    stepUpSessionId: stepUpIdA,
    idempotencyKey: `refund-race-a:${randomUUID()}`,
    provider: 'TEST_SANDBOX',
  };
  const inputB = {
    paymentTransactionId: transaction.paymentTransactionId,
    amountMinor: 700n,
    currencyCode: 'USD',
    reasonCode: 'REQUESTED_BY_CUSTOMER',
    reasonNote: 'race-b',
    stepUpSessionId: stepUpIdB,
    idempotencyKey: `refund-race-b:${randomUUID()}`,
    provider: 'TEST_SANDBOX',
  };

  // TWO independent, genuinely concurrent calls -- each internally acquires
  // its OWN pool connection/transaction (runInTransaction -> getPool().getConnection()),
  // racing against each other exactly like billingCoreProviderEventConcurrency.mysql.test.mjs's
  // Promise.all([service.record(...), service.record(...)]).
  const [resultA, resultB] = await Promise.all([
    refundOrchestrationService.initiateRefund(inputA, actor, roles),
    refundOrchestrationService.initiateRefund(inputB, actor, roles),
  ]);

  const outcomes = [resultA.outcome, resultB.outcome].sort();
  assert.deepEqual(outcomes, ['EXCEEDS_BALANCE', 'FINALIZED'], `expected exactly one FINALIZED and one EXCEEDS_BALANCE, got [${resultA.outcome}, ${resultB.outcome}]`);

  // The provider must have been called EXACTLY ONCE for this payment --
  // never both racers reaching provider.refund.
  assert.equal(sandboxProvider.getRefundCallCountForTest(providerPaymentRef), 1, 'provider.refund must be called for the allowed refund only, never for the rejected one');

  // Real DB-level proof, independent of the in-process outcome objects:
  // exactly one row in billing_refund_operations ever reached a
  // balance-consuming state (CREATED/PROVIDER_CONFIRMED/FINALIZED) for
  // this payment_transaction_id with a non-CREATED-rejected amount -- i.e.
  // the rejected racer never got an operations row inserted at all (the
  // EXCEEDS_BALANCE check happens BEFORE insert).
  const [opRows] = await getPool().query(
    `SELECT state, amount_minor FROM billing_refund_operations WHERE payment_transaction_id = ?`,
    [transaction.paymentTransactionId],
  );
  assert.equal(opRows.length, 1, 'the rejected racer must never have inserted a billing_refund_operations row at all');
  assert.equal(opRows[0].state, 'FINALIZED');
  assert.equal(Number(opRows[0].amount_minor), 700);

  const [refundRows] = await getPool().query(`SELECT COUNT(*) AS n, SUM(amount_minor) AS total FROM billing_refunds WHERE payment_transaction_id = ?`, [transaction.paymentTransactionId]);
  assert.equal(Number(refundRows[0].n), 1, 'exactly one billing_refunds row -- the DB-level invariant refund.ts alone could not guarantee under concurrency');
  assert.equal(Number(refundRows[0].total), 700);
});

test('MySQL CONCURRENCY: N=5 concurrent refund attempts of 300 each against a 1000 balance -- exactly the number that fit (3) are FINALIZED, the rest EXCEEDS_BALANCE, provider called exactly 3 times', async () => {
  const { transaction, financeAdminId, actor, roles, providerPaymentRef } = await createConfirmedTransaction(1000n, 'USD');
  const N = 5;
  const inputs = await Promise.all(
    Array.from({ length: N }, async (_, i) => ({
      paymentTransactionId: transaction.paymentTransactionId,
      amountMinor: 300n,
      currencyCode: 'USD',
      reasonCode: 'REQUESTED_BY_CUSTOMER',
      reasonNote: `race-${i}`,
      stepUpSessionId: await createConsumedStepUp(financeAdminId, 'REFUND'),
      idempotencyKey: `refund-race-n:${i}:${randomUUID()}`,
      provider: 'TEST_SANDBOX',
    })),
  );

  const results = await Promise.all(inputs.map((input) => refundOrchestrationService.initiateRefund(input, actor, roles)));
  const finalized = results.filter((r) => r.outcome === 'FINALIZED');
  const rejected = results.filter((r) => r.outcome === 'EXCEEDS_BALANCE');
  assert.equal(finalized.length, 3, `expected exactly 3 FINALIZED (3*300=900<=1000, a 4th would exceed), got ${finalized.length}`);
  assert.equal(rejected.length, N - 3);

  assert.equal(sandboxProvider.getRefundCallCountForTest(providerPaymentRef), 3, 'provider.refund must be called exactly 3 times, never once per rejected attempt');

  const [refundRows] = await getPool().query(`SELECT COUNT(*) AS n, SUM(amount_minor) AS total FROM billing_refunds WHERE payment_transaction_id = ?`, [transaction.paymentTransactionId]);
  assert.equal(Number(refundRows[0].n), 3);
  assert.equal(Number(refundRows[0].total), 900);
});

test.after(async () => {
  await closePool();
});
