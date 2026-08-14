import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeGenesisAnchor,
  canonicalizeOwnerAttestation,
  computeAttestationId,
} from '../../../dist/familycommercial/authority/canonicalize.js';

function anchor(overrides = {}) {
  return {
    familyId: 'fam-1',
    genesisDeviceId: 'dev-1',
    genesisDskKeyId: 'k-1',
    genesisDskPublicKey: 'pk-1',
    protocolVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function attestation(overrides = {}) {
  return {
    familyId: 'fam-1',
    purpose: 'PCA_FAMILY_COMMERCIAL_OWNER_AUTHORITY_V1',
    attestationRevision: 1,
    ownerDeviceId: 'dev-1',
    ownerDskKeyId: 'k-1',
    ownerDskPublicKey: 'pk-1',
    trustSetEpoch: 1,
    keyEpoch: 1,
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-02-01T00:00:00Z'),
    previousAttestationId: null,
    signerDeviceId: 'dev-1',
    signerDskKeyId: 'k-1',
    signerDskPublicKey: 'pk-1',
    signature: 'sig',
    ...overrides,
  };
}

test('canonicalizeGenesisAnchor is deterministic for identical input', () => {
  assert.equal(canonicalizeGenesisAnchor(anchor()), canonicalizeGenesisAnchor(anchor()));
});

test('canonicalizeGenesisAnchor changes when any field changes', () => {
  const base = canonicalizeGenesisAnchor(anchor());
  assert.notEqual(canonicalizeGenesisAnchor(anchor({ familyId: 'fam-2' })), base);
  assert.notEqual(canonicalizeGenesisAnchor(anchor({ genesisDeviceId: 'dev-2' })), base);
  assert.notEqual(canonicalizeGenesisAnchor(anchor({ genesisDskPublicKey: 'pk-2' })), base);
  assert.notEqual(canonicalizeGenesisAnchor(anchor({ protocolVersion: 2 })), base);
  assert.notEqual(canonicalizeGenesisAnchor(anchor({ createdAt: new Date('2027-01-01T00:00:00Z') })), base);
});

test('canonicalizeOwnerAttestation is deterministic for identical input', () => {
  assert.equal(canonicalizeOwnerAttestation(attestation()), canonicalizeOwnerAttestation(attestation()));
});

test('canonicalizeOwnerAttestation changes when any signable field changes', () => {
  const base = canonicalizeOwnerAttestation(attestation());
  assert.notEqual(canonicalizeOwnerAttestation(attestation({ familyId: 'fam-2' })), base);
  assert.notEqual(canonicalizeOwnerAttestation(attestation({ attestationRevision: 2 })), base);
  assert.notEqual(canonicalizeOwnerAttestation(attestation({ ownerDeviceId: 'dev-2' })), base);
  assert.notEqual(canonicalizeOwnerAttestation(attestation({ previousAttestationId: 'prev-1' })), base);
  assert.notEqual(canonicalizeOwnerAttestation(attestation({ signerDeviceId: 'dev-2' })), base);
  assert.notEqual(canonicalizeOwnerAttestation(attestation({ expiresAt: new Date('2027-01-01T00:00:00Z') })), base);
});

test('domain separator prevents a genesis-anchor and attestation with otherwise-identical fields from canonicalizing the same', () => {
  const anchorBytes = canonicalizeGenesisAnchor(anchor({ genesisDeviceId: 'dev-1', genesisDskKeyId: 'k-1', genesisDskPublicKey: 'pk-1' }));
  const attestationBytes = canonicalizeOwnerAttestation(
    attestation({ ownerDeviceId: 'dev-1', ownerDskKeyId: 'k-1', ownerDskPublicKey: 'pk-1' }),
  );
  assert.notEqual(anchorBytes, attestationBytes);
});

test('no field-boundary can be crafted to collide: shifting a byte across the familyId/genesisDeviceId boundary changes canonical bytes', () => {
  const a = canonicalizeGenesisAnchor(anchor({ familyId: 'fam', genesisDeviceId: '1dev-1' }));
  const b = canonicalizeGenesisAnchor(anchor({ familyId: 'fam1', genesisDeviceId: 'dev-1' }));
  assert.notEqual(a, b);
});

test('computeAttestationId is deterministic and changes with the signature', () => {
  const a1 = attestation({ signature: 'sig-a' });
  const a2 = attestation({ signature: 'sig-a' });
  const a3 = attestation({ signature: 'sig-b' });
  assert.equal(computeAttestationId(a1), computeAttestationId(a2));
  assert.notEqual(computeAttestationId(a1), computeAttestationId(a3));
  assert.match(computeAttestationId(a1), /^[0-9a-f]{64}$/);
});
