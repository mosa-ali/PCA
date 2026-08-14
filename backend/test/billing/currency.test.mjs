import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPPORTED_CURRENCIES, isSupportedCurrency, getCurrencyMetadata, listCurrencyMetadata, UnsupportedCurrencyError } from '../../dist/billing/currency.js';

test('initial supported currencies are exactly USD, SAR, YER', () => {
  assert.deepEqual([...SUPPORTED_CURRENCIES].sort(), ['SAR', 'USD', 'YER']);
});

test('EUR is explicitly not supported (PCA-DEC-024 supersedes the earlier four-currency draft)', () => {
  assert.equal(isSupportedCurrency('EUR'), false);
  assert.throws(() => getCurrencyMetadata('EUR'), UnsupportedCurrencyError);
});

test('every supported currency has a centrally defined minor-unit exponent', () => {
  for (const code of SUPPORTED_CURRENCIES) {
    const meta = getCurrencyMetadata(code);
    assert.equal(meta.currencyCode, code);
    assert.equal(typeof meta.minorUnitExponent, 'number');
    assert.equal(meta.enabled, true);
  }
});

test('listCurrencyMetadata returns all three, and only those three', () => {
  const list = listCurrencyMetadata();
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((m) => m.currencyCode).sort(), ['SAR', 'USD', 'YER']);
});

test('an unknown currency code is rejected, never silently defaulted', () => {
  assert.equal(isSupportedCurrency('XYZ'), false);
  assert.throws(() => getCurrencyMetadata('XYZ'));
});
