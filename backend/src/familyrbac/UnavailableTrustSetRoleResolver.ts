import type { OpaqueDeviceId, OpaqueFamilyId } from '../familytrustset/types.js';
import type { ActorResolutionFailure, ResolvedActor, TrustSetRoleResolver } from './TrustSetRoleResolver.js';

/**
 * Explicit production composition boundary while the server-reachable,
 * signature-verified trust-set source is unavailable. This resolver never
 * treats a parent session, family id, or client role as family authority.
 * Replacing it with the reviewed resolver is a wiring change, not a policy
 * change; until then every ParentActionAuthorizationService decision fails
 * closed as NO_TRUST_SET.
 */
export class UnavailableTrustSetRoleResolver implements TrustSetRoleResolver {
  resolveActor(_familyId: OpaqueFamilyId, _deviceId: OpaqueDeviceId): ResolvedActor | ActorResolutionFailure {
    return 'NO_TRUST_SET';
  }
}
