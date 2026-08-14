// PCA-BILL-2A -- quoteBridge.ts: entitlements QuoteSnapshot -> billing-core
// PriceSnapshot bridging. Pure function, no DB.
import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeEntitlementQuoteToPriceSnapshot, UnbridgeableQuoteError } from '../../dist/billing/checkout/quoteBridge.js';

function baseRequest(overrides = {}) {
  return {
    requestId: 'req-1',
    familyId: 'family-1',
    limitType: 'DEVICE',
    currentLimitAtRequest: 3,
    targetLimit: 5,
    state: 'QUOTED',
    awaitingAdminQuote: false,
    noChargeOverride: false,
    quote: null,
    decidedByAdminId: null,
    decisionReason: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

test('throws UnbridgeableQuoteError when the request has no attached quote', () => {
  const request = baseRequest({ quote: null });
  assert.throws(() => bridgeEntitlementQuoteToPriceSnapshot(request), UnbridgeableQuoteError);
});

test('throws UnbridgeableQuoteError for an unsupported currency, never silently substitutes', () => {
  const request = baseRequest({
    quote: {
      quoteKind: 'STANDARD',
      quoteRef: 'quote-1',
      amountMinor: 1000n,
      currencyCode: 'EUR',
      priceBookVersion: 1,
      quotedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  assert.throws(() => bridgeEntitlementQuoteToPriceSnapshot(request), UnbridgeableQuoteError);
});

test('maps quoteId and priceBookId to null regardless of quoteKind, and carries amount/currency/version/timestamps through exactly', () => {
  const quotedAt = new Date('2026-02-01T00:00:00Z');
  const expiresAt = new Date('2026-02-01T01:00:00Z');
  const request = baseRequest({
    targetLimit: 7,
    quote: {
      quoteKind: 'CUSTOM',
      quoteRef: 'custom-quote:abc',
      amountMinor: 2599n,
      currencyCode: 'USD',
      priceBookVersion: 3,
      quotedAt,
      expiresAt,
    },
  });
  const snapshot = bridgeEntitlementQuoteToPriceSnapshot(request);
  assert.equal(snapshot.quoteId, null);
  assert.equal(snapshot.priceBookId, null);
  assert.equal(snapshot.priceBookVersion, 3);
  assert.equal(snapshot.targetDeviceLimit, 7);
  assert.equal(snapshot.price.amountMinor, 2599n);
  assert.equal(snapshot.price.currencyCode, 'USD');
  assert.equal(snapshot.quotedAt, quotedAt);
  assert.equal(snapshot.expiresAt, expiresAt);
});

test('a STANDARD quoteKind is bridged identically to CUSTOM (quoteId always null -- this bridge never fabricates a billing_quotes row)', () => {
  const request = baseRequest({
    quote: {
      quoteKind: 'STANDARD',
      quoteRef: 'standard-quote-ref',
      amountMinor: 500n,
      currencyCode: 'SAR',
      priceBookVersion: null,
      quotedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const snapshot = bridgeEntitlementQuoteToPriceSnapshot(request);
  assert.equal(snapshot.quoteId, null);
  assert.equal(snapshot.priceBookId, null);
  assert.equal(snapshot.priceBookVersion, null);
});
