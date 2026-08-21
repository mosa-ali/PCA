// PCA-ADD-BILL-010: real-MySQL proof for DisputeService, previously
// imported/instantiated in other test files but never actually called
// (confirmed by a full-repo audit this session).
if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'fa'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { PaymentRepository, PaymentService } from '../../dist/billing/payment.js';
import { PriceBookRepository } from '../../dist/billing/priceBook.js';
import { QuoteRepository, QuoteService } from '../../dist/billing/quote.js';
import { money } from '../../dist/billing/money.js';
import { PlatformAdminAuditService } from '../../dist/platformadmin/audit/PlatformAdminAuditService.js';
import { MySqlPlatformAdminAuditRepository } from '../../dist/platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { DisputeService, DisputeRepository } from '../../dist/billing/dispute.js';
import { BillingAuthorizationError } from '../../dist/billing/rbac.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const priceBookRepository = new PriceBookRepository();
const quoteRepository = new QuoteRepository();
const platformAdminAuditService = new PlatformAdminAuditService(new MySqlPlatformAdminAuditRepository());
const quoteService = new QuoteService(priceBookRepository, quoteRepository, platformAdminAuditService);
const paymentRepository = new PaymentRepository();
const paymentService = new PaymentService(paymentRepository, quoteService, platformAdminAuditService);
const disputeService = new DisputeService(new DisputeRepository());

async function seedConfirmedTransaction() {
  const attempt = await paymentService.createAttemptFromSnapshot(
    { accountRef: `account-${randomUUID()}`, invoiceId: null, increaseRequestRef: null, paymentMethodId: null },
    { targetDeviceLimit: 5, price: money(1500n, 'USD'), priceBookId: null, priceBookVersion: null, quoteId: null, quotedAt: new Date(), expiresAt: null },
  );
  const transaction = await paymentService.confirmPaymentAttempt(attempt.paymentAttemptId, 'test-provider', `ref-${randomUUID()}`, { adminId: null, role: null }, new Date());
  return transaction.paymentTransactionId;
}

test('MySQL: openDispute is FINANCE_ADMIN/APP_OWNER only', async () => {
  const paymentTransactionId = await seedConfirmedTransaction();
  await assert.rejects(
    () => disputeService.openDispute(paymentTransactionId, null, ['SUPPORT_ADMIN'], new Date()),
    (error) => error instanceof BillingAuthorizationError,
  );
  const opened = await disputeService.openDispute(paymentTransactionId, null, ['FINANCE_ADMIN'], new Date());
  assert.equal(opened.status, 'OPEN');
  assert.equal(opened.paymentTransactionId, paymentTransactionId);
});

test('MySQL: full lifecycle OPEN -> submitEvidence -> UNDER_REVIEW -> resolve WON, persisted in real MySQL', async () => {
  const paymentTransactionId = await seedConfirmedTransaction();
  const now = new Date();
  const dueAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const opened = await disputeService.openDispute(paymentTransactionId, dueAt, ['APP_OWNER'], now);
  assert.equal(opened.status, 'OPEN');
  assert.equal(opened.evidenceSubmittedAt, null);
  assert.equal(opened.evidenceDueAt.getTime(), dueAt.getTime());

  await disputeService.submitEvidence(opened.disputeId, ['FINANCE_ADMIN'], new Date());
  const underReview = await disputeService.getDispute(opened.disputeId, ['APP_OWNER']);
  assert.equal(underReview.status, 'UNDER_REVIEW');
  assert.ok(underReview.evidenceSubmittedAt);

  await disputeService.resolve(opened.disputeId, 'WON', ['APP_OWNER']);
  const resolved = await disputeService.getDispute(opened.disputeId, ['FINANCE_ADMIN']);
  assert.equal(resolved.status, 'WON');

  const [rows] = await getPool().query(`SELECT status FROM billing_disputes WHERE dispute_id = ?`, [opened.disputeId]);
  assert.equal(rows[0].status, 'WON');
});

test('MySQL: resolve to LOST is a real, distinct terminal state', async () => {
  const paymentTransactionId = await seedConfirmedTransaction();
  const opened = await disputeService.openDispute(paymentTransactionId, null, ['APP_OWNER'], new Date());
  await disputeService.resolve(opened.disputeId, 'LOST', ['APP_OWNER']);
  const resolved = await disputeService.getDispute(opened.disputeId, ['APP_OWNER']);
  assert.equal(resolved.status, 'LOST');
});

test('MySQL: getDispute is readable by AUDITOR_READ_ONLY but not by SUPPORT_ADMIN/PLATFORM_ADMIN', async () => {
  const paymentTransactionId = await seedConfirmedTransaction();
  const opened = await disputeService.openDispute(paymentTransactionId, null, ['APP_OWNER'], new Date());

  const viaAuditor = await disputeService.getDispute(opened.disputeId, ['AUDITOR_READ_ONLY']);
  assert.equal(viaAuditor.disputeId, opened.disputeId);

  await assert.rejects(
    () => disputeService.getDispute(opened.disputeId, ['SUPPORT_ADMIN']),
    (error) => error instanceof BillingAuthorizationError,
  );
  await assert.rejects(
    () => disputeService.getDispute(opened.disputeId, ['PLATFORM_ADMIN']),
    (error) => error instanceof BillingAuthorizationError,
  );
});

test('MySQL: getDispute for an unknown disputeId returns null, never throws', async () => {
  const result = await disputeService.getDispute(randomUUID(), ['APP_OWNER']);
  assert.equal(result, null);
});

test.after(async () => {
  await closePool();
});
