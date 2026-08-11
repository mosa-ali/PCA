import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptEpoch } from '../../dist/familytrustset/FamilyTrustSetEngine.js';
import { acceptRecoveryEpoch } from '../../dist/familytrustset/FamilyTrustSetRecoveryEngine.js';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { InMemoryRecoveryTransactionLedger } from '../../dist/familytrustset/RecoveryTransactionLedger.js';
import {
  createTestOnlyTrustSetSignatureVerifier,
  signTestOnlyEpoch,
} from '../support/testOnlyTrustSetSignatureVerifier.mjs';
import { createDelayedTestOnlyTrustSetSignatureVerifier } from '../support/delayedTrustSetSignatureVerifier.mjs';

function entry(overrides = {}) {
  return {
    deviceId: 'owner-device',
    role: 'OWNER',
    dskKeyId: 'owner-dsk-key',
    dskPublicKey: 'owner-dsk-pub',
    dekKeyId: 'owner-dek-key',
    dekPublicKey: 'owner-dek-pub',
    status: 'ACTIVE',
    ...overrides,
  };
}

function buildEpoch(signerPublicKey, overrides = {}) {
  const unsigned = {
    familyId: 'family-1',
    trustSetEpoch: 1,
    keyEpoch: 1,
    entries: [entry()],
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    supersedesEpoch: null,
    ...overrides,
  };
  const signature = signTestOnlyEpoch(signerPublicKey, canonicalizeTrustSetEpoch(unsigned));
  return { ...unsigned, signature };
}

function newOwnerEntry(overrides = {}) {
  return entry({
    deviceId: 'replacement-parent-device',
    dskKeyId: 'new-owner-dsk-key',
    dskPublicKey: 'new-owner-dsk-pub',
    dekKeyId: 'new-owner-dek-key',
    dekPublicKey: 'new-owner-dek-pub',
    ...overrides,
  });
}

function opened(overrides = {}) {
  return {
    familyId: 'family-1',
    recoveryEnvelopeId: 'envelope-1',
    recoveryTransactionId: 'txn-1',
    boundTrustSetEpoch: 1,
    boundKeyEpoch: 1,
    ...overrides,
  };
}

async function establishedHarness() {
  const store = new InMemoryFamilyTrustSetStore();
  const verifier = createTestOnlyTrustSetSignatureVerifier();
  const ledger = new InMemoryRecoveryTransactionLedger();
  const genesis = buildEpoch('owner-dsk-pub');
  const genesisVerdict = await acceptEpoch(genesis, store, verifier);
  assert.equal(genesisVerdict.accepted, true);
  return { store, verifier, ledger, genesis };
}

/** Builds the standard "lost owner replaced by a fresh parent" recovery epoch, signed by the new owner's own DSK. */
function buildRecoveryEpoch(overrides = {}) {
  const unsigned = {
    familyId: 'family-1',
    trustSetEpoch: 2,
    keyEpoch: 2,
    entries: [entry({ status: 'REVOKED' }), newOwnerEntry()],
    issuedAt: new Date('2026-02-01T00:00:00.000Z'),
    supersedesEpoch: 1,
    ...overrides,
  };
  const signature = signTestOnlyEpoch('new-owner-dsk-pub', canonicalizeTrustSetEpoch(unsigned));
  return { ...unsigned, signature };
}

// --- Happy path ------------------------------------------------------------

test('a valid recovery epoch is accepted: revokes the lost owner, enrolls a distinct new owner, advances both epochs', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  const recoveryEpoch = buildRecoveryEpoch();

  const verdict = await acceptRecoveryEpoch(recoveryEpoch, opened(), store, verifier, ledger);

  assert.deepEqual(verdict, { accepted: true });
  const current = store.getCurrentEpoch();
  assert.equal(current.trustSetEpoch, 2);
  assert.equal(current.keyEpoch, 2);
  assert.equal(current.entries.find((e) => e.deviceId === 'owner-device').status, 'REVOKED');
  assert.equal(current.entries.find((e) => e.deviceId === 'replacement-parent-device').status, 'ACTIVE');
});

