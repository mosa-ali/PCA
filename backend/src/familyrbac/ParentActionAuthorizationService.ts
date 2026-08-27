import { resolveOperationAuthorization, requiresStepUp, STEP_UP_MAX_FRESHNESS_MS } from './policy.js';
import type { ActionIdempotencyLedger } from './ActionIdempotencyLedger.js';
import { isActorResolutionFailure, type TrustSetRoleResolver } from './TrustSetRoleResolver.js';
import type { FamilyRbacPolicyConfig, ParentOperation, StepUpAssertion, TargetScope } from './types.js';
import {
  UnavailableChildProfileMembershipResolver,
  type ChildProfileMembershipResolver,
} from '../childprofiles/ChildProfileMembershipResolver.js';
import { isPlausibleChildProfileId } from '../childprofiles/policy.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from './FamilyAuditStore.js';

const STEP_UP_DENY_REASONS: ReadonlySet<AuthorizationDenyReason> = new Set([
  'STEP_UP_REQUIRED_BUT_ABSENT',
  'STEP_UP_NOT_FRESH',
  'STEP_UP_FAILED',
  'STEP_UP_UNSUPPORTED',
  'STEP_UP_CANCELLED',
]);

/** doc 18 Section 6 / PCA10 error-oracle requirement: CROSS_FAMILY_TARGET is the ONE public reason for every DEVICE/MEMBER/CHILD_PROFILE target-resolution failure shape (wrong family, unknown, malformed, or resolver-unavailable) -- never branched on internally to produce a distinct public reason, so a caller cannot distinguish "exists in another family" from "doesn't exist" from "couldn't be checked." */
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
  private readonly configProvider: (familyId: string) => FamilyRbacPolicyConfig;
  private readonly idempotency: ActionIdempotencyLedger;
  private readonly now: () => Date;
  private readonly childProfileMembership: ChildProfileMembershipResolver;
  private readonly auditService: FamilyAuditService;

  constructor(
    roleResolver: TrustSetRoleResolver,
    // Takes the REQUEST's familyId so config genuinely varies per family
    // (see FamilyRbacPolicyConfigStore.snapshotFor) rather than being one
    // global default shared by every family, as the original zero-arg
    // closure signature made unavoidable. A plain zero-arg function like
    // defaultFamilyRbacPolicyConfig remains a valid argument here (fewer
    // parameters than the declared type is always callable with more, per
    // TypeScript's own contravariant function-parameter rule), so this is
    // backward compatible with every existing caller.
    configProvider: (familyId: string) => FamilyRbacPolicyConfig,
    idempotency: ActionIdempotencyLedger,
    now: () => Date = () => new Date(),
    // PCA10: defaults to fail-closed (UNAVAILABLE -> DENY for every CHILD_PROFILE target) when no trustworthy
    // resolver has been injected -- see UnavailableChildProfileMembershipResolver. Callers that DO have a
    // verified family-state source must inject a real resolver explicitly; forgetting to never silently
    // reopens the IDOR this closes.
    childProfileMembership: ChildProfileMembershipResolver = new UnavailableChildProfileMembershipResolver(),
    // See FamilyAuditStore.ts's doc comment: this is the in-memory REFERENCE
    // implementation only, never a durable PCA server audit log. Production
    // wiring (main.ts) should inject a SHARED FamilyAuditService so records
    // from this and every other family-rbac event source land together.
    auditService: FamilyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository()),
  ) {
    this.roleResolver = roleResolver;
    this.configProvider = configProvider;
    this.idempotency = idempotency;
    this.now = now;
    this.childProfileMembership = childProfileMembership;
    this.auditService = auditService;
  }

  authorize(request: AuthorizeRequest): AuthorizationDecision {
    const fingerprint = fingerprintRequest(request);
    const cached = this.idempotency.getRecorded(request.idempotencyKey);
    if (cached !== null && cached.actionId === request.actionId && cached.requestFingerprint === fingerprint) {
      return JSON.parse(cached.outcome) as AuthorizationDecision;
    }

    const decision = this.evaluate(request);
    this.idempotency.record(request.idempotencyKey, { actionId: request.actionId, requestFingerprint: fingerprint, outcome: JSON.stringify(decision) });
    // Fire-and-forget: authorize() is, and remains, synchronous (many
    // existing callers depend on that) -- the in-memory reference audit
    // append() has no real I/O to await, so this never introduces an
    // unhandled-rejection risk under normal operation, only under a
    // caller-supplied auditService that itself throws synchronously-shaped
    // errors, which is a caller defect, not this method's concern.
    void this.recordAudit(request, decision);
    return decision;
  }

  private async recordAudit(request: AuthorizeRequest, decision: AuthorizationDecision): Promise<void> {
    const resolved = this.roleResolver.resolveActor(request.familyId, request.actorDeviceId);
    const role = isActorResolutionFailure(resolved) ? null : resolved.role;
    const trustSetEpoch = isActorResolutionFailure(resolved) ? 0 : resolved.trustSetEpoch;

    if (decision.verdict === 'DENY') {
      const isStepUpDenial = STEP_UP_DENY_REASONS.has(decision.reason);
      await this.auditService.record({
        familyId: request.familyId,
        actionType: isStepUpDenial ? 'STEP_UP_FAILURE' : 'DENIED_AUTHORIZATION_ATTEMPT',
        actorDeviceId: request.actorDeviceId,
        actorMemberId: null,
        targetScope: request.targetScope,
        authorizationRole: role,
        trustSetEpoch,
        policyRevision: null,
        clientMonotonicSequence: null,
        resultStatus: 'DENIED',
        targetAcknowledgementCount: 0,
        reasonCategory: null,
        correlationId: null,
        actionId: request.actionId,
        freeTextNote: `${request.operation}: ${decision.reason}`,
      });
      return;
    }

    // ALLOW/etc.: only log when step-up was actually presented and required
    // -- an ordinary read/allow (e.g. VIEW_DASHBOARD) is not itself one of
    // doc 18 Section 5's required audit examples, and logging every single
    // advisory pre-check would make the reference store unusable as a
    // signal. STEP_UP_SUCCESS covers the "step-up success" required
    // example; the operation itself (a valid ParentOperation, and thus a
    // valid actionType) covers sensitive non-step-up-required ALLOWs.
    if (request.stepUp !== null) {
      await this.auditService.record({
        familyId: request.familyId,
        actionType: 'STEP_UP_SUCCESS',
        actorDeviceId: request.actorDeviceId,
        actorMemberId: null,
        targetScope: request.targetScope,
        authorizationRole: role,
        trustSetEpoch,
        policyRevision: null,
        clientMonotonicSequence: null,
        resultStatus: 'SUCCESS',
        targetAcknowledgementCount: 0,
        reasonCategory: null,
        correlationId: null,
        actionId: request.actionId,
        freeTextNote: request.operation,
      });
    }
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
    // OWN family.
    if (request.targetScope.kind === 'DEVICE' || request.targetScope.kind === 'MEMBER') {
      const targetResolution = this.roleResolver.resolveActor(request.familyId, request.targetScope.id);
      if (isActorResolutionFailure(targetResolution)) {
        return { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' };
      }
    }

    // PCA10_CHILD_PROFILE_TARGET_MEMBERSHIP_VALIDATION: a CHILD_PROFILE target is cross-checked against the
    // SAME verified family the actor was resolved from, via the injected ChildProfileMembershipResolver --
    // never trusted merely because the actor themself resolved to a legitimate Owner/Administrator role.
    // Malformed ids, unknown profiles, cross-family profiles, and resolver-unavailable ALL collapse to the
    // same public CROSS_FAMILY_TARGET denial (see the error-oracle note on AuthorizationDenyReason above) --
    // fail-closed on every branch, no branch distinguishable from another by the caller.
    if (request.targetScope.kind === 'CHILD_PROFILE') {
      if (!isPlausibleChildProfileId(request.targetScope.id)) {
        return { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' };
      }
      const membership = this.childProfileMembership.resolveMembership(request.familyId, request.targetScope.id);
      if (membership.status !== 'MEMBER_OF_FAMILY') {
        return { verdict: 'DENY', reason: 'CROSS_FAMILY_TARGET' };
      }
    }

    const verdict = resolveOperationAuthorization(resolved.role, request.operation, this.configProvider(request.familyId));
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

/**
 * Binds an idempotency-ledger record to the exact security-relevant shape
 * of the request it was computed for. An idempotencyKey/actionId pair
 * reused with a DIFFERENT familyId, actor, operation, or -- most
 * importantly for PCA10 -- a mutated targetScope must never be treated as a
 * replay of the original decision; authorize() falls through to fresh
 * evaluation whenever this fingerprint doesn't match the cached one.
 */
function fingerprintRequest(request: AuthorizeRequest): string {
  return [request.familyId, request.actorDeviceId, request.operation, request.targetScope.kind, request.targetScope.id].join('|');
}
