import { resolveOperationAuthorization, requiresStepUp, STEP_UP_MAX_FRESHNESS_MS } from './policy.js';
import type { ActionIdempotencyLedger } from './ActionIdempotencyLedger.js';
import { isActorResolutionFailure, type TrustSetRoleResolver } from './TrustSetRoleResolver.js';
import type { FamilyRbacPolicyConfig, ParentOperation, StepUpAssertion, TargetScope } from './types.js';

export type AuthorizationDenyReason =
  | 'UNRECOGNIZED_OPERATION'
  | 'ACTOR_NOT_RESOLVABLE'
  | 'ROLE_NOT_PERMITTED'
  | 'CROSS_FAMILY_TARGET'
  | 'STEP_UP_REQUIRED_BUT_ABSENT'
  | 'STEP_UP_NOT_FRESH'
  | 'STEP_UP_FAILED'
  | 'STEP_UP_UNSUPPORTED'
  | 'STEP_UP_CANCELLED'
  | 'ACTION_EXPIRED';

export type AuthorizationDecision =
  | { verdict: 'ALLOW' | 'ALLOW_READ_ONLY' | 'ALLOW_OWN_SCOPE_ONLY' | 'REQUEST_ONLY' }
  | { verdict: 'DENY'; reason: AuthorizationDenyReason };

export interface AuthorizeRequest {
  familyId: string;
  actorDeviceId: string;
  operation: ParentOperation;
  targetScope: TargetScope;
  issuedAt: Date;
  expiresAt: Date;
  stepUp: StepUpAssertion | null;
  idempotencyKey: string;
  actionId: string;
}

/**
 * doc 18's full authorization decision, PRE-CHECK ONLY. This is an
 * advisory/UX-shaping decision the parent panel and initiating device use
 * to avoid submitting an obviously-forbidden action -- doc 18 Section 1 is
 * explicit that TRUE authority is the receiving device's own signed-
 * envelope verification against its own trust set, never this service or
 * any server ACL. Every check here still matters (default-deny, actor
 * resolved only from the verified trust-set store, step-up freshness,
 * expiry) because a caller that skips or spoofs this check gains nothing:
 * the receiving device re-derives the same verdict independently.
 */
export class ParentActionAuthorizationService {
  private readonly roleResolver: TrustSetRoleResolver;
  private readonly configProvider: () => FamilyRbacPolicyConfig;
  private readonly idempotency: ActionIdempotencyLedger;
  private readonly now: () => Date;

  constructor(
    roleResolver: TrustSetRoleResolver,
    configProvider: () => FamilyRbacPolicyConfig,
    idempotency: ActionIdempotencyLedger,
    now: () => Date = () => new Date(),
  ) {
    this.roleResolver = roleResolver;
    this.configProvider = configProvider;
    this.idempotency = idempotency;
    this.now = now;
  }

  authorize(request: AuthorizeRequest): AuthorizationDecision {
    const cached = this.idempotency.getRecorded(request.idempotencyKey);
    if (cached !== null && cached.actionId === request.actionId) {
      return JSON.parse(cached.outcome) as AuthorizationDecision;
    }

    const decision = this.evaluate(request);
    this.idempotency.record(request.idempotencyKey, { actionId: request.actionId, outcome: JSON.stringify(decision) });
    return decision;
  }

  private evaluate(request: AuthorizeRequest): AuthorizationDecision {
    const now = this.now();

    if (now.getTime() > request.expiresAt.getTime()) {
      return { verdict: 'DENY', reason: 'ACTION_EXPIRED' };
    }

    const resolved = this.roleResolver.resolveActor(request.familyId, request.actorDeviceId);
    if (isActorResolutionFailure(resolved)) {
      return { verdict: 'DENY', reason: 'ACTOR_NOT_RESOLVABLE' };
    }

    if (request.targetScope.kind === 'FAMILY' && request.targetScope.id !== request.familyId) {
      return { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' };
    }

    // DEVICE/MEMBER targets are cross-checked against the SAME verified trust set the actor was resolved
    // from -- a target device id belonging to a different family (or no family at all) must never be
    // reachable just because the actor themself is a legitimately resolved Owner/Administrator of THEIR
    // OWN family. (CHILD_PROFILE targets cannot be validated here: this module has no child-profile
    // directory of its own -- that remains a residual gap pending an injected directory port from
    // whichever lane owns child-profile identity, not silently declared safe.)
    if (request.targetScope.kind === 'DEVICE' || request.targetScope.kind === 'MEMBER') {
      const targetResolution = this.roleResolver.resolveActor(request.familyId, request.targetScope.id);
      if (isActorResolutionFailure(targetResolution)) {
        return { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' };
      }
    }

    const verdict = resolveOperationAuthorization(resolved.role, request.operation, this.configProvider());
    if (verdict === 'DENY') {
      return { verdict: 'DENY', reason: 'ROLE_NOT_PERMITTED' };
    }

    if (requiresStepUp(verdict)) {
      const stepUpFailure = this.checkStepUp(request.stepUp, now);
      if (stepUpFailure !== null) return { verdict: 'DENY', reason: stepUpFailure };
      return { verdict: 'ALLOW' }; // step-up satisfied: the ALLOW_WITH_STEP_UP precondition is now met, so the decision collapses to a plain ALLOW
    }

    return { verdict };
  }

  private checkStepUp(stepUp: StepUpAssertion | null, now: Date): AuthorizationDenyReason | null {
    if (stepUp === null) return 'STEP_UP_REQUIRED_BUT_ABSENT';
    switch (stepUp.state) {
      case 'FAILED':
        return 'STEP_UP_FAILED';
      case 'UNSUPPORTED':
        return 'STEP_UP_UNSUPPORTED';
      case 'CANCELLED':
        return 'STEP_UP_CANCELLED';
      case 'EXPIRED':
        return 'STEP_UP_NOT_FRESH';
      case 'FRESH': {
        if (stepUp.assertedAt === null) return 'STEP_UP_NOT_FRESH';
        const freshUntil = stepUp.freshUntil ?? new Date(stepUp.assertedAt.getTime() + STEP_UP_MAX_FRESHNESS_MS);
        if (now.getTime() > freshUntil.getTime()) return 'STEP_UP_NOT_FRESH';
        return null;
      }
    }
  }
}
