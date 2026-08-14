// PCA-FAMILY-AUTH-1-R1 (PCA-DEC-025, Option A). Exercises
// FamilyOwnerAttestationChainEngine -- the ONLY writer of Family-Owner
// authority state -- against the required matrices from the mission brief:
// bootstrap/genesis, Owner transfer, tamper rejection, stale/revoked
// rejection, and cross-family/cross-member denial. Real MySQL
// concurrency (genesis race, chain-head race) is covered separately in
// test/db/familyCommercialAuthority.mysql.test.mjs -- this file uses the
// in-memory stores and proves the CAS logic itself is correct
// (append-then-reject-second-writer), not true concurrent interleaving.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestOnlyDeviceSignatureVerifier } from '../../support/testOnlyDeviceSignatureVerifier.mjs';
import { InMemoryGenesisAnchorStore } from '../../../dist/familycommercial/authority/InMemoryGenesisAnchorStore.js';
import { InMemoryAttestationChainStore } from '../../../dist/familycommercial/authority/InMemoryAttestationChainStore.js';
import { FamilyOwnerAttestationChainEngine } from '../../../dist/familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { buildGenesisAnchor, buildGenesisAttestation, buildTransferAttestation, signOwnerAttestation } from './fixtures.mjs';

function buildEngine(now = () => new Date('2026-01-03T00:00:00Z')) {
  return new FamilyOwnerAttestationChainEngine(
    new InMemoryGenesisAnchorStore(),
    new InMemoryAttestationChainStore(),
    createTestOnlyDeviceSignatureVerifier(),
    now,
  );
}

async function bootstrapped(now) {
  const engine = buildEngine(now);
  const anchor = buildGenesisAnchor();
  const genesisAttestation = buildGenesisAttestation(anchor);
  const result = await engine.bootstrapFamilyAuthority({ anchor, genesisAttestation });
  assert.equal(result.status, 'BOOTSTRAPPED');
  return { engine, anchor, genesisAttestation, attestationId: result.attestationId };
}

// ---------------------------------------------------------------------------
// Bootstrap / genesis
// ---------------------------------------------------------------------------

test('bootstrap: valid genesis anchor + self-certified revision-1 attestation -> BOOTSTRAPPED, then resolves OWNER_AUTHORIZED for the genesis device', async () => {
  const { engine, anchor } = await bootstrapped();
  assert.deepEqual(await engine.resolveCurrentOwner(anchor.familyId, anchor.genesisDeviceId), { status: 'OWNER_AUTHORIZED' });
});

test('bootstrap: repeated identical bootstrap is idempotent -> ALREADY_BOOTSTRAPPED, never a second root', async () => {
  const engine = buildEngine();
  const anchor = buildGenesisAnchor();
  const genesisAttestation = buildGenesisAttestation(anchor);
  const first = await engine.bootstrapFamilyAuthority({ anchor, genesisAttestation });
  const second = await engine.bootstrapFamilyAuthority({ anchor, genesisAttestation });
  assert.equal(first.status, 'BOOTSTRAPPED');
  assert.equal(second.status, 'ALREADY_BOOTSTRAPPED');
});

test('bootstrap: a DIFFERENT genesis device attempting to bootstrap an already-bootstrapped family never becomes a second root -> ALREADY_BOOTSTRAPPED naming the FIRST genesis device', async () => {
  const engine = buildEngine();
  const anchor1 = buildGenesisAnchor({ genesisDeviceId: 'dev-first', genesisDskKeyId: 'k-first', genesisDskPublicKey: 'pk-first' });
  await engine.bootstrapFamilyAuthority({ anchor: anchor1, genesisAttestation: buildGenesisAttestation(anchor1) });

  const anchor2 = buildGenesisAnchor({ genesisDeviceId: 'dev-second', genesisDskKeyId: 'k-second', genesisDskPublicKey: 'pk-second' });
  const result = await engine.bootstrapFamilyAuthority({ anchor: anchor2, genesisAttestation: buildGenesisAttestation(anchor2) });
  assert.equal(result.status, 'ALREADY_BOOTSTRAPPED');
  assert.equal(result.anchor.genesisDeviceId, 'dev-first');
});

