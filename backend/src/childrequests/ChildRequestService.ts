import { randomUUID } from 'node:crypto';
import type { ChildRequestRepository } from './ChildRequestRepository.js';
import {
  DEFAULT_REQUEST_LIFETIME_MS,
  isLegalChildRequestTransition,
  isPlausibleExtraMinutes,
  isPlausibleOpaqueId,
  operationForRequestType,
  sanitizeReasonNote,
} from './policy.js';
import type { ChildRequest, ChildRequestId, ChildRequestType, ParentDecisionOutcome, TargetScope } from './types.js';
import type { AppScope, BonusGrant } from '../schedule/types.js';
import type { ParentActionAuthorizationService } from '../familyrbac/ParentActionAuthorizationService.js';

export type ChildRequestErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'ILLEGAL_TRANSITION'
  | 'REQUEST_EXPIRED'
  | 'NOT_AUTHORIZED_TO_DECIDE'
  | 'NOT_THE_REQUESTER'
  | 'BONUS_MINUTES_OUT_OF_BOUND'
  | 'COUNTER_OFFER_NOT_SHORTER';

export class ChildRequestError extends Error {
  readonly code: ChildRequestErrorCode;
  constructor(code: ChildRequestErrorCode) {
    super(CHILD_REQUEST_ERROR_MESSAGES[code]);
    this.name = 'ChildRequestError';
    this.code = code;
  }
}

const CHILD_REQUEST_ERROR_MESSAGES: Record<ChildRequestErrorCode, string> = {
  INVALID_INPUT: 'Child request input is not plausible.',
  NOT_FOUND: 'Child request does not exist.',
  ILLEGAL_TRANSITION: 'This child request has already been decided or is not in a decidable state.',
  REQUEST_EXPIRED: 'This child request has expired.',
  NOT_AUTHORIZED_TO_DECIDE: 'The deciding device is not authorized to approve/deny this request type.',
  NOT_THE_REQUESTER: 'Only the requesting child device may perform this action.',
  BONUS_MINUTES_OUT_OF_BOUND: 'Requested/granted extra minutes is outside the permitted bound.',
  COUNTER_OFFER_NOT_SHORTER: 'A counter-offer must grant strictly fewer minutes than the child requested.',
};

/**
 * doc 18/lane brief Section 11: "A child request cannot self-approve while
 * offline." Enforced structurally, not by a client-trusted flag: decide()
 * always re-derives the deciding device's authority via
 * ParentActionAuthorizationService, which itself only ever resolves a role
 * from the CURRENT verified Family Trust Set (see familyrbac/
 * TrustSetRoleResolver) -- a child device's OWN authorize() call for its
 * own request type always resolves REQUEST_ONLY, never ALLOW, regardless
 * of connectivity state, cached UI, or any claim the caller makes.
 */
export class ChildRequestService {
  private readonly repository: ChildRequestRepository;
  private readonly authorization: ParentActionAuthorizationService;
  private readonly now: () => Date;

  constructor(repository: ChildRequestRepository, authorization: ParentActionAuthorizationService, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.authorization = authorization;
    this.now = now;
  }

  /**
   * Local-only draft, never persisted -- submit() is what makes it a real,
   * transported request.
   *
   * PCA-FR-130: `requestedExtraMinutes`/`requestedAppScope` are REQUIRED
   * (and bound-checked against MAX_BONUS_GRANT_MINUTES) when
   * `requestType === 'BONUS_TIME'`, and must be omitted for every other
   * request type -- a caller cannot smuggle an amount onto an UNBLOCK/
   * SCHEDULE_EXCEPTION/POLICY_EXCEPTION request, and cannot submit a
   * BONUS_TIME request with no amount at all.
   */
  createDraft(
    familyId: string,
    childDeviceId: string,
    childMemberId: string | null,
    requestType: ChildRequestType,
    targetScope: TargetScope,
    reasonNote?: string | null,
    requestedExtraMinutes?: number | null,
    requestedAppScope?: AppScope | null,
  ): ChildRequest {
    if (requestType === 'BONUS_TIME') {
      if (!isPlausibleExtraMinutes(requestedExtraMinutes)) throw new ChildRequestError('BONUS_MINUTES_OUT_OF_BOUND');
      if (requestedAppScope == null) throw new ChildRequestError('INVALID_INPUT');
    } else if (requestedExtraMinutes != null || requestedAppScope != null) {
      throw new ChildRequestError('INVALID_INPUT');
    }

    const now = this.now();
    return {
      requestId: randomUUID(),
      familyId,
      childDeviceId,
      childMemberId,
      requestType,
      targetScope,
      state: 'DRAFT_LOCAL',
      requestedAt: now,
      expiresAt: new Date(now.getTime() + DEFAULT_REQUEST_LIFETIME_MS),
      decidedAt: null,
      decidedByDeviceId: null,
      decisionActionId: null,
      correlationId: null,
      reasonNote: sanitizeReasonNote(reasonNote ?? null),
      requestedExtraMinutes: requestType === 'BONUS_TIME' ? (requestedExtraMinutes as number) : null,
      requestedAppScope: requestType === 'BONUS_TIME' ? (requestedAppScope as AppScope) : null,
      grantedExtraMinutes: null,
      grantExpiresAtUtc: null,
    };
  }

