import type { ChildRequestState, ChildRequestType, InstallApprovalCapabilityState } from './types.js';
import { INSTALL_APPROVAL_CAPABILITY_STATES } from './types.js';
import type { ParentOperation } from '../familyrbac/types.js';

export const MAX_REASON_NOTE_LENGTH = 280;
export const MAX_REQUEST_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours -- a child request is not an indefinitely open grant
export const DEFAULT_REQUEST_LIFETIME_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * PCA-FR-130 bound on a single BONUS_TIME grant (principle "amount is
 * bounded"). Chosen relative to this codebase's own existing screen-time
 * ceilings rather than an arbitrary number: parent-web's
 * `domain/screenTimePolicy.ts` already treats 120 minutes
 * (`BREAK_DURATION_MAX_MINUTES`) as the sane operational ceiling for a
 * single configurable duration field, and the daily-limit engine
 * (`schedule/engine.ts`) treats bonus minutes as strictly additive on top
 * of whatever daily limit is configured -- an unbounded bonus grant would
 * let a single approval silently override a whole day's policy, which
 * principle 7 ("cannot become permanent policy silently") forbids in
 * spirit. 120 minutes is generous enough to be a genuine "yes, watch one
 * more movie" exception while remaining strictly bounded and auditable.
 */
export const MAX_BONUS_GRANT_MINUTES = 120;
export const MIN_BONUS_GRANT_MINUTES = 1;

/** PCA-FR-131: bounds on the two install-target text fields -- generous enough for a real Android
 * package name (reverse-DNS, no realistic ceiling near this) or iOS bundle id, and for a
 * PackageManager-resolved app label, while still rejecting an obviously-abusive payload. */
export const MAX_APP_IDENTIFIER_LENGTH = 255;
export const MAX_APP_LABEL_LENGTH = 200;

/** Every ChildRequestType maps to exactly the familyrbac ParentOperation doc 18's matrix requires for its decision -- childrequests never invents a separate authorization path. */
const REQUEST_TYPE_TO_OPERATION: Record<ChildRequestType, ParentOperation> = {
  BONUS_TIME: 'APPROVE_BONUS_TIME',
  UNBLOCK: 'APPROVE_UNBLOCK',
  SCHEDULE_EXCEPTION: 'APPROVE_EXCEPTION',
  POLICY_EXCEPTION: 'APPROVE_EXCEPTION',
  INSTALL_APPROVAL: 'APPROVE_INSTALL',
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
  PENDING: new Set(['APPROVED', 'DENIED', 'COUNTERED', 'EXPIRED', 'CANCELLED']),
  APPROVED: new Set(['APPLIED_ACKNOWLEDGED']),
  DENIED: new Set(),
  // COUNTERED is terminal, exactly like DENIED -- see types.ts's ChildRequestState doc comment:
  // the parent's counter-offer IS the decision, never a re-opened negotiation.
  COUNTERED: new Set(),
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

/** PCA-FR-130: whole minutes, strictly within [MIN_BONUS_GRANT_MINUTES, MAX_BONUS_GRANT_MINUTES]. Used both for the child's ASK (createDraft) and the parent's eventual grant/counter-offer (decide) -- the SAME bound applies to both, so a parent counter-offering "more" than the bound is rejected exactly like an over-bound child request. */
export function isPlausibleExtraMinutes(candidate: unknown): candidate is number {
  return (
    typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= MIN_BONUS_GRANT_MINUTES &&
    candidate <= MAX_BONUS_GRANT_MINUTES
  );
}

/**
 * PCA-FR-131: bounded, non-empty app-identifier shape. Deliberately permissive across BOTH
 * supported platforms rather than an Android-only reverse-DNS regex -- an iOS bundle id has the
 * same reverse-DNS-like shape but this module has no reason to reject a future platform's
 * differently-shaped identifier as long as it is a plausible, bounded opaque string; the actual
 * platform-side receivers (Android's `InstalledAppEventReceiver`) are what constrain what a REAL
 * package name looks like before this ever gets called.
 */
export function isPlausibleAppIdentifier(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.trim().length > 0 && candidate.length <= MAX_APP_IDENTIFIER_LENGTH;
}

/** PCA-FR-131: an app label is best-effort and MAY be absent (see types.ts's `installTargetAppLabel` doc comment) -- null/undefined is valid input, but a present value must still be bounded and non-blank. */
export function isPlausibleAppLabel(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.trim().length > 0 && candidate.length <= MAX_APP_LABEL_LENGTH;
}

export function isInstallApprovalCapabilityState(candidate: unknown): candidate is InstallApprovalCapabilityState {
  return typeof candidate === 'string' && INSTALL_APPROVAL_CAPABILITY_STATES.has(candidate as InstallApprovalCapabilityState);
}
