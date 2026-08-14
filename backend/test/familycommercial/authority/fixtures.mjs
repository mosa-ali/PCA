import { signTestOnlyChallenge } from '../../support/testOnlyDeviceSignatureVerifier.mjs';

// TEST-ONLY fixture builder. Signs with the same deterministic,
// non-cryptographic test-only scheme as
// test/support/testOnlyDeviceSignatureVerifier.mjs (CRYPTO_SUITE =
// WAITING_HUMAN_SECURITY_REVIEW, doc 09 PCA-DEC-020) -- this file lives
// entirely under backend/test/ and is not reachable from backend/src/ or
// backend/dist/.

export function buildGenesisAnchor(overrides = {}) {
  const base = {
    familyId: 'fam-1',
    genesisDeviceId: 'dev-genesis-owner',
    genesisDskKeyId: 'gk-1',
    genesisDskPublicKey: 'pk-genesis',
    protocolVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
  return { ...base, signature: signGenesisAnchor(base) };
}

function canonicalizeGenesisAnchorLocal(anchor) {
  const fields = [
    'PCA_FAMILY_AUTHORITY_GENESIS_V1',
    anchor.familyId,
    anchor.genesisDeviceId,
    anchor.genesisDskKeyId,
    anchor.genesisDskPublicKey,
    String(anchor.protocolVersion),
    anchor.createdAt.toISOString(),
  ];
  return fields.map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`).join('');
}

function canonicalizeOwnerAttestationLocal(attestation) {
  const fields = [
    'PCA_FAMILY_COMMERCIAL_OWNER_AUTHORITY_V1',
    attestation.familyId,
    String(attestation.attestationRevision),
    attestation.ownerDeviceId,
    attestation.ownerDskKeyId,
    attestation.ownerDskPublicKey,
    String(attestation.trustSetEpoch),
    String(attestation.keyEpoch),
    attestation.issuedAt.toISOString(),
    attestation.expiresAt.toISOString(),
    attestation.previousAttestationId === null ? 'null' : attestation.previousAttestationId,
    attestation.signerDeviceId,
    attestation.signerDskKeyId,
    attestation.signerDskPublicKey,
  ];
  return fields.map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`).join('');
}

export function signGenesisAnchor(anchorWithoutSignature) {
  return signTestOnlyChallenge(anchorWithoutSignature.genesisDskPublicKey, canonicalizeGenesisAnchorLocal(anchorWithoutSignature));
}

export function signOwnerAttestation(attestationWithoutSignature) {
  return signTestOnlyChallenge(
    attestationWithoutSignature.signerDskPublicKey,
    canonicalizeOwnerAttestationLocal(attestationWithoutSignature),
  );
}

export function buildGenesisAttestation(anchor, overrides = {}) {
  const base = {
    familyId: anchor.familyId,
    purpose: 'PCA_FAMILY_COMMERCIAL_OWNER_AUTHORITY_V1',
    attestationRevision: 1,
    ownerDeviceId: anchor.genesisDeviceId,
    ownerDskKeyId: anchor.genesisDskKeyId,
    ownerDskPublicKey: anchor.genesisDskPublicKey,
    trustSetEpoch: 1,
    keyEpoch: 1,
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-01-08T00:00:00Z'),
    previousAttestationId: null,
    signerDeviceId: anchor.genesisDeviceId,
    signerDskKeyId: anchor.genesisDskKeyId,
    signerDskPublicKey: anchor.genesisDskPublicKey,
    ...overrides,
  };
  return { ...base, signature: signOwnerAttestation(base) };
}

export function buildTransferAttestation(currentAttestation, headAttestationId, overrides = {}) {
  const base = {
    familyId: currentAttestation.familyId,
    purpose: 'PCA_FAMILY_COMMERCIAL_OWNER_AUTHORITY_V1',
    attestationRevision: currentAttestation.attestationRevision + 1,
    ownerDeviceId: 'dev-new-owner',
    ownerDskKeyId: 'nk-1',
    ownerDskPublicKey: 'pk-new-owner',
    trustSetEpoch: currentAttestation.trustSetEpoch + 1,
    keyEpoch: currentAttestation.keyEpoch,
    issuedAt: new Date('2026-01-15T00:00:00Z'),
    expiresAt: new Date('2026-01-22T00:00:00Z'),
    previousAttestationId: headAttestationId,
    signerDeviceId: currentAttestation.ownerDeviceId,
    signerDskKeyId: currentAttestation.ownerDskKeyId,
    signerDskPublicKey: currentAttestation.ownerDskPublicKey,
    ...overrides,
  };
  return { ...base, signature: signOwnerAttestation(base) };
}
