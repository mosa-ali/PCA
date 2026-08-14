import assert from 'node:assert/strict';
import test from 'node:test';
import { dateToJson, moneyOrNullToJson, bigintAmountToJson } from '../../../dist/platformadmin/api/dto.js';
import { money } from '../../../dist/billing/money.js';

test('dateToJson converts a Date to an ISO string and passes null/undefined through', () => {
  const d = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(dateToJson(d), '2026-01-01T00:00:00.000Z');
  assert.equal(dateToJson(null), null);
  assert.equal(dateToJson(undefined), null);
});

test('moneyOrNullToJson never emits a JS number for amountMinor -- always a decimal string', () => {
  const m = money(12345n, 'USD');
  const json = moneyOrNullToJson(m);
  assert.equal(typeof json.amountMinor, 'string');
  assert.equal(json.amountMinor, '12345');
  assert.equal(json.currencyCode, 'USD');
  assert.equal(moneyOrNullToJson(null), null);
});

test('bigintAmountToJson converts bigint to decimal string, never throws on JSON.stringify afterwards', () => {
  const asString = bigintAmountToJson(9007199254740993n); // > Number.MAX_SAFE_INTEGER, would lose precision as a JS number
  assert.equal(asString, '9007199254740993');
  assert.doesNotThrow(() => JSON.stringify({ amountMinor: asString }));
  assert.equal(bigintAmountToJson(null), null);
});
