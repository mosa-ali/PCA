import type { FamilyAuthorityAttestationChainStore } from '../familycommercial/authority/AttestationChainStore.js';

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
 * truth" header). The one genuinely real, server-queryable, signature-verified
 * per-device parent record in this codebase is the family's current Owner,
 * via `FamilyAuthorityAttestationChainStore` (PCA-FAMILY-AUTH-1-R1) -- a
 * different bounded context (commercial-authority verification, not family
 * E2EE trust), reused here only because it is the one honest, non-fabricated
 * source available. `findHead` -> `findAttestationById` yields the current
 * Owner's `ownerDeviceId` plus the `keyEpoch` that attestation was issued
 * against (a lineage/freshness snapshot, not a guaranteed-live FTS epoch --
 * see FamilyOwnerAttestation's own doc comment).
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
    const attestation = await this.chainStore.findAttestationById(familyId, head.headAttestationId);
    if (attestation === null) return [];
    return [{ deviceId: attestation.ownerDeviceId, keyEpoch: attestation.keyEpoch }];
  }
}
