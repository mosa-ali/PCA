import { decodeCanonicalTrustSetEpochBytes } from './decode.js';
import { canonicalizeTrustSetEpoch } from './canonicalize.js';
import { activeOwnerCount, findActiveOwner, findDuplicateIdentity } from './FamilyTrustSetEngine.js';
import { isFamilyEpochNumber } from '../familyepoch/bounds.js';
import { isPlausibleOpaqueId, isPlausibleSignature } from './policy.js';
import type { TrustSetEpochRecord, TrustSetEpochStore } from './TrustSetEpochStore.js';
import { isActorResolutionFailure, type TrustSetRoleResolver } from '../familyrbac/TrustSetRoleResolver.js';
import type { RemovalDecisionSigningKey, RemovalDecisionSigningKeyResolver } from '../familyrbac/RemovalDecisionAuthority.js';
import type { DeviceRepository } from '../device/DeviceRepository.js';

const MAX_SIGNED_EPOCH_BYTES = 262_144;
const PARENT_ROLES = new Set(['OWNER', 'ADMINISTRATOR', 'VIEWER']);

export interface StoreBackedRemovalDecisionSigningKeyResolverDeps {
  epochStore: Pick<TrustSetEpochStore, 'readLatestEpoch'>;
  trustSetRoleResolver: Pick<TrustSetRoleResolver, 'resolveActor'>;
  deviceRepository: Pick<DeviceRepository, 'isDeviceSessionActive' | 'findKeysByDeviceForFamily'>;
}

/**
 * Resolves the current parent DSK from the accepted Trust Set and independent
 * device-key directory. The shared TrustSetRoleResolver verifies the accepted
 * head and current membership; this adapter additionally requires the exact
 * accepted member DSK to remain active in the directory before exposing its
 * public key to RemovalDecisionAuthority. Any missing, corrupt, stale, or
 * unavailable source fails closed as `null`.
 *
 * This does not activate a production signature suite. The production
 * DeviceSignatureVerifier remains rejecting until its separate crypto review
 * gate is closed.
 */
export class StoreBackedRemovalDecisionSigningKeyResolver implements RemovalDecisionSigningKeyResolver {
  constructor(private readonly deps: StoreBackedRemovalDecisionSigningKeyResolverDeps) {}

  async resolve(familyId: string, actorDeviceId: string): Promise<RemovalDecisionSigningKey | null> {
    if (!isPlausibleOpaqueId(familyId) || !isPlausibleOpaqueId(actorDeviceId)) return null;
    try {
      const acceptedHead = await this.deps.epochStore.readLatestEpoch(familyId);
      if (acceptedHead === null || !validAcceptedRecord(acceptedHead, familyId)) return null;
      const epoch = decodeCanonicalTrustSetEpochBytes(acceptedHead.signedEpochBytes);
      const member = epoch.entries.find((entry) => entry.deviceId === actorDeviceId);
      if (member === undefined || member.status !== 'ACTIVE' || !PARENT_ROLES.has(member.role)) return null;

      // Resolver is the verified authority boundary. Supplying the exact DSK
      // key id binds this lookup to the key in the accepted membership entry.
      const actor = await this.deps.trustSetRoleResolver.resolveActor(familyId, actorDeviceId, member.dskKeyId);
      if (isActorResolutionFailure(actor) || !actor || typeof actor !== 'object' ||
          actor.deviceId !== actorDeviceId || actor.role !== member.role ||
          actor.trustSetEpoch !== acceptedHead.trustSetEpoch || actor.keyEpoch !== acceptedHead.keyEpoch) return null;

      if (!await this.deps.deviceRepository.isDeviceSessionActive(familyId, actorDeviceId)) return null;
      const matchingKeys = (await this.deps.deviceRepository.findKeysByDeviceForFamily(familyId, actorDeviceId))
        .filter((key) => key.keyPurpose === 'DSK' && key.keyId === member.dskKeyId);
      if (matchingKeys.length !== 1 || matchingKeys[0].status !== 'ACTIVE' ||
          matchingKeys[0].publicKey !== member.dskPublicKey) return null;

      // Avoid returning a key from a snapshot that changed while membership
      // and directory state were checked.
      const currentHead = await this.deps.epochStore.readLatestEpoch(familyId);
      if (currentHead === null || !sameAcceptedRecord(acceptedHead, currentHead)) return null;
      return { familyId, deviceId: actorDeviceId, publicKey: member.dskPublicKey };
    } catch {
      return null;
    }
  }
}

function validAcceptedRecord(record: TrustSetEpochRecord, familyId: string): boolean {
  try {
    if (record.familyId !== familyId || !Buffer.isBuffer(record.signedEpochBytes) ||
        record.signedEpochBytes.length < 1 || record.signedEpochBytes.length > MAX_SIGNED_EPOCH_BYTES ||
        !isFamilyEpochNumber(record.trustSetEpoch, 1) || !isFamilyEpochNumber(record.keyEpoch, 1) ||
        !isPlausibleSignature(record.signature) || !isPlausibleOpaqueId(record.signerDeviceId) ||
        !isPlausibleOpaqueId(record.signerKeyId) || !(record.issuedAt instanceof Date) ||
        !Number.isFinite(record.issuedAt.getTime()) || !(record.receivedAt instanceof Date) ||
        !Number.isFinite(record.receivedAt.getTime())) return false;
    const epoch = decodeCanonicalTrustSetEpochBytes(record.signedEpochBytes);
    const owner = findActiveOwner(epoch);
    return epoch.familyId === familyId && epoch.trustSetEpoch === record.trustSetEpoch &&
      epoch.keyEpoch === record.keyEpoch && epoch.supersedesEpoch === record.supersedesEpoch &&
      epoch.issuedAt.getTime() === record.issuedAt.getTime() && activeOwnerCount(epoch.entries) === 1 &&
      !findDuplicateIdentity(epoch.entries) && owner !== null &&
      owner.deviceId === record.signerDeviceId && owner.dskKeyId === record.signerKeyId &&
      canonicalizeTrustSetEpoch(epoch) === record.signedEpochBytes.toString('utf8');
  } catch {
    return false;
  }
}

function sameAcceptedRecord(a: TrustSetEpochRecord, b: TrustSetEpochRecord): boolean {
  return a.familyId === b.familyId && a.trustSetEpoch === b.trustSetEpoch && a.keyEpoch === b.keyEpoch &&
    a.supersedesEpoch === b.supersedesEpoch && a.signerDeviceId === b.signerDeviceId &&
    a.signerKeyId === b.signerKeyId && a.signature === b.signature &&
    a.issuedAt instanceof Date && b.issuedAt instanceof Date && a.issuedAt.getTime() === b.issuedAt.getTime() &&
    a.receivedAt instanceof Date && b.receivedAt instanceof Date && a.receivedAt.getTime() === b.receivedAt.getTime() &&
    Buffer.isBuffer(a.signedEpochBytes) && Buffer.isBuffer(b.signedEpochBytes) &&
    a.signedEpochBytes.equals(b.signedEpochBytes);
}
