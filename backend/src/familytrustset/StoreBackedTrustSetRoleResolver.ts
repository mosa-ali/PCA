import { FamilyTrustSetRoleResolver } from '../familyrbac/TrustSetRoleResolver.js';
import type { ActorResolutionFailure, ResolvedActor, TrustSetRoleResolver } from '../familyrbac/TrustSetRoleResolver.js';
import type { DeviceRepository } from '../device/DeviceRepository.js';
import { canonicalizeTrustSetEpoch } from './canonicalize.js';
import { activeOwnerCount, findActiveOwner, findDuplicateIdentity } from './FamilyTrustSetEngine.js';
import { decodeCanonicalTrustSetEpochBytes } from './decode.js';
import type { FamilyTrustSetStore } from './FamilyTrustSetStore.js';
import type { TrustSetEpochRecord, TrustSetEpochStore } from './TrustSetEpochStore.js';
import type { TrustSetSignatureVerifier } from './TrustSetSignatureVerifier.js';
import type { OpaqueDeviceId, OpaqueFamilyId } from './types.js';

// Match the maximum accepted-record size enforced before persistence. Role
// resolution runs on many authenticated routes and must reject a corrupt or
// manually altered oversized row before decoding/copying its payload.
const MAX_SIGNED_EPOCH_BYTES = 262_144;

export interface StoreBackedTrustSetRoleResolverDeps {
  epochStore: TrustSetEpochStore;
  /** Current device/key lifecycle state, independent of accepted epoch bytes. */
  deviceRepository: Pick<DeviceRepository, 'isDeviceSessionActive' | 'findKeysByDeviceForFamily'>;
  verifier: TrustSetSignatureVerifier;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function sameAcceptedHead(
  left: Awaited<ReturnType<TrustSetEpochStore['readLatestEpoch']>>,
  right: Awaited<ReturnType<TrustSetEpochStore['readLatestEpoch']>>,
): boolean {
  if (left === null || right === null) return left === right;
  return left.familyId === right.familyId &&
    left.trustSetEpoch === right.trustSetEpoch &&
    left.keyEpoch === right.keyEpoch &&
    left.supersedesEpoch === right.supersedesEpoch &&
    Buffer.isBuffer(left.signedEpochBytes) && Buffer.isBuffer(right.signedEpochBytes) &&
    left.signedEpochBytes.equals(right.signedEpochBytes) &&
    left.signature === right.signature &&
    left.signerKeyId === right.signerKeyId &&
    left.signerDeviceId === right.signerDeviceId &&
    isValidDate(left.issuedAt) && isValidDate(right.issuedAt) &&
    left.issuedAt.getTime() === right.issuedAt.getTime() &&
    isValidDate(left.receivedAt) && isValidDate(right.receivedAt) &&
    left.receivedAt.getTime() === right.receivedAt.getTime();
}

function snapshotAcceptedHead(record: TrustSetEpochRecord): TrustSetEpochRecord {
  return {
    familyId: record.familyId,
    trustSetEpoch: record.trustSetEpoch,
    keyEpoch: record.keyEpoch,
    supersedesEpoch: record.supersedesEpoch,
    signedEpochBytes: Buffer.from(record.signedEpochBytes),
    signature: record.signature,
    signerKeyId: record.signerKeyId,
    signerDeviceId: record.signerDeviceId,
    issuedAt: new Date(record.issuedAt.getTime()),
    receivedAt: new Date(record.receivedAt.getTime()),
  };
}

/**
 * Server-side role resolution against the durably ACCEPTED Family Trust Set
 * epochs: the same authorization question the device-local
 * FamilyTrustSetRoleResolver answers, but answered from the server's
 * accepted-epoch history instead of a device's own store.
 *
 * RESULT CONTRACT: identical to TrustSetRoleResolver /
 * UnavailableTrustSetRoleResolver -- `ResolvedActor` on success, or exactly
 * one of NO_TRUST_SET / FAMILY_MISMATCH / DEVICE_NOT_IN_TRUST_SET /
 * DEVICE_NOT_ACTIVE. The entry mapping is not re-implemented here: the
 * decoded epoch is wrapped in a read-only FamilyTrustSetStore adapter and
 * the REAL FamilyTrustSetRoleResolver resolves against it, so the role
 * semantics (device not in set -> DEVICE_NOT_IN_TRUST_SET, non-ACTIVE
 * status -> DEVICE_NOT_ACTIVE, never a default role) cannot drift between
 * the two implementations.
 *
 * WAVE 5B WIRING: TrustSetRoleResolver.resolveActor was widened to permit
 * an asynchronous result (device-local implementations stay synchronous),
 * so this resolver implements that interface directly and async consumers
 * await it before narrowing. It is the production resolver swapped in at
 * main.ts's single shared composition site.
 *
 * FAIL CLOSED: every read, decode, metadata, signature, or current-device-key
 * validation failure resolves as NO_TRUST_SET. That
 * deliberately differs from the ACCEPTANCE flow, where durable-read errors
 * must throw (anti-TFU: never let a failed read masquerade as "no epoch
 * accepted"). Resolution here is a read-only authorization query whose only
 * safe answers are the truthful ones and DENY -- a failure is denied, not
 * retried into existence.
 */
export class StoreBackedTrustSetRoleResolver implements TrustSetRoleResolver {
  private readonly deps: StoreBackedTrustSetRoleResolverDeps;

