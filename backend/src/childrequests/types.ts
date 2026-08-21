import type { TargetScope } from '../familyrbac/types.js';
import type { AppScope } from '../schedule/types.js';

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
 *
 * `COUNTERED` (PCA-FR-130): a parent-decided BONUS_TIME request where the
 * deciding parent granted a SHORTER duration than the child requested,
 * rather than the requested amount verbatim -- doc text: "approve, deny, or
 * counter-offer a shorter duration." Terminal, exactly like APPROVED/DENIED
 * (see policy.ts's LEGAL_TRANSITIONS) -- this module never asks the child to
 * separately accept a counter-offer; the parent's counter-offer IS the
 * decision, recorded and auditable like any other.
 */
export type ChildRequestState =
  | 'DRAFT_LOCAL'
  | 'PENDING'
  | 'APPROVED'
  | 'DENIED'
  | 'COUNTERED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'APPLIED_ACKNOWLEDGED';

export type ParentDecisionOutcome = 'APPROVED' | 'DENIED' | 'COUNTERED';

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
  /**
   * PCA-FR-130: only ever set (non-null) when `requestType === 'BONUS_TIME'`;
   * null for every other request type -- see policy.ts's
   * isPlausibleExtraMinutes/MAX_BONUS_GRANT_MINUTES for the bound this is
   * validated against at createDraft() time. The child's ASK, not the
   * parent's eventual grant (see `grantedExtraMinutes` below).
   */
  requestedExtraMinutes: number | null;
  /** PCA-FR-130: only ever set when `requestType === 'BONUS_TIME'`; the app scope the requested/granted extra time applies to (mirrors `schedule/types.ts`'s `BonusGrant.appScope`). */
  requestedAppScope: AppScope | null;
  /**
   * PCA-FR-130: the ACTUAL amount of extra time granted by the deciding
   * parent -- set on APPROVED (equal to `requestedExtraMinutes`, already
   * bound-clamped at createDraft time) and on COUNTERED (the parent's own
   * shorter figure, strictly less than `requestedExtraMinutes` and itself
   * bound-checked). Null for DENIED/EXPIRED/CANCELLED and for every non-
   * BONUS_TIME request type. See ChildRequestService.toBonusGrant().
   */
  grantedExtraMinutes: number | null;
  /** PCA-FR-130: deterministic absolute-UTC expiry of the resulting grant, set alongside `grantedExtraMinutes` at decide() time (`decidedAt + grantedExtraMinutes` minutes) -- never a wall-clock/local-time value, exactly like `schedule/types.ts`'s `BonusGrant.expiresAtUtc`, so it cannot be extended by manipulating device time zone. */
  grantExpiresAtUtc: Date | null;
}
