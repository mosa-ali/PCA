import type { DeviceSignatureVerifier } from '../../deviceauth/DeviceSignatureVerifier.js';
import type { OpaqueDeviceId, OpaqueFamilyId } from '../../familytrustset/types.js';
import { canonicalizeGenesisAnchor, canonicalizeOwnerAttestation, computeAttestationId } from './canonicalize.js';
import { MAX_ATTESTATION_TTL_MS, MIN_ATTESTATION_TTL_MS } from './policy.js';
import { FAMILY_AUTHORITY_PROTOCOL_VERSION, OWNER_ATTESTATION_DOMAIN } from './types.js';
import type { AttestationId, FamilyAuthorityGenesisAnchor, FamilyOwnerAttestation } from './types.js';
import type { FamilyAuthorityGenesisStore } from './GenesisAnchorStore.js';
import type { FamilyAuthorityAttestationChainStore } from './AttestationChainStore.js';

export interface BootstrapFamilyAuthorityInput {
  anchor: FamilyAuthorityGenesisAnchor;
  /** Revision 1, self-certified by the genesis device -- see types.ts's FamilyOwnerAttestation doc. */
  genesisAttestation: FamilyOwnerAttestation;
}

export type BootstrapFamilyAuthorityResult =
  | { readonly status: 'BOOTSTRAPPED'; readonly anchor: FamilyAuthorityGenesisAnchor; readonly attestationId: AttestationId }
  | { readonly status: 'ALREADY_BOOTSTRAPPED'; readonly anchor: FamilyAuthorityGenesisAnchor }
  | { readonly status: 'INVALID_PROOF'; readonly reason: string };

export type TransferOwnerAuthorityResult =
  | { readonly status: 'TRANSFERRED'; readonly attestationId: AttestationId }
  | { readonly status: 'AUTHORITY_UNAVAILABLE' }
  | { readonly status: 'STALE_OR_REVOKED' }
  | { readonly status: 'INVALID_PROOF'; readonly reason: string }
  | { readonly status: 'REJECTED_STALE_REVISION' };

export type ResolveCurrentOwnerResult =
  | { readonly status: 'OWNER_AUTHORIZED' }
  | { readonly status: 'ROLE_DENIED' }
  | { readonly status: 'AUTHORITY_UNAVAILABLE' }
  | { readonly status: 'STALE_OR_REVOKED' }
  | { readonly status: 'INVALID_PROOF' };

/**
 * Bounds the attestation's OWN (issuedAt, expiresAt) duration only --
 * mission Section 14's "not too long" half. Freshness relative to the
 * CURRENT time ("was this actually issued recently, not merely not-yet-
 * expired") is enforced separately, at every resolution/transfer call, by
 * comparing the live clock against `expiresAt` (never against `issuedAt`):
 * see resolveCurrentOwner/transferOwnerAuthority's own `now() >
 * expiresAt` checks. Deliberately NOT also comparing `now` to `issuedAt`
 * here: at ingestion time those two are expected to be close, but nothing
 * downstream depends on that -- the real freshness guarantee always comes
 * from the expiry check, so this function stays a pure, clock-independent
 * shape check (easier to reason about, and correct even if ingestion is
 * processed slightly out of band from issuance).
 */
function hasSaneTtl(issuedAt: Date, expiresAt: Date): boolean {
  const ttl = expiresAt.getTime() - issuedAt.getTime();
  return ttl >= MIN_ATTESTATION_TTL_MS && ttl <= MAX_ATTESTATION_TTL_MS;
}

/**
 * PCA-DEC-025 Option A. The ONLY component in this codebase that ever
 * writes durable Family-Owner authority state, and it never invents that
 * state -- every write here is the atomic persistence of an ALREADY
 * cryptographically verified artifact (genesis self-certification, or an
 * outgoing-Owner-signed transfer). This is the "backend is a VERIFIER"
 * boundary the mission requires: no method here can make a device Owner
 * except by checking a signature this class did not produce.
 *
 * Read paths (resolveCurrentOwner) re-verify the stored head's signature
 * on every call rather than trusting a persisted boolean -- belt-and-
 * suspenders against a hypothetically tampered row, at the cost of one
 * signature verification per resolution (cheap; no network I/O beyond the
 * store read already required).
 */
export class FamilyOwnerAttestationChainEngine {
  constructor(
    private readonly genesisStore: FamilyAuthorityGenesisStore,
    private readonly chainStore: FamilyAuthorityAttestationChainStore,
    private readonly signatureVerifier: DeviceSignatureVerifier,
    private readonly now: () => Date,
  ) {}