// --- Cannot use ordinary owner path by accident -----------------------------

test('the ordinary acceptEpoch path rejects a recovery-signed epoch (INVALID_SIGNATURE) -- the two paths cannot be confused', async () => {
  const { store, verifier } = await establishedHarness();
  const recoveryEpoch = buildRecoveryEpoch();

  const verdict = await acceptEpoch(recoveryEpoch, store, verifier);

  assert.deepEqual(verdict, { accepted: false, reason: 'INVALID_SIGNATURE' });
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 1); // unchanged
});

// --- Family/envelope binding -------------------------------------------------

test('recovery against a family with no established epoch is rejected (recovery is a transition, not genesis)', async () => {
  const store = new InMemoryFamilyTrustSetStore();
  const verifier = createTestOnlyTrustSetSignatureVerifier();
  const ledger = new InMemoryRecoveryTransactionLedger();

  const verdict = await acceptRecoveryEpoch(buildRecoveryEpoch(), opened(), store, verifier, ledger);

  assert.deepEqual(verdict, { accepted: false, reason: 'NO_ESTABLISHED_FAMILY' });
});

test('a recovery epoch/envelope naming the wrong family is rejected (cross-family recovery attack)', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  const wrongFamilyOpened = opened({ familyId: 'family-OTHER' });

  const verdict = await acceptRecoveryEpoch(buildRecoveryEpoch(), wrongFamilyOpened, store, verifier, ledger);

  assert.deepEqual(verdict, { accepted: false, reason: 'FAMILY_MISMATCH' });
});

test('an envelope bound to an epoch newer than this device has ever reached is rejected (malformed/impossible binding)', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  const futureOpened = opened({ boundTrustSetEpoch: 99 });

  const verdict = await acceptRecoveryEpoch(buildRecoveryEpoch(), futureOpened, store, verifier, ledger);

  assert.deepEqual(verdict, { accepted: false, reason: 'ENVELOPE_EPOCH_MISMATCH' });
});

// --- Epoch advancement (recovery always rotates, strictly) -----------------

test('trustSetEpoch not strictly greater than current is rejected', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  const stale = buildRecoveryEpoch({ trustSetEpoch: 1 });

  const verdict = await acceptRecoveryEpoch(stale, opened(), store, verifier, ledger);

  assert.deepEqual(verdict, { accepted: false, reason: 'TRUST_SET_EPOCH_NOT_ADVANCED' });
});

test('keyEpoch EQUAL to current (not strictly greater) is rejected -- unlike the ordinary path, recovery always rotates FDEK (PCA-SEC-019)', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  const noRotation = buildRecoveryEpoch({ keyEpoch: 1 });

  const verdict = await acceptRecoveryEpoch(noRotation, opened(), store, verifier, ledger);

  assert.deepEqual(verdict, { accepted: false, reason: 'KEY_EPOCH_NOT_ADVANCED' });
});

test('an old, already-superseded keyEpoch cannot be reused via recovery (old FDEK reuse attack)', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  const oldKeyEpoch = buildRecoveryEpoch({ keyEpoch: 0 });

  const verdict = await acceptRecoveryEpoch(oldKeyEpoch, opened(), store, verifier, ledger);

  assert.deepEqual(verdict, { accepted: false, reason: 'KEY_EPOCH_NOT_ADVANCED' });
});

// --- Lost device revocation --------------------------------------------------

test('a recovery epoch that silently drops a prior device (no entry at all) is rejected', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  const dropped = buildRecoveryEpoch({ entries: [newOwnerEntry()] }); // owner-device entirely absent

  const verdict = await acceptRecoveryEpoch(dropped, opened(), store, verifier, ledger);

  assert.deepEqual(verdict, { accepted: false, reason: 'PRIOR_DEVICE_SILENTLY_DROPPED' });
});

