import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptEpoch, FTS_RECOVERY_ACCEPTANCE } from '../../dist/familytrustset/FamilyTrustSetEngine.js';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import {
  createTestOnlyTrustSetSignatureVerifier,
  signTestOnlyEpoch,
} from '../support/testOnlyTrustSetSignatureVerifier.mjs';

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

function buildHarness() {
  return { store: new InMemoryFamilyTrustSetStore(), verifier: createTestOnlyTrustSetSignatureVerifier() };
}

// --- Genesis -----------------------------------------------------------

test('a valid genesis epoch (no prior store state) is accepted when self-signed by its own claimed owner', async () => {
  const { store, verifier } = buildHarness();
  const genesis = buildEpoch('owner-dsk-pub');
  const verdict = await acceptEpoch(genesis, store, verifier);
  assert.deepEqual(verdict, { accepted: true });
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 1);
});

test('a genesis epoch signed by a key OTHER than its own claimed owner is INVALID_SIGNATURE', async () => {
  const { store, verifier } = buildHarness();
  const genesis = buildEpoch('some-other-key');
  const verdict = await acceptEpoch(genesis, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'INVALID_SIGNATURE' });
  assert.equal(store.getCurrentEpoch(), null);
});

test('a genesis epoch with zero active owners is NOT_EXACTLY_ONE_ACTIVE_OWNER', async () => {
  const { store, verifier } = buildHarness();
  const noOwner = buildEpoch('owner-dsk-pub', { entries: [entry({ role: 'CHILD' })] });
  const verdict = await acceptEpoch(noOwner, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'NOT_EXACTLY_ONE_ACTIVE_OWNER' });
});

test('a genesis epoch with two active owners is NOT_EXACTLY_ONE_ACTIVE_OWNER (PCA-FR-002A)', async () => {
  const { store, verifier } = buildHarness();
  const twoOwners = buildEpoch('owner-dsk-pub', {
    entries: [entry(), entry({ deviceId: 'owner-device-2', dskKeyId: 'k2', dskPublicKey: 'p2', dekKeyId: 'k3', dekPublicKey: 'p3' })],
  });
  const verdict = await acceptEpoch(twoOwners, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'NOT_EXACTLY_ONE_ACTIVE_OWNER' });
});

test('a REVOKED owner entry does not count toward the active-owner requirement', async () => {
  const { store, verifier } = buildHarness();
  const revokedOwnerOnly = buildEpoch('owner-dsk-pub', { entries: [entry({ status: 'REVOKED' })] });
  const verdict = await acceptEpoch(revokedOwnerOnly, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'NOT_EXACTLY_ONE_ACTIVE_OWNER' });
});

test('an entry whose DSK equals its DEK is KEYS_NOT_DISTINCT', async () => {
  const { store, verifier } = buildHarness();
  const sameKey = buildEpoch('owner-dsk-pub', {
    entries: [entry({ dskPublicKey: 'shared', dekPublicKey: 'shared' })],
  });
  const verdict = await acceptEpoch(sameKey, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'KEYS_NOT_DISTINCT' });
});

// --- Subsequent epochs ---------------------------------------------------

test('a subsequent epoch signed by the CURRENT owner with a higher trustSetEpoch is accepted and updates the store', async () => {
  const { store, verifier } = buildHarness();
  await acceptEpoch(buildEpoch('owner-dsk-pub'), store, verifier);

  const next = buildEpoch('owner-dsk-pub', { trustSetEpoch: 2, supersedesEpoch: 1 });
  const verdict = await acceptEpoch(next, store, verifier);
  assert.deepEqual(verdict, { accepted: true });
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 2);
});

test('a subsequent epoch signed by anyone OTHER than the current owner is INVALID_SIGNATURE -- a new epoch cannot self-certify its own ownership claim', async () => {
  const { store, verifier } = buildHarness();
  await acceptEpoch(buildEpoch('owner-dsk-pub'), store, verifier);

  // Signed by the NEW epoch's own claimed owner key, not the outgoing owner -- must be rejected.
  const selfCertified = buildEpoch('new-owner-dsk-pub', {
    trustSetEpoch: 2,
    supersedesEpoch: 1,
    entries: [entry({ deviceId: 'new-owner-device', dskPublicKey: 'new-owner-dsk-pub', dekPublicKey: 'new-owner-dek-pub' })],
  });
  const verdict = await acceptEpoch(selfCertified, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'INVALID_SIGNATURE' });
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 1, 'the store must still hold the original epoch');
});

