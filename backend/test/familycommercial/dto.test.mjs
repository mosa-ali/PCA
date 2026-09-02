// PCA-MYKIDS-BILL-2 -- familycommercial/dto.ts: wire-DTO mapping. Pure
// functions, no DB. Money must always cross as a decimal-string MoneyJson
// (never a float/bigint on the wire), and PaymentMethodSummaryJson must
// never carry anything beyond its explicit allowlist (no PAN/CVV/secret).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changeRequestToJson,
  entitlementReadModelToJson,
  invoiceToJson,
  paymentMethodToJson,
  quoteSnapshotToJson,
  subscriptionToJson,
} from '../../dist/familycommercial/dto.js';
import { money } from '../../dist/billing/money.js';

test('quoteSnapshotToJson: amountMinor crosses as an exact decimal string, never a float/bigint', () => {
  const json = quoteSnapshotToJson({
    quoteKind: 'STANDARD',
    quoteRef: 'price-book:pb-1',
    amountMinor: 999999999999n,
    currencyCode: 'USD',
    priceBookVersion: 3,
    quotedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-01-02T00:00:00Z'),
  });
  assert.equal(typeof json.price.amountMinor, 'string');
  assert.equal(json.price.amountMinor, '999999999999');
  assert.equal(json.price.currencyCode, 'USD');
  assert.equal(json.quotedAtUtc, '2026-01-01T00:00:00.000Z');
  assert.equal(json.expiresAtUtc, '2026-01-02T00:00:00.000Z');
});

test('quoteSnapshotToJson: null expiresAt (custom-quote-pending has none yet) maps to null, never a synthesized date', () => {
  const json = quoteSnapshotToJson({
    quoteKind: 'CUSTOM',
    quoteRef: 'custom-quote:abc',
    amountMinor: 100n,
    currencyCode: 'SAR',
    priceBookVersion: null,
    quotedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: null,
  });
  assert.equal(json.expiresAtUtc, null);
  assert.equal(json.priceBookVersion, null);
});

test('entitlementReadModelToJson: maps every field, and openRequests is the pendingRequestSummary projection', () => {
  const json = entitlementReadModelToJson({
    familyId: 'fam-1',
    planRef: 'FREE_STARTER',
    parentMemberLimit: 2,
    parentMemberUsed: 1,
    managedDeviceLimit: 3,
    managedDeviceActive: 2,
    managedDeviceReserved: 1,
    availableDeviceSlots: 0,
    overLimitParentMember: false,
    overLimitManagedDevice: false,
    pendingRequestSummary: [{ requestId: 'req-1', limitType: 'MANAGED_DEVICE_LIMIT', state: 'PENDING', targetLimit: 5, awaitingAdminQuote: true }],
  });
  assert.equal(json.tier, 'FREE_STARTER');
  assert.equal(json.availableDeviceSlots, 0);
  assert.equal(json.openRequests.length, 1);
  assert.equal(json.openRequests[0].requestId, 'req-1');
  assert.equal(json.openRequests[0].awaitingAdminQuote, true);
});

test('changeRequestToJson: a request with no quote maps quote to null; denialReason mirrors decisionReason', () => {
  const base = {
    requestId: 'req-2',
    limitType: 'PARENT_MEMBER_LIMIT',
    currentLimitAtRequest: 2,
    targetLimit: 3,
    state: 'DENIED',
    awaitingAdminQuote: false,
    quote: null,
    noChargeOverride: false,
    decidedByAdminId: 'admin-1',
    decisionReason: 'over free-tier cap',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };
  const json = changeRequestToJson(base);
  assert.equal(json.quote, null);
  assert.equal(json.denialReason, 'over free-tier cap');
  assert.equal(json.createdAtUtc, '2026-01-01T00:00:00.000Z');
});

test('subscriptionToJson: no active subscription -> FREE_STARTER posture, never a fabricated paid status', () => {
  const json = subscriptionToJson(null);
  assert.equal(json.status, 'FREE_STARTER');
  assert.equal(json.planId, null);
  assert.equal(json.currentPeriodEndUtc, null);
  assert.equal(json.autoRenew, false);
});

test('subscriptionToJson: an active subscription row maps status/planId/period end/autoRenew exactly (migrations/0031_billing_subscription_auto_renew.sql)', () => {
  const json = subscriptionToJson({
    subscriptionId: 'sub-1',
    accountRef: 'fam-1',
    planId: 'plan-1',
    status: 'ACTIVE',
    currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
    paymentMethodId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    canceledAt: null,
    autoRenew: true,
  });
  assert.equal(json.status, 'ACTIVE');
  assert.equal(json.planId, 'plan-1');
  assert.equal(json.currentPeriodEndUtc, '2026-02-01T00:00:00.000Z');
  assert.equal(json.autoRenew, true);
});

test('subscriptionToJson: an active subscription row with auto_renew turned off maps autoRenew=false -- passed through verbatim, never re-derived from status', () => {
  const json = subscriptionToJson({
    subscriptionId: 'sub-2',
    accountRef: 'fam-1',
    planId: 'plan-1',
    status: 'ACTIVE',
    currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
    paymentMethodId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    canceledAt: null,
    autoRenew: false,
  });
  assert.equal(json.status, 'ACTIVE');
  assert.equal(json.autoRenew, false);
});

test('invoiceToJson: exact amounts (decimal string) for both the invoice total and every line', () => {
  const invoice = {
    invoiceId: 'inv-1',
    accountRef: 'fam-1',
    subscriptionId: null,
    status: 'PAID',
    total: money(519800000000n, 'USD'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    dueAt: null,
    periodStart: new Date('2026-01-01T00:00:00Z'),
    periodEnd: new Date('2026-02-01T00:00:00Z'),
  };
  const lines = [{ invoiceLineId: 'l1', invoiceId: 'inv-1', description: 'Device limit increase', lineType: 'DEVICE_LIMIT_INCREASE', amount: money(519800000000n, 'USD'), quantity: 1 }];
  const json = invoiceToJson(invoice, lines);
  assert.equal(json.total.amountMinor, '519800000000');
  assert.equal(json.lines[0].amount.amountMinor, '519800000000');
  assert.equal(json.lines[0].lineType, 'DEVICE_LIMIT_INCREASE');
});

test('paymentMethodToJson: PRIVACY -- output is an explicit allowlist, never leaks anything beyond paymentMethodId/brand/last4/expiry/displayLabel (no PAN/CVV/secret/providerPaymentMethodRef)', () => {
  const row = {
    paymentMethodId: 'pm-1',
    accountRef: 'fam-1',
    provider: 'TEST_SANDBOX',
    providerPaymentMethodRef: 'prov-ref-should-not-leak',
    brand: 'VISA',
    displayLabel: 'Visa ending 4242',
    last4: '4242',
    expiryMonth: 12,
    expiryYear: 2030,
    status: 'ACTIVE',
    createdAt: new Date(),
  };
  const json = paymentMethodToJson(row);
  assert.deepEqual(Object.keys(json).sort(), ['brand', 'displayLabel', 'expiryMonth', 'expiryYear', 'last4', 'paymentMethodId'].sort());
  assert.equal(json.paymentMethodId, 'pm-1');
  assert.equal(json.last4, '4242');
  assert.ok(!('providerPaymentMethodRef' in json));
  assert.ok(!('provider' in json));
  assert.ok(!('accountRef' in json));
  assert.ok(!JSON.stringify(json).toLowerCase().includes('prov-ref'));
});
