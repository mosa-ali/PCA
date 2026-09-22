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
  /**
   * Always asynchronous: the shared family-action matrix now records its
   * authorization outcomes in a DURABLE idempotency ledger, so a synchronous
   * implementation could only ever be backed by process-local memory. Allowing
   * the union would let a future implementation quietly reintroduce exactly the
   * P1-04 defect this signature was widened to remove.
   */
  authorize(request: AuthorizeRequest): Promise<AuthorizationDecision>;
}

/** Adapter that keeps Safe Zone routes on the shared family-action matrix. */
export class ParentActionSafeZonePolicyAuthorizer implements SafeZonePolicyAuthorizer {
  constructor(private readonly parentActionAuthorization: Pick<ParentActionAuthorizationService, 'authorize'>) {}

  async authorize(request: AuthorizeRequest): Promise<AuthorizationDecision> {
    return this.parentActionAuthorization.authorize(request);
  }
}
