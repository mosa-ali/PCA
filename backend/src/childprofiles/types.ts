export type OpaqueChildProfileId = string;

/**
 * PCA10_CHILD_PROFILE_TARGET_MEMBERSHIP_VALIDATION. Modeled honestly as four
 * distinct outcomes rather than collapsed to a boolean, matching the shape
 * ActorResolutionFailure already uses for DEVICE/MEMBER targets:
 *  - MEMBER_OF_FAMILY: the profile exists and belongs to the family the
 *    actor was resolved from.
 *  - NOT_MEMBER: the profile exists but belongs to a DIFFERENT family.
 *  - NOT_FOUND: no such profile exists at all.
 *  - UNAVAILABLE: the resolver could not determine membership (no backing
 *    source wired, backing source errored/timed out, etc).
 * Every non-MEMBER_OF_FAMILY outcome must collapse to the SAME public deny
 * reason downstream (see ParentActionAuthorizationService) -- this type
 * exists for internal/audit fidelity, never as a signal a public error path
 * may branch on (that would recreate the "profile exists in another family"
 * vs "profile doesn't exist" oracle the lane brief Section 6 forbids).
 */
export type ChildProfileMembershipStatus = 'MEMBER_OF_FAMILY' | 'NOT_MEMBER' | 'NOT_FOUND' | 'UNAVAILABLE';

export interface ChildProfileMembershipResult {
  status: ChildProfileMembershipStatus;
}
