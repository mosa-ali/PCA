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
import { signTestOnlyChallenge } from '../../support/testOnlyDeviceSignatureVerifier.mjs';
import { InMemoryGenesisAnchorStore } from '../../../dist/familycommercial/authority/InMemoryGenesisAnchorStore.js';
import { InMemoryAttestationChainStore } from '../../../dist/familycommercial/authority/InMemoryAttestationChainStore.js';
import { FamilyOwnerAttestationChainEngine } from '../../../dist/familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { buildGenesisAnchor, buildGenesisAttestation, buildTransferAttestation, signOwnerAttestation } from './fixtures.mjs';
import { canonicalizeFamilyAuthorityRequestProof, digestAuthorityRequestBody } from '../../../dist/familycommercial/authority/requestProofProtocol.js';

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

test('request proof: guessed actor ID is rejected; a session-bound digest proof authorizes once and replay is denied', async () => {
  const expectedPublicKey = 'BArQn4mGDfD8WbmEr3y436L0C_MxjRuPMWujop0xjrNt-dHBPBuGdWziFXdjHW1d322DsGA0CNg8uqRRdViMd5E';
  const consumed = new Set();
  const keyResolver = {
    async isActiveDsk({ familyId, deviceId, keyId, publicKey }) {
      return familyId === 'fam-1' && deviceId === 'dev-genesis-owner' && keyId === 'gk-1' && publicKey === expectedPublicKey;
    },
  };
  const requestChallengeVerifier = {
    async consume(proof) {
      if (consumed.has(proof.challengeId)) return false;
      consumed.add(proof.challengeId);
      return proof.serviceAccountId === 'svc-1' && proof.familyId === 'fam-1' && proof.deviceId === 'dev-genesis-owner';
    },
  };
  const engine = new FamilyOwnerAttestationChainEngine(
    new InMemoryGenesisAnchorStore(),
    new InMemoryAttestationChainStore(),
    createTestOnlyDeviceSignatureVerifier(),
    () => new Date('2026-01-03T00:00:00Z'),
    keyResolver,
    requestChallengeVerifier,
  );
  const anchor = buildGenesisAnchor({ genesisDskPublicKey: expectedPublicKey });
  await engine.bootstrapFamilyAuthority({ anchor, genesisAttestation: buildGenesisAttestation(anchor) });

  assert.deepEqual(await engine.resolveCurrentOwner('fam-1', 'dev-genesis-owner'), { status: 'INVALID_PROOF' });

  const unsignedProof = {
    protocolVersion: 1,
    operation: 'FAMILY_COMMERCIAL_REQUEST_CREATE',
    serviceAccountId: 'svc-1',
    familyId: 'fam-1',
    deviceId: 'dev-genesis-owner',
    keyId: 'gk-1',
    publicKey: expectedPublicKey,
    challengeId: 'challenge-1',
    nonce: '0123456789012345678901234567890123456789abc',
    requestDigest: digestAuthorityRequestBody('{"targetLimit":5}'),
    issuedAt: new Date('2026-01-03T00:00:00Z'),
    expiresAt: new Date('2026-01-03T00:05:00Z'),
  };
  const proof = { ...unsignedProof, signature: signTestOnlyChallenge(unsignedProof.publicKey, canonicalizeFamilyAuthorityRequestProof(unsignedProof)) };
  assert.deepEqual(
    await engine.resolveCurrentOwner('fam-1', proof, 'svc-1', unsignedProof.operation, unsignedProof.requestDigest),
    { status: 'OWNER_AUTHORIZED' },
  );
  assert.deepEqual(
    await engine.resolveCurrentOwner('fam-1', proof, 'svc-1', unsignedProof.operation, unsignedProof.requestDigest),
    { status: 'INVALID_PROOF' },
  );
  assert.deepEqual(
    await engine.resolveCurrentOwner('fam-1', proof, 'svc-1', unsignedProof.operation, digestAuthorityRequestBody('{"targetLimit":6}')),
    { status: 'INVALID_PROOF' },
  );
});

