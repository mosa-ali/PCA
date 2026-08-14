import type { KeyId, OpaqueDeviceId, OpaqueFamilyId } from '../../familytrustset/types.js';

/**
 * PCA-FAMILY-AUTH-1-R1 (PCA-DEC-025, Option A: genesis-anchored Owner
 * attestation signature chain). This package is a VERIFIER, never an
 * authority: every type here is either (a) a signed artifact the server
 * only ever checks, or (b) verification/replay/currentness metadata the
 * server durably stores about artifacts it has checked. Nothing here is a
 * server-authored role assignment.
 */

/** Domain separator bound into every genesis anchor's signed bytes -- distinct from every other signature purpose in this codebase (deviceauth challenges, FTS epochs, family-control envelopes), so a signature produced for one context can never be replayed as valid in another (mission Section 8). */
export const GENESIS_ANCHOR_DOMAIN = 'PCA_FAMILY_AUTHORITY_GENESIS_V1' as const;

/** Domain separator bound into every Owner attestation's signed bytes. */
export const OWNER_ATTESTATION_DOMAIN = 'PCA_FAMILY_COMMERCIAL_OWNER_AUTHORITY_V1' as const;

export const FAMILY_AUTHORITY_PROTOCOL_VERSION = 1 as const;

/**
 * The per-family root of trust (mission Section 5). Recorded exactly once,
 * at the family's server-authorized bootstrap ceremony (Section 6) --
 * never via a general "make owner" endpoint. Self-signed by the genesis
 * device's own DSK (mirrors FamilyTrustSetEpoch's genesis-epoch
 * self-certification, familytrustset/types.ts). This anchor is NOT a
 * mutable `currentRole = OWNER` row: it never changes after creation, and
 * by itself does not say who the CURRENT Owner is -- only who founded the
 * family's trust lineage. "Who is Owner now" is answered by the
 * attestation chain (below), which the server can re-derive is
 * legitimate only because it traces back to this anchor.
 */
export interface FamilyAuthorityGenesisAnchor {
  familyId: OpaqueFamilyId;
  genesisDeviceId: OpaqueDeviceId;
  genesisDskKeyId: KeyId;
  genesisDskPublicKey: string;
  protocolVersion: number;
  createdAt: Date;
  /** Self-signed by genesisDskPublicKey's private key over canonicalizeGenesisAnchor(this, without signature). */
  signature: string;
}

/**
 * One signed, versioned link in a family's Owner-attestation chain
 * (mission Section 7/10/11). `attestationRevision` is strictly monotonic
 * per family, starting at 1. Revision 1 is ALWAYS self-certified by the
 * genesis device (ownerDeviceId === signerDeviceId === the genesis
 * anchor's genesisDeviceId) -- the bootstrap ceremony's own first
 * attestation, never a separate "assign Owner" action. Revision N > 1 is
 * an Owner-transfer: signed by the OUTGOING Owner (signerDeviceId is
 * revision N-1's ownerDeviceId), never by the incoming Owner or by any
 * other party -- the currently valid authority authorizes the next one,
 * exactly as FamilyTrustSetEpoch requires (mission Section 11).
 *
 * `trustSetEpoch`/`keyEpoch` bind this attestation to the device-side FTS
 * lineage it was issued against (freshness/lineage signal only -- this
 * package never resolves FTS content itself, see FamilyTrustSetStore's own
 * "device-local, never server-side source of truth" header).
 */
export interface FamilyOwnerAttestation {
  familyId: OpaqueFamilyId;
  purpose: typeof OWNER_ATTESTATION_DOMAIN;
  attestationRevision: number;
  ownerDeviceId: OpaqueDeviceId;
  ownerDskKeyId: KeyId;
  ownerDskPublicKey: string;
  trustSetEpoch: number;
  keyEpoch: number;
  issuedAt: Date;
  /** Bounded freshness window (mission Section 14) -- an attestation older than this can never authorize a commercial mutation, transfer or not. */
  expiresAt: Date;
  /** Chain linkage: the previous head's attestationId, or null only for revision 1. */
  previousAttestationId: string | null;
  signerDeviceId: OpaqueDeviceId;
  signerDskKeyId: KeyId;
  signerDskPublicKey: string;
  /** Signature over canonicalizeOwnerAttestation(this, without signature/attestationId) by signerDskPublicKey's private key. */
  signature: string;
}

/** Content-addressed id for a stored attestation (sha256 of its canonical bytes + signature) -- used for chain linkage and lookup, never itself signed material. */
export type AttestationId = string;

export type FamilyAuthorityChainHeadStatus = 'ACTIVE' | 'REVOKED';

/** Durable, mutable POINTER only -- never the authority itself. It names which already-verified attestation is currently canonical; it does not assign, invent, or override a role. */
export interface FamilyAuthorityChainHead {
  familyId: OpaqueFamilyId;
  headAttestationId: AttestationId;
  headRevision: number;
  status: FamilyAuthorityChainHeadStatus;
  updatedAt: Date;
}
