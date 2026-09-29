import { FamilyTrustSetRoleResolver } from '../familyrbac/TrustSetRoleResolver.js';
import type { ActorResolutionFailure, ResolvedActor, TrustSetRoleResolver } from '../familyrbac/TrustSetRoleResolver.js';
import { decodeCanonicalTrustSetEpoch } from './decode.js';
import type { FamilyTrustSetStore } from './FamilyTrustSetStore.js';
import type { TrustSetEpochStore } from './TrustSetEpochStore.js';
import type { OpaqueDeviceId, OpaqueFamilyId } from './types.js';

export interface StoreBackedTrustSetRoleResolverDeps {
  epochStore: TrustSetEpochStore;
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
 * FAIL CLOSED: every read or decode failure resolves as NO_TRUST_SET. That
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
  ): Promise<ResolvedActor | ActorResolutionFailure> {
    try {
      const latest = await this.deps.epochStore.readLatestEpoch(familyId);
      if (latest === null) return 'NO_TRUST_SET';
      const epoch = decodeCanonicalTrustSetEpoch(latest.signedEpochBytes.toString('utf8'));
      const readOnlyStore: FamilyTrustSetStore = {
        getCurrentEpoch: () => epoch,
        setCurrentEpoch: () => {
          throw new Error(
            'StoreBackedTrustSetRoleResolver is read-only; no resolution path may write a trust-set epoch',
          );
        },
      };
      return new FamilyTrustSetRoleResolver(readOnlyStore).resolveActor(familyId, deviceId);
    } catch {
      return 'NO_TRUST_SET';
    }
  }
}
