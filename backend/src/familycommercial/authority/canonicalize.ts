import { createHash } from 'node:crypto';
import { GENESIS_ANCHOR_DOMAIN, OWNER_ATTESTATION_DOMAIN } from './types.js';
import type { AttestationId, FamilyAuthorityGenesisAnchor, FamilyOwnerAttestation } from './types.js';

/**
 * Same netstring-style length-prefixed scheme as
 * familytrustset/canonicalize.ts and familyenvelope/canonicalize.ts, for
 * the same reason: no field value can be crafted to make two structurally
 * different objects canonicalize to the same byte string, sidestepping any
 * JSON-key-ordering question entirely. The domain separator is always the
 * FIRST field, so a genesis-anchor signature can never be replayed as an
 * attestation signature or vice versa (mission Section 8) even if every
 * other field coincidentally matched.
 */
function netstring(fields: readonly string[]): string {
  return fields.map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`).join('');
}

export function canonicalizeGenesisAnchor(anchor: Omit<FamilyAuthorityGenesisAnchor, 'signature'>): string {
  return netstring([
    GENESIS_ANCHOR_DOMAIN,
    anchor.familyId,
    anchor.genesisDeviceId,
    anchor.genesisDskKeyId,
    anchor.genesisDskPublicKey,
    String(anchor.protocolVersion),
    anchor.createdAt.toISOString(),
  ]);
}

export function canonicalizeOwnerAttestation(attestation: Omit<FamilyOwnerAttestation, 'signature'>): string {
  return netstring([
    OWNER_ATTESTATION_DOMAIN,
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
  ]);
}

/**
 * Content-addressed id for an already-signed attestation: sha256 of its
 * canonical (unsigned) bytes concatenated with its signature. NOT itself
 * signed material -- purely a lookup/linkage key the server assigns after
 * verification, exactly as familyenvelope-style ledgers key idempotency
 * records off content hashes rather than caller-supplied ids.
 */
export function computeAttestationId(attestation: FamilyOwnerAttestation): AttestationId {
  const canonicalBytes = canonicalizeOwnerAttestation(attestation);
  return createHash('sha256').update(canonicalBytes, 'utf8').update(':', 'utf8').update(attestation.signature, 'utf8').digest('hex');
}