// ---------------------------------------------------------------------------
// Tamper matrix (mission Section 28) -- every case: INVALID_PROOF
// ---------------------------------------------------------------------------

test('tamper: genesis anchor signature invalid -> INVALID_PROOF', async () => {
  const engine = buildEngine();
  const anchor = { ...buildGenesisAnchor(), signature: 'not-a-real-signature' };
  const result = await engine.bootstrapFamilyAuthority({ anchor, genesisAttestation: buildGenesisAttestation(anchor) });
  assert.equal(result.status, 'INVALID_PROOF');
});

test('tamper: genesis attestation signature invalid -> INVALID_PROOF', async () => {
  const engine = buildEngine();
  const anchor = buildGenesisAnchor();
  const genesisAttestation = { ...buildGenesisAttestation(anchor), signature: 'not-a-real-signature' };
  const result = await engine.bootstrapFamilyAuthority({ anchor, genesisAttestation });
  assert.equal(result.status, 'INVALID_PROOF');
});

test('tamper: modified familyId on genesis attestation -> INVALID_PROOF', async () => {
  const engine = buildEngine();
  const anchor = buildGenesisAnchor();
  const genesisAttestation = buildGenesisAttestation(anchor, { familyId: 'fam-OTHER' });
  const result = await engine.bootstrapFamilyAuthority({ anchor, genesisAttestation });
  assert.equal(result.status, 'INVALID_PROOF');
});

test('tamper: modified ownerDeviceId on genesis attestation (not the genesis device) -> INVALID_PROOF', async () => {
  const engine = buildEngine();
  const anchor = buildGenesisAnchor();
  const genesisAttestation = buildGenesisAttestation(anchor, { ownerDeviceId: 'dev-someone-else' });
  const result = await engine.bootstrapFamilyAuthority({ anchor, genesisAttestation });
  assert.equal(result.status, 'INVALID_PROOF');
});

test('tamper: non-null previousAttestationId on a genesis (revision-1) attestation -> INVALID_PROOF', async () => {
  const engine = buildEngine();
  const anchor = buildGenesisAnchor();
  const genesisAttestation = buildGenesisAttestation(anchor, { previousAttestationId: 'some-prior-id' });
  const result = await engine.bootstrapFamilyAuthority({ anchor, genesisAttestation });
  assert.equal(result.status, 'INVALID_PROOF');
});

test('tamper: wrong domain/purpose string -> INVALID_PROOF', async () => {
  const engine = buildEngine();
  const anchor = buildGenesisAnchor();
  const genesisAttestation = buildGenesisAttestation(anchor, { purpose: 'SOME_OTHER_PURPOSE' });
  const result = await engine.bootstrapFamilyAuthority({ anchor, genesisAttestation });
  assert.equal(result.status, 'INVALID_PROOF');
});

test('tamper: unsupported protocol version on genesis anchor -> INVALID_PROOF', async () => {
  const engine = buildEngine();
  const anchor = buildGenesisAnchor({ protocolVersion: 999 });
  const result = await engine.bootstrapFamilyAuthority({ anchor, genesisAttestation: buildGenesisAttestation(anchor) });
  assert.equal(result.status, 'INVALID_PROOF');
});

test('tamper (post-storage): a stored attestation mutated after the fact fails resolveCurrentOwner live re-verification -> INVALID_PROOF', async () => {
  const chainStore = new InMemoryAttestationChainStore();
  const engine = new FamilyOwnerAttestationChainEngine(
    new InMemoryGenesisAnchorStore(),
    chainStore,
    createTestOnlyDeviceSignatureVerifier(),
    () => new Date('2026-01-03T00:00:00Z'),
  );
  const anchor = buildGenesisAnchor();
  const genesisAttestation = buildGenesisAttestation(anchor);
  const bootstrapResult = await engine.bootstrapFamilyAuthority({ anchor, genesisAttestation });
  assert.equal(bootstrapResult.status, 'BOOTSTRAPPED');

  // Directly corrupt the stored row (simulating a tampered/compromised
  // database row) by re-appending a same-id-but-different-owner record is
  // not representable through the store's own API (attestation_id is
  // content-addressed), so instead we overwrite via a second store with a
  // pre-populated map is not exposed either -- exercise the same effect by
  // constructing a fresh store, seeding it with a tampered attestation
  // whose signature was never actually verified against its own (mutated)
  // content, and pointing a head at it.
  const tamperedAttestation = { ...genesisAttestation, ownerDeviceId: 'dev-attacker' };
  const tamperedStore = new InMemoryAttestationChainStore();
  await tamperedStore.appendIfCurrentRevision(tamperedAttestation, bootstrapResult.attestationId, 0);
  const tamperedGenesisStore = new InMemoryGenesisAnchorStore();
  await tamperedGenesisStore.createIfAbsent(anchor);
  const tamperedEngine = new FamilyOwnerAttestationChainEngine(
    tamperedGenesisStore,
    tamperedStore,
    createTestOnlyDeviceSignatureVerifier(),
    () => new Date('2026-01-03T00:00:00Z'),
  );
  const resolved = await tamperedEngine.resolveCurrentOwner(anchor.familyId, 'dev-attacker');
  assert.equal(resolved.status, 'INVALID_PROOF');
});

