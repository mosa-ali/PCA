import type { ParentUnblockRequest, ParentUnblockRequestStatus } from './types.js';
import type { WebRuleSource } from '../web/types.js';

export const MAX_URL_LENGTH = 2048;
export const MAX_PAGE_TITLE_LENGTH = 512;

/**
 * doc 14: "a parent denylist overrides ordinary category allow" and a
 * security block is the one case doc 14 calls "non-overridable security
 * policy." A SECURITY_DENYLIST block is therefore never requestable -- the
 * child review/unblock workflow exists for category, schedule, parent-
 * denylist and classifier blocks only, never a malware/phishing/scam hit.
 */
export function isBlockRequestable(source: WebRuleSource | 'CLASSIFIER' | 'DEFAULT'): boolean {
  return source !== 'SECURITY_DENYLIST';
}

/**
 * Every legal status transition for a ParentUnblockRequest. PENDING is the
 * only state a decision can be made from; once decided, a request is
 * terminal -- doc 14's "the parent...can allow a site temporarily or
 * permanently" describes ONE decision per request, so a second decision on
 * an already-decided request must be a new request, not a state overwrite.
 */
const LEGAL_TRANSITIONS: Record<ParentUnblockRequestStatus, ReadonlySet<ParentUnblockRequestStatus>> = {
  PENDING: new Set(['APPROVED_TEMPORARY', 'APPROVED_PERMANENT', 'DENIED']),
  APPROVED_TEMPORARY: new Set(),
  APPROVED_PERMANENT: new Set(),
  DENIED: new Set(),
};

export function isLegalUnblockRequestTransition(
  from: ParentUnblockRequestStatus,
  to: ParentUnblockRequestStatus,
): boolean {
  return LEGAL_TRANSITIONS[from].has(to);
}

/** A temporary approval is only in effect until its own expiry; after that the underlying block resumes exactly as before, no re-request needed for it to take effect. */
export function isTemporaryApprovalActive(request: ParentUnblockRequest, now: Date): boolean {
  return (
    request.status === 'APPROVED_TEMPORARY' &&
    request.temporaryApprovalExpiresAt !== null &&
    request.temporaryApprovalExpiresAt.getTime() > now.getTime()
  );
}

export function isPlausibleUrl(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_URL_LENGTH;
}

export function isPlausiblePageTitle(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_PAGE_TITLE_LENGTH;
}
