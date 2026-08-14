import assert from 'node:assert/strict';
import test from 'node:test';
import { assertValidPriceBookVersion } from '../../dist/entitlements/types.js';

// PCA-PA-2-R1: priceBookVersion must match Agent44's canonical Billing
// Core representation (billing_price_books.price_book_version INT
// UNSIGNED / BillingEntitlementSignal.priceBookVersion) -- an integer
// version number, never a formatted/opaque string, never silently coerced.

test('assertValidPriceBookVersion: null is accepted (no quote/no price-book association yet)', () => {
  assert.doesNotThrow(() => assertValidPriceBookVersion(null));
});

test('assertValidPriceBookVersion: a positive integer is accepted', () => {
  assert.doesNotThrow(() => assertValidPriceBookVersion(1));
  assert.doesNotThrow(() => assertValidPriceBookVersion(42));
  assert.doesNotThrow(() => assertValidPriceBookVersion(4294967295)); // MySQL INT UNSIGNED max
});

test('assertValidPriceBookVersion: zero and negative integers are rejected (Agent44 versions start at 1)', () => {
  assert.throws(() => assertValidPriceBookVersion(0), TypeError);
  assert.throws(() => assertValidPriceBookVersion(-1), TypeError);
  assert.throws(() => assertValidPriceBookVersion(-100), TypeError);
});

test('assertValidPriceBookVersion: a value beyond MySQL INT UNSIGNED range is rejected', () => {
  assert.throws(() => assertValidPriceBookVersion(4294967296), TypeError);
});

test('assertValidPriceBookVersion: floating point is rejected, never truncated/rounded', () => {
  assert.throws(() => assertValidPriceBookVersion(1.5), TypeError);
  assert.throws(() => assertValidPriceBookVersion(2.0000001), TypeError);
});

test('assertValidPriceBookVersion: NaN and Infinity are rejected', () => {
  assert.throws(() => assertValidPriceBookVersion(Number.NaN), TypeError);
  assert.throws(() => assertValidPriceBookVersion(Number.POSITIVE_INFINITY), TypeError);
  assert.throws(() => assertValidPriceBookVersion(Number.NEGATIVE_INFINITY), TypeError);
});

test('assertValidPriceBookVersion: a numeric string is rejected, never coerced (e.g. no ad-hoc Number()/parseInt at the boundary)', () => {
  // @ts-expect-error deliberately passing a string past the TS boundary to prove the runtime guard also holds
  assert.throws(() => assertValidPriceBookVersion('1'), TypeError);
  // @ts-expect-error
  assert.throws(() => assertValidPriceBookVersion('1x'), TypeError);
});