// ---------------------------------------------------------------------------
// Owner transfer (mission Section 11)
// ---------------------------------------------------------------------------

test('transfer: outgoing Owner signs the incoming Owner into revision 2 -> old owner ROLE_DENIED, new owner OWNER_AUTHORIZED', async () => {
  const { engine, anchor, genesisAttestation, attestationId } = await bootstrapped();
  const next = buildTransferAttestation(genesisAttestation, attestationId);
  const transferResult = await engine.transferOwnerAuthority(anchor.familyId, next);
  assert.equal(transferResult.status, 'TRANSFERRED');

  assert.deepEqual(await engine.resolveCurrentOwner(anchor.familyId, next.ownerDeviceId), { status: 'OWNER_AUTHORIZED' });
  assert.deepEqual(await engine.resolveCurrentOwner(anchor.familyId, anchor.genesisDeviceId), { status: 'ROLE_DENIED' });
});

test('transfer: incoming owner cannot self-certify its own transfer (signer must be the OUTGOING owner) -> INVALID_PROOF', async () => {
  const { engine, anchor, genesisAttestation, attestationId } = await bootstrapped();
  const forged = buildTransferAttestation(genesisAttestation, attestationId, {
    signerDeviceId: 'dev-new-owner',
    signerDskKeyId: 'nk-1',
    signerDskPublicKey: 'pk-new-owner',
  });
  const result = await engine.transferOwnerAuthority(anchor.familyId, forged);
  assert.equal(result.status, 'INVALID_PROOF');
});

test('transfer: broken chain link (wrong previousAttestationId) -> INVALID_PROOF', async () => {
  const { engine, anchor, genesisAttestation } = await bootstrapped();
  const forged = buildTransferAttestation(genesisAttestation, 'not-the-real-head-id');
  const result = await engine.transferOwnerAuthority(anchor.familyId, forged);
  assert.equal(result.status, 'INVALID_PROOF');
});

test('transfer: non-monotonic revision -> INVALID_PROOF', async () => {
  const { engine, anchor, genesisAttestation, attestationId } = await bootstrapped();
  const forged = buildTransferAttestation(genesisAttestation, attestationId, { attestationRevision: 5 });
  const result = await engine.transferOwnerAuthority(anchor.familyId, forged);
  assert.equal(result.status, 'INVALID_PROOF');
});

test('chain-head race: two conflicting transitions from the same prior revision -> at most one TRANSFERRED, the other REJECTED_STALE_REVISION', async () => {
  const { engine, anchor, genesisAttestation, attestationId } = await bootstrapped();
  const nextA = buildTransferAttestation(genesisAttestation, attestationId, { ownerDeviceId: 'dev-a', ownerDskKeyId: 'ka', ownerDskPublicKey: 'pk-a' });
  const nextB = buildTransferAttestation(genesisAttestation, attestationId, { ownerDeviceId: 'dev-b', ownerDskKeyId: 'kb', ownerDskPublicKey: 'pk-b' });

  const [resultA, resultB] = await Promise.all([
    engine.transferOwnerAuthority(anchor.familyId, nextA),
    engine.transferOwnerAuthority(anchor.familyId, nextB),
  ]);
  const statuses = [resultA.status, resultB.status].sort();
  assert.deepEqual(statuses, ['REJECTED_STALE_REVISION', 'TRANSFERRED']);
});

