// Pure (no-DB) validation-path tests for
// backend/src/entitlements/complimentary/ComplimentaryEntitlementService.ts.
// Every case here is expected to reject SYNCHRONOUSLY (before the service
// ever opens a transaction/repository call), so `null` stands in for a
// repository/transaction runner that must never be invoked -- if any of
// these accidentally reach the repository, the test fails loudly with a
// TypeError rather than silently passing.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

// ---------------------------------------------------------------------------
// Production wiring: complimentary capacity was consumable but invisible.
// main.ts constructed ComplimentaryEntitlementService for the Platform
// Administration grant surface but never handed it to buildServer, so
// familyCommercialRoutes.ts's entitlement read hit its
// `if (!deps.complimentaryEntitlementService) return json;` short-circuit and
// a family holding an ACTIVE grant was shown the base entitlement only
// (availableDeviceSlots: 0) while enrollment genuinely honoured the grant.
// Static source checks: main.ts cannot be imported without a live database.
// ---------------------------------------------------------------------------

test('PRODUCTION WIRING: main.ts hands the SAME ComplimentaryEntitlementService instance to buildServer', async () => {
  const mainTs = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
  assert.equal(
    (mainTs.match(/new ComplimentaryEntitlementService\(/g) ?? []).length,
    1,
    'one shared instance -- never a second, independently-constructed copy',
  );
  assert.match(mainTs, /^\s*complimentaryEntitlementService,$/m, 'must be passed into the buildServer({...}) dependency object');
});

test('PRODUCTION WIRING: buildServer threads complimentaryEntitlementService into the family commercial routes', async () => {
  const buildServerTs = await readFile(new URL('../../src/http/buildServer.ts', import.meta.url), 'utf8');
  assert.match(buildServerTs, /complimentaryEntitlementService:\s*deps\.complimentaryEntitlementService/);
  const routesTs = await readFile(new URL('../../src/http/routes/familyCommercialRoutes.ts', import.meta.url), 'utf8');
  // The short-circuit itself is correct and must stay (a caller that
  // genuinely has no complimentary service must not fabricate a DTO) -- the
  // defect was only ever that production took it.
  assert.match(routesTs, /if \(!deps\.complimentaryEntitlementService\) return json;/);
});
