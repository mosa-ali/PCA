import type { AuthorizationDecision, AuthorizeRequest } from '../familyrbac/ParentActionAuthorizationService.js';
import type { ParentActionAuthorizationService } from '../familyrbac/ParentActionAuthorizationService.js';

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

/** Adapter that keeps Safe Zone routes on the shared family-action matrix. */
export class ParentActionSafeZonePolicyAuthorizer implements SafeZonePolicyAuthorizer {
  constructor(private readonly parentActionAuthorization: Pick<ParentActionAuthorizationService, 'authorize'>) {}

  authorize(request: AuthorizeRequest): AuthorizationDecision {
    return this.parentActionAuthorization.authorize(request);
  }
}