  async submit(draft: ChildRequest): Promise<ChildRequest> {
    if (!isLegalChildRequestTransition(draft.state, 'PENDING')) throw new ChildRequestError('ILLEGAL_TRANSITION');
    const pending: ChildRequest = { ...draft, state: 'PENDING', correlationId: draft.correlationId ?? randomUUID() };
    await this.repository.put(pending);
    return pending;
  }

  /**
   * `counterOfferExtraMinutes` is REQUIRED (and must be strictly less than
   * `request.requestedExtraMinutes`, and itself within the same
   * MAX_BONUS_GRANT_MINUTES bound) when `outcome === 'COUNTERED'`; it must
   * be omitted for every other outcome/request type. PCA-FR-130's "counter-
   * offer a SHORTER duration" is enforced structurally here, not left to
   * caller discipline -- a counter-offer that is not shorter than the ask
   * is rejected outright, never silently clamped to look shorter.
   */
  async decide(
    requestId: ChildRequestId,
    decidingActorDeviceId: string,
    outcome: ParentDecisionOutcome,
    decisionActionId: string,
    idempotencyKey: string,
    counterOfferExtraMinutes?: number | null,
  ): Promise<ChildRequest> {
    if (!isPlausibleOpaqueId(decidingActorDeviceId) || !isPlausibleOpaqueId(decisionActionId)) {
      throw new ChildRequestError('INVALID_INPUT');
    }
    const request = await this.repository.get(requestId);
    if (request === null) throw new ChildRequestError('NOT_FOUND');

    const now = this.now();
    if (request.state === 'PENDING' && now.getTime() > request.expiresAt.getTime()) {
      const expired: ChildRequest = { ...request, state: 'EXPIRED' };
      await this.repository.put(expired);
      throw new ChildRequestError('REQUEST_EXPIRED');
    }

    // PCA-FR-130 bound/shape checks run BEFORE the idempotency short-circuit
    // and BEFORE authorization, so a malformed counter-offer is rejected on
    // its own terms regardless of who's asking.
    let grantedExtraMinutes: number | null = null;
    let grantExpiresAtUtc: Date | null = null;
    if (outcome === 'COUNTERED') {
      if (request.requestType !== 'BONUS_TIME' || request.requestedExtraMinutes === null) {
        throw new ChildRequestError('INVALID_INPUT');
      }
      if (!isPlausibleExtraMinutes(counterOfferExtraMinutes)) throw new ChildRequestError('BONUS_MINUTES_OUT_OF_BOUND');
      if ((counterOfferExtraMinutes as number) >= request.requestedExtraMinutes) {
        throw new ChildRequestError('COUNTER_OFFER_NOT_SHORTER');
      }
      grantedExtraMinutes = counterOfferExtraMinutes as number;
      grantExpiresAtUtc = new Date(now.getTime() + grantedExtraMinutes * 60_000);
    } else if (counterOfferExtraMinutes != null) {
      throw new ChildRequestError('INVALID_INPUT');
    } else if (outcome === 'APPROVED' && request.requestType === 'BONUS_TIME') {
      // requestedExtraMinutes was already bound-checked at createDraft() time -- re-validated here
      // as defense in depth (a repository/transport layer must never be trusted to preserve it).
      if (!isPlausibleExtraMinutes(request.requestedExtraMinutes)) throw new ChildRequestError('BONUS_MINUTES_OUT_OF_BOUND');
      grantedExtraMinutes = request.requestedExtraMinutes;
      grantExpiresAtUtc = new Date(now.getTime() + grantedExtraMinutes * 60_000);
    }

    // Idempotency: a repeated decide() call with the SAME outcome (and, for BONUS_TIME, the SAME
    // granted amount) by the SAME actor on an already-decided request returns the existing record
    // rather than erroring or re-deciding. A replay that tries to change the granted amount is
    // deliberately NOT treated as idempotent -- it falls through to the illegal-transition check
    // below, since APPROVED/DENIED/COUNTERED are all terminal states.
    if (
      (request.state === 'APPROVED' || request.state === 'DENIED' || request.state === 'COUNTERED') &&
      request.decidedByDeviceId === decidingActorDeviceId &&
      request.state === outcome &&
      request.grantedExtraMinutes === grantedExtraMinutes
    ) {
      return request;
    }

    if (!isLegalChildRequestTransition(request.state, outcome)) throw new ChildRequestError('ILLEGAL_TRANSITION');

    const decision = this.authorization.authorize({
      familyId: request.familyId,
      actorDeviceId: decidingActorDeviceId,
      operation: operationForRequestType(request.requestType),
      targetScope: request.targetScope,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      stepUp: null,
      idempotencyKey,
      actionId: decisionActionId,
    });
    if (decision.verdict !== 'ALLOW') throw new ChildRequestError('NOT_AUTHORIZED_TO_DECIDE');

    const decided: ChildRequest = {
      ...request,
      state: outcome,
      decidedAt: now,
      decidedByDeviceId: decidingActorDeviceId,
      decisionActionId,
      grantedExtraMinutes,
      grantExpiresAtUtc,
    };
    await this.repository.put(decided);
    return decided;
  }

