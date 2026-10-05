import type { FamilyAuthorityAttestationChainStore } from '../familycommercial/authority/AttestationChainStore.js';
import { isFamilyEpochNumber } from '../familyepoch/bounds.js';

/**
 * PCA-ADD-ENR-020's `RemovalDecisionAlerting.resolveParentDevices` real
 * implementation.
 *
 * Honest scope, established during a full-repo investigation before writing
 * this: there is no dedicated per-account parent-device/key registry in
 * this codebase (`parent_accounts` is pure account identity with no
 * device_id/public_key/key_epoch columns; the Family Trust Set is
 * explicitly device-local-only, never server-queryable -- see
 * FamilyTrustSetStore's own "device-local, never server-side source of
 * truth" header). The available per-device Parent record is the family's
 * current Owner, read via `FamilyAuthorityAttestationChainStore`
 * (PCA-FAMILY-AUTH-1-R1). This resolver is routing metadata only: it does not
 * invoke the attestation engine or independently verify the stored signature.
 * Its returned keyEpoch is the attestation's lineage/freshness snapshot, not
 * a guaranteed-live FTS epoch (see FamilyOwnerAttestation's own doc comment).
 *
 * KNOWN GAP, not fabricated around: this resolves the Owner device only.
 * ADMINISTRATOR-role parent devices are never included, because no table or
 * repository in this codebase registers per-device keys for non-Owner
 * parent roles today. A family with only Administrator parents (no
 * attestation chain, or a revoked head) resolves to an empty array --
 * `RemovalDecisionAuthority.emitAlert` then addresses zero devices for that
 * family, which is the correct fail-closed behavior (never a guessed or
 * fabricated recipient) rather than a thrown error.
 */
export class MySqlOwnerParentDeviceResolver {
  constructor(private readonly chainStore: FamilyAuthorityAttestationChainStore) {}

  async resolveParentDevices(familyId: string): Promise<Array<{ deviceId: string; keyEpoch: number }>> {
    const head = await this.chainStore.findHead(familyId);
    if (head === null || head.status !== 'ACTIVE') return [];
    if (!isFamilyEpochNumber(head.requiredTrustSetEpoch, 1) || !isFamilyEpochNumber(head.requiredKeyEpoch, 1)) return [];
    const attestation = await this.chainStore.findAttestationById(familyId, head.headAttestationId);
    if (
      attestation === null ||
      !isFamilyEpochNumber(attestation.trustSetEpoch, 1) ||
      !isFamilyEpochNumber(attestation.keyEpoch, 1)
    ) return [];
    return [{ deviceId: attestation.ownerDeviceId, keyEpoch: attestation.keyEpoch }];
  }
}
