import { randomUUID } from 'node:crypto';
import type { ChildRequestRepository } from './ChildRequestRepository.js';
import {
  DEFAULT_REQUEST_LIFETIME_MS,
  isLegalChildRequestTransition,
  isPlausibleOpaqueId,
  operationForRequestType,
  sanitizeReasonNote,
} from './policy.js';
import type { ChildRequest, ChildRequestId, ChildRequestType, ParentDecisionOutcome, TargetScope } from './types.js';
import type { ParentActionAuthorizationService } from '../familyrbac/ParentActionAuthorizationService.js';

export type ChildRequestErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'ILLEGAL_TRANSITION'
  | 'REQUEST_EXPIRED'
  | 'NOT_AUTHORIZED_TO_DECIDE'
  | 'NOT_THE_REQUESTER';

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

  /** Local-only draft, never persisted -- submit() is what makes it a real, transported request. */
  createDraft(
    familyId: string,
    childDeviceId: string,
    childMemberId: string | null,
    requestType: ChildRequestType,
    targetScope: TargetScope,
    reasonNote?: string | null,
  ): ChildRequest {
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
    };
  }

  async submit(draft: ChildRequest): Promise<ChildRequest> {
    if (!isLegalChildRequestTransition(draft.state, 'PENDING')) throw new ChildRequestError('ILLEGAL_TRANSITION');
    const pending: ChildRequest = { ...draft, state: 'PENDING', correlationId: draft.correlationId ?? randomUUID() };
    await this.repository.put(pending);
    return pending;
  }

  async decide(
    requestId: ChildRequestId,
    decidingActorDeviceId: string,
    outcome: ParentDecisionOutcome,
    decisionActionId: string,
    idempotencyKey: string,
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

    // Idempotency: a repeated decide() call with the SAME outcome by the SAME actor on an already-decided
    // request returns the existing record rather than erroring or re-deciding.
    if ((request.state === 'APPROVED' || request.state === 'DENIED') && request.decidedByDeviceId === decidingActorDeviceId) {
      const matches = (outcome === 'APPROVED' && request.state === 'APPROVED') || (outcome === 'DENIED' && request.state === 'DENIED');
      if (matches) return request;
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
    };
    await this.repository.put(decided);
    return decided;
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
