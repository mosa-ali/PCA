import type { DeviceSignatureVerifier } from '../../deviceauth/DeviceSignatureVerifier.js';
import type { OpaqueDeviceId, OpaqueFamilyId } from '../../familytrustset/types.js';
import { canonicalizeGenesisAnchor, canonicalizeOwnerAttestation, computeAttestationId } from './canonicalize.js';
import { MAX_ATTESTATION_TTL_MS, MIN_ATTESTATION_TTL_MS } from './policy.js';
import { FAMILY_AUTHORITY_PROTOCOL_VERSION, OWNER_ATTESTATION_DOMAIN } from './types.js';
import type { AttestationId, FamilyAuthorityGenesisAnchor, FamilyOwnerAttestation } from './types.js';
import type { FamilyAuthorityGenesisStore } from './GenesisAnchorStore.js';
import type { FamilyAuthorityAttestationChainStore } from './AttestationChainStore.js';
import type { FamilyAuthorityKeyResolver } from './FamilyAuthorityKeyResolver.js';
import { canonicalizeFamilyAuthorityRequestProof, type FamilyAuthorityRequestProofFields } from './requestProofProtocol.js';

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

/** A request-level proof is challenge-bound, not a caller-supplied device ID or message. */
export interface FamilyAuthorityRequestProof extends FamilyAuthorityRequestProofFields {
  signature: string;
}