  /**
   * PCA-FR-130: turns a decided (APPROVED or COUNTERED) BONUS_TIME request
   * into the same `BonusGrant` shape `schedule/engine.ts`'s `evaluateSchedule`
   * already knows how to apply (see that module's `bonusGrants` handling) --
   * this is a pure projection, never a second source of truth: `id` reuses
   * the request's own `requestId` (so a grant is always traceable back to
   * the decision that authorized it), and `grantedAtUtc`/`expiresAtUtc` are
   * copied verbatim from the fields decide() already computed and persisted.
   * Returns null for anything that isn't a decided BONUS_TIME grant (DENIED,
   * still-PENDING, wrong request type, etc.) -- callers must not guess.
   */
  toBonusGrant(decided: ChildRequest): BonusGrant | null {
    if (decided.requestType !== 'BONUS_TIME') return null;
    if (decided.state !== 'APPROVED' && decided.state !== 'COUNTERED') return null;
    if (
      decided.grantedExtraMinutes === null ||
      decided.grantExpiresAtUtc === null ||
      decided.decidedAt === null ||
      decided.requestedAppScope === null
    ) {
      return null;
    }
    return {
      id: decided.requestId,
      appScope: decided.requestedAppScope,
      extraMinutes: decided.grantedExtraMinutes,
      grantedAtUtc: decided.decidedAt,
      expiresAtUtc: decided.grantExpiresAtUtc,
    };
  }

  /**
   * PCA-FR-130 "grant directly": an authorized parent granting bonus time
   * PROACTIVELY, with no pending child request to respond to (the standing
   * decision's principle "only an existing authorized parent role may
   * grant" covers this path too, not just the request/approve flow FR-130's
   * normative text describes). Deliberately NOT a separate authority system:
   * this is exactly createDraft() + submit() + decide('APPROVED') composed
   * in one call, so it goes through the IDENTICAL bound check, RBAC check
   * (APPROVE_BONUS_TIME, same as responding to a child's own request), audit
   * write, and idempotency ledger as every other bonus-time decision -- a
   * child's own draft() would be indistinguishable from this one once
   * PENDING, other than `childDeviceId`/`childMemberId` being caller-supplied
   * here rather than derived from a submitting child device.
   */
  async grantDirectly(
    familyId: string,
    childDeviceId: string,
    childMemberId: string | null,
    targetScope: TargetScope,
    extraMinutes: number,
    appScope: AppScope,
    grantingActorDeviceId: string,
    decisionActionId: string,
    idempotencyKey: string,
    reasonNote?: string | null,
  ): Promise<ChildRequest> {
    const draft = this.createDraft(familyId, childDeviceId, childMemberId, 'BONUS_TIME', targetScope, reasonNote, extraMinutes, appScope);
    const pending = await this.submit(draft);
    return this.decide(pending.requestId, grantingActorDeviceId, 'APPROVED', decisionActionId, idempotencyKey);
  }

  /** Thin passthrough -- the HTTP layer (parent-facing list view) has no business reaching into the repository port directly. */
  async listForFamily(familyId: string): Promise<ChildRequest[]> {
    return this.repository.listForFamily(familyId);
  }

  async cancel(requestId: ChildRequestId, requestingDeviceId: string): Promise<ChildRequest> {
    const request = await this.repository.get(requestId);
    if (request === null) throw new ChildRequestError('NOT_FOUND');
    if (request.childDeviceId !== requestingDeviceId) throw new ChildRequestError('NOT_THE_REQUESTER');
    if (!isLegalChildRequestTransition(request.state, 'CANCELLED')) throw new ChildRequestError('ILLEGAL_TRANSITION');

    const cancelled: ChildRequest = { ...request, state: 'CANCELLED' };
    await this.repository.put(cancelled);
    return cancelled;
  }

  async acknowledgeApplied(requestId: ChildRequestId, childDeviceId: string): Promise<ChildRequest> {
    const request = await this.repository.get(requestId);
    if (request === null) throw new ChildRequestError('NOT_FOUND');
    if (request.childDeviceId !== childDeviceId) throw new ChildRequestError('NOT_THE_REQUESTER');
    if (!isLegalChildRequestTransition(request.state, 'APPLIED_ACKNOWLEDGED')) throw new ChildRequestError('ILLEGAL_TRANSITION');

    const acknowledged: ChildRequest = { ...request, state: 'APPLIED_ACKNOWLEDGED' };
    await this.repository.put(acknowledged);
    return acknowledged;
  }
}