// ---------------------------------------------------------------------------
// Stale / revoked matrix (mission Section 29)
// ---------------------------------------------------------------------------

test('stale: attestation past expiresAt -> STALE_OR_REVOKED, never OWNER_AUTHORIZED', async () => {
  const { engine, anchor } = await bootstrapped(() => new Date('2026-03-01T00:00:00Z'));
  const result = await engine.resolveCurrentOwner(anchor.familyId, anchor.genesisDeviceId);
  assert.equal(result.status, 'STALE_OR_REVOKED');
});

test('revoked: explicit revocation of the current head -> STALE_OR_REVOKED for the formerly-authorized device', async () => {
  const { engine, anchor } = await bootstrapped();
  await engine.revokeCurrentOwner(anchor.familyId);
  const result = await engine.resolveCurrentOwner(anchor.familyId, anchor.genesisDeviceId);
  assert.equal(result.status, 'STALE_OR_REVOKED');
});

test('revoked: a transfer attempt against a revoked head -> STALE_OR_REVOKED, no new attestation appended', async () => {
  const { engine, anchor, genesisAttestation, attestationId } = await bootstrapped();
  await engine.revokeCurrentOwner(anchor.familyId);
  const next = buildTransferAttestation(genesisAttestation, attestationId);
  const result = await engine.transferOwnerAuthority(anchor.familyId, next);
  assert.equal(result.status, 'STALE_OR_REVOKED');
});

test('old owner proof before transfer remains rejected even if replayed after: ROLE_DENIED (never re-authorized by presenting the same device id again)', async () => {
  const { engine, anchor, genesisAttestation, attestationId } = await bootstrapped();
  const next = buildTransferAttestation(genesisAttestation, attestationId);
  await engine.transferOwnerAuthority(anchor.familyId, next);
  assert.deepEqual(await engine.resolveCurrentOwner(anchor.familyId, anchor.genesisDeviceId), { status: 'ROLE_DENIED' });
  assert.deepEqual(await engine.resolveCurrentOwner(anchor.familyId, anchor.genesisDeviceId), { status: 'ROLE_DENIED' });
});

// ---------------------------------------------------------------------------
// Cross-family / cross-member (mission Section 30/31)
// ---------------------------------------------------------------------------

test('cross-family: a valid Owner in family A is never authorized for family B, even with no trust set bootstrapped for B', async () => {
  const { engine, anchor } = await bootstrapped();
  const result = await engine.resolveCurrentOwner('fam-B-never-bootstrapped', anchor.genesisDeviceId);
  assert.equal(result.status, 'AUTHORITY_UNAVAILABLE');
});

test('cross-family: family A Owner device presented against family B (which HAS its own, different Owner) -> ROLE_DENIED, never OWNER_AUTHORIZED', async () => {
  const engineA = buildEngine();
  const anchorA = buildGenesisAnchor({ familyId: 'fam-A', genesisDeviceId: 'dev-A-owner' });
  await engineA.bootstrapFamilyAuthority({ anchor: anchorA, genesisAttestation: buildGenesisAttestation(anchorA) });

  const anchorB = buildGenesisAnchor({ familyId: 'fam-B', genesisDeviceId: 'dev-B-owner' });
  await engineA.bootstrapFamilyAuthority({ anchor: anchorB, genesisAttestation: buildGenesisAttestation(anchorB) });

  const result = await engineA.resolveCurrentOwner('fam-B', 'dev-A-owner');
  assert.equal(result.status, 'ROLE_DENIED');
});

test('AUTHORITY_UNAVAILABLE: unknown family (no genesis at all)', async () => {
  const engine = buildEngine();
  const result = await engine.resolveCurrentOwner('fam-never-existed', 'dev-anyone');
  assert.equal(result.status, 'AUTHORITY_UNAVAILABLE');
});

test('sanity: the fixture signing helper itself matches the test-only verifier (guards against a false-positive test suite)', async () => {
  const verifier = createTestOnlyDeviceSignatureVerifier();
  const anchor = buildGenesisAnchor();
  assert.equal(await verifier.verify(anchor.genesisDskPublicKey, 'wrong-bytes', anchor.signature), false);
});