export interface FamilyAuthorityRequestChallengeVerifier {
  /** Returns true only when the exact challenge is valid and consumed once. */
  consume(input: FamilyAuthorityRequestProofFields & { consumedAt: Date }): Promise<boolean>;
}

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
    private readonly keyResolver?: FamilyAuthorityKeyResolver,
    private readonly requestChallengeVerifier?: FamilyAuthorityRequestChallengeVerifier,
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
    if (this.keyResolver && !(await this.keyResolver.isActiveDsk({
      familyId: anchor.familyId,
      deviceId: anchor.genesisDeviceId,
      keyId: anchor.genesisDskKeyId,
      publicKey: anchor.genesisDskPublicKey,
    }))) {
      return { status: 'INVALID_PROOF', reason: 'GENESIS_DEVICE_KEY_NOT_ACTIVE' };
    }

    const attestationReason = this.validateGenesisAttestationShape(anchor, genesisAttestation);
    if (attestationReason !== null) return { status: 'INVALID_PROOF', reason: attestationReason };
    if (!hasSaneTtl(genesisAttestation.issuedAt, genesisAttestation.expiresAt)) {
      return { status: 'INVALID_PROOF', reason: 'IMPLAUSIBLE_VALIDITY_WINDOW' };
    }
    if (genesisAttestation.trustSetEpoch < 1 || genesisAttestation.keyEpoch < 1) {
      return { status: 'INVALID_PROOF', reason: 'INVALID_EPOCH' };
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
    if (this.keyResolver && !(await this.keyResolver.isActiveDsk({
      familyId,
      deviceId: currentAttestation.signerDeviceId,
      keyId: currentAttestation.signerDskKeyId,
      publicKey: currentAttestation.signerDskPublicKey,
    }))) {
      return { status: 'INVALID_PROOF', reason: 'CURRENT_SIGNER_KEY_NOT_ACTIVE' };
    }

    const currentValid = await this.signatureVerifier.verify(
      currentAttestation.signerDskPublicKey,
      canonicalizeOwnerAttestation(currentAttestation),
      currentAttestation.signature,
    );
    if (!currentValid) return { status: 'INVALID_PROOF', reason: 'CURRENT_HEAD_SIGNATURE_INVALID' };
    if (this.now().getTime() > currentAttestation.expiresAt.getTime()) return { status: 'STALE_OR_REVOKED' };

    const reason = this.validateTransferShape(familyId, head.headAttestationId, head.headRevision, currentAttestation, nextAttestation);
    if (reason !== null) return { status: 'INVALID_PROOF', reason };
    if (nextAttestation.trustSetEpoch < head.requiredTrustSetEpoch) {
      return { status: 'INVALID_PROOF', reason: 'TRUST_SET_EPOCH_DOWNGRADE' };
    }
    if (nextAttestation.keyEpoch < head.requiredKeyEpoch) {
      return { status: 'INVALID_PROOF', reason: 'KEY_EPOCH_DOWNGRADE' };
    }
    if (!hasSaneTtl(nextAttestation.issuedAt, nextAttestation.expiresAt)) {
      return { status: 'INVALID_PROOF', reason: 'IMPLAUSIBLE_VALIDITY_WINDOW' };
    }

    const nextValid = await this.signatureVerifier.verify(
      nextAttestation.signerDskPublicKey,
      canonicalizeOwnerAttestation(nextAttestation),
      nextAttestation.signature,
    );
    if (!nextValid) return { status: 'INVALID_PROOF', reason: 'TRANSFER_SIGNATURE_INVALID' };
    if (this.keyResolver && !(await this.keyResolver.isActiveDsk({
      familyId,
      deviceId: nextAttestation.signerDeviceId,
      keyId: nextAttestation.signerDskKeyId,
      publicKey: nextAttestation.signerDskPublicKey,
    }))) {
      return { status: 'INVALID_PROOF', reason: 'NEXT_SIGNER_KEY_NOT_ACTIVE' };
    }

    const attestationId = computeAttestationId(nextAttestation);
    const appendResult = await this.chainStore.appendIfCurrentRevision(nextAttestation, attestationId, head.headRevision);
    if (appendResult === 'REJECTED_STALE_REVISION') return { status: 'REJECTED_STALE_REVISION' };
    return { status: 'TRANSFERRED', attestationId };
  }

  /** Mechanical revocation only -- the CALLER is responsible for having already established that the request is itself authorized (e.g. the currently-resolved Owner's own request path), mirroring every other narrow engine in this codebase that never re-derives authorization it was handed. */
  async revokeCurrentOwner(familyId: OpaqueFamilyId): Promise<void> {
    await this.chainStore.markHeadRevoked(familyId, this.now());
  }

  /**
   * SECURITY GAP FLAGGED FOR THE PENDING HUMAN CRYPTO REVIEW (found during a
   * red-team pass; not fixed here because closing it correctly requires a
   * real device-authentication transport decision this lane does not own --
   * see below): `actorDeviceId` is whatever the HTTP route layer
   * (billingCheckoutRoutes.ts / familyCommercialRoutes.ts) read out of the
   * request body, with ONLY a length/shape check -- neither this method nor
   * either of those routes ever verifies that the ACTUAL caller of this
   * specific HTTP request possesses that device's key. The final
   * `attestation.ownerDeviceId === actorDeviceId` comparison below only
   * proves "the chain's cryptographically-attested Owner ID happens to
   * string-equal whatever the caller typed in the body" -- it is NOT proof
   * of possession for THIS request. Today that is safe only because
   * `this.signatureVerifier` is `RejectingDeviceSignatureVerifier` (see
   * main.ts's own wiring comment) -- `verify()` always returns false, so
   * every call returns INVALID_PROOF before this comparison is ever
   * reached, regardless of what `actorDeviceId` is. The moment a real,
   * accepting DeviceSignatureVerifier replaces it, this comparison starts
   * actually mattering, and ANY family-scoped caller who learns or guesses
   * the real Owner's deviceId (device IDs are not modeled as secrets
   * anywhere in this codebase) could self-authorize a paid checkout /
   * commercial mutation by simply asserting that ID -- no signature, no
   * session, no proof of anything about the CURRENT request. Every other
   * actor-device check in this codebase (childRequestRoutes.ts's
   * `requireActorDevice`, parentAccountRoutes.ts's
   * `authorizeSafeZoneRequest`) instead derives `actorDeviceId` EXCLUSIVELY
   * from a verified, proof-of-possession `DeviceSessionService` bearer
   * token, never a client-supplied body field alone -- whatever wires in
   * the real signature verifier here must add the equivalent binding to
   * billingCheckoutRoutes.ts/familyCommercialRoutes.ts (or to this method's
   * own contract) BEFORE that happens, or this reopens the exact
   * "Administrator can pay" gap PCA-BILL-2A-R1/PCA-FAMILY-AUTH-1-R1 were
   * built to close.
   */
  async resolveCurrentOwner(
    familyId: OpaqueFamilyId,
    actor: OpaqueDeviceId | FamilyAuthorityRequestProof,
    expectedServiceAccountId?: string,
    expectedOperation?: string,
    expectedRequestDigest?: string,
  ): Promise<ResolveCurrentOwnerResult> {
    // Production composition supplies a key resolver. In that mode the old
    // actorDeviceId-only API is deliberately rejected: an identifier is not
    // proof of possession. A proof is accepted only when its canonical
    // challenge is also consumed by an explicitly supplied verifier.
    if (this.keyResolver && typeof actor === 'string') return { status: 'INVALID_PROOF' };
    const actorDeviceId = typeof actor === 'string' ? actor : actor.deviceId;
    const head = await this.chainStore.findHead(familyId);
    if (head === null) return { status: 'AUTHORITY_UNAVAILABLE' };
    if (head.status === 'REVOKED') return { status: 'STALE_OR_REVOKED' };

    const attestation = await this.chainStore.findAttestationById(familyId, head.headAttestationId);
    if (attestation === null) return { status: 'AUTHORITY_UNAVAILABLE' };
    if (attestation.familyId !== familyId || attestation.purpose !== OWNER_ATTESTATION_DOMAIN) {
      return { status: 'INVALID_PROOF' };
    }
    if (this.keyResolver && !(await this.keyResolver.isActiveDsk({
      familyId,
      deviceId: attestation.ownerDeviceId,
      keyId: attestation.ownerDskKeyId,
      publicKey: attestation.ownerDskPublicKey,
    }))) {
      return { status: 'INVALID_PROOF' };
    }
    if (this.keyResolver && !(await this.keyResolver.isActiveDsk({
      familyId,
      deviceId: attestation.signerDeviceId,
      keyId: attestation.signerDskKeyId,
      publicKey: attestation.signerDskPublicKey,
    }))) {
      return { status: 'INVALID_PROOF' };
    }
    if (attestation.trustSetEpoch < head.requiredTrustSetEpoch || attestation.keyEpoch < head.requiredKeyEpoch) {
      return { status: 'STALE_OR_REVOKED' };
    }

    const valid = await this.signatureVerifier.verify(
      attestation.signerDskPublicKey,
      canonicalizeOwnerAttestation(attestation),
      attestation.signature,
    );
    if (!valid) return { status: 'INVALID_PROOF' };
    if (this.now().getTime() > attestation.expiresAt.getTime()) return { status: 'STALE_OR_REVOKED' };

    if (this.keyResolver) {
      const proof = actor as FamilyAuthorityRequestProof;
      if (!this.requestChallengeVerifier) return { status: 'INVALID_PROOF' };
      if (!expectedServiceAccountId || proof.serviceAccountId !== expectedServiceAccountId) return { status: 'INVALID_PROOF' };
      if (!expectedOperation || proof.operation !== expectedOperation) return { status: 'INVALID_PROOF' };
      if (!expectedRequestDigest || proof.requestDigest !== expectedRequestDigest) return { status: 'INVALID_PROOF' };
      let proofMessage: string;
      try {
        proofMessage = canonicalizeFamilyAuthorityRequestProof(proof);
      } catch {
        return { status: 'INVALID_PROOF' };
      }
      const proofValid = await this.signatureVerifier.verify(proof.publicKey, proofMessage, proof.signature);
      if (!proofValid || proof.deviceId !== attestation.ownerDeviceId || proof.keyId !== attestation.ownerDskKeyId || proof.publicKey !== attestation.ownerDskPublicKey) {
        return { status: 'INVALID_PROOF' };
      }
      const challengeConsumed = await this.requestChallengeVerifier.consume({ ...proof, consumedAt: this.now() });
      if (!challengeConsumed) return { status: 'INVALID_PROOF' };
    }
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
