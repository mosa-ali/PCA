/**
 * PCA-BILL-2A-R1 correction (FIX 4: family owner authority), superseded by
 * PCA-FAMILY-AUTH-1-R1 (PCA-DEC-025, OWNER_APPROVED_OPTION_A:
 * genesis-anchored Owner-attestation signature chain -- see
 * docs/implementation/decisions/PCA_IMPL_DECISION_002_FAMILY_COMMERCIAL_AUTHORITY.md
 * and docs/architecture/31_RISK_DECISION_REGISTER.md PCA-DEC-025).
 *
 * ORIGINAL GAP (still the accurate history of why this file exists):
 * `createRequireFamilyAuthorization` only ever proves "this service
 * account holds an ACTIVE family-scope row for this family" -- there was
 * NO Family-Owner-vs-Administrator-vs-Viewer distinction available at the
 * HTTP layer, so a family-scoped service account belonging to an
 * Administrator (not an Owner) could initiate a paid checkout.
 * `FamilyTrustSetStore`'s own header states "device-local state, never a
 * server-side source of truth"; `ParentActionAuthorizationService`'s header
 * states "TRUE authority is the receiving device's own signed-envelope
 * verification against its own trust set, never this service or any
 * server ACL." PCA's backend did NOT hold a genuine, trustworthy,
 * server-side source of a family's current Owner assignment.
 *
 * WHAT PCA-DEC-025/OPTION-A CLOSES, AND WHAT IT DOES NOT: the server now
 * holds a per-family genesis root of trust plus an append-only,
 * signature-verified attestation chain
 * (backend/src/familycommercial/authority/FamilyOwnerAttestationChainEngine.ts)
 * that lets it resolve "which device is the current Owner" WITHOUT ever
 * becoming a server-authored role ACL: every fact this resolver returns
 * traces back to a signature the server only checked, never produced, and
 * it never learns the rest of the family trust set (Administrator/Viewer/
 * Child assignments stay entirely device-side, per doc 09 Section 5.2).
 * `resolveOwnerAuthority` is now `async` (a compile-only signature
 * extension -- see this lane's SHARED_INTEGRATION_REQUIRED report; the one
 * call site in billingCheckoutRoutes.ts needs an `await` added by whoever
 * performs that wiring, since this file does not own that route).
 *
 * `TrustSetFamilyCommercialAuthorityResolver` (below) remains a TESTS-ONLY
 * reference implementation against the device-local FamilyTrustSetStore --
 * still useful for proving the route-level OWNER-gating logic itself, but
 * NOT what production should wire, since it has no server-reachable trust
 * anchor of its own. `AttestationChainFamilyCommercialAuthorityResolver` is
 * the real, server-reachable production candidate.
 */
import type { ActorResolutionFailure, TrustSetRoleResolver } from '../../familyrbac/TrustSetRoleResolver.js';
import { isActorResolutionFailure } from '../../familyrbac/TrustSetRoleResolver.js';
import type { OpaqueDeviceId, OpaqueFamilyId } from '../../familytrustset/types.js';
import type { FamilyOwnerAttestationChainEngine } from '../../familycommercial/authority/FamilyOwnerAttestationChainEngine.js';

export type FamilyCommercialAuthorityResult =
  | { readonly status: 'OWNER_AUTHORIZED' }
  // A resolution FAILURE (no trust set/no genesis anchor, family mismatch,
  // device not present/not active) and a resolved-but-wrong-role DENIAL
  // are kept as DISTINCT statuses here even though the HTTP layer maps
  // both to a 403 -- an operational/availability signal is a different
  // kind of fact than an identity-scoped denial. STALE_OR_REVOKED is
  // likewise distinct from ROLE_DENIED: it means "we know a chain exists
  // for this family, but its current head is expired or revoked," never
  // silently collapsed into "wrong role" or "no data." INVALID_PROOF means
  // the stored chain head itself failed live re-verification (tamper
  // detection) -- see FamilyOwnerAttestationChainEngine.resolveCurrentOwner.
  | { readonly status: 'ROLE_DENIED' }
  | { readonly status: 'AUTHORITY_UNAVAILABLE' }
  | { readonly status: 'STALE_OR_REVOKED' }
  | { readonly status: 'INVALID_PROOF' };

