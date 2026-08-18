import assert from 'node:assert/strict';
import test from 'node:test';
import { FreeAccessAcquisitionPolicy } from '../../../dist/parentaccount/freeaccess/FreeAccessAcquisitionPolicy.js';
import { FreeAccessEnforcementError } from '../../../dist/parentaccount/freeaccess/types.js';

const NOW = new Date('2026-08-18T00:00:00.000Z');
const EXPIRED = {
  mode: 'TIME_LIMITED',
  durationDays: 30,
  startedAt: new Date('2026-07-01T00:00:00.000Z'),
  expiresAt: new Date('2026-08-01T00:00:00.000Z'),
  defaultParentMemberLimit: 4,
  defaultManagedDeviceLimit: 5,
};

function policyFor(snapshot, commercialAccessAmount = 0) {
  const accountRepository = {
    findByFamilyId: async () => (snapshot ? { accountId: 'account-a', status: 'VERIFIED', disabledAt: null, freeAccess: snapshot } : null),
  };
  const grantRepository = {
    sumActiveAmount: async (_conn, _familyId, entitlementType) => (entitlementType === 'COMMERCIAL_ACCESS' ? commercialAccessAmount : 0),
  };
  return new FreeAccessAcquisitionPolicy(accountRepository, grantRepository, async (fn) => fn({}));
}

test('expired FREE_ACCESS is enforced at the acquisition policy boundary', async () => {
  await assert.rejects(() => policyFor(EXPIRED).assertAllowed('family-a', NOW), (error) => {
    assert.ok(error instanceof FreeAccessEnforcementError);
    assert.equal(error.code, 'FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED');
    return true;
  });
});

test('active and perpetual FREE_ACCESS remain allowed', async () => {
  const active = { ...EXPIRED, expiresAt: new Date('2026-09-01T00:00:00.000Z') };
  await policyFor(active).assertAllowed('family-a', NOW);
  await policyFor({ ...EXPIRED, mode: 'PERPETUAL', expiresAt: null, durationDays: null }).assertAllowed('family-a', NOW);
});

test('active complimentary COMMERCIAL_ACCESS overrides an expired FREE_ACCESS snapshot', async () => {
  await policyFor(EXPIRED, 1).assertAllowed('family-a', NOW);
});

test('legacy families without a parent FREE_ACCESS snapshot remain compatible', async () => {
  await policyFor(null).assertAllowed('legacy-family', NOW);
});
