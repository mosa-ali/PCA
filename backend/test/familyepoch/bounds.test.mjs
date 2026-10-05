import assert from 'node:assert/strict';
import test from 'node:test';
import { familyEpochFromStorage, isFamilyEpochNumber, MAX_FAMILY_EPOCH } from '../../dist/familyepoch/bounds.js';

test('family epoch numeric domain includes zero through INT32_MAX exactly', () => {
  assert.equal(isFamilyEpochNumber(0), true);
  assert.equal(isFamilyEpochNumber(1), true);
  assert.equal(isFamilyEpochNumber(MAX_FAMILY_EPOCH), true);
  assert.equal(isFamilyEpochNumber(MAX_FAMILY_EPOCH + 1), false);
  assert.equal(isFamilyEpochNumber(-1), false);
  assert.equal(isFamilyEpochNumber(1.5), false);
  assert.equal(isFamilyEpochNumber(Number.NaN), false);
  assert.equal(isFamilyEpochNumber(Number.POSITIVE_INFINITY), false);
  assert.equal(isFamilyEpochNumber('1'), false);
  assert.equal(isFamilyEpochNumber(MAX_FAMILY_EPOCH, 1), true);
  assert.equal(isFamilyEpochNumber(0, 1), false);
});

test('database epoch values are converted exactly and rejected when malformed or out of range', () => {
  assert.equal(familyEpochFromStorage(0), 0);
  assert.equal(familyEpochFromStorage(MAX_FAMILY_EPOCH), MAX_FAMILY_EPOCH);
  assert.equal(familyEpochFromStorage('1'), 1);
  assert.equal(familyEpochFromStorage('2147483647'), MAX_FAMILY_EPOCH);
  assert.equal(familyEpochFromStorage(2147483647n), MAX_FAMILY_EPOCH);
  for (const invalid of [MAX_FAMILY_EPOCH + 1, '2147483648', 2147483648n, '1.0', '01', 1.5, Number.NaN]) {
    assert.throws(() => familyEpochFromStorage(invalid));
  }
});
