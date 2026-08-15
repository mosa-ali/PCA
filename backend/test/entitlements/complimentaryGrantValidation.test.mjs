// Pure (no-DB) validation-path tests for
// backend/src/entitlements/complimentary/ComplimentaryEntitlementService.ts.
// Every case here is expected to reject SYNCHRONOUSLY (before the service
// ever opens a transaction/repository call), so `null` stands in for a
// repository/transaction runner that must never be invoked -- if any of
// these accidentally reach the repository, the test fails loudly with a
// TypeError rather than silently passing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ComplimentaryEntitlementService, ComplimentaryGrantError } from '../../dist/entitlements/complimentary/ComplimentaryEntitlementService.js';

const neverCalledRepository = new Proxy(
  {},
  {
    get() {
      throw new Error('repository must not be called for an invalid request');
    },
  },
);
const neverCalledRunTx = () => {
  throw new Error('transaction runner must not be invoked for an invalid request');
};

const service = new ComplimentaryEntitlementService(neverCalledRepository, neverCalledRunTx);

function baseRequest(overrides = {}) {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    familyId: 'family-1',
    entitlementType: 'MANAGED_DEVICE_CAPACITY',
    category: 'OTHER',
    amountOrAllowance: 1,
    effectiveFrom: now,
    expiresAt: null,
    reasonCode: 'TEST',
    internalNote: null,
    grantedByAdminId: 'admin-1',
    ...overrides,
  };
}

async function rejectsWithCode(request, code) {
  await assert.rejects(
    () => service.createGrant(baseRequest(request), new Date()),
    (err) => err instanceof ComplimentaryGrantError && err.code === code,
  );
}

test('rejects an unknown entitlementType', () => rejectsWithCode({ entitlementType: 'NOT_A_REAL_TYPE' }, 'INVALID_ENTITLEMENT_TYPE'));
test('rejects an unknown category', () => rejectsWithCode({ category: 'NOT_A_REAL_CATEGORY' }, 'INVALID_CATEGORY'));
test('rejects a negative amount', () => rejectsWithCode({ amountOrAllowance: -1 }, 'INVALID_AMOUNT'));
test('rejects a non-integer amount', () => rejectsWithCode({ amountOrAllowance: 1.5 }, 'INVALID_AMOUNT'));
test('rejects an unreasonably large amount', () => rejectsWithCode({ amountOrAllowance: 10_000_000 }, 'INVALID_AMOUNT'));
test('COMMERCIAL_ACCESS rejects any amount other than the fixed marker (1)', () => rejectsWithCode({ entitlementType: 'COMMERCIAL_ACCESS', amountOrAllowance: 2 }, 'INVALID_AMOUNT'));
test('COMMERCIAL_ACCESS accepts amount 1', async () => {
  await assert.rejects(
    () => service.createGrant(baseRequest({ entitlementType: 'COMMERCIAL_ACCESS', amountOrAllowance: 1 }), new Date()),
    (err) => !(err instanceof ComplimentaryGrantError) || err.code !== 'INVALID_AMOUNT',
  );
});
test('rejects expiresAt at or before effectiveFrom', () => rejectsWithCode({ expiresAt: new Date('2026-01-01T00:00:00.000Z') }, 'INVALID_DATES'));
test('rejects an invalid effectiveFrom date', () => rejectsWithCode({ effectiveFrom: new Date('not-a-date') }, 'INVALID_DATES'));
test('rejects an empty reasonCode', () => rejectsWithCode({ reasonCode: '' }, 'INVALID_REASON_CODE'));
test('rejects an oversized reasonCode', () => rejectsWithCode({ reasonCode: 'x'.repeat(65) }, 'INVALID_REASON_CODE'));
test('rejects an oversized internalNote', () => rejectsWithCode({ internalNote: 'x'.repeat(2001) }, 'INVALID_INTERNAL_NOTE'));
test('accepts a well-formed request without touching the (never-called) repository until validation passes', async () => {
  // This call still hits neverCalledRunTx AFTER validation passes -- proving
  // validation ran first (a TypeError/thrown-Error from the stub, not a
  // ComplimentaryGrantError, confirms the request was well-formed).
  await assert.rejects(() => service.createGrant(baseRequest(), new Date()), /transaction runner must not be invoked/);
});
