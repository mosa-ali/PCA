/**
 * PCA-BILL-2A-R1 correction (FIX 4: family owner authority). Closes the
 * disclosed gap in billingCheckoutRoutes.ts's original header comment:
 * `createRequireFamilyAuthorization` only ever proves "this service
 * account holds an ACTIVE family-scope row for this family" -- there was
 * NO Family-Owner-vs-Administrator-vs-Viewer distinction available at the
 * HTTP layer, so a family-scoped service account belonging to an
 * Administrator (not an Owner) could initiate a paid checkout.
 *
 * WHY THIS IS A REAL ARCHITECTURE GAP, NOT AN OVERSIGHT TO WIRE AROUND:
 * `FamilyTrustSetStore`'s own header states "device-local state, never a
 * server-side source of truth -- the Relay only ever distributes opaque,
 * signed epoch objects; it does not adjudicate which one is current."
 * `ParentActionAuthorizationService`'s header states "TRUE authority is the
 * receiving device's own signed-envelope verification against its own
 * trust set, never this service or any server ACL." PCA's backend does
 * NOT today hold a genuine, trustworthy, server-side source of a family's
 * current trust-set epoch/role assignments -- that state is designed to
 * live device-side. Resolving true Family-Owner authority server-side for
 * an HTTP-only commercial action (checkout) is therefore a REAL,
 * currently-unclosed architecture gap.
 *
 * THE PATTERN (reused verbatim from childprofiles/ChildProfileMembershipResolver.ts,
 * which faces the identical "no trustworthy server-side source yet" shape
 * for CHILD_PROFILE membership): a resolver INTERFACE, a safe
 * fail-closed-to-UNAVAILABLE default (`UnavailableFamilyCommercialAuthorityResolver`,
 * the PRODUCTION default -- see main.ts), and a real
 * implementation (`TrustSetFamilyCommercialAuthorityResolver`, TESTS ONLY
 * today) that wraps the existing `TrustSetRoleResolver`
 * (familyrbac/TrustSetRoleResolver.ts) so this lane never reimplements
 * role resolution -- it only proves, against that resolver, that the
 * route-level OWNER-vs-not-OWNER gating logic itself is correct, ready for
 * whenever a genuine server-reachable trust-set source exists.
 */
import type { ActorResolutionFailure, TrustSetRoleResolver } from '../../familyrbac/TrustSetRoleResolver.js';
import { isActorResolutionFailure } from '../../familyrbac/TrustSetRoleResolver.js';
import type { OpaqueDeviceId, OpaqueFamilyId } from '../../familytrustset/types.js';

export type FamilyCommercialAuthorityResult =
  | { readonly status: 'OWNER_AUTHORIZED' }
  // A resolution FAILURE (no trust set, family mismatch, device not
  // present/not active -- see ActorResolutionFailure) and a
  // resolved-but-wrong-role DENIAL are kept as DISTINCT statuses here even
  // though the HTTP layer maps both to a 403 -- see
  // billingCheckoutRoutes.ts's mapping and this type's own doc: an
  // operational/availability signal is a different kind of fact than an
  // identity-scoped denial, worth keeping distinct in the type even where
  // the wire response collapses them for the ROLE_DENIED case (never for
  // AUTHORITY_UNAVAILABLE, which the mission explicitly wants
  // distinguishable).
  | { readonly status: 'ROLE_DENIED' }
  | { readonly status: 'AUTHORITY_UNAVAILABLE' };

export interface FamilyCommercialAuthorityResolver {
  resolveOwnerAuthority(familyId: OpaqueFamilyId, actorDeviceId: OpaqueDeviceId): FamilyCommercialAuthorityResult;
}

/**
 * The safe, PRODUCTION-DEFAULT implementation. No trustworthy
 * server-reachable trust-set source has been wired in (see this file's
 * header), so every call fails closed as AUTHORITY_UNAVAILABLE --
 * mirroring UnavailableChildProfileMembershipResolver exactly. Wired as the
 * default in main.ts: forgetting to (or being unable to, given the
 * architecture gap above) inject a real resolver denies every
 * family-checkout-CREATE call rather than silently reopening the
 * Administrator-can-pay gap this correction closes.
 */
export class UnavailableFamilyCommercialAuthorityResolver implements FamilyCommercialAuthorityResolver {
  resolveOwnerAuthority(_familyId: OpaqueFamilyId, _actorDeviceId: OpaqueDeviceId): FamilyCommercialAuthorityResult {
    return { status: 'AUTHORITY_UNAVAILABLE' };
  }
}

/**
 * TESTS ONLY today (see this file's header for why: no genuine
 * server-side trust-set source exists in this codebase yet). Wraps the
 * existing `TrustSetRoleResolver` -- reused, never reimplemented -- so
 * this lane's route-level OWNER-gating logic is proven correct against the
 * SAME role-resolution code a real, future server-reachable trust-set
 * adapter would also use.
 */
export class TrustSetFamilyCommercialAuthorityResolver implements FamilyCommercialAuthorityResolver {
  constructor(private readonly roleResolver: TrustSetRoleResolver) {}

  resolveOwnerAuthority(familyId: OpaqueFamilyId, actorDeviceId: OpaqueDeviceId): FamilyCommercialAuthorityResult {
    const result: ReturnType<TrustSetRoleResolver['resolveActor']> = this.roleResolver.resolveActor(familyId, actorDeviceId);
    if (isActorResolutionFailure(result)) {
      const failure: ActorResolutionFailure = result;
      // Every resolution failure (NO_TRUST_SET / FAMILY_MISMATCH /
      // DEVICE_NOT_IN_TRUST_SET / DEVICE_NOT_ACTIVE) maps to
      // AUTHORITY_UNAVAILABLE -- NEVER silently to ROLE_DENIED, per this
      // mission's explicit instruction: an inability to determine the role
      // is not the same fact as a determined-and-wrong role.
      void failure;
      return { status: 'AUTHORITY_UNAVAILABLE' };
    }
    return result.role === 'OWNER' ? { status: 'OWNER_AUTHORIZED' } : { status: 'ROLE_DENIED' };
  }
}