test('a recovery epoch that revokes nobody is rejected -- recovery must actually revoke the lost identity', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  // owner-device is carried forward demoted to ADMINISTRATOR but still ACTIVE (never REVOKED); a fresh OWNER is added.
  const unsigned = {
    familyId: 'family-1',
    trustSetEpoch: 2,
    keyEpoch: 2,
    entries: [entry({ status: 'ACTIVE', role: 'ADMINISTRATOR' }), newOwnerEntry()],
    issuedAt: new Date('2026-02-01T00:00:00.000Z'),
    supersedesEpoch: 1,
  };
  const nobodyRevoked = { ...unsigned, signature: signTestOnlyEpoch('new-owner-dsk-pub', canonicalizeTrustSetEpoch(unsigned)) };

  const verdict = await acceptRecoveryEpoch(nobodyRevoked, opened(), store, verifier, ledger);

  assert.deepEqual(verdict, { accepted: false, reason: 'NO_PRIOR_DEVICE_REVOKED' });
});

// --- New keys must be genuinely new (lost-key resurrection attack) ---------

test('a "new owner" whose DSK is actually the just-revoked owner\'s old DSK is rejected -- lost-key resurrection', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  const resurrected = buildRecoveryEpoch({
    entries: [
      entry({ status: 'REVOKED' }),
      newOwnerEntry({ dskPublicKey: 'owner-dsk-pub' }), // reuses the revoked owner's DSK
    ],
  });
  // Must be re-signed with the (reused) key for this scenario to reach the resurrection check.
  const signature = signTestOnlyEpoch('owner-dsk-pub', canonicalizeTrustSetEpoch(resurrected));
  const candidate = { ...resurrected, signature };

  const verdict = await acceptRecoveryEpoch(candidate, opened(), store, verifier, ledger);

  assert.deepEqual(verdict, { accepted: false, reason: 'NEW_OWNER_KEYS_NOT_DISTINCT_FROM_PRIOR' });
});

test('a "new owner" whose DEK reuses a still-active OTHER prior device\'s DEK (not just the revoked one\'s) is rejected', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  // Establish a second, still-ACTIVE administrator device first.
  const withAdmin = buildEpoch('owner-dsk-pub', {
    trustSetEpoch: 2,
    supersedesEpoch: 1,
    entries: [entry(), entry({ deviceId: 'admin-device', role: 'ADMINISTRATOR', dskKeyId: 'admin-dsk', dskPublicKey: 'admin-dsk-pub', dekKeyId: 'admin-dek', dekPublicKey: 'admin-dek-pub' })],
  });
  await acceptEpoch(withAdmin, store, verifier);

  const reusesAdminDek = buildRecoveryEpoch({
    trustSetEpoch: 3,
    keyEpoch: 2,
    entries: [
      entry({ status: 'REVOKED' }),
      entry({ deviceId: 'admin-device', role: 'ADMINISTRATOR', dskKeyId: 'admin-dsk', dskPublicKey: 'admin-dsk-pub', dekKeyId: 'admin-dek', dekPublicKey: 'admin-dek-pub' }),
      newOwnerEntry({ dekPublicKey: 'admin-dek-pub' }),
    ],
  });
  const signature = signTestOnlyEpoch('new-owner-dsk-pub', canonicalizeTrustSetEpoch(reusesAdminDek));
  const candidate = { ...reusesAdminDek, signature };

  const verdict = await acceptRecoveryEpoch(candidate, opened({ boundTrustSetEpoch: 2, boundKeyEpoch: 1 }), store, verifier, ledger);

  assert.deepEqual(verdict, { accepted: false, reason: 'NEW_OWNER_KEYS_NOT_DISTINCT_FROM_PRIOR' });
});

// --- Signature ---------------------------------------------------------------

