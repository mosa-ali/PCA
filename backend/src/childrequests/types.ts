import type { TargetScope } from '../familyrbac/types.js';

export type { TargetScope };
export type ChildRequestId = string;

/** doc 18 Section 6/lane brief Section 11's four request kinds. */
export type ChildRequestType = 'BONUS_TIME' | 'UNBLOCK' | 'SCHEDULE_EXCEPTION' | 'POLICY_EXCEPTION';

/**
 * doc-equivalent lifecycle (lane brief Section 11). `DRAFT_LOCAL` is
 * deliberately never persisted by this module's repository -- it exists
 * only as the shape ChildRequestService.createDraft() returns before
 * submit() turns it into a real, transported PENDING request. Every other
 * state IS persisted and is reachable only through the transitions
 * policy.ts's isLegalChildRequestTransition defines.
 */
export type ChildRequestState =
  | 'DRAFT_LOCAL'
  | 'PENDING'
  | 'APPROVED'
  | 'DENIED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'APPLIED_ACKNOWLEDGED';

export type ParentDecisionOutcome = 'APPROVED' | 'DENIED';

export interface ChildRequest {
  requestId: ChildRequestId;
  familyId: string;
  childDeviceId: string;
  childMemberId: string | null;
  requestType: ChildRequestType;
  targetScope: TargetScope;
  state: ChildRequestState;
  requestedAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  decidedByDeviceId: string | null;
  /** Ties this decision back to the ParentAction that authorized it (familyrbac's ActionId) -- never a bare boolean, so the decision itself is independently auditable/traceable. */
  decisionActionId: string | null;
  /** doc 22/contracts catalogue: correlates this request's CHILD_REQUEST envelope with its PARENT_DECISION reply. This module does not send envelopes itself (see ChildRequestTransport), only carries the field. */
  correlationId: string | null;
  /** Bounded, sanitized reason text -- see MAX_REASON_NOTE_LENGTH. */
  reasonNote: string | null;
}
