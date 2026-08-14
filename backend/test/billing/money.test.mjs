import assert from 'node:assert/strict';
import test from 'node:test';
import {
  money,
  addMoney,
  subtractMoney,
  multiplyMoneyByQuantity,
  sumMoney,
  isZeroMoney,
  compareMoney,
  moneyToJson,
  moneyFromJson,
  sqlAmountMinorToBigInt,
  bigIntToSqlParam,
  CurrencyMismatchError,
  InvalidMoneyError,
} from '../../dist/billing/money.js';

test('money() constructs an exact bigint amount with a validated currency', () => {
  const m = money(1234n, 'USD');
  assert.equal(m.amountMinor, 1234n);
  assert.equal(typeof m.amountMinor, 'bigint');
  assert.equal(m.currencyCode, 'USD');
});

test('money() rejects a non-bigint amountMinor (never a float)', () => {
  assert.throws(() => money(1234, 'USD'), InvalidMoneyError);
  assert.throws(() => money(12.5, 'USD'), InvalidMoneyError);
});

test('money() rejects a negative amount', () => {
  assert.throws(() => money(-1n, 'USD'), InvalidMoneyError);
});

test('money() rejects EUR and any unsupported currency', () => {
  assert.throws(() => money(100n, 'EUR'));
  assert.throws(() => money(100n, 'GBP'));
});

test('addMoney/subtractMoney require matching currency', () => {
  const usd = money(100n, 'USD');
  const sar = money(100n, 'SAR');
  assert.throws(() => addMoney(usd, sar), CurrencyMismatchError);
  assert.throws(() => subtractMoney(usd, sar), CurrencyMismatchError);
});

test('addMoney/subtractMoney are exact', () => {
  const a = money(1_000_000_000_000n, 'USD');
  const b = money(1n, 'USD');
  assert.equal(addMoney(a, b).amountMinor, 1_000_000_000_001n);
  assert.equal(subtractMoney(a, b).amountMinor, 999_999_999_999n);
});

test('subtractMoney refuses to go negative', () => {
  assert.throws(() => subtractMoney(money(1n, 'USD'), money(2n, 'USD')), InvalidMoneyError);
});

test('multiplyMoneyByQuantity is exact integer multiplication, never float', () => {
  const unit = money(333n, 'USD');
  assert.equal(multiplyMoneyByQuantity(unit, 3).amountMinor, 999n);
  assert.throws(() => multiplyMoneyByQuantity(unit, 1.5));
  assert.throws(() => multiplyMoneyByQuantity(unit, -1));
});

test('sumMoney sums a list exactly', () => {
  const items = [money(1n, 'USD'), money(2n, 'USD'), money(3n, 'USD')];
  assert.equal(sumMoney(items, 'USD').amountMinor, 6n);
});

test('isZeroMoney / compareMoney', () => {
  assert.equal(isZeroMoney(money(0n, 'USD')), true);
  assert.equal(isZeroMoney(money(1n, 'USD')), false);
  assert.equal(compareMoney(money(1n, 'USD'), money(2n, 'USD')), -1);
  assert.equal(compareMoney(money(2n, 'USD'), money(1n, 'USD')), 1);
  assert.equal(compareMoney(money(2n, 'USD'), money(2n, 'USD')), 0);
});

test('a LARGE bigint amount (beyond Number.MAX_SAFE_INTEGER) survives arithmetic exactly', () => {
  const huge = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2 -- not exactly representable as a JS number
  const a = money(huge, 'USD');
  const b = money(1n, 'USD');
  const sum = addMoney(a, b);
  assert.equal(sum.amountMinor, 9_007_199_254_740_994n);
  assert.notEqual(Number(sum.amountMinor), Number(sum.amountMinor - 1n), 'sanity: bigints are distinct at this magnitude even though doubles would collide');
});

test('moneyToJson serializes amountMinor as a decimal string, never a JS number, and round-trips a large bigint exactly', () => {
  const huge = money(123456789012345678901234567890n, 'USD');
  const json = moneyToJson(huge);
  assert.equal(typeof json.amountMinor, 'string');
  assert.equal(json.amountMinor, '123456789012345678901234567890');
  assert.doesNotThrow(() => JSON.stringify(json));
  const roundTripped = moneyFromJson(JSON.parse(JSON.stringify(json)));
  assert.equal(roundTripped.amountMinor, huge.amountMinor);
});

test('JSON.stringify on a raw object containing a bigint throws -- proving moneyToJson is load-bearing, not incidental', () => {
  assert.throws(() => JSON.stringify({ amountMinor: 10n }), TypeError);
});

test('moneyFromJson rejects a non-integer-string amount (no silent Number() coercion)', () => {
  assert.throws(() => moneyFromJson({ amountMinor: '12.5', currencyCode: 'USD' }));
  assert.throws(() => moneyFromJson({ amountMinor: 'abc', currencyCode: 'USD' }));
  assert.throws(() => moneyFromJson({ amountMinor: 12, currencyCode: 'USD' }));
});

test('sqlAmountMinorToBigInt handles both mysql2 number and string return shapes identically', () => {
  assert.equal(sqlAmountMinorToBigInt(42), 42n);
  assert.equal(sqlAmountMinorToBigInt('42'), 42n);
  assert.equal(sqlAmountMinorToBigInt('99999999999999999999'), 99999999999999999999n);
});

test('bigIntToSqlParam produces the exact decimal string to bind', () => {
  assert.equal(bigIntToSqlParam(123456789012345678901234567890n), '123456789012345678901234567890');
});
