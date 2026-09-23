// PCA-FAMILY-AUTH-1-R1 (PCA-DEC-025, Option A). Real-MySQL concurrency and
// durability proof for the genesis-anchored Owner-attestation chain --
// mission Section 26 (genesis race) and Section 27 (chain-head race), plus
// Section 32 (restart/multi-instance: correctness must not depend on
// in-memory state -- proved here by re-reading through a FRESH store
// instance every time, since these stores hold no process-local cache).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { createTestOnlyDeviceSignatureVerifier } from '../support/testOnlyDeviceSignatureVerifier.mjs';
import { MySqlFamilyAuthorityGenesisStore } from '../../dist/familycommercial/authority/MySqlGenesisAnchorStore.js';
import { MySqlFamilyAuthorityAttestationChainStore } from '../../dist/familycommercial/authority/MySqlAttestationChainStore.js';
import { FamilyOwnerAttestationChainEngine } from '../../dist/familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { buildGenesisAnchor, buildGenesisAttestation, buildTransferAttestation } from '../familycommercial/authority/fixtures.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

function freshEngine(now = () => new Date('2026-01-03T00:00:00Z')) {
  // A NEW store/engine instance every call, backed only by the shared
  // MySQL pool -- proves no correctness-relevant state lives in the
  // process, which is what makes this durable across restarts/multiple
  // backend instances.
  return new FamilyOwnerAttestationChainEngine(
    new MySqlFamilyAuthorityGenesisStore(),
    new MySqlFamilyAuthorityAttestationChainStore(),
    createTestOnlyDeviceSignatureVerifier(),
    now,
  );
}

