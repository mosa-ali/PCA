import type {
  AuthorizedRecoveryAuthority,
  AuthorizedRecoveryProof,
  RemovalDecisionInput,
  RemovalDecisionRecord,
} from './RemovalDecisionAuthority.js';

/**
 * Explicit production composition boundary while no real authorized-
 * recovery-protocol verification source exists yet (see
 * RemovalDecisionAuthority.ts's AuthorizedRecoveryAuthority doc comment).
 * Mirrors UnavailableTrustSetRoleResolver's fail-closed posture: this
 * authority never treats an opaque recovery proof as verified, so
 * `decideWithAuthorizedRecovery` always fails NOT_AUTHORIZED rather than
 * silently accepting an unverifiable recovery claim. Replacing it with the
 * real, reviewed recovery-protocol binding is a wiring change, not a policy
 * change.
 */
export class UnavailableAuthorizedRecoveryAuthority implements AuthorizedRecoveryAuthority {
  async verifyAuthorizedRecovery(_input: {
    request: RemovalDecisionRecord;
    decision: RemovalDecisionInput;
    proof: AuthorizedRecoveryProof;
  }): Promise<boolean> {
    return false;
  }
}