  async bootstrapFamilyAuthority(input: BootstrapFamilyAuthorityInput): Promise<BootstrapFamilyAuthorityResult> {
    const { anchor, genesisAttestation } = input;

    if (anchor.protocolVersion !== FAMILY_AUTHORITY_PROTOCOL_VERSION) {
      return { status: 'INVALID_PROOF', reason: 'UNSUPPORTED_PROTOCOL_VERSION' };
    }
    const anchorValid = await this.signatureVerifier.verify(
      anchor.genesisDskPublicKey,
      canonicalizeGenesisAnchor(anchor),
      anchor.signature,
    );
    if (!anchorValid) return { status: 'INVALID_PROOF', reason: 'GENESIS_SIGNATURE_INVALID' };

    const attestationReason = this.validateGenesisAttestationShape(anchor, genesisAttestation);
    if (attestationReason !== null) return { status: 'INVALID_PROOF', reason: attestationReason };
    if (!hasSaneTtl(genesisAttestation.issuedAt, genesisAttestation.expiresAt)) {
      return { status: 'INVALID_PROOF', reason: 'IMPLAUSIBLE_VALIDITY_WINDOW' };
    }
    const attestationValid = await this.signatureVerifier.verify(
      genesisAttestation.signerDskPublicKey,
      canonicalizeOwnerAttestation(genesisAttestation),
      genesisAttestation.signature,
    );
    if (!attestationValid) return { status: 'INVALID_PROOF', reason: 'GENESIS_ATTESTATION_SIGNATURE_INVALID' };

    const existing = await this.genesisStore.findByFamilyId(anchor.familyId);
    if (existing !== null) return { status: 'ALREADY_BOOTSTRAPPED', anchor: existing };

    const persisted = await this.genesisStore.createIfAbsent(anchor);
    if (persisted.genesisDeviceId !== anchor.genesisDeviceId || persisted.signature !== anchor.signature) {
      // A concurrent bootstrap for the same family won the race first --
      // mission Section 26: exactly one canonical genesis, never two roots.
      return { status: 'ALREADY_BOOTSTRAPPED', anchor: persisted };
    }

    const attestationId = computeAttestationId(genesisAttestation);
    const appendResult = await this.chainStore.appendIfCurrentRevision(genesisAttestation, attestationId, 0);
    if (appendResult === 'REJECTED_STALE_REVISION') {
      return { status: 'ALREADY_BOOTSTRAPPED', anchor: persisted };
    }
    return { status: 'BOOTSTRAPPED', anchor: persisted, attestationId };
  }

  async transferOwnerAuthority(
    familyId: OpaqueFamilyId,
    nextAttestation: FamilyOwnerAttestation,
  ): Promise<TransferOwnerAuthorityResult> {
    const anchor = await this.genesisStore.findByFamilyId(familyId);
    if (anchor === null) return { status: 'AUTHORITY_UNAVAILABLE' };

    const head = await this.chainStore.findHead(familyId);
    if (head === null) return { status: 'AUTHORITY_UNAVAILABLE' };
    if (head.status === 'REVOKED') return { status: 'STALE_OR_REVOKED' };

    const currentAttestation = await this.chainStore.findAttestationById(familyId, head.headAttestationId);
    if (currentAttestation === null) return { status: 'AUTHORITY_UNAVAILABLE' };

    const currentValid = await this.signatureVerifier.verify(
      currentAttestation.signerDskPublicKey,
      canonicalizeOwnerAttestation(currentAttestation),
      currentAttestation.signature,
    );
    if (!currentValid) return { status: 'INVALID_PROOF', reason: 'CURRENT_HEAD_SIGNATURE_INVALID' };
    if (this.now().getTime() > currentAttestation.expiresAt.getTime()) return { status: 'STALE_OR_REVOKED' };

    const reason = this.validateTransferShape(familyId, head.headAttestationId, head.headRevision, currentAttestation, nextAttestation);
    if (reason !== null) return { status: 'INVALID_PROOF', reason };
    if (!hasSaneTtl(nextAttestation.issuedAt, nextAttestation.expiresAt)) {
      return { status: 'INVALID_PROOF', reason: 'IMPLAUSIBLE_VALIDITY_WINDOW' };
    }

    const nextValid = await this.signatureVerifier.verify(
      nextAttestation.signerDskPublicKey,
      canonicalizeOwnerAttestation(nextAttestation),
      nextAttestation.signature,
    );
    if (!nextValid) return { status: 'INVALID_PROOF', reason: 'TRANSFER_SIGNATURE_INVALID' };

    const attestationId = computeAttestationId(nextAttestation);
    const appendResult = await this.chainStore.appendIfCurrentRevision(nextAttestation, attestationId, head.headRevision);
    if (appendResult === 'REJECTED_STALE_REVISION') return { status: 'REJECTED_STALE_REVISION' };
    return { status: 'TRANSFERRED', attestationId };
  }