test('MySQL CONCURRENCY: N concurrent genesis-bootstrap attempts for the SAME family -- exactly one canonical genesis anchor, no two roots', async () => {
  const familyId = `fam-genrace-${randomUUID()}`;
  const attempts = Array.from({ length: 8 }, (_, i) => {
    const anchor = buildGenesisAnchor({
      familyId,
      genesisDeviceId: `dev-attempt-${i}`,
      genesisDskKeyId: `k-attempt-${i}`,
      genesisDskPublicKey: `pk-attempt-${i}`,
    });
    return freshEngine().bootstrapFamilyAuthority({ anchor, genesisAttestation: buildGenesisAttestation(anchor) });
  });

  const results = await Promise.all(attempts);
  const bootstrapped = results.filter((r) => r.status === 'BOOTSTRAPPED');
  const alreadyBootstrapped = results.filter((r) => r.status === 'ALREADY_BOOTSTRAPPED');
  assert.equal(bootstrapped.length, 1, 'exactly one attempt must win BOOTSTRAPPED');
  assert.equal(alreadyBootstrapped.length, 7, 'every other attempt must observe ALREADY_BOOTSTRAPPED, never a second root');

  const winningDeviceId = bootstrapped[0].anchor.genesisDeviceId;
  for (const r of alreadyBootstrapped) assert.equal(r.anchor.genesisDeviceId, winningDeviceId);

  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM family_authority_genesis_anchors WHERE family_id = ?`, [familyId]);
  assert.equal(Number(rows[0].n), 1, 'exactly one genesis row must exist for this family after the race');
});

test('MySQL CONCURRENCY: two conflicting Owner transitions from the same prior revision -- at most one becomes canonical, no fork', async () => {
  const familyId = `fam-headrace-${randomUUID()}`;
  const anchor = buildGenesisAnchor({ familyId, genesisDeviceId: 'dev-genesis' });
  const genesisAttestation = buildGenesisAttestation(anchor);
  const bootstrapResult = await freshEngine().bootstrapFamilyAuthority({ anchor, genesisAttestation });
  assert.equal(bootstrapResult.status, 'BOOTSTRAPPED');

  const nextA = buildTransferAttestation(genesisAttestation, bootstrapResult.attestationId, {
    ownerDeviceId: 'dev-race-a', ownerDskKeyId: 'ka', ownerDskPublicKey: 'pk-race-a',
  });
  const nextB = buildTransferAttestation(genesisAttestation, bootstrapResult.attestationId, {
    ownerDeviceId: 'dev-race-b', ownerDskKeyId: 'kb', ownerDskPublicKey: 'pk-race-b',
  });

  const [resultA, resultB] = await Promise.all([
    freshEngine().transferOwnerAuthority(familyId, nextA),
    freshEngine().transferOwnerAuthority(familyId, nextB),
  ]);
  const statuses = [resultA.status, resultB.status].sort();
  assert.deepEqual(statuses, ['REJECTED_STALE_REVISION', 'TRANSFERRED']);

  const [rows] = await getPool().query(
    `SELECT COUNT(*) AS n FROM family_authority_chain_heads WHERE family_id = ? AND head_revision = 2`,
    [familyId],
  );
  assert.equal(Number(rows[0].n), 1, 'exactly one head row at revision 2 -- no fork silently treated as equally canonical');

  const winner = resultA.status === 'TRANSFERRED' ? 'dev-race-a' : 'dev-race-b';
  const resolved = await freshEngine().resolveCurrentOwner(familyId, winner);
  assert.equal(resolved.status, 'OWNER_AUTHORIZED');
});

test('MySQL RACE (revoke wins the read/append gap): a revocation landing between the head read and the append is REFUSED and leaves NO orphan attestation row', async () => {
  // Claude _0300 F-2 REQUIRED_BEFORE_FINAL_CERTIFICATION proof, order 1.
  // The window is the same one the in-memory test injects: markHeadRevoked
  // flips `status` WITHOUT bumping head_revision, so the append CAS is only
  // safe because its predicate also requires status = 'ACTIVE'.
  const familyId = `fam-revokegap-${randomUUID()}`;
  const anchor = buildGenesisAnchor({ familyId, genesisDeviceId: 'dev-genesis' });
  const genesisAttestation = buildGenesisAttestation(anchor);
  const bootstrapResult = await freshEngine().bootstrapFamilyAuthority({ anchor, genesisAttestation });
  assert.equal(bootstrapResult.status, 'BOOTSTRAPPED');

  const store = new MySqlFamilyAuthorityAttestationChainStore();
  let revocationInjected = false;
  const racingStore = {
    findHead: async (requestedFamilyId) => {
      const head = await store.findHead(requestedFamilyId);
      if (!revocationInjected && head !== null && head.status === 'ACTIVE') {
        revocationInjected = true;
        // A second connection, like a concurrent admin revocation arriving
        // exactly between the engine's read and its append.
        await new MySqlFamilyAuthorityAttestationChainStore().markHeadRevoked(requestedFamilyId, new Date('2026-01-03T00:00:01Z'));
      }
      return head;
    },
    findAttestationById: (requestedFamilyId, id) => store.findAttestationById(requestedFamilyId, id),
    appendIfCurrentRevision: (attestation, id, revision) => store.appendIfCurrentRevision(attestation, id, revision),
    markHeadRevoked: (requestedFamilyId, at) => store.markHeadRevoked(requestedFamilyId, at),
  };
  assert.equal(revocationInjected, false);
  const racingEngine = new FamilyOwnerAttestationChainEngine(
    new MySqlFamilyAuthorityGenesisStore(),
    racingStore,
    createTestOnlyDeviceSignatureVerifier(),
    () => new Date('2026-01-03T00:00:01.500Z'),
  );

  const next = buildTransferAttestation(genesisAttestation, bootstrapResult.attestationId);
  const result = await racingEngine.transferOwnerAuthority(familyId, next);
  assert.equal(result.status, 'REJECTED_STALE_REVISION');

  const [heads] = await getPool().query(`SELECT status, head_revision FROM family_authority_chain_heads WHERE family_id = ?`, [familyId]);
  assert.equal(heads[0].status, 'REVOKED', 'revocation must still be in force after the refused append');
  assert.equal(Number(heads[0].head_revision), 1, 'the head must not have advanced');
  const [orphans] = await getPool().query(
    `SELECT COUNT(*) AS n FROM family_authority_attestations WHERE family_id = ? AND attestation_revision = 2`,
    [familyId],
  );
  assert.equal(Number(orphans[0].n), 0, 'the refused append must not leave an orphan attestation row (single transaction rollback)');
});

test('MySQL RACE (other order): a revocation AFTER a successful append is still terminal -- the append never resurrects revoked authority', async () => {
  // Claude _0300 F-2 REQUIRED_BEFORE_FINAL_CERTIFICATION proof, order 2.
  // The append wins its window; the revocation that follows must still take
  // effect and must not be undone by any later append state.
  const familyId = `fam-revokeafter-${randomUUID()}`;
  const anchor = buildGenesisAnchor({ familyId, genesisDeviceId: 'dev-genesis' });
  const genesisAttestation = buildGenesisAttestation(anchor);
  const bootstrapResult = await freshEngine().bootstrapFamilyAuthority({ anchor, genesisAttestation });
  assert.equal(bootstrapResult.status, 'BOOTSTRAPPED');

  const renewal = buildTransferAttestation(genesisAttestation, bootstrapResult.attestationId, {
    ownerDeviceId: 'dev-genesis',
    ownerDskKeyId: anchor.genesisDskKeyId,
    ownerDskPublicKey: anchor.genesisDskPublicKey,
  });
  const transferred = await freshEngine().transferOwnerAuthority(familyId, renewal);
  assert.equal(transferred.status, 'TRANSFERRED');

  await freshEngine().revokeCurrentOwner(familyId);

  const resolved = await freshEngine().resolveCurrentOwner(familyId, anchor.genesisDeviceId);
  assert.equal(resolved.status, 'STALE_OR_REVOKED');

  const [heads] = await getPool().query(`SELECT status, head_revision FROM family_authority_chain_heads WHERE family_id = ?`, [familyId]);
  assert.equal(heads[0].status, 'REVOKED');
  assert.equal(Number(heads[0].head_revision), 2, 'the revocation is terminal at the revision the append produced');

  // A subsequent append attempt (even a well-formed same-owner renewal for the
  // now-current revision) must be refused: revocation is terminal for the
  // chain-head append transition.
  const afterRevoke = buildTransferAttestation(renewal, transferred.attestationId, {
    ownerDeviceId: 'dev-genesis',
    ownerDskKeyId: anchor.genesisDskKeyId,
    ownerDskPublicKey: anchor.genesisDskPublicKey,
  });
  const refused = await freshEngine().transferOwnerAuthority(familyId, afterRevoke);
  assert.equal(refused.status, 'STALE_OR_REVOKED');
});

test('MySQL DURABILITY: state survives across independent store/engine instances (restart/multi-instance proof -- no process-local cache)', async () => {
  const familyId = `fam-durability-${randomUUID()}`;  const anchor = buildGenesisAnchor({ familyId, genesisDeviceId: 'dev-genesis' });
  const genesisAttestation = buildGenesisAttestation(anchor);

  await freshEngine().bootstrapFamilyAuthority({ anchor, genesisAttestation });
  // A brand-new engine instance (simulating a second backend process, or
  // the same process after a restart) must resolve identically.
  const resolvedByInstanceTwo = await freshEngine().resolveCurrentOwner(familyId, anchor.genesisDeviceId);
  assert.deepEqual(resolvedByInstanceTwo, { status: 'OWNER_AUTHORIZED' });
});

test('MySQL: revocation persists and is visible to a fresh engine instance', async () => {
  const familyId = `fam-revoke-${randomUUID()}`;
  const anchor = buildGenesisAnchor({ familyId, genesisDeviceId: 'dev-genesis' });
  await freshEngine().bootstrapFamilyAuthority({ anchor, genesisAttestation: buildGenesisAttestation(anchor) });

  await freshEngine().revokeCurrentOwner(familyId);
  const resolved = await freshEngine().resolveCurrentOwner(familyId, anchor.genesisDeviceId);
  assert.equal(resolved.status, 'STALE_OR_REVOKED');
});

test.after(async () => {
  await closePool();
});