export interface FamilyCommercialAuthorityResolver {
  resolveOwnerAuthority(familyId: OpaqueFamilyId, actorDeviceId: OpaqueDeviceId): Promise<FamilyCommercialAuthorityResult>;
}

/**
 * The safe, PRODUCTION-DEFAULT implementation until a Coordinator binds a
 * real resolver (see this file's header and this lane's
 * SHARED_INTEGRATION_REQUIRED report). Wired as the default in main.ts:
 * forgetting to (or not yet having) inject a real resolver denies every
 * family-checkout-CREATE call rather than silently reopening the
 * Administrator-can-pay gap this correction closes.
 */
export class UnavailableFamilyCommercialAuthorityResolver implements FamilyCommercialAuthorityResolver {
  async resolveOwnerAuthority(_familyId: OpaqueFamilyId, _actorDeviceId: OpaqueDeviceId): Promise<FamilyCommercialAuthorityResult> {
    return { status: 'AUTHORITY_UNAVAILABLE' };
  }
}

/**
 * TESTS ONLY (see this file's header): wraps the existing
 * `TrustSetRoleResolver` against a device-local `FamilyTrustSetStore` --
 * reused, never reimplemented -- so this lane's route-level OWNER-gating
 * logic is proven correct independent of the genesis-anchored chain path.
 * Not server-reachable in production (no genuine trust anchor of its own).
 */
export class TrustSetFamilyCommercialAuthorityResolver implements FamilyCommercialAuthorityResolver {
  constructor(private readonly roleResolver: TrustSetRoleResolver) {}

  async resolveOwnerAuthority(familyId: OpaqueFamilyId, actorDeviceId: OpaqueDeviceId): Promise<FamilyCommercialAuthorityResult> {
    const result: ReturnType<TrustSetRoleResolver['resolveActor']> = this.roleResolver.resolveActor(familyId, actorDeviceId);
    if (isActorResolutionFailure(result)) {
      const failure: ActorResolutionFailure = result;
      // Every resolution failure (NO_TRUST_SET / FAMILY_MISMATCH /
      // DEVICE_NOT_IN_TRUST_SET / DEVICE_NOT_ACTIVE) maps to
      // AUTHORITY_UNAVAILABLE -- NEVER silently to ROLE_DENIED: an
      // inability to determine the role is not the same fact as a
      // determined-and-wrong role.
      void failure;
      return { status: 'AUTHORITY_UNAVAILABLE' };
    }
    return result.role === 'OWNER' ? { status: 'OWNER_AUTHORIZED' } : { status: 'ROLE_DENIED' };
  }
}

/**
 * PCA-DEC-025/Option A production candidate: a thin adapter over
 * `FamilyOwnerAttestationChainEngine.resolveCurrentOwner`, which is the
 * ONLY component that ever reads the genesis-anchored attestation chain
 * (backend/src/familycommercial/authority/). This class performs no
 * verification of its own -- it exists solely so billing/authority/ (this
 * lane's accepted resolver home, per the mission that created
 * FamilyCommercialAuthorityResolver.ts) exposes the engine through the
 * SAME interface billingCheckoutRoutes.ts already depends on, without that
 * frozen route needing to know the engine exists.
 *
 * NOT yet wired as the production default -- see this lane's
 * SHARED_INTEGRATION_REQUIRED report for the exact main.ts change a
 * Coordinator must apply to replace UnavailableFamilyCommercialAuthorityResolver
 * with this class.
 */
export class AttestationChainFamilyCommercialAuthorityResolver implements FamilyCommercialAuthorityResolver {
  constructor(private readonly chainEngine: FamilyOwnerAttestationChainEngine) {}

  async resolveOwnerAuthority(familyId: OpaqueFamilyId, actorDeviceId: OpaqueDeviceId): Promise<FamilyCommercialAuthorityResult> {
    const result = await this.chainEngine.resolveCurrentOwner(familyId, actorDeviceId);
    switch (result.status) {
      case 'OWNER_AUTHORIZED':
        return { status: 'OWNER_AUTHORIZED' };
      case 'ROLE_DENIED':
        return { status: 'ROLE_DENIED' };
      case 'AUTHORITY_UNAVAILABLE':
        return { status: 'AUTHORITY_UNAVAILABLE' };
      case 'STALE_OR_REVOKED':
        return { status: 'STALE_OR_REVOKED' };
      case 'INVALID_PROOF':
        return { status: 'INVALID_PROOF' };
    }
  }
}
