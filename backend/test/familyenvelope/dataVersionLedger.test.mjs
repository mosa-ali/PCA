import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryDataVersionLedger } from '../../dist/familyenvelope/InMemoryDataVersionLedger.js';

test('getLastAcceptedVersion is null before anything is recorded', () => {
  const ledger = new InMemoryDataVersionLedger();
  assert.equal(ledger.getLastAcceptedVersion('key-1'), null);
});

test('recordAcceptedVersion then getLastAcceptedVersion reflects it', () => {
  const ledger = new InMemoryDataVersionLedger();
  ledger.recordAcceptedVersion('key-1', 5);
  assert.equal(ledger.getLastAcceptedVersion('key-1'), 5);
});

test('recordAcceptedVersion unconditionally sets the value -- it does NOT enforce a max-only/forward-only floor itself', () => {
  // The ledger trusts its caller (FamilyEnvelopeVerifier.evaluateEnvelope)
  // to invoke this only on full acceptance, which already enforces
  // monotonicity for ordinary messages before this is ever called. A
  // ROLLBACK's whole purpose is to move the floor DOWN to an authorized
  // target version -- a ledger that silently refused to record a lower
  // value would defeat that (see FamilyEnvelopeVerifier's ROLLBACK tests).
  const ledger = new InMemoryDataVersionLedger();
  ledger.recordAcceptedVersion('key-1', 5);
  ledger.recordAcceptedVersion('key-1', 3);
  assert.equal(ledger.getLastAcceptedVersion('key-1'), 3);
});

test('versions are scoped per sender key', () => {
  const ledger = new InMemoryDataVersionLedger();
  ledger.recordAcceptedVersion('key-1', 5);
  assert.equal(ledger.getLastAcceptedVersion('key-2'), null);
});
