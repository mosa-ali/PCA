import { isPlausibleChildProfileId } from './policy.js';
import type { ChildProfileMembershipResult } from './types.js';

/**
 * PCA10_CHILD_PROFILE_TARGET_MEMBERSHIP_VALIDATION -- the CHILD_PROFILE
 * equivalent of TrustSetRoleResolver: the ONLY path
 * ParentActionAuthorizationService may use to learn whether a CHILD_PROFILE
 * target belongs to the acting family. `familyId` here is ALWAYS the
 * caller's own already-resolved family (the same value DEVICE/MEMBER checks
 * use), never a value read back off the target or asserted by the client --
 * a familyId supplied by an untrusted caller is not proof of anything and
 * must never be threaded into this resolver as if it were.
 *
 * Lane brief Section 4: this module deliberately does NOT ship a readable
 * central child-profile directory just to make the pre-check convenient.
 * Implementations backed by a trusted endpoint or verified local family
 * state are a later, separate Coordinator binding (Section 13) -- until one
 * is wired in, `resolveMembership` MUST return UNAVAILABLE rather than
 * inventing a directory or defaulting to ALLOW-shaped behavior.
 */
export interface ChildProfileMembershipResolver {
  resolveMembership(familyId: string, childProfileId: string): ChildProfileMembershipResult;
}

/**
 * The safe default. No trustworthy resolver has been injected, so every
 * lookup fails closed as UNAVAILABLE -- ParentActionAuthorizationService
 * maps that (like NOT_MEMBER and NOT_FOUND) straight to DENY. This is
 * intentionally the ParentActionAuthorizationService default constructor
 * argument: forgetting to wire a real resolver in production denies
 * CHILD_PROFILE-targeted operations rather than silently reintroducing the
 * IDOR this lane closes.
 */
export class UnavailableChildProfileMembershipResolver implements ChildProfileMembershipResolver {
  resolveMembership(_familyId: string, _childProfileId: string): ChildProfileMembershipResult {
    return { status: 'UNAVAILABLE' };
  }
}

/**
 * Reference/test implementation only -- an explicit, static
 * childProfileId -> familyId map supplied by the caller (e.g. a test
 * harness, or a Coordinator-owned adapter snapshotting verified local
 * family state). This is NOT the central readable directory Section 4
 * forbids: it holds no network surface, no query-by-anything-but-exact-id,
 * and callers are responsible for how (and whether) they populate it from a
 * trustworthy source.
 */
export class StaticChildProfileMembershipResolver implements ChildProfileMembershipResolver {
  private readonly familyIdByChildProfileId: ReadonlyMap<string, string>;

  constructor(familyIdByChildProfileId: ReadonlyMap<string, string>) {
    this.familyIdByChildProfileId = familyIdByChildProfileId;
  }

  resolveMembership(familyId: string, childProfileId: string): ChildProfileMembershipResult {
    if (!isPlausibleChildProfileId(childProfileId)) return { status: 'NOT_FOUND' };
    const owningFamilyId = this.familyIdByChildProfileId.get(childProfileId);
    if (owningFamilyId === undefined) return { status: 'NOT_FOUND' };
    return { status: owningFamilyId === familyId ? 'MEMBER_OF_FAMILY' : 'NOT_MEMBER' };
  }
}
