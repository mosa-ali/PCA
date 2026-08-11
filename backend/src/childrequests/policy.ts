import type { ChildRequestState, ChildRequestType } from './types.js';
import type { ParentOperation } from '../familyrbac/types.js';

export const MAX_REASON_NOTE_LENGTH = 280;
export const MAX_REQUEST_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours -- a child request is not an indefinitely open grant
export const DEFAULT_REQUEST_LIFETIME_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Every ChildRequestType maps to exactly the familyrbac ParentOperation doc 18's matrix requires for its decision -- childrequests never invents a separate authorization path. */
const REQUEST_TYPE_TO_OPERATION: Record<ChildRequestType, ParentOperation> = {
  BONUS_TIME: 'APPROVE_BONUS_TIME',
  UNBLOCK: 'APPROVE_UNBLOCK',
  SCHEDULE_EXCEPTION: 'APPROVE_EXCEPTION',
  POLICY_EXCEPTION: 'APPROVE_EXCEPTION',
};

export function operationForRequestType(requestType: ChildRequestType): ParentOperation {
  return REQUEST_TYPE_TO_OPERATION[requestType];
}

/**
 * Legal state transitions. PENDING is the only state a parent decision or
 * expiry can act on; every other state is terminal except APPROVED, which
 * has exactly one further transition (the child's own applied
 * acknowledgement). This closes the same "decided-once" shape as
 * familyrbac's ParentUnblockRequest-equivalent state machines elsewhere in
 * this codebase.
 */
const LEGAL_TRANSITIONS: Record<ChildRequestState, ReadonlySet<ChildRequestState>> = {
  DRAFT_LOCAL: new Set(['PENDING']),
  PENDING: new Set(['APPROVED', 'DENIED', 'EXPIRED', 'CANCELLED']),
  APPROVED: new Set(['APPLIED_ACKNOWLEDGED']),
  DENIED: new Set(),
  EXPIRED: new Set(),
  CANCELLED: new Set(),
  APPLIED_ACKNOWLEDGED: new Set(),
};

export function isLegalChildRequestTransition(from: ChildRequestState, to: ChildRequestState): boolean {
  return LEGAL_TRANSITIONS[from].has(to);
}

export function isPlausibleReasonNote(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_REASON_NOTE_LENGTH;
}

export function sanitizeReasonNote(candidate: string | null | undefined): string | null {
  if (candidate == null || candidate.length === 0) return null;
  return candidate.slice(0, MAX_REASON_NOTE_LENGTH);
}

export function isPlausibleOpaqueId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 128;
}
