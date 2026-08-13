import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryDataVersionLedger } from '../../dist/familyenvelope/InMemoryDataVersionLedger.js';

test('getLastAcceptedVersion is null before anything is recorded', async () => {
  const ledger = new InMemoryDataVersionLedger();
  assert.equal(await ledger.getLastAcceptedVersion('family-1', 'key-1'), null);
});

test('advancePolicyVersionIfNewer records the first-ever version for a sender and reports "advanced"', async () => {
  const ledger = new InMemoryDataVersionLedger();
  const result = await ledger.advancePolicyVersionIfNewer('family-1', 'key-1', '1.0.0');
  assert.equal(result, 'advanced');
  assert.equal(await ledger.getLastAcceptedVersion('family-1', 'key-1'), '1.0.0');
});

test('advancePolicyVersionIfNewer accepts a strictly higher version and reports "advanced"', async () => {
  const ledger = new InMemoryDataVersionLedger();
  await ledger.advancePolicyVersionIfNewer('family-1', 'key-1', '1.0.0');
  const result = await ledger.advancePolicyVersionIfNewer('family-1', 'key-1', '2.0.0');
  assert.equal(result, 'advanced');
  assert.equal(await ledger.getLastAcceptedVersion('family-1', 'key-1'), '2.0.0');
});

test('advancePolicyVersionIfNewer rejects an equal version as "stale" and never perturbs the floor', async () => {
  const ledger = new InMemoryDataVersionLedger();
  await ledger.advancePolicyVersionIfNewer('family-1', 'key-1', '5.0.0');
  const result = await ledger.advancePolicyVersionIfNewer('family-1', 'key-1', '5.0.0');
  assert.equal(result, 'stale');
  assert.equal(await ledger.getLastAcceptedVersion('family-1', 'key-1'), '5.0.0');
});

test('advancePolicyVersionIfNewer rejects a lower version as "stale" and never perturbs the floor', async () => {
  const ledger = new InMemoryDataVersionLedger();
  await ledger.advancePolicyVersionIfNewer('family-1', 'key-1', '5.0.0');
  const result = await ledger.advancePolicyVersionIfNewer('family-1', 'key-1', '3.0.0');
  assert.equal(result, 'stale');
  assert.equal(await ledger.getLastAcceptedVersion('family-1', 'key-1'), '5.0.0');
});

test('recordAuthorizedRollbackVersion unconditionally sets the value -- it does NOT enforce a max-only/forward-only floor', async () => {
  // SIGNED_ROLLBACK's whole purpose is to move the floor DOWN to an
  // authorized target version -- a ledger that silently refused to record
  // a lower value on this path would defeat that.
  const ledger = new InMemoryDataVersionLedger();
  await ledger.advancePolicyVersionIfNewer('family-1', 'key-1', '5.0.0');
  await ledger.recordAuthorizedRollbackVersion('family-1', 'key-1', '3.0.0');
  assert.equal(await ledger.getLastAcceptedVersion('family-1', 'key-1'), '3.0.0');
});

test('after a rollback, an ordinary advance still requires a strict increase from the NEW (rolled-back) floor', async () => {
  const ledger = new InMemoryDataVersionLedger();
  await ledger.advancePolicyVersionIfNewer('family-1', 'key-1', '5.0.0');
  await ledger.recordAuthorizedRollbackVersion('family-1', 'key-1', '2.0.0');

  const staleAgainstOldFloor = await ledger.advancePolicyVersionIfNewer('family-1', 'key-1', '2.0.0');
  assert.equal(staleAgainstOldFloor, 'stale', 'equal to the rollback target itself is still not a strict increase');

  const intermediate = await ledger.advancePolicyVersionIfNewer('family-1', 'key-1', '3.0.0');
  assert.equal(intermediate, 'advanced', 'an intermediate version between the rollback target and the stale pre-rollback floor must be acceptable');
  assert.equal(await ledger.getLastAcceptedVersion('family-1', 'key-1'), '3.0.0');
});

test('versions are scoped per sender key', async () => {
  const ledger = new InMemoryDataVersionLedger();
  await ledger.advancePolicyVersionIfNewer('family-1', 'key-1', '5.0.0');
  assert.equal(await ledger.getLastAcceptedVersion('family-1', 'key-2'), null);
});

test('PCA-17C: versions are scoped per family -- the SAME senderKeyId in a DIFFERENT family never collides', async () => {
  const ledger = new InMemoryDataVersionLedger();
  await ledger.advancePolicyVersionIfNewer('family-A', 'key-shared', '5.0.0');
  assert.equal(
    await ledger.getLastAcceptedVersion('family-B', 'key-shared'),
    null,
    'family B must never see family A\'s version floor for the identical senderKeyId',
  );
  await ledger.advancePolicyVersionIfNewer('family-B', 'key-shared', '1.0.0');
  assert.equal(await ledger.getLastAcceptedVersion('family-A', 'key-shared'), '5.0.0', 'family A\'s floor must be unaffected by family B\'s independent write');
  assert.equal(await ledger.getLastAcceptedVersion('family-B', 'key-shared'), '1.0.0');
});