test('a candidate epoch for a DIFFERENT familyId than the store currently holds is FAMILY_MISMATCH, even with a higher trustSetEpoch and a technically-valid-shaped signature', async () => {
  const { store, verifier } = buildHarness();
  await acceptEpoch(buildEpoch('owner-dsk-pub', { familyId: 'family-1', trustSetEpoch: 1 }), store, verifier);

  // Signed correctly under the ORIGINAL family's owner key, but claiming a different familyId.
  const wrongFamily = buildEpoch('owner-dsk-pub', { familyId: 'family-2', trustSetEpoch: 2, supersedesEpoch: 1 });
  const verdict = await acceptEpoch(wrongFamily, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'FAMILY_MISMATCH' });
  assert.equal(store.getCurrentEpoch().familyId, 'family-1');
});

test('an equal or lower trustSetEpoch is STALE_EPOCH, even with a correct signature', async () => {
  const { store, verifier } = buildHarness();
  await acceptEpoch(buildEpoch('owner-dsk-pub', { trustSetEpoch: 5 }), store, verifier);

  const equal = buildEpoch('owner-dsk-pub', { trustSetEpoch: 5 });
  assert.deepEqual(await acceptEpoch(equal, store, verifier), { accepted: false, reason: 'STALE_EPOCH' });

  const lower = buildEpoch('owner-dsk-pub', { trustSetEpoch: 3 });
  assert.deepEqual(await acceptEpoch(lower, store, verifier), { accepted: false, reason: 'STALE_EPOCH' });
});

test('a device can catch up across skipped epochs directly to the latest, when the owner has not changed', async () => {
  const { store, verifier } = buildHarness();
  await acceptEpoch(buildEpoch('owner-dsk-pub', { trustSetEpoch: 1 }), store, verifier);

  // Jump straight from epoch 1 to epoch 5 -- same owner signs both.
  const latest = buildEpoch('owner-dsk-pub', { trustSetEpoch: 5, supersedesEpoch: 4 });
  const verdict = await acceptEpoch(latest, store, verifier);
  assert.deepEqual(verdict, { accepted: true });
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 5);
});

test('ownership transfer: the CURRENT owner signs an epoch handing OWNER to a different device; the new owner then correctly becomes the required signer for the epoch after that', async () => {
  const { store, verifier } = buildHarness();
  await acceptEpoch(buildEpoch('owner-dsk-pub'), store, verifier);

  const transfer = buildEpoch('owner-dsk-pub', {
    trustSetEpoch: 2,
    supersedesEpoch: 1,
    entries: [
      entry({ deviceId: 'owner-device', role: 'ADMINISTRATOR' }), // demoted, still present
      entry({ deviceId: 'new-owner-device', role: 'OWNER', dskKeyId: 'k2', dskPublicKey: 'new-owner-dsk-pub', dekKeyId: 'k3', dekPublicKey: 'new-owner-dek-pub' }),
    ],
  });
  const transferVerdict = await acceptEpoch(transfer, store, verifier);
  assert.deepEqual(transferVerdict, { accepted: true });

  // The OLD owner can no longer sign the NEXT epoch.
  const signedByOldOwner = buildEpoch('owner-dsk-pub', { trustSetEpoch: 3, supersedesEpoch: 2 });
  assert.deepEqual(await acceptEpoch(signedByOldOwner, store, verifier), { accepted: false, reason: 'INVALID_SIGNATURE' });

  // The NEW owner can.
  const signedByNewOwner = buildEpoch('new-owner-dsk-pub', { trustSetEpoch: 3, supersedesEpoch: 2 });
  assert.deepEqual(await acceptEpoch(signedByNewOwner, store, verifier), { accepted: true });
});

test('a rejected epoch never advances the store, proven by a subsequent legitimate epoch at the ORIGINAL trustSetEpoch+1 still succeeding', async () => {
  const { store, verifier } = buildHarness();
  await acceptEpoch(buildEpoch('owner-dsk-pub', { trustSetEpoch: 1 }), store, verifier);

  const forged = buildEpoch('wrong-key', { trustSetEpoch: 2, supersedesEpoch: 1 });
  const forgedVerdict = await acceptEpoch(forged, store, verifier);
  assert.deepEqual(forgedVerdict, { accepted: false, reason: 'INVALID_SIGNATURE' });
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 1);

  const genuine = buildEpoch('owner-dsk-pub', { trustSetEpoch: 2, supersedesEpoch: 1 });
  const verdict = await acceptEpoch(genuine, store, verifier);
  assert.deepEqual(verdict, { accepted: true });
});

// --- Key-epoch anti-downgrade -------------------------------------------