test('a recovery epoch not signed by its own claimed new owner is INVALID_SIGNATURE', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  const unsigned = buildRecoveryEpoch();
  const wrongSignature = { ...unsigned, signature: signTestOnlyEpoch('some-attacker-key', canonicalizeTrustSetEpoch(unsigned)) };

  const verdict = await acceptRecoveryEpoch(wrongSignature, opened(), store, verifier, ledger);

  assert.deepEqual(verdict, { accepted: false, reason: 'INVALID_SIGNATURE' });
});

// --- One-time transaction / replay -----------------------------------------

test('the exact same request (epoch + opened envelope) replayed verbatim is rejected', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  const recoveryEpoch = buildRecoveryEpoch();
  const first = await acceptRecoveryEpoch(recoveryEpoch, opened(), store, verifier, ledger);
  assert.equal(first.accepted, true);

  const replay = await acceptRecoveryEpoch(recoveryEpoch, opened(), store, verifier, ledger);

  assert.equal(replay.accepted, false);
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 2); // the replay did not advance anything further
});

test('the same recoveryTransactionId cannot authorize a SECOND, otherwise-legitimate-looking recovery (transaction-id reuse specifically, isolated from key freshness)', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  const first = await acceptRecoveryEpoch(buildRecoveryEpoch(), opened(), store, verifier, ledger);
  assert.equal(first.accepted, true);

  // A second, otherwise fully legitimate-shaped recovery (fresh third-generation owner, correctly
  // revokes the previous owner, epochs correctly advance) -- but reuses the FIRST recovery's
  // transaction id instead of a new one.
  const secondUnsigned = {
    familyId: 'family-1',
    trustSetEpoch: 3,
    keyEpoch: 3,
    entries: [
      entry({ status: 'REVOKED' }),
      newOwnerEntry({ status: 'REVOKED' }),
      entry({ deviceId: 'third-owner', dskKeyId: 'third-dsk', dskPublicKey: 'third-dsk-pub', dekKeyId: 'third-dek', dekPublicKey: 'third-dek-pub' }),
    ],
    issuedAt: new Date('2026-03-01T00:00:00.000Z'),
    supersedesEpoch: 2,
  };
  const signature = signTestOnlyEpoch('third-dsk-pub', canonicalizeTrustSetEpoch(secondUnsigned));
  const secondEpoch = { ...secondUnsigned, signature };
  // Same recoveryTransactionId as the first ('txn-1', opened()'s default) -- the replay.
  const reusedIdOpened = opened({ boundTrustSetEpoch: 2, boundKeyEpoch: 2 });

  const replay = await acceptRecoveryEpoch(secondEpoch, reusedIdOpened, store, verifier, ledger);

  assert.deepEqual(replay, { accepted: false, reason: 'RECOVERY_TRANSACTION_ALREADY_USED' });
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 2); // the replay did not advance anything
});

test('a failed validation attempt does NOT consume the recoveryTransactionId -- a later legitimate attempt with the same id still succeeds', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  const invalid = buildRecoveryEpoch({ trustSetEpoch: 1 }); // TRUST_SET_EPOCH_NOT_ADVANCED

  const rejected = await acceptRecoveryEpoch(invalid, opened(), store, verifier, ledger);
  assert.deepEqual(rejected, { accepted: false, reason: 'TRUST_SET_EPOCH_NOT_ADVANCED' });

  const legitimate = await acceptRecoveryEpoch(buildRecoveryEpoch(), opened(), store, verifier, ledger);
  assert.deepEqual(legitimate, { accepted: true });
});

