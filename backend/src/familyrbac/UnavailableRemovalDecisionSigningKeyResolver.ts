import type { RemovalDecisionSigningKey, RemovalDecisionSigningKeyResolver } from './RemovalDecisionAuthority.js';

/**
 * Explicit production composition boundary while no real signed
 * remote-parent signing-key source exists yet (see
 * RemovalDecisionAuthority.ts's RemovalDecisionSigningKeyResolver doc
 * comment). Mirrors UnavailableTrustSetRoleResolver's fail-closed posture:
 * this resolver never invents or trusts a key, so
 * `decideWithSignedRemoteParent` always fails NOT_AUTHORIZED rather than
 * silently accepting an unverifiable signature. Replacing it with a real,
 * reviewed key source is a wiring change, not a policy change.
 */
export class UnavailableRemovalDecisionSigningKeyResolver implements RemovalDecisionSigningKeyResolver {
  async resolve(_familyId: string, _actorDeviceId: string): Promise<RemovalDecisionSigningKey | null> {
    return null;
  }
}
