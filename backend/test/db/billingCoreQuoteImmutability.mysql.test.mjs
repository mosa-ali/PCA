// Constraint 12 (`PCA-ADD-BILL-043`): once a Quote/PriceBook lookup is used
// to create a PaymentAttempt, its targetDeviceLimit/amountMinor/
// currencyCode/priceBookVersion snapshot MUST remain immutable for that
// payment, unaffected by later PriceBook edits or Quote supersession. This
// is the direct DB/service regression test the mission requires.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool, runInTransaction } from '../../dist/db/pool.js';
import { PriceBookService, PriceBookRepository } from '../../dist/billing/priceBook.js';
import { QuoteService, QuoteRepository, QuoteExpiredError, DEFAULT_QUOTE_VALIDITY_MS } from '../../dist/billing/quote.js';
import { PaymentService, PaymentRepository } from '../../dist/billing/payment.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { PlatformAdminAuditService } from '../../dist/platformadmin/audit/PlatformAdminAuditService.js';
import { MySqlPlatformAdminAuditRepository } from '../../dist/platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createAdmin(role = 'FINANCE_ADMIN') {
  const accountService = new PlatformAdminAccountService(new MySqlPlatformAdminAuthRepository());
  const account = await accountService.createAccount('DB Test Admin', hashAdminEmail(uniqueEmail('admin')), 'password-value', role, 'BOOTSTRAP');
  return account.adminId;
}

function buildServices() {
  const auditService = new PlatformAdminAuditService(new MySqlPlatformAdminAuditRepository());
  const priceBookRepository = new PriceBookRepository();
  const priceBookService = new PriceBookService(priceBookRepository, auditService);
  const quoteRepository = new QuoteRepository();
  const quoteService = new QuoteService(priceBookRepository, quoteRepository, auditService);
  const paymentService = new PaymentService(new PaymentRepository(), quoteService, auditService);
  return { priceBookService, quoteService, paymentService };
}

test('MySQL REGRESSION: a PaymentAttempt created from a standard PriceBook quote is unaffected by a LATER PriceBook price change', async () => {
  const adminId = await createAdmin();
  const actor = { adminId, role: 'FINANCE_ADMIN' };
  const roles = ['FINANCE_ADMIN'];
  const { priceBookService, quoteService, paymentService } = buildServices();

  const key = { commercialMarket: 'GULF', currencyCode: 'SAR', targetDeviceLimit: 700 + Math.floor(Math.random() * 100000) };
  const v1 = await priceBookService.publishPrice({ ...key, amountMinor: 5000n }, actor, roles);

  const resolution = await quoteService.resolveStandardQuote(key.commercialMarket, key.currencyCode, key.targetDeviceLimit, new Date());
  assert.equal(resolution.kind, 'RESOLVED');
  assert.equal(resolution.snapshot.price.amountMinor, 5000n);
  assert.equal(resolution.snapshot.priceBookVersion, v1.priceBookVersion);

  const attempt = await paymentService.createAttemptFromSnapshot(
    { accountRef: `account-${randomUUID()}`, invoiceId: null, increaseRequestRef: `req-${randomUUID()}`, paymentMethodId: null },
    resolution.snapshot,
  );
  assert.equal(attempt.price.amountMinor, 5000n);
  assert.equal(attempt.priceBookVersion, v1.priceBookVersion);

  // The App Owner now changes the price for the SAME commercial key.
  const v2 = await priceBookService.publishPrice({ ...key, amountMinor: 9999n }, actor, roles);
  assert.notEqual(v2.priceBookVersion, v1.priceBookVersion);

  // Re-read the ALREADY-CREATED attempt: it must be untouched.
  const rereadAttempt = await paymentService.getAttempt(attempt.paymentAttemptId, roles);
  assert.equal(rereadAttempt.price.amountMinor, 5000n, 'attempt amount must remain the snapshotted 5000, never the new 9999');
  assert.equal(rereadAttempt.priceBookVersion, v1.priceBookVersion, 'attempt must remain pinned to the original price book version');

  // A NEW standard-quote resolution after the price change reflects the new price -- proving the old attempt's immutability is a real snapshot, not a stale cache artifact of an unrelated bug.
  const newResolution = await quoteService.resolveStandardQuote(key.commercialMarket, key.currencyCode, key.targetDeviceLimit, new Date());
  assert.equal(newResolution.snapshot.price.amountMinor, 9999n);
});

test('MySQL REGRESSION: a PaymentAttempt created from a custom Quote is unaffected by the Quote later expiring/being superseded', async () => {
  const adminId = await createAdmin();
  const actor = { adminId, role: 'FINANCE_ADMIN' };
  const roles = ['FINANCE_ADMIN'];
  const { quoteService, paymentService } = buildServices();

  const quote = await quoteService.issueCustomQuote(
    {
      increaseRequestRef: `req-${randomUUID()}`,
      commercialMarket: 'YEMEN',
      targetDeviceLimit: 42,
      amountMinor: 7777n,
      currencyCode: 'YER',
      expiresAt: new Date(Date.now() + DEFAULT_QUOTE_VALIDITY_MS),
    },
    actor,
    roles,
  );

  const snapshot = await quoteService.getQuoteSnapshot(quote.quoteId);
  const attempt = await paymentService.createAttemptFromSnapshot(
    { accountRef: `account-${randomUUID()}`, invoiceId: null, increaseRequestRef: quote.increaseRequestRef, paymentMethodId: null },
    snapshot,
  );
  assert.equal(attempt.price.amountMinor, 7777n);
  assert.equal(attempt.quoteId, quote.quoteId);

  // The quote is now CONSUMED (constraint 12) -- a second attempt against the same quote must fail, never silently reuse or re-extend it.
  await assert.rejects(
    () =>
      paymentService.createAttemptFromSnapshot(
        { accountRef: `account-${randomUUID()}`, invoiceId: null, increaseRequestRef: quote.increaseRequestRef, paymentMethodId: null },
        snapshot,
      ),
    QuoteExpiredError,
  );

  // Re-read the original attempt: still pinned to its original snapshot.
  const reread = await paymentService.getAttempt(attempt.paymentAttemptId, roles);
  assert.equal(reread.price.amountMinor, 7777n);
  assert.equal(reread.quoteId, quote.quoteId);
});

test.after(async () => {
  await closePool();
});