  constructor(deps: StoreBackedTrustSetRoleResolverDeps) {
    this.deps = deps;
  }

  async resolveActor(
    familyId: OpaqueFamilyId,
    deviceId: OpaqueDeviceId,
    dskKeyId?: string,
  ): Promise<ResolvedActor | ActorResolutionFailure> {
    try {
      const readHead = await this.deps.epochStore.readLatestEpoch(familyId);
      if (readHead === null) return 'NO_TRUST_SET';
      if (!Buffer.isBuffer(readHead.signedEpochBytes) || readHead.signedEpochBytes.length < 1 ||
          readHead.signedEpochBytes.length > MAX_SIGNED_EPOCH_BYTES ||
          !isValidDate(readHead.issuedAt) || !isValidDate(readHead.receivedAt)) return 'NO_TRUST_SET';
      // Stores may return mutable row objects or Buffers. Detach the initial
      // authority snapshot before any asynchronous verification or directory read.
      const latest = snapshotAcceptedHead(readHead);
      const epoch = decodeCanonicalTrustSetEpochBytes(latest.signedEpochBytes);
      const canonicalBytes = latest.signedEpochBytes.toString('utf8');
      const owner = findActiveOwner(epoch);
      if (
        epoch.familyId !== latest.familyId ||
        epoch.trustSetEpoch !== latest.trustSetEpoch ||
        epoch.keyEpoch !== latest.keyEpoch ||
        epoch.supersedesEpoch !== latest.supersedesEpoch ||
        !isValidDate(latest.issuedAt) ||
        epoch.issuedAt.getTime() !== latest.issuedAt.getTime() ||
        !isValidDate(latest.receivedAt) ||
        activeOwnerCount(epoch.entries) !== 1 ||
        findDuplicateIdentity(epoch.entries) ||
        owner === null ||
        owner.deviceId !== latest.signerDeviceId ||
        owner.dskKeyId !== latest.signerKeyId ||
        canonicalizeTrustSetEpoch(epoch) !== canonicalBytes
      ) {
        return 'NO_TRUST_SET';
      }

      // The payload's DSK is not authoritative by itself. Bind the stored
      // signer tuple back to the independently persisted device/key
      // directory, require the device and DSK to remain active, and verify
      // against that directory key rather than a key selected from the row.
      const signerKey = await this.readActiveDsk(
        familyId,
        latest.signerDeviceId,
        latest.signerKeyId,
        owner.dskPublicKey,
      );
      if (
        signerKey === null ||
        !await this.deps.verifier.verify(signerKey.publicKey, canonicalBytes, latest.signature)
      ) {
        return 'NO_TRUST_SET';
      }

      const readOnlyStore: FamilyTrustSetStore = {
        getCurrentEpoch: () => epoch,
        setCurrentEpoch: () => {
          throw new Error(
            'StoreBackedTrustSetRoleResolver is read-only; no resolution path may write a trust-set epoch',
          );
        },
      };
      const resolved = new FamilyTrustSetRoleResolver(readOnlyStore).resolveActor(familyId, deviceId);
      if (typeof resolved === 'string') return resolved;

      const member = epoch.entries.find((entry) => entry.deviceId === deviceId);
      if (
        member === undefined ||
        (dskKeyId !== undefined && member.dskKeyId !== dskKeyId) ||
        await this.readActiveDsk(familyId, member.deviceId, member.dskKeyId, member.dskPublicKey) === null
      ) {
        return 'DEVICE_NOT_ACTIVE';
      }

      // Signature and device-directory checks above await external state.
      // Re-read the complete accepted row at the end so a newer epoch that
      // revoked or changed this member cannot return a stale actor. This
      // query is the authorization decision's linearization point.
      const current = await this.deps.epochStore.readLatestEpoch(familyId);
      if (!sameAcceptedHead(latest, current)) return 'NO_TRUST_SET';
      return { ...resolved, dskKeyId: member.dskKeyId };
    } catch {
      return 'NO_TRUST_SET';
    }
  }

  private async readActiveDsk(
    familyId: OpaqueFamilyId,
    deviceId: OpaqueDeviceId,
    keyId: string,
    expectedPublicKey: string,
  ): Promise<{ publicKey: string } | null> {
    if (!await this.deps.deviceRepository.isDeviceSessionActive(familyId, deviceId)) return null;

    const matchingKeys = (await this.deps.deviceRepository.findKeysByDeviceForFamily(familyId, deviceId))
      .filter((key) => key.keyPurpose === 'DSK' && key.keyId === keyId);
    if (
      matchingKeys.length !== 1 ||
      matchingKeys[0].status !== 'ACTIVE' ||
      matchingKeys[0].publicKey !== expectedPublicKey
    ) {
      return null;
    }
    return { publicKey: matchingKeys[0].publicKey };
  }
}