test('a lower keyEpoch than the store currently holds is STALE_KEY_EPOCH, even with a higher trustSetEpoch and a correct signature', async () => {
  const { store, verifier } = buildHarness();
  await acceptEpoch(buildEpoch('owner-dsk-pub', { trustSetEpoch: 1, keyEpoch: 5 }), store, verifier);

  const lowerKeyEpoch = buildEpoch('owner-dsk-pub', { trustSetEpoch: 2, supersedesEpoch: 1, keyEpoch: 4 });
  const verdict = await acceptEpoch(lowerKeyEpoch, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'STALE_KEY_EPOCH' });
  assert.equal(store.getCurrentEpoch().keyEpoch, 5, 'the store must still hold the original keyEpoch');
});

test('an EQUAL keyEpoch is acceptable when trustSetEpoch itself still advances (a trust-set-metadata-only change need not rotate FDEK material)', async () => {
  const { store, verifier } = buildHarness();
  await acceptEpoch(buildEpoch('owner-dsk-pub', { trustSetEpoch: 1, keyEpoch: 5 }), store, verifier);

  const sameKeyEpoch = buildEpoch('owner-dsk-pub', { trustSetEpoch: 2, supersedesEpoch: 1, keyEpoch: 5 });
  const verdict = await acceptEpoch(sameKeyEpoch, store, verifier);
  assert.deepEqual(verdict, { accepted: true });
  assert.equal(store.getCurrentEpoch().keyEpoch, 5);
});

test('a HIGHER keyEpoch (an ordinary rotation) is acceptable', async () => {
  const { store, verifier } = buildHarness();
  await acceptEpoch(buildEpoch('owner-dsk-pub', { trustSetEpoch: 1, keyEpoch: 5 }), store, verifier);

  const higherKeyEpoch = buildEpoch('owner-dsk-pub', { trustSetEpoch: 2, supersedesEpoch: 1, keyEpoch: 6 });
  const verdict = await acceptEpoch(higherKeyEpoch, store, verifier);
  assert.deepEqual(verdict, { accepted: true });
  assert.equal(store.getCurrentEpoch().keyEpoch, 6);
});

test('a rejected STALE_KEY_EPOCH candidate never mutates the store -- proven by a subsequent legitimate epoch still succeeding from the original state', async () => {
  const { store, verifier } = buildHarness();
  await acceptEpoch(buildEpoch('owner-dsk-pub', { trustSetEpoch: 1, keyEpoch: 5 }), store, verifier);

  const rejected = buildEpoch('owner-dsk-pub', { trustSetEpoch: 2, supersedesEpoch: 1, keyEpoch: 1 });
  assert.deepEqual(await acceptEpoch(rejected, store, verifier), { accepted: false, reason: 'STALE_KEY_EPOCH' });

  const genuine = buildEpoch('owner-dsk-pub', { trustSetEpoch: 2, supersedesEpoch: 1, keyEpoch: 5 });
  assert.deepEqual(await acceptEpoch(genuine, store, verifier), { accepted: true });
});

// --- Structural uniqueness -----------------------------------------------

test('two entries sharing the same deviceId is DUPLICATE_ENTRY_IDENTITY', async () => {
  const { store, verifier } = buildHarness();
  const dup = buildEpoch('owner-dsk-pub', {
    entries: [
      entry(),
      entry({ deviceId: 'owner-device', role: 'CHILD', dskKeyId: 'k2', dskPublicKey: 'p2', dekKeyId: 'k3', dekPublicKey: 'p3' }),
    ],
  });
  const verdict = await acceptEpoch(dup, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'DUPLICATE_ENTRY_IDENTITY' });
});

test('two entries sharing the same DSK key id is DUPLICATE_ENTRY_IDENTITY', async () => {
  const { store, verifier } = buildHarness();
  const dup = buildEpoch('owner-dsk-pub', {
    entries: [
      entry(),
      entry({ deviceId: 'device-2', role: 'CHILD', dskKeyId: 'owner-dsk-key', dskPublicKey: 'p2', dekKeyId: 'k3', dekPublicKey: 'p3' }),
    ],
  });
  const verdict = await acceptEpoch(dup, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'DUPLICATE_ENTRY_IDENTITY' });
});

test('two entries sharing the same DEK key id is DUPLICATE_ENTRY_IDENTITY', async () => {
  const { store, verifier } = buildHarness();
  const dup = buildEpoch('owner-dsk-pub', {
    entries: [
      entry(),
      entry({ deviceId: 'device-2', role: 'CHILD', dskKeyId: 'k2', dskPublicKey: 'p2', dekKeyId: 'owner-dek-key', dekPublicKey: 'p3' }),
    ],
  });
  const verdict = await acceptEpoch(dup, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'DUPLICATE_ENTRY_IDENTITY' });
});

