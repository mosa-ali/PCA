import type { ChildProfileMembershipResolver } from '../childprofiles/ChildProfileMembershipResolver.js';
import type { ParentAccountService } from '../parentaccount/ParentAccountService.js';
import type { ParentSessionChildRequestAuthorizer } from './ChildRequestService.js';

export interface ParentSessionChildRequestAuthorizerDeps {
  parentAccountService: Pick<ParentAccountService, 'activeFamilyRole'>;
  childProfileMembershipResolver: ChildProfileMembershipResolver;
}

/**
 * Creates the ordinary Parent-session authorization lane for request
 * decisions and direct grants. It checks the live family Administrator role
 * and resolves CHILD_PROFILE targets through the same fail-closed membership
 * adapter used by Parent action authorization and the child-request routes.
 * Any unavailable or ambiguous result denies.
 */
export function createParentSessionChildRequestAuthorizer(
  deps: ParentSessionChildRequestAuthorizerDeps,
): ParentSessionChildRequestAuthorizer {
  return {
    async authorize({ parentAccountId, familyId, targetScope }) {
      try {
        if ((await deps.parentAccountService.activeFamilyRole(parentAccountId as never, familyId)) !== 'ADMINISTRATOR') {
          return { verdict: 'DENY' };
        }
        if (targetScope.kind === 'FAMILY') {
          return { verdict: targetScope.id === familyId ? 'ALLOW' : 'DENY' };
        }
        if (targetScope.kind === 'CHILD_PROFILE') {
          const membership = await deps.childProfileMembershipResolver.resolveMembership(familyId, targetScope.id);
          return { verdict: membership.status === 'MEMBER_OF_FAMILY' ? 'ALLOW' : 'DENY' };
        }
        // Device and accepted-member target lookup is not available through
        // this family-scoped Parent-session resolver. Keep those actions closed.
        return { verdict: 'DENY' };
      } catch {
        return { verdict: 'DENY' };
      }
    },
  };
}
