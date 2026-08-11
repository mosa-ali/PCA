import type { FamilyTrustSetStore } from '../familytrustset/FamilyTrustSetStore.js';
import type { OpaqueDeviceId, OpaqueFamilyId } from '../familytrustset/types.js';
import type { FamilyRole } from './types.js';

/** The actor identity/role/epoch this module authorizes against -- ALWAYS derived from a verified trust-set entry, never from a caller-asserted role string (closes role-forgery/IDOR). */
export interface ResolvedActor {
  deviceId: OpaqueDeviceId;
  role: FamilyRole;
  trustSetEpoch: number;
  keyEpoch: number;
}

export type ActorResolutionFailure =
  | 'NO_TRUST_SET'
  | 'FAMILY_MISMATCH'
  | 'DEVICE_NOT_IN_TRUST_SET'
  | 'DEVICE_NOT_ACTIVE';

export interface TrustSetRoleResolver {
  resolveActor(familyId: OpaqueFamilyId, deviceId: OpaqueDeviceId): ResolvedActor | ActorResolutionFailure;
}

/**
 * doc 18 Section 1: "Role-based access control is enforced... by every
 * receiving... endpoint that verifies a signed control envelope; UI hiding
 * is never authorization." This adapter is the ONLY path
 * ParentActionAuthorizationService uses to learn an actor's role -- it
 * reads the device's own locally-held, already-verified
 * FamilyTrustSetStore (see familytrustset/FamilyTrustSetEngine, which is
 * responsible for ONLY ever admitting a signature-verified epoch into this
 * store). A device not present in the current epoch's entries, or present
 * but not ACTIVE (revoked, epoch-stale, awaiting rotation/recovery), is a
 * resolution FAILURE, never silently mapped to a default role.
 */
export class FamilyTrustSetRoleResolver implements TrustSetRoleResolver {
  private readonly store: FamilyTrustSetStore;

  constructor(store: FamilyTrustSetStore) {
    this.store = store;
  }

  resolveActor(familyId: OpaqueFamilyId, deviceId: OpaqueDeviceId): ResolvedActor | ActorResolutionFailure {
    const epoch = this.store.getCurrentEpoch();
    if (epoch === null) return 'NO_TRUST_SET';
    if (epoch.familyId !== familyId) return 'FAMILY_MISMATCH';

    const entry = epoch.entries.find((e) => e.deviceId === deviceId);
    if (entry === undefined) return 'DEVICE_NOT_IN_TRUST_SET';
    if (entry.status !== 'ACTIVE') return 'DEVICE_NOT_ACTIVE';

    return { deviceId, role: entry.role, trustSetEpoch: epoch.trustSetEpoch, keyEpoch: epoch.keyEpoch };
  }
}

export function isActorResolutionFailure(
  result: ResolvedActor | ActorResolutionFailure,
): result is ActorResolutionFailure {
  return typeof result === 'string';
}