test('a different, independent recoveryTransactionId is evaluated on its own merits after a prior one succeeded', async () => {
  const { store, verifier, ledger } = await establishedHarness();
  await acceptRecoveryEpoch(buildRecoveryEpoch(), opened(), store, verifier, ledger);

  // A second, later legitimate recovery (e.g. the replacement parent is later lost too).
  const secondUnsigned = {
    familyId: 'family-1',
    trustSetEpoch: 3,
    keyEpoch: 3,
    entries: [
      entry({ status: 'REVOKED' }),
      newOwnerEntry({ status: 'REVOKED' }),
      entry({ deviceId: 'second-replacement', dskKeyId: 'second-dsk', dskPublicKey: 'second-dsk-pub', dekKeyId: 'second-dek', dekPublicKey: 'second-dek-pub' }),
    ],
    issuedAt: new Date('2026-03-01T00:00:00.000Z'),
    supersedesEpoch: 2,
  };
  const signature = signTestOnlyEpoch('second-dsk-pub', canonicalizeTrustSetEpoch(secondUnsigned));
  const secondEpoch = { ...secondUnsigned, signature };
  const secondOpened = opened({ recoveryTransactionId: 'txn-2', boundTrustSetEpoch: 2, boundKeyEpoch: 2 });

  const verdict = await acceptRecoveryEpoch(secondEpoch, secondOpened, store, verifier, ledger);

  assert.deepEqual(verdict, { accepted: true });
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 3);
});

// --- Concurrency -------------------------------------------------------------

test('two concurrent recovery attempts with the SAME transaction id: exactly one succeeds', async () => {
  const store = new InMemoryFamilyTrustSetStore();
  const verifier = createDelayedTestOnlyTrustSetSignatureVerifier();
  const ledger = new InMemoryRecoveryTransactionLedger();
  const genesis = buildEpoch('owner-dsk-pub');
  await acceptEpoch(genesis, store, createTestOnlyTrustSetSignatureVerifier());

  const epoch = buildRecoveryEpoch();
  const results = await Promise.all([
    acceptRecoveryEpoch(epoch, opened(), store, verifier, ledger),
    acceptRecoveryEpoch(epoch, opened(), store, verifier, ledger),
  ]);

  const accepted = results.filter((r) => r.accepted === true);
  const rejected = results.filter((r) => r.accepted === false);
  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 2);
});

test('two concurrent recovery attempts with DIFFERENT transaction ids racing the same family: exactly one succeeds, the other sees CONCURRENT_EPOCH_CHANGED', async () => {
  const store = new InMemoryFamilyTrustSetStore();
  const verifier = createDelayedTestOnlyTrustSetSignatureVerifier();
  const ledger = new InMemoryRecoveryTransactionLedger();
  await acceptEpoch(buildEpoch('owner-dsk-pub'), store, createTestOnlyTrustSetSignatureVerifier());

  const epochA = buildRecoveryEpoch();
  const openedA = opened({ recoveryTransactionId: 'txn-A' });
  const epochBUnsigned = { ...buildRecoveryEpoch(), entries: [entry({ status: 'REVOKED' }), newOwnerEntry({ deviceId: 'other-replacement', dskKeyId: 'other-dsk', dskPublicKey: 'other-dsk-pub', dekKeyId: 'other-dek', dekPublicKey: 'other-dek-pub' })] };
  delete epochBUnsigned.signature;
  const epochB = { ...epochBUnsigned, signature: signTestOnlyEpoch('other-dsk-pub', canonicalizeTrustSetEpoch(epochBUnsigned)) };
  const openedB = opened({ recoveryTransactionId: 'txn-B' });

  const results = await Promise.all([
    acceptRecoveryEpoch(epochA, openedA, store, verifier, ledger),
    acceptRecoveryEpoch(epochB, openedB, store, verifier, ledger),
  ]);

  const accepted = results.filter((r) => r.accepted === true);
  assert.equal(accepted.length, 1);
  const loser = results.find((r) => r.accepted === false);
  assert.equal(loser.reason, 'CONCURRENT_EPOCH_CHANGED');
  // Both transaction ids stay permanently consumed -- neither can be replayed even though one lost the race.
  assert.equal(await ledger.claimTransaction('txn-A'), false);
  assert.equal(await ledger.claimTransaction('txn-B'), false);
});