  /** Mechanical revocation only -- the CALLER is responsible for having already established that the request is itself authorized (e.g. the currently-resolved Owner's own request path), mirroring every other narrow engine in this codebase that never re-derives authorization it was handed. */
  async revokeCurrentOwner(familyId: OpaqueFamilyId): Promise<void> {
    await this.chainStore.markHeadRevoked(familyId, this.now());
  }

  async resolveCurrentOwner(familyId: OpaqueFamilyId, actorDeviceId: OpaqueDeviceId): Promise<ResolveCurrentOwnerResult> {
    const head = await this.chainStore.findHead(familyId);
    if (head === null) return { status: 'AUTHORITY_UNAVAILABLE' };
    if (head.status === 'REVOKED') return { status: 'STALE_OR_REVOKED' };

    const attestation = await this.chainStore.findAttestationById(familyId, head.headAttestationId);
    if (attestation === null) return { status: 'AUTHORITY_UNAVAILABLE' };
    if (attestation.familyId !== familyId || attestation.purpose !== OWNER_ATTESTATION_DOMAIN) {
      return { status: 'INVALID_PROOF' };
    }

    const valid = await this.signatureVerifier.verify(
      attestation.signerDskPublicKey,
      canonicalizeOwnerAttestation(attestation),
      attestation.signature,
    );
    if (!valid) return { status: 'INVALID_PROOF' };
    if (this.now().getTime() > attestation.expiresAt.getTime()) return { status: 'STALE_OR_REVOKED' };

    return attestation.ownerDeviceId === actorDeviceId ? { status: 'OWNER_AUTHORIZED' } : { status: 'ROLE_DENIED' };
  }

  private validateGenesisAttestationShape(
    anchor: FamilyAuthorityGenesisAnchor,
    attestation: FamilyOwnerAttestation,
  ): string | null {
    if (attestation.familyId !== anchor.familyId) return 'FAMILY_MISMATCH';
    if (attestation.purpose !== OWNER_ATTESTATION_DOMAIN) return 'DOMAIN_MISMATCH';
    if (attestation.attestationRevision !== 1) return 'GENESIS_REVISION_MUST_BE_1';
    if (attestation.previousAttestationId !== null) return 'GENESIS_MUST_HAVE_NO_PREVIOUS';
    if (attestation.ownerDeviceId !== anchor.genesisDeviceId) return 'GENESIS_OWNER_MUST_BE_GENESIS_DEVICE';
    if (attestation.ownerDskKeyId !== anchor.genesisDskKeyId) return 'GENESIS_OWNER_KEY_MISMATCH';
    if (attestation.ownerDskPublicKey !== anchor.genesisDskPublicKey) return 'GENESIS_OWNER_KEY_MISMATCH';
    if (attestation.signerDeviceId !== anchor.genesisDeviceId) return 'GENESIS_SIGNER_MUST_SELF_CERTIFY';
    if (attestation.signerDskKeyId !== anchor.genesisDskKeyId) return 'GENESIS_SIGNER_KEY_MISMATCH';
    if (attestation.signerDskPublicKey !== anchor.genesisDskPublicKey) return 'GENESIS_SIGNER_KEY_MISMATCH';
    return null;
  }

  private validateTransferShape(
    familyId: OpaqueFamilyId,
    headAttestationId: AttestationId,
    headRevision: number,
    currentAttestation: FamilyOwnerAttestation,
    nextAttestation: FamilyOwnerAttestation,
  ): string | null {
    if (nextAttestation.familyId !== familyId) return 'FAMILY_MISMATCH';
    if (nextAttestation.purpose !== OWNER_ATTESTATION_DOMAIN) return 'DOMAIN_MISMATCH';
    if (nextAttestation.attestationRevision !== headRevision + 1) return 'REVISION_NOT_MONOTONIC';
    if (nextAttestation.previousAttestationId !== headAttestationId) return 'BROKEN_CHAIN_LINK';
    if (nextAttestation.signerDeviceId !== currentAttestation.ownerDeviceId) return 'SIGNER_MUST_BE_OUTGOING_OWNER';
    if (nextAttestation.signerDskKeyId !== currentAttestation.ownerDskKeyId) return 'SIGNER_KEY_MISMATCH';
    if (nextAttestation.signerDskPublicKey !== currentAttestation.ownerDskPublicKey) return 'SIGNER_KEY_MISMATCH';
    return null;
  }
}
