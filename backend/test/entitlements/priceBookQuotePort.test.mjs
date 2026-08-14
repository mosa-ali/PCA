// PCA-MYKIDS-BILL-2 -- PriceBookQuotePort: the real, PriceBook-backed
// QuotePort adapter. Pure unit test via the injected `runQuery` seam (no
// real MySQL connection) against a fake PriceBookRepository-shaped object
// (only `findActiveAt` is called).
import assert from 'node:assert/strict';
import test from 'node:test';
import { PriceBookQuotePort, STANDARD_QUOTE_VALIDITY_MS } from '../../dist/entitlements/quote/PriceBookQuotePort.js';

function fakeRunQuery(fn) {
  // The fake PriceBookRepository below ignores `conn` entirely, so any
  // value (even undefined) is a valid stand-in for a real PoolConnection.
  return fn(undefined);
}

function fakeRepository(row) {
  return {
    async findActiveAt(_conn, _market, _currency, _targetDeviceLimit, _asOf) {
      return row;
    },
  };
}

test('resolves a STANDARD quote from an active PriceBook row, verbatim (no hardcoded pricing)', async () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const row = {
    priceBookId: 'pb-1',
    commercialMarket: 'GLOBAL_OTHER',
    currencyCode: 'USD',
    targetDeviceLimit: 3,
    price: { amountMinor: 899n, currencyCode: 'USD' },
    priceBookVersion: 2,
    status: 'ACTIVE',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    effectiveTo: null,
    createdByAdminId: 'admin-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  const port = new PriceBookQuotePort(fakeRepository(row), () => now, fakeRunQuery);
  const resolution = await port.resolveStandardQuote({ commercialMarket: 'GLOBAL_OTHER', currencyCode: 'USD', targetDeviceLimit: 3 });

  assert.equal(resolution.kind, 'STANDARD');
  assert.equal(resolution.amountMinor, 899n);
  assert.equal(resolution.currencyCode, 'USD');
  assert.equal(resolution.priceBookVersion, 2);
  assert.equal(resolution.targetDeviceLimit, 3);
  assert.equal(resolution.quoteId, 'price-book:pb-1');
  assert.equal(resolution.expiresAt.getTime(), now.getTime() + STANDARD_QUOTE_VALIDITY_MS);
});

test('no active PriceBook row => REQUIRES_CUSTOM_QUOTE, never a fallback/derived price', async () => {
  const port = new PriceBookQuotePort(fakeRepository(null), () => new Date(), fakeRunQuery);
  const resolution = await port.resolveStandardQuote({ commercialMarket: 'GLOBAL_OTHER', currencyCode: 'USD', targetDeviceLimit: 9 });
  assert.deepEqual(resolution, { kind: 'REQUIRES_CUSTOM_QUOTE' });
});

test('an invalid commercial market never throws, always REQUIRES_CUSTOM_QUOTE', async () => {
  const port = new PriceBookQuotePort(fakeRepository({ priceBookId: 'pb-x' }), () => new Date(), fakeRunQuery);
  const resolution = await port.resolveStandardQuote({ commercialMarket: 'MARS', currencyCode: 'USD', targetDeviceLimit: 3 });
  assert.deepEqual(resolution, { kind: 'REQUIRES_CUSTOM_QUOTE' });
});

test('EUR (explicitly out of scope) never resolves a standard quote', async () => {
  const port = new PriceBookQuotePort(fakeRepository({ priceBookId: 'pb-x' }), () => new Date(), fakeRunQuery);
  const resolution = await port.resolveStandardQuote({ commercialMarket: 'GLOBAL_OTHER', currencyCode: 'EUR', targetDeviceLimit: 3 });
  assert.deepEqual(resolution, { kind: 'REQUIRES_CUSTOM_QUOTE' });
});

test('a non-positive or non-integer targetDeviceLimit never resolves a standard quote', async () => {
  const port = new PriceBookQuotePort(fakeRepository({ priceBookId: 'pb-x' }), () => new Date(), fakeRunQuery);
  assert.deepEqual(await port.resolveStandardQuote({ commercialMarket: 'GLOBAL_OTHER', currencyCode: 'USD', targetDeviceLimit: 0 }), { kind: 'REQUIRES_CUSTOM_QUOTE' });
  assert.deepEqual(await port.resolveStandardQuote({ commercialMarket: 'GLOBAL_OTHER', currencyCode: 'USD', targetDeviceLimit: 1.5 }), { kind: 'REQUIRES_CUSTOM_QUOTE' });
});