test('two entries sharing the same DSK public key is DUPLICATE_ENTRY_IDENTITY -- one physical key cannot represent two device identities', async () => {
  const { store, verifier } = buildHarness();
  const dup = buildEpoch('owner-dsk-pub', {
    entries: [
      entry(),
      entry({ deviceId: 'device-2', role: 'CHILD', dskKeyId: 'k2', dskPublicKey: 'owner-dsk-pub', dekKeyId: 'k3', dekPublicKey: 'p3' }),
    ],
  });
  const verdict = await acceptEpoch(dup, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'DUPLICATE_ENTRY_IDENTITY' });
});

test('two entries sharing the same DEK public key is DUPLICATE_ENTRY_IDENTITY', async () => {
  const { store, verifier } = buildHarness();
  const dup = buildEpoch('owner-dsk-pub', {
    entries: [
      entry(),
      entry({ deviceId: 'device-2', role: 'CHILD', dskKeyId: 'k2', dskPublicKey: 'p2', dekKeyId: 'k3', dekPublicKey: 'owner-dek-pub' }),
    ],
  });
  const verdict = await acceptEpoch(dup, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'DUPLICATE_ENTRY_IDENTITY' });
});

test('one entry\'s DSK equal to a DIFFERENT entry\'s DEK is DUPLICATE_ENTRY_IDENTITY -- a key cannot masquerade in both roles across two identities', async () => {
  const { store, verifier } = buildHarness();
  const dup = buildEpoch('owner-dsk-pub', {
    entries: [
      entry(),
      entry({ deviceId: 'device-2', role: 'CHILD', dskKeyId: 'k2', dskPublicKey: 'owner-dek-pub', dekKeyId: 'k3', dekPublicKey: 'p3' }),
    ],
  });
  const verdict = await acceptEpoch(dup, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'DUPLICATE_ENTRY_IDENTITY' });
});

test('distinct entries with genuinely unique deviceId/DSK/DEK material are accepted', async () => {
  const { store, verifier } = buildHarness();
  const distinct = buildEpoch('owner-dsk-pub', {
    entries: [
      entry(),
      entry({ deviceId: 'device-2', role: 'CHILD', dskKeyId: 'k2', dskPublicKey: 'p2', dekKeyId: 'k3', dekPublicKey: 'p3' }),
    ],
  });
  const verdict = await acceptEpoch(distinct, store, verifier);
  assert.deepEqual(verdict, { accepted: true });
});

// --- Recovery acceptance boundary ----------------------------------------

test('recovery-transaction acceptance is implemented as a dedicated, separate engine (PCA-13), not a branch of the ordinary path', () => {
  // FamilyTrustSetRecoveryEngine.acceptRecoveryEpoch (a different exported
  // function, in a different module) is the recovery-authorized acceptance
  // path doc 09 Section 10 describes. This engine's own acceptEpoch
  // deliberately has no recovery branch -- see the next test, which pins
  // that a recovery-signed epoch still fails closed here.
  assert.equal(FTS_RECOVERY_ACCEPTANCE, 'IMPLEMENTED_VIA_FamilyTrustSetRecoveryEngine');
});

test('a recovery-authorized signer (not the previous epoch\'s stored OWNER) still fails closed as INVALID_SIGNATURE here -- the ordinary path has no recovery branch to accidentally take', async () => {
  const { store, verifier } = buildHarness();
  await acceptEpoch(buildEpoch('owner-dsk-pub'), store, verifier);

  // A plausible-looking "recovery replacement" epoch signed by a brand-new
  // key that is NOT the current owner's DSK -- ordinary acceptance must
  // reject it. This is the boundary that makes "a recovery authorization
  // cannot use the ordinary owner path by accident" true: even now that
  // recovery acceptance genuinely exists (FamilyTrustSetRecoveryEngine),
  // it is not reachable through this function.
  const recoveryAttempt = buildEpoch('recovery-authorized-key', {
    trustSetEpoch: 2,
    supersedesEpoch: 1,
    entries: [entry({ deviceId: 'recovered-owner-device', dskPublicKey: 'recovery-authorized-key', dekPublicKey: 'recovery-dek-pub' })],
  });
  const verdict = await acceptEpoch(recoveryAttempt, store, verifier);
  assert.deepEqual(verdict, { accepted: false, reason: 'INVALID_SIGNATURE' });
  assert.equal(store.getCurrentEpoch().trustSetEpoch, 1);
});