test('E-3/A-2 NEGATIVE CONTROL: an engine composed WITHOUT a request-challenge verifier refuses EVERY proof -- even a genuine one with a correct key resolver', async () => {
  // This is the defect the production wiring had: main.ts constructed the
  // engine with five arguments and the challenge service only afterwards, so
  // after crypto activation every owner-gated commercial mutation would have
  // failed INVALID_PROOF forever -- with a perfectly valid proof. The engine
  // fails closed without a verifier (FamilyOwnerAttestationChainEngine:307),
  // which is correct; the composition must therefore always pass one.
  const expectedPublicKey = 'BArQn4mGDfD8WbmEr3y436L0C_MxjRuPMWujop0xjrNt-dHBPBuGdWziFXdjHW1d322DsGA0CNg8uqRRdViMd5E';
  const keyResolver = {
    async isActiveDsk({ familyId, deviceId, keyId, publicKey }) {
      return familyId === 'fam-1' && deviceId === 'dev-genesis-owner' && keyId === 'gk-1' && publicKey === expectedPublicKey;
    },
  };
  const consumed = new Set();
  const requestChallengeVerifier = {
    async consume(proof) {
      if (consumed.has(proof.challengeId)) return false;
      consumed.add(proof.challengeId);
      return proof.serviceAccountId === 'svc-1' && proof.familyId === 'fam-1' && proof.deviceId === 'dev-genesis-owner';
    },
  };
  const anchor = buildGenesisAnchor({ genesisDskPublicKey: expectedPublicKey });
  const unsignedProof = {
    protocolVersion: 1,
    operation: 'FAMILY_COMMERCIAL_REQUEST_CREATE',
    serviceAccountId: 'svc-1',
    familyId: 'fam-1',
    deviceId: 'dev-genesis-owner',
    keyId: 'gk-1',
    publicKey: expectedPublicKey,
    challengeId: 'challenge-a9',
    nonce: '0123456789012345678901234567890123456789abc',
    requestDigest: digestAuthorityRequestBody('{"targetLimit":5}'),
    issuedAt: new Date('2026-01-03T00:00:00Z'),
    expiresAt: new Date('2026-01-03T00:05:00Z'),
  };
  const proof = { ...unsignedProof, signature: signTestOnlyChallenge(unsignedProof.publicKey, canonicalizeFamilyAuthorityRequestProof(unsignedProof)) };

  const composedWithoutVerifier = new FamilyOwnerAttestationChainEngine(
    new InMemoryGenesisAnchorStore(),
    new InMemoryAttestationChainStore(),
    createTestOnlyDeviceSignatureVerifier(),
    () => new Date('2026-01-03T00:00:00Z'),
    keyResolver,
  );
  await composedWithoutVerifier.bootstrapFamilyAuthority({ anchor, genesisAttestation: buildGenesisAttestation(anchor) });
  assert.deepEqual(
    await composedWithoutVerifier.resolveCurrentOwner('fam-1', proof, 'svc-1', unsignedProof.operation, unsignedProof.requestDigest),
    { status: 'INVALID_PROOF' },
  );

  // Positive control: the SAME proof against the SAME composition plus the
  // challenge verifier resolves OWNER_AUTHORIZED -- proving the refusal above
  // is caused by the missing verifier and not by a malformed proof.
  const composedWithVerifier = new FamilyOwnerAttestationChainEngine(
    new InMemoryGenesisAnchorStore(),
    new InMemoryAttestationChainStore(),
    createTestOnlyDeviceSignatureVerifier(),
    () => new Date('2026-01-03T00:00:00Z'),
    keyResolver,
    requestChallengeVerifier,
  );
  await composedWithVerifier.bootstrapFamilyAuthority({ anchor, genesisAttestation: buildGenesisAttestation(anchor) });
  assert.deepEqual(
    await composedWithVerifier.resolveCurrentOwner('fam-1', proof, 'svc-1', unsignedProof.operation, unsignedProof.requestDigest),
    { status: 'OWNER_AUTHORIZED' },
  );
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

test('RACE: a revocation landing between the head read and the append cannot resurrect revoked authority', async () => {
  // REVIEWER FINDING (Codex, CODEX_20260923T213721Z_genesis_priority_ruling item 4),
  // independently confirmed in both stores before fixing.
  //
  // markHeadRevoked flips `status` WITHOUT bumping `headRevision`, and the append
  // CAS matched on revision alone -- while its SET clause writes status back to
  // 'ACTIVE'. A renewal or transfer that raced a revocation therefore succeeded and
  // RESURRECTED revoked owner authority, silently undoing the revocation.
  //
  // This cannot be reproduced sequentially: the engine reads the head first and
  // returns STALE_OR_REVOKED if it is already revoked, so the defect is reachable
  // only in the gap between that read and the write. That gap is exactly why the
  // existing suite missed it, so the revocation is injected from inside findHead.
  const anchorStore = new InMemoryGenesisAnchorStore();
  const store = new InMemoryAttestationChainStore();
  const now = () => new Date('2026-01-03T00:00:00Z');
  const bootstrapEngine = new FamilyOwnerAttestationChainEngine(anchorStore, store, createTestOnlyDeviceSignatureVerifier(), now);
  const anchor = buildGenesisAnchor();
  const genesisAttestation = buildGenesisAttestation(anchor);
  const boot = await bootstrapEngine.bootstrapFamilyAuthority({ anchor, genesisAttestation });
  assert.equal(boot.status, 'BOOTSTRAPPED');

  let revocationInjected = false;
  const racingStore = {
    findHead: async (familyId) => {
      const head = await store.findHead(familyId);
      if (!revocationInjected && head !== null && head.status === 'ACTIVE') {
        revocationInjected = true;
        await store.markHeadRevoked(familyId, now());
      }
      return head;
    },
    findAttestationById: (familyId, id) => store.findAttestationById(familyId, id),
    appendIfCurrentRevision: (attestation, id, revision) => store.appendIfCurrentRevision(attestation, id, revision),
    markHeadRevoked: (familyId, at) => store.markHeadRevoked(familyId, at),
  };
  const racingEngine = new FamilyOwnerAttestationChainEngine(anchorStore, racingStore, createTestOnlyDeviceSignatureVerifier(), now);

  const next = buildTransferAttestation(genesisAttestation, boot.attestationId);
  const result = await racingEngine.transferOwnerAuthority(anchor.familyId, next);

  // The append must be refused. It matched on revision (revocation does not bump
  // it), so the status guard is the only thing that can stop it.
  assert.equal(result.status, 'REJECTED_STALE_REVISION');

  // The decisive assertion: revocation is STILL in force, and the head did not
  // advance. Before the fix the UPDATE matched and wrote status = 'ACTIVE'.
  const head = await store.findHead(anchor.familyId);
  assert.equal(head.status, 'REVOKED');
  assert.equal(head.headRevision, 1);
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

test('epoch floors: accepted increments become the new floor and stale or downgraded transitions are rejected', async () => {
  const { engine, anchor, genesisAttestation, attestationId } = await bootstrapped();
  const next = buildTransferAttestation(genesisAttestation, attestationId, { trustSetEpoch: 2, keyEpoch: 2 });
  const first = await engine.transferOwnerAuthority(anchor.familyId, next);
  assert.equal(first.status, 'TRANSFERRED');

  const nextHead = buildTransferAttestation(next, first.attestationId, { trustSetEpoch: 1, keyEpoch: 2 });
  const trustDowngrade = await engine.transferOwnerAuthority(anchor.familyId, nextHead);
  assert.deepEqual(trustDowngrade, { status: 'INVALID_PROOF', reason: 'TRUST_SET_EPOCH_DOWNGRADE' });

  const keyDowngrade = buildTransferAttestation(next, first.attestationId, { trustSetEpoch: 2, keyEpoch: 1 });
  const keyResult = await engine.transferOwnerAuthority(anchor.familyId, keyDowngrade);
  assert.deepEqual(keyResult, { status: 'INVALID_PROOF', reason: 'KEY_EPOCH_DOWNGRADE' });
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
