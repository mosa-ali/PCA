// Synchronous, pre-DB-call input validation for the Billing Core services.
// Every assertion here throws BEFORE any repository/DB call is reached, so
// a repository stub that throws if actually invoked proves the validation
// short-circuits correctly without needing a live database.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PriceBookService } from '../../dist/billing/priceBook.js';
import { QuoteService } from '../../dist/billing/quote.js';
import { RefundService } from '../../dist/billing/refund.js';

function neverCalledRepo(methodNames) {
  const repo = {};
  for (const name of methodNames) {
    repo[name] = () => {
      throw new Error(`${name} should not have been called -- validation should have short-circuited first.`);
    };
  }
  return repo;
}

const neverCalledAudit = { record: async () => { throw new Error('audit.record should not have been called.'); } };
const actor = { adminId: 'admin-1', role: 'APP_OWNER' };
const roles = ['APP_OWNER'];

test('PriceBookService.publishPrice rejects an invalid commercial market before touching the DB', async () => {
  const service = new PriceBookService(neverCalledRepo(['publishWithinTransaction']), neverCalledAudit);
  await assert.rejects(() =>
    service.publishPrice({ commercialMarket: 'MARS', currencyCode: 'USD', targetDeviceLimit: 2, amountMinor: 100n }, actor, roles),
  );
});

test('PriceBookService.publishPrice rejects an unsupported currency (e.g. EUR) before touching the DB', async () => {
  const service = new PriceBookService(neverCalledRepo(['publishWithinTransaction']), neverCalledAudit);
  await assert.rejects(() =>
    service.publishPrice({ commercialMarket: 'GULF', currencyCode: 'EUR', targetDeviceLimit: 2, amountMinor: 100n }, actor, roles),
  );
});

test('PriceBookService.publishPrice rejects a non-positive targetDeviceLimit', async () => {
  const service = new PriceBookService(neverCalledRepo(['publishWithinTransaction']), neverCalledAudit);
  await assert.rejects(() =>
    service.publishPrice({ commercialMarket: 'GULF', currencyCode: 'SAR', targetDeviceLimit: 0, amountMinor: 100n }, actor, roles),
  );
});

test('PriceBookService.publishPrice enforces RBAC before touching the DB', async () => {
  const service = new PriceBookService(neverCalledRepo(['publishWithinTransaction']), neverCalledAudit);
  await assert.rejects(() =>
    service.publishPrice({ commercialMarket: 'GULF', currencyCode: 'SAR', targetDeviceLimit: 2, amountMinor: 100n }, actor, ['SUPPORT_ADMIN']),
  );
});

test('QuoteService.issueCustomQuote enforces RBAC before touching the DB', async () => {
  const service = new QuoteService(neverCalledRepo(['findActiveAt']), neverCalledRepo(['insert']), neverCalledAudit);
  await assert.rejects(() =>
    service.issueCustomQuote(
      { increaseRequestRef: null, commercialMarket: 'YEMEN', targetDeviceLimit: 5, amountMinor: 100n, currencyCode: 'YER', expiresAt: new Date(Date.now() + 1000) },
      actor,
      ['PLATFORM_ADMIN'],
    ),
  );
});

test('QuoteService.issueCustomQuote rejects an expiresAt in the past (constraint 11: expired quotes must not remain payable)', async () => {
  const service = new QuoteService(neverCalledRepo(['findActiveAt']), neverCalledRepo(['insert']), neverCalledAudit);
  await assert.rejects(() =>
    service.issueCustomQuote(
      { increaseRequestRef: null, commercialMarket: 'YEMEN', targetDeviceLimit: 5, amountMinor: 100n, currencyCode: 'YER', expiresAt: new Date(Date.now() - 1000) },
      actor,
      roles,
    ),
  );
});

test('RefundService.issueRefund enforces RBAC before touching the DB', async () => {
  const service = new RefundService(neverCalledRepo(['insert']), neverCalledRepo(['findTransactionById']), neverCalledAudit);
  await assert.rejects(() =>
    service.issueRefund(
      { paymentTransactionId: 'tx-1', amountMinor: 100n, currencyCode: 'USD', reasonCode: 'REQUESTED_BY_CUSTOMER', reasonNote: null, stepUpSessionId: 'step-1', entitlementTreatment: 'NOT_APPLICABLE' },
      actor,
      ['SUPPORT_ADMIN'],
    ),
  );
});

test('RefundService.issueRefund rejects a non-positive amountMinor before touching the DB', async () => {
  const service = new RefundService(neverCalledRepo(['insert']), neverCalledRepo(['findTransactionById']), neverCalledAudit);
  await assert.rejects(() =>
    service.issueRefund(
      { paymentTransactionId: 'tx-1', amountMinor: 0n, currencyCode: 'USD', reasonCode: 'REQUESTED_BY_CUSTOMER', reasonNote: null, stepUpSessionId: 'step-1', entitlementTreatment: 'NOT_APPLICABLE' },
      actor,
      roles,
    ),
  );
});

test('RefundService.issueRefund rejects an over-length reasonNote', async () => {
  const service = new RefundService(neverCalledRepo(['insert']), neverCalledRepo(['findTransactionById']), neverCalledAudit);
  await assert.rejects(() =>
    service.issueRefund(
      { paymentTransactionId: 'tx-1', amountMinor: 100n, currencyCode: 'USD', reasonCode: 'REQUESTED_BY_CUSTOMER', reasonNote: 'x'.repeat(256), stepUpSessionId: 'step-1', entitlementTreatment: 'NOT_APPLICABLE' },
      actor,
      roles,
    ),
  );
});
