import type { AuthorizationDecision, AuthorizeRequest } from '../familyrbac/ParentActionAuthorizationService.js';

/**
 * Safe-zone HTTP routes consume the existing family action-authorization
 * contract. A service session is deliberately not an implicit family role.
 * Production must inject a resolver backed by the verified family trust set;
 * an absent resolver therefore denies rather than treating the account as an
 * Owner.
 */
export interface SafeZonePolicyAuthorizer {
  authorize(request: AuthorizeRequest): AuthorizationDecision | Promise<AuthorizationDecision>;
}
