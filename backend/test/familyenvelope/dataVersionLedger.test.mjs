import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryDataVersionLedger } from '../../dist/familyenvelope/InMemoryDataVersionLedger.js';

test('getLastAcceptedVersion is null before anything is recorded', async () => {
  const ledger = new InMemoryDataVersionLedger();
  assert.equal(await ledger.getLastAcceptedVersion('family-1', 'key-1'), null);
});

test('recordAcceptedVersion then getLastAcceptedVersion reflects it', async () => {
  const ledger = new InMemoryDataVersionLedger();
  await ledger.recordAcceptedVersion('family-1', 'key-1', '1.0.0');
  assert.equal(await ledger.getLastAcceptedVersion('family-1', 'key-1'), '1.0.0');
});

test('recordAcceptedVersion unconditionally sets the value -- it does NOT enforce a max-only/forward-only floor itself', async () => {
  // The ledger trusts its caller (FamilyEnvelopeVerifier.evaluateEnvelope)
  // to invoke this only on full acceptance, which already enforces
  // monotonicity for POLICY_UPDATE before this is ever called. A
  // SIGNED_ROLLBACK's whole purpose is to move the floor DOWN to an
  // authorized target version -- a ledger that silently refused to
  // record a lower value would defeat that.
  const ledger = new InMemoryDataVersionLedger();
  await ledger.recordAcceptedVersion('family-1', 'key-1', '5.0.0');
  await ledger.recordAcceptedVersion('family-1', 'key-1', '3.0.0');
  assert.equal(await ledger.getLastAcceptedVersion('family-1', 'key-1'), '3.0.0');
});

test('versions are scoped per sender key', async () => {
  const ledger = new InMemoryDataVersionLedger();
  await ledger.recordAcceptedVersion('family-1', 'key-1', '5.0.0');
  assert.equal(await ledger.getLastAcceptedVersion('family-1', 'key-2'), null);
});

test('PCA-17C: versions are scoped per family -- the SAME senderKeyId in a DIFFERENT family never collides', async () => {
  const ledger = new InMemoryDataVersionLedger();
  await ledger.recordAcceptedVersion('family-A', 'key-shared', '5.0.0');
  assert.equal(
    await ledger.getLastAcceptedVersion('family-B', 'key-shared'),
    null,
    'family B must never see family A\'s version floor for the identical senderKeyId',
  );
  await ledger.recordAcceptedVersion('family-B', 'key-shared', '1.0.0');
  assert.equal(await ledger.getLastAcceptedVersion('family-A', 'key-shared'), '5.0.0', 'family A\'s floor must be unaffected by family B\'s independent write');
  assert.equal(await ledger.getLastAcceptedVersion('family-B', 'key-shared'), '1.0.0');
});
