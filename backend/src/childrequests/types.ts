import type { TargetScope } from '../familyrbac/types.js';
import type { AppScope } from '../schedule/types.js';

export type { TargetScope };
export type ChildRequestId = string;

/**
 * doc 18 Section 6/lane brief Section 11's four original request kinds, plus `INSTALL_APPROVAL`
 * (PCA-FR-131, CAPABILITY_HONEST_INSTALL_APPROVAL): a device's honest report of a newly-installed
 * app, requesting a parent decision. Reuses this exact same request/decide/audit machinery rather
 * than a parallel approval system -- see `installTargetPackageName`/`installCapabilityState`/
 * `installEnforcementOutcome` below for the fields specific to this kind.
 */
export type ChildRequestType = 'BONUS_TIME' | 'UNBLOCK' | 'SCHEDULE_EXCEPTION' | 'POLICY_EXCEPTION' | 'INSTALL_APPROVAL';

/**
 * CAPABILITY_HONEST_INSTALL_APPROVAL's shared vocabulary (PCA-FR-131). Never a boolean: "can this
 * device actually enforce a decision about this install" has five genuinely distinct honest
 * answers, not one bit -- mirrors Android's `org.pca.app.feature.installapproval.InstallApprovalCapabilityState`
 * and iOS's `InstallApprovalCapability` verbatim (all three keep the identical vocabulary so the
 * SAME state string means the same thing on every surface, never re-interpreted per platform).
 */
export type InstallApprovalCapabilityState =
  /** Real Device Owner authority is held; the device can (and, per `installEnforcementOutcome`,
   * either already has or will) actually suspend/keep-suspended the target package until decided. */
  | 'ENFORCED'
  /** No enforcement authority exists; the device can only surface the request and notify -- it
   * cannot stop the child from using the app before or after the parent decides. */
  | 'REQUEST_ONLY'
  /** Enforcement authority was available before but is not currently held/verifiable (e.g. Android
   * Device Owner status was lost) -- a parent must re-establish it before enforcement is possible
   * again. Never silently reported as ENFORCED just because it once was. */
  | 'AUTHORIZATION_REQUIRED'
  /** The platform exposes no enforcement mechanism for this at all (distinct from REQUEST_ONLY:
   * there is no path to ever reach ENFORCED on this platform, not merely an unheld authority). */
  | 'NOT_SUPPORTED'
  /** Reserved for a platform whose capability is real but inherently partial in a way that is
   * neither full ENFORCED nor a plain REQUEST_ONLY/NOT_SUPPORTED (kept in the shared vocabulary for
   * cross-platform consistency; no request created by this backend module currently sets it). */
  | 'PLATFORM_LIMITED';

export const INSTALL_APPROVAL_CAPABILITY_STATES: ReadonlySet<InstallApprovalCapabilityState> = new Set([
  'ENFORCED',
  'REQUEST_ONLY',
  'AUTHORIZATION_REQUIRED',
  'NOT_SUPPORTED',
  'PLATFORM_LIMITED',
]);

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
  /** PCA-FR-131: only ever set (non-null) when `requestType === 'INSTALL_APPROVAL'`; the device
   * package identifier of the newly-installed app the request is about (Android package name / iOS
   * bundle id shape -- see policy.ts's `isPlausibleAppIdentifier`). Null for every other request type. */
  installTargetPackageName: string | null;
  /** PCA-FR-131: best-effort human-readable app name for the SAME target, or null if the device
   * could not resolve one (see Android's `InstalledAppEventReceiver.resolveAppMetadata`) -- a
   * missing label is never treated as a missing request. Only ever set when `requestType === 'INSTALL_APPROVAL'`. */
  installTargetAppLabel: string | null;
  /**
   * PCA-FR-131 (CAPABILITY_HONEST_INSTALL_APPROVAL): the capability the reporting device honestly
   * believed it had AT THE MOMENT it created this request (before any parent decision) -- shown to
   * the deciding parent so "approve" never silently implies "and this will definitely be blocked."
   * Only ever set when `requestType === 'INSTALL_APPROVAL'`; REQUIRED (not merely allowed) for that
   * type, exactly like `requestedExtraMinutes` is required for `BONUS_TIME`.
   *
   * Deliberately a SEPARATE field from `installEnforcementOutcome` below: this one is a snapshot
   * from request-creation time and can go stale (e.g. Device Owner authority lost afterward) --
   * never re-used as if it were the outcome of applying the eventual decision.
   */
  installCapabilityState: InstallApprovalCapabilityState | null;
  /**
   * PCA-FR-131: the device's own honest, SEPARATE report of what actually happened when it applied
   * the parent's decision -- populated only via `ChildRequestService.acknowledgeApplied`'s
   * `capabilityOutcome` argument (i.e. only once `state === 'APPLIED_ACKNOWLEDGED'`), never by
   * `decide()` itself. `decide()` records the parent's AUTHORIZATION only; it has no way to know
   * what a remote device will actually be able to do, so it never sets this field -- exactly the
   * "approved must never be conflated with enforced" requirement. May legitimately differ from
   * `installCapabilityState` above (e.g. ENFORCED at request time, AUTHORIZATION_REQUIRED here if
   * authority was lost before the decision could be applied) -- that divergence is the honesty
   * signal working as designed, not a bug. Null until acknowledged, and for every non-INSTALL_APPROVAL type.
   */
  installEnforcementOutcome: InstallApprovalCapabilityState | null;
}
