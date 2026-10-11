import type { FamilyAuthorityAttestationChainStore } from '../familycommercial/authority/AttestationChainStore.js';
import { canonicalizeOwnerAttestation, computeAttestationId } from '../familycommercial/authority/canonicalize.js';
import { OWNER_ATTESTATION_DOMAIN } from '../familycommercial/authority/types.js';
import type { FamilyOwnerAttestation } from '../familycommercial/authority/types.js';
import { hasSaneAttestationTemporalPolicy } from '../familycommercial/authority/policy.js';
import type { DeviceSignatureVerifier } from '../deviceauth/DeviceSignatureVerifier.js';
import { isFamilyEpochNumber } from '../familyepoch/bounds.js';
import type { FamilyAuthorityKeyResolver } from '../familycommercial/authority/FamilyAuthorityKeyResolver.js';
import type { OpaqueDeviceId, OpaqueFamilyId } from '../familytrustset/types.js';
import { isActorResolutionFailure } from './TrustSetRoleResolver.js';
import type { TrustSetRoleResolver } from './TrustSetRoleResolver.js';

/**
 * Resolves FamilyAudit delivery to the attested current Owner only when that
 * same device and DSK are still an active OWNER in the server's current,
 * accepted Trust Set. Attestation epochs are lineage/freshness metadata, not
 * a live FTS key epoch, so the delivery epoch always comes from resolveActor.
 */
export class FamilyAuditParentDeviceResolver {
  constructor(
    private readonly chainStore: FamilyAuthorityAttestationChainStore,
    private readonly trustSetRoleResolver: TrustSetRoleResolver,
    private readonly signatureVerifier: DeviceSignatureVerifier,
    private readonly keyResolver: FamilyAuthorityKeyResolver,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolveParentDevices(familyId: OpaqueFamilyId): Promise<Array<{ deviceId: OpaqueDeviceId; keyEpoch: number }>> {
    try {
      const head = await this.chainStore.findHead(familyId);
      if (
        head === null ||
        head.familyId !== familyId ||
        head.status !== 'ACTIVE' ||
        !isFamilyEpochNumber(head.headRevision, 1) ||
        !isFamilyEpochNumber(head.requiredTrustSetEpoch, 1) ||
        !isFamilyEpochNumber(head.requiredKeyEpoch, 1)
      ) return [];

      const attestation = await this.chainStore.findAttestationById(familyId, head.headAttestationId);
      if (!isCurrentOwnerAttestation(attestation, familyId, this.now()) ||
        attestation.attestationRevision !== head.headRevision ||
        attestation.trustSetEpoch < head.requiredTrustSetEpoch ||
        attestation.keyEpoch < head.requiredKeyEpoch ||
        computeAttestationId(attestation) !== head.headAttestationId) return [];

      // A valid signature over an embedded public key is not enough: both
      // the signed Owner identity and the current attestation signer must
      // still resolve to their exact active DSKs in the independent device
      // directory, as in FamilyOwnerAttestationChainEngine's read path.
      for (const key of [
        { deviceId: attestation.ownerDeviceId, keyId: attestation.ownerDskKeyId, publicKey: attestation.ownerDskPublicKey },
        { deviceId: attestation.signerDeviceId, keyId: attestation.signerDskKeyId, publicKey: attestation.signerDskPublicKey },
      ]) {
        if (!await this.keyResolver.isActiveDsk({ familyId, ...key })) return [];
      }

      const canonicalBytes = canonicalizeOwnerAttestation(attestation);
      if (!await this.signatureVerifier.verify(attestation.signerDskPublicKey, canonicalBytes, attestation.signature)) return [];

      // Bind resolution to the attested DSK: a device/key change makes the
      // owner attestation stale and must not silently redirect audit delivery.
      const actor = await this.trustSetRoleResolver.resolveActor(
        familyId,
        attestation.ownerDeviceId,
        attestation.ownerDskKeyId,
      );
      if (
        isActorResolutionFailure(actor) ||
        actor.deviceId !== attestation.ownerDeviceId ||
        actor.role !== 'OWNER' ||
        !isFamilyEpochNumber(actor.trustSetEpoch, 1) ||
        !isFamilyEpochNumber(actor.keyEpoch, 1) ||
        actor.trustSetEpoch < head.requiredTrustSetEpoch ||
        actor.keyEpoch < head.requiredKeyEpoch
      ) return [];

      // TrustSetRoleResolver returns a ResolvedActor only for an active member;
      // its keyEpoch is the current server-accepted FDEK generation.
      return [{ deviceId: actor.deviceId, keyEpoch: actor.keyEpoch }];
    } catch {
      // Chain reads, row canonicalization, verifier failures and current-role
      // resolution all fail closed: never emit an audit delivery recipient on
      // incomplete or contradictory authority evidence. Propagate a sanitized
      // failure so FamilyAuditEventProducer can distinguish an authority
      // outage from a valid empty recipient list and emit its bounded warning.
      throw new Error('family_audit_parent_device_resolution_unavailable');
    }
  }
}

function isCurrentOwnerAttestation(
  attestation: FamilyOwnerAttestation | null,
  familyId: OpaqueFamilyId,
  now: Date,
): attestation is FamilyOwnerAttestation {
  return attestation !== null &&
    attestation.familyId === familyId &&
    attestation.purpose === OWNER_ATTESTATION_DOMAIN &&
    isFamilyEpochNumber(attestation.attestationRevision, 1) &&
    typeof attestation.ownerDeviceId === 'string' && attestation.ownerDeviceId.length > 0 &&
    typeof attestation.ownerDskKeyId === 'string' && attestation.ownerDskKeyId.length > 0 &&
    typeof attestation.ownerDskPublicKey === 'string' && attestation.ownerDskPublicKey.length > 0 &&
    typeof attestation.signerDeviceId === 'string' && attestation.signerDeviceId.length > 0 &&
    typeof attestation.signerDskKeyId === 'string' && attestation.signerDskKeyId.length > 0 &&
    typeof attestation.signerDskPublicKey === 'string' && attestation.signerDskPublicKey.length > 0 &&
    typeof attestation.signature === 'string' && attestation.signature.length > 0 &&
    isFamilyEpochNumber(attestation.trustSetEpoch, 1) &&
    isFamilyEpochNumber(attestation.keyEpoch, 1) &&
    now instanceof Date &&
    !Number.isNaN(now.getTime()) &&
    hasSaneAttestationTemporalPolicy(attestation.issuedAt, attestation.expiresAt, now);
}
