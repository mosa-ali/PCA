import type { ChildProfileRegistryRepository } from './ChildProfileRegistryRepository.js';
import type { ChildProfileMembershipResolver } from './ChildProfileMembershipResolver.js';
import type { ChildProfileMembershipResult } from './types.js';
import { isPlausibleChildProfileId } from './policy.js';

export interface RegistryBackedChildProfileMembershipResolverDeps {
  registry: Pick<ChildProfileRegistryRepository, 'resolveMembership'>;
}

/**
 * Adapts the owner-approved opaque (familyId, childProfileId) registry to the
 * Parent action target-membership contract. The registry can establish only
 * MEMBER versus NOT_MEMBER_OR_NOT_FOUND; the latter is deliberately reported
 * as NOT_MEMBER and never reveals whether an identifier exists in another
 * family. All negative outcomes are collapsed again by
 * ParentActionAuthorizationService to CROSS_FAMILY_TARGET.
 *
 * This adapter is read-only and returns no child content. Every call performs
 * a fresh exact-id lookup; it has no cache or list/query surface. Repository
 * errors resolve to UNAVAILABLE so database failure cannot grant authority or
 * become a distinguishable public response.
 */
export class RegistryBackedChildProfileMembershipResolver implements ChildProfileMembershipResolver {
  private readonly registry: RegistryBackedChildProfileMembershipResolverDeps['registry'];

  constructor(deps: RegistryBackedChildProfileMembershipResolverDeps) {
    this.registry = deps.registry;
  }

  async resolveMembership(familyId: string, childProfileId: string): Promise<ChildProfileMembershipResult> {
    if (!isPlausibleChildProfileId(childProfileId)) return { status: 'NOT_FOUND' };

    try {
      const result = await this.registry.resolveMembership(familyId, childProfileId);
      return result === 'MEMBER' ? { status: 'MEMBER_OF_FAMILY' } : { status: 'NOT_MEMBER' };
    } catch {
      return { status: 'UNAVAILABLE' };
    }
  }
}
