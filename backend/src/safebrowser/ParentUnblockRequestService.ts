import { randomUUID } from 'node:crypto';
import type { BlockDecisionStateRepository } from './BlockDecisionStateStore.js';
import { isLegalUnblockRequestTransition } from './policy.js';
import type {
  BlockDecisionId,
  OpaqueFamilyId,
  OpaqueProfileId,
  ParentUnblockRequest,
  ParentUnblockRequestStatus,
  UnblockRequestId,
} from './types.js';

/** Local persistence port -- device-local per doc 14/15's retention rules, same posture as BlockDecisionStateRepository. */
export interface ParentUnblockRequestRepository {
  put(request: ParentUnblockRequest): Promise<void>;
  get(id: UnblockRequestId): Promise<ParentUnblockRequest | null>;
  findPendingForDecision(blockDecisionId: BlockDecisionId): Promise<ParentUnblockRequest | null>;
}

export class InMemoryParentUnblockRequestRepository implements ParentUnblockRequestRepository {
  private readonly requests = new Map<UnblockRequestId, ParentUnblockRequest>();

  async put(request: ParentUnblockRequest): Promise<void> {
    this.requests.set(request.id, request);
  }

  async get(id: UnblockRequestId): Promise<ParentUnblockRequest | null> {
    return this.requests.get(id) ?? null;
  }

  async findPendingForDecision(blockDecisionId: BlockDecisionId): Promise<ParentUnblockRequest | null> {
    for (const request of this.requests.values()) {
      if (request.blockDecisionId === blockDecisionId && request.status === 'PENDING') return request;
    }
    return null;
  }
}

export type UnblockRequestErrorCode =
  | 'DECISION_NOT_FOUND'
  | 'NOT_REQUESTABLE'
  | 'REQUEST_NOT_FOUND'
  | 'ALREADY_PENDING'
  | 'ILLEGAL_TRANSITION'
  | 'INVALID_DURATION';

export class UnblockRequestError extends Error {
  readonly code: UnblockRequestErrorCode;
  constructor(code: UnblockRequestErrorCode) {
    super(UNBLOCK_ERROR_MESSAGES[code]);
    this.name = 'UnblockRequestError';
    this.code = code;
  }
}

const UNBLOCK_ERROR_MESSAGES: Record<UnblockRequestErrorCode, string> = {
  DECISION_NOT_FOUND: 'The referenced block decision does not exist.',
  NOT_REQUESTABLE: 'This block decision is not eligible for a parent review request.',
  REQUEST_NOT_FOUND: 'The unblock request does not exist.',
  ALREADY_PENDING: 'A pending request already exists for this block decision.',
  ILLEGAL_TRANSITION: 'This request has already been decided.',
  INVALID_DURATION: 'Temporary approval duration must be a positive number of milliseconds.',
};

/**
 * doc 14: child request -> parent decision -> allow temporarily/
 * permanently or deny. This service never re-evaluates or overrides the
 * WebFilterEngine itself -- an APPROVED_* request is a signal a caller
 * (e.g. the WebRuleService, via a subsequent explicit PARENT_ALLOWLIST
 * write) acts on; this module owns the request/decision workflow state
 * only, not the resulting policy change.
 */
export class ParentUnblockRequestService {
  private readonly requests: ParentUnblockRequestRepository;
  private readonly decisions: BlockDecisionStateRepository;
  private readonly now: () => Date;

  constructor(
    requests: ParentUnblockRequestRepository,
    decisions: BlockDecisionStateRepository,
    now: () => Date = () => new Date(),
  ) {
    this.requests = requests;
    this.decisions = decisions;
    this.now = now;
  }

  async submit(
    familyId: OpaqueFamilyId,
    profileId: OpaqueProfileId,
    blockDecisionId: BlockDecisionId,
  ): Promise<ParentUnblockRequest> {
    const decision = await this.decisions.get(blockDecisionId);
    if (decision === null) throw new UnblockRequestError('DECISION_NOT_FOUND');
    if (!decision.requestable) throw new UnblockRequestError('NOT_REQUESTABLE');

    const existingPending = await this.requests.findPendingForDecision(blockDecisionId);
    if (existingPending !== null) throw new UnblockRequestError('ALREADY_PENDING');

    const request: ParentUnblockRequest = {
      id: randomUUID(),
      blockDecisionId,
      familyId,
      profileId,
      domain: decision.domain,
      status: 'PENDING',
      requestedAt: this.now(),
      decidedAt: null,
      temporaryApprovalExpiresAt: null,
    };
    await this.requests.put(request);
    return request;
  }

  private async transition(
    requestId: UnblockRequestId,
    to: ParentUnblockRequestStatus,
    temporaryApprovalDurationMs?: number,
  ): Promise<ParentUnblockRequest> {
    const request = await this.requests.get(requestId);
    if (request === null) throw new UnblockRequestError('REQUEST_NOT_FOUND');
    if (!isLegalUnblockRequestTransition(request.status, to)) throw new UnblockRequestError('ILLEGAL_TRANSITION');

    let temporaryApprovalExpiresAt: Date | null = null;
    if (to === 'APPROVED_TEMPORARY') {
      if (!Number.isFinite(temporaryApprovalDurationMs) || (temporaryApprovalDurationMs as number) <= 0) {
        throw new UnblockRequestError('INVALID_DURATION');
      }
      temporaryApprovalExpiresAt = new Date(this.now().getTime() + (temporaryApprovalDurationMs as number));
    }

    const decided: ParentUnblockRequest = {
      ...request,
      status: to,
      decidedAt: this.now(),
      temporaryApprovalExpiresAt,
    };
    await this.requests.put(decided);
    return decided;
  }

  async approveTemporary(requestId: UnblockRequestId, durationMs: number): Promise<ParentUnblockRequest> {
    return this.transition(requestId, 'APPROVED_TEMPORARY', durationMs);
  }

  async approvePermanent(requestId: UnblockRequestId): Promise<ParentUnblockRequest> {
    return this.transition(requestId, 'APPROVED_PERMANENT');
  }

  async deny(requestId: UnblockRequestId): Promise<ParentUnblockRequest> {
    return this.transition(requestId, 'DENIED');
  }
}
