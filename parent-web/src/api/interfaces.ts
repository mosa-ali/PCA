// Typed API boundary. Every interface here is implemented once by a
// DEVELOPMENT_ONLY fixture provider (src/api/dev/*) and, later, by a real
// HTTP implementation the backend-integration coordinator adds -- the UI
// only ever imports these interfaces plus a factory (src/api/client.ts), so
// swapping the implementation requires no UI changes.
//
// Per docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 5, a real HTTP
// implementation would receive opaque encrypted envelopes and hand them to
// a client-side crypto layer to decrypt -- never assume the HTTP layer
// itself returns readable URLs/locations/usage history/messages/policy.

import type {
  AuditEntrySummary,
  DashboardSnapshot,
  DeviceProtectionStatus,
  EyeProtectionStatus,
  FamilyMember,
  FamilyRequest,
  LocationStatus,
  PrayerSettings,
  RequestStatus,
  ScreenTimeStatus,
  WebProtectionStatus,
  YouTubeStatus,
  AppRule,
} from '../domain/types';
import type { FamilyAction, FamilyRole, PermissionResult } from '../domain/roles';
import type { ParentProtectionAlert } from '../pages/security/ProtectionAlertPanel';
import type {
  CuratedSuggestion,
  WellbeingCustomMessage,
  WellbeingMessageControlV1,
} from '../domain/wellbeing';
import type { WebRuleDeliveryStatus, WebRuleEntry, WebRuleListType } from '../domain/webRulePolicy';
import type {
  CheckoutSession,
  CheckoutStatus,
  CommercialNotification,
  EntitlementChangeRequest,
  EntitlementSnapshot,
  Invoice,
  LimitType,
  PaymentMethodSummary,
  SubscriptionSnapshot,
} from '../domain/billing';
import type { FreeAccessStatus } from '../domain/freeAccess';
import type { DeleteNowResult, ExportRequestResult, RetentionDefaults, RetentionPolicySettings, RetentionPolicySubmitResult } from '../domain/retention';
import type { ActivityTimelineEntry } from '../domain/activityTimeline';

/**
 * An authenticated parent session (PCA-DEC-037).
 *
 * The family is provisioned server-side at the account's first sign-in, so an
 * established session always carries a real `familyId` and a real normal role.
 * There is no pre-family state any more: a session body that arrives without
 * one is a server contract violation and is rejected by the client (fail
 * closed), never bridged with a fabricated family or role.
 *
 * `mfa` is the server's statement of the account's authenticator-app status.
 * The UI only DISPLAYS it (grace reminder, mandatory setup redirect); the
 * server enforces it. `graceExpiresAt` is always taken from the server and is
 * never extended, recomputed or persisted client-side.
 */
export type ParentMfaStatus =
  | { status: 'ACTIVE' }
  | { status: 'GRACE'; graceExpiresAt: string }
  | { status: 'SETUP_REQUIRED'; graceExpiresAt: string };

export interface AuthenticatedSession {
  accountId: string;
  displayName: string;
  familyId: string;
  memberId: string;
  role: FamilyRole;
  serviceAuthenticated: boolean;
  mfa: ParentMfaStatus;
}

/** Result of a self-service registration/verification call -- PCA-AUTH-SESSION-1 (FAMILY_SERVICE_SESSION_V1). Never leaks whether an email already existed. */
export interface RegistrationResult {
  status: 'PENDING_VERIFICATION';
}

export type ParentAccountType = 'PARENT_GUARDIAN' | 'OTHER';
export interface ParentSignupProfile {
  accountType: ParentAccountType;
  estimatedChildCount: number | null;
}

/** Deliberately identical whether or not the email matches an account -- see requestPasswordReset's own doc comment. */
export interface RequestPasswordResetResult {
  status: 'RESET_CODE_SENT_IF_ACCOUNT_EXISTS';
}

export interface ResetPasswordResult {
  status: 'PASSWORD_RESET';
}

/**
 * The password step of sign-in has three expected outcomes besides an
 * immediate session, all modelled as results rather than thrown errors:
 *  - STEP_UP_REQUIRED: an emailed one-time code was sent (accounts without an
 *    authenticator app); finish with `completeLoginStepUp`.
 *  - MFA_REQUIRED: the account has an authenticator app; call `signIn` again
 *    with the SAME email and password plus the current 6-digit `totpCode`.
 */
export type SignInResult =
  | { status: 'AUTHENTICATED'; session: AuthenticatedSession }
  | { status: 'STEP_UP_REQUIRED' }
  | { status: 'MFA_REQUIRED' }
  | { status: 'MFA_RECOVERY_PENDING'; recoveryAvailableAt: string };

/**
 * The emailed login code either establishes the session, or -- when the
 * account's authenticator grace period is over -- establishes NO session and
 * instead sets a short-lived HttpOnly enrollment ticket: the caller must go
 * straight to mandatory authenticator setup.
 */
export type LoginStepUpResult = { status: 'AUTHENTICATED'; session: AuthenticatedSession } | { status: 'MFA_SETUP_REQUIRED' };

/** Email verification activates the account. It deliberately establishes NO session: the parent signs in next. */
export interface VerifyEmailResult {
  status: 'VERIFIED';
}

/**
 * The one-time authenticator enrollment material. It is shown once, held in
 * component memory only, and must never be written to any storage, URL or log.
 */
export interface MfaEnrollmentStart {
  otpauthUri: string;
  secret: string;
}

/** `sessionEstablished` is true only on the enrollment-ticket path, where confirming the authenticator also signs this browser in. */
export interface MfaEnrollmentConfirmResult {
  sessionEstablished: boolean;
}

export type MfaRecoveryCompletionResult =
  | { status: 'MFA_RECOVERY_PENDING'; recoveryAvailableAt: string }
  | { status: 'MFA_SETUP_REQUIRED' };

/** The sensitive commercial operations a fresh authenticator step-up can be minted for (backend: isCommercialStepUpOperation). */
export type CommercialStepUpOperation =
  | 'BILLING_CHECKOUT_CREATE'
  | 'FAMILY_COMMERCIAL_REQUEST_CREATE'
  | 'FAMILY_COMMERCIAL_REQUEST_CANCEL'
  | 'FAMILY_COMMERCIAL_AUTO_RENEW_CANCEL'
  | 'FAMILY_COMMERCIAL_AUTO_RENEW_RESUME';

/** A single-use grant for exactly one commercial operation. Held in memory only and sent once, in that operation's request body. */
export interface CommercialStepUpGrant {
  stepUpToken: string;
  operation: CommercialStepUpOperation;
  expiresAt: string;
}

/** Service-level (account) authentication -- separate from family authority. */
export interface ServiceAuthClient {
  getSession(): Promise<AuthenticatedSession | null>;
  /** `totpCode` is sent only on the second call after an MFA_REQUIRED result. */
  signIn(email: string, password: string, totpCode?: string): Promise<SignInResult>;
  /** Consumes the one-time emailed login step-up code issued when signIn() returned STEP_UP_REQUIRED. */
  completeLoginStepUp(email: string, code: string): Promise<LoginStepUpResult>;
  signOut(): Promise<void>;
  /** Re-authentication for a step-up-protected (non-commercial) family action; binds to an action id. */
  stepUp(actionId: string): Promise<{ granted: boolean; expiresAtUtc: string }>;
  /**
   * PCA-AUTH-SESSION-1 (PCA-DEC-026): self-service registration. Server
   * validates password===passwordConfirmation itself. Always resolves to
   * the identical PENDING_VERIFICATION result, whether the email was new
   * or already registered -- never an enumeration oracle a caller can
   * branch on.
   */
  register(email: string, password: string, passwordConfirmation: string, profile?: ParentSignupProfile): Promise<RegistrationResult>;
  /** Consumes the one-time emailed verification code. Activates the account; establishes no session. */
  verifyEmail(email: string, code: string): Promise<VerifyEmailResult>;
  /**
   * PCA product-completion programme (P1 /login finding): account-level
   * password reset, distinct from the family-E2EE Recovery flow. Always
   * resolves to the identical RESET_CODE_SENT_IF_ACCOUNT_EXISTS result
   * regardless of whether the email matches a real, verified account --
   * never an enumeration oracle, same posture as register().
   */
  requestPasswordReset(email: string): Promise<RequestPasswordResetResult>;
  /**
   * Consumes a password-reset code and replaces the account's credential.
   * Deliberately does NOT establish a session -- the caller must sign in
   * fresh with the new password.
   */
  resetPassword(email: string, code: string, newPassword: string, newPasswordConfirmation: string): Promise<ResetPasswordResult>;
  /**
   * PCA-DEC-037 authenticator enrollment, step 1: password re-authentication,
   * then the server returns the one-time otpauth URI and base32 secret.
   * Authorised by EITHER the HttpOnly enrollment ticket (mandatory setup /
   * recovery; no session exists) OR the live session plus CSRF (voluntary
   * setup during grace).
   */
  startMfaEnrollment(email: string, password: string): Promise<MfaEnrollmentStart>;
  /** Step 2: proves the app is set up with its current 6-digit code. */
  confirmMfaEnrollment(email: string, code: string): Promise<MfaEnrollmentConfirmResult>;
  /** Lost-authenticator recovery, step 1. Always resolves identically (never an account/password oracle). */
  requestMfaRecovery(email: string, password: string): Promise<void>;
  /**
   * Step 2: the first verified code starts a database-backed 24-hour hold;
   * a fresh code after the hold clears the old factor and sets an enrollment
   * ticket. Pending responses carry the server deadline.
   */
  completeMfaRecovery(email: string, password: string, code: string): Promise<MfaRecoveryCompletionResult>;
  /** Mints a single-use grant for one sensitive commercial operation from a fresh authenticator code. ADMINISTRATOR with an active authenticator only. */
  issueCommercialStepUp(operation: CommercialStepUpOperation, code: string): Promise<CommercialStepUpGrant>;
}

/**
 * FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61) -- reads the current
 * account's FreeAccessStatus, derived server-side from the existing
 * FreeAccessSnapshot (PCA-AUTH-SESSION-1) + the server clock. Read-only:
 * this client never computes or caches a locally-derived expiry/remaining-
 * days value, and the UI must always treat the server's response as
 * authoritative over anything it might otherwise infer.
 */
export interface FreeAccessStatusClient {
  /** null when no session is established, or the account has no snapshot yet (never thrown for that expected case). */
  getStatus(): Promise<FreeAccessStatus | null>;
}

export type ParentLanguage = 'en' | 'ar';

export interface ParentPreferences {
  accountId: string;
  language: ParentLanguage;
  emailAlertsEnabled: boolean;
  pushRequestsEnabled: boolean;
  emailDestination: string | null;
  emailDestinationState: 'UNVERIFIED' | 'VERIFIED';
  updatedAtUtc: string;
}

export interface ParentPreferencesPatch {
  language?: ParentLanguage;
  emailAlertsEnabled?: boolean;
  pushRequestsEnabled?: boolean;
  emailDestination?: string | null;
}

export interface ParentPreferencesClient {
  get(): Promise<ParentPreferences>;
  update(patch: ParentPreferencesPatch): Promise<ParentPreferences>;
}

export interface SafeZone {
  zoneId: string;
  familyId: string;
  recipientEndpointId: string;
  ciphertextB64: string;
  nonceB64: string;
  keyEpoch: number;
  revision: number;
  deliveryState: 'PENDING_OFFLINE' | 'READY';
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface NewSafeZoneInput {
  recipientEndpointId: string;
  ciphertextB64: string;
  nonceB64: string;
  keyEpoch: number;
}

export interface SafeZonePatch {
  ciphertextB64?: string;
  nonceB64?: string;
  keyEpoch?: number;
}

export interface SafeZoneClient {
  list(familyId: string): Promise<SafeZone[]>;
  create(familyId: string, input: NewSafeZoneInput): Promise<SafeZone>;
  update(familyId: string, zoneId: string, patch: SafeZonePatch): Promise<SafeZone>;
  remove(familyId: string, zoneId: string): Promise<void>;
}

/**
 * FamilyAuthorityGateway -- every role-authority action is modeled as a
 * signed, epoch-bound, auditable request going through this gateway, never
 * as a direct state mutation from a UI handler. The gateway itself
 * re-checks permission (via evaluatePermission) and rejects on the
 * server/device side conceptually -- UI hiding of a control is never
 * sufficient (docs/architecture/18_PARENT_CONTROL_PANEL_RBAC.md Section 1).
 */
export interface FamilyAuthorityGateway {
  checkPermission(action: FamilyAction): Promise<PermissionResult>;
  listMembers(): Promise<FamilyMember[]>;
  inviteMember(role: 'ADMINISTRATOR' | 'VIEWER', label: string): Promise<{ invitationId: string }>;
  removeMember(memberId: string): Promise<{ auditEventId: string }>;
  changeRole(memberId: string, newRole: FamilyRole): Promise<{ auditEventId: string }>;
  transferOwnership(newOwnerMemberId: string): Promise<{ auditEventId: string }>;
  listAuditTrail(): Promise<AuditEntrySummary[]>;
}

export type FamilyMemberInvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

/** Mirrors backend/src/familymembers/types.ts's FamilyMemberInvitationRecord DTO exactly (never the invited person's plaintext email -- only the server holds/needs the hash). */
export interface FamilyMemberInvitation {
  invitationId: string;
  familyId: string;
  role: 'ADMINISTRATOR' | 'VIEWER';
  status: FamilyMemberInvitationStatus;
  invitedByAccountId: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  expiredAt: string | null;
  revokedAt: string | null;
  acceptedByAccountId: string | null;
}

/**
 * PCA product-completion programme, Writer P0-C (family/members):
 * genuinely separate from FamilyAuthorityGateway (which also carries the
 * still-unimplemented checkPermission/listAuditTrail/transferOwnership --
 * see UnavailableFamilyAuthorityGateway) so a real implementation of the
 * invitation lifecycle specifically does not have to fabricate or stub
 * those unrelated methods. Members.tsx consumes both this AND
 * FamilyAuthorityGateway.listMembers -- the former for "invited, not yet
 * paired" state, the latter for trust-set-resolved active members (see
 * MEMBERSHIP_PERSISTENCE in docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md
 * for why these are two genuinely different states, never conflated).
 */
export interface FamilyMemberInvitationClient {
  list(): Promise<FamilyMemberInvitation[]>;
  invite(role: 'ADMINISTRATOR' | 'VIEWER', invitedEmail: string): Promise<FamilyMemberInvitation>;
  revoke(invitationId: string): Promise<FamilyMemberInvitation>;
  changeRole(invitationId: string, newRole: 'ADMINISTRATOR' | 'VIEWER'): Promise<FamilyMemberInvitation>;
  accept(invitationId: string): Promise<FamilyMemberInvitation>;
}

/** Coarse HTTP-status-bucket code, same shape/spirit as DeviceEnrollmentErrorCode (deviceEnrollmentClient.ts) -- callers branch on this first. */
export type FamilyMemberInvitationErrorCode =
  | 'INVALID_REQUEST' // 400
  | 'UNAUTHORIZED' // 401
  | 'FORBIDDEN' // 403
  | 'NOT_FOUND' // 404
  | 'CONFLICT' // 409 -- duplicate/expired/revoked/already-accepted/not-pending/capacity-exceeded
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

/**
 * Thrown by every FamilyMemberInvitationClient implementation (real and dev)
 * instead of a bare Error, so callers (Members.tsx) can map a rejection to a
 * clear, translated, actionable message instead of displaying a raw
 * diagnostic string. Mirrors DeviceEnrollmentError's shape exactly: `code`
 * is the coarse HTTP bucket, `serverCode` is the backend's own lower_snake_case
 * error id (see backend/src/familymembers/FamilyMemberInvitationService.ts's
 * FamilyMemberInvitationErrorCode, lower-cased by familyMemberRoutes.ts) when
 * one was available, so a caller can distinguish e.g. a duplicate-pending
 * invitation from a capacity-exceeded rejection without re-deriving policy
 * the server already told it.
 */
export class FamilyMemberInvitationError extends Error {
  readonly code: FamilyMemberInvitationErrorCode;
  readonly httpStatus: number | null;
  readonly serverCode: string | null;

  constructor(code: FamilyMemberInvitationErrorCode, message: string, httpStatus: number | null = null, serverCode: string | null = null) {
    super(message);
    this.name = 'FamilyMemberInvitationError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.serverCode = serverCode;
  }
}

/**
 * PCA product-completion programme, Writer P0-D (/security/audit):
 * genuinely separate from FamilyAuthorityGateway.listAuditTrail (which
 * remains still-unimplemented, see UnavailableFamilyAuthorityGateway) --
 * this client fetches OPAQUE, still-encrypted audit-event envelopes from
 * backend/src/http/routes/familyAuditEventRoutes.ts and never claims to
 * return decrypted content itself. Decryption happens only via the
 * injected `decryption` boundary (see AUDIT_EVENT_MODEL in
 * docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md);
 * `list()`'s PENDING_TRUSTED_DECRYPTION result covers BOTH "no
 * actor-device-session available yet" and "envelopes were fetched but the
 * decryption boundary itself is unavailable" -- Audit.tsx must render both
 * as the same honest pending state, exactly like ProtectionAlertPanel.tsx's
 * existing precedent, never a fabricated empty list.
 */
export type AuditTrailFeedResult =
  | { status: 'PENDING_TRUSTED_DECRYPTION' }
  | { status: 'READY'; entries: AuditEntrySummary[] };

export interface FamilyAuditDeliveryClient {
  list(): Promise<AuditTrailFeedResult>;
}

/**
 * PCA product-completion programme (/security/status): genuinely separate
 * from `familyAuditDelivery` above -- this client fetches a family's
 * protection-alert envelopes from
 * backend/src/http/routes/protectionAlertRoutes.ts. Unlike the audit-trail
 * feed, `trigger`/`deviceId`/`generatedAtUtc` are already-safe routing
 * metadata (a closed event-category vocabulary, never a readable
 * family-data description -- see backend/src/alerts/types.ts's own doc
 * comment), so this client renders them directly with no decryption
 * boundary of its own; the envelope's `encryptedPayloadB64`/`nonceB64`
 * payload itself stays fully opaque and is never surfaced to the UI. Same
 * PENDING_TRUSTED_DECRYPTION honest-pending convention as
 * AuditTrailFeedResult -- it covers "no actor-device-session available yet"
 * (this route cannot even be reached without one), never a fabricated
 * empty list.
 */
export type ProtectionAlertFeedResult =
  | { status: 'PENDING_TRUSTED_DECRYPTION' }
  | { status: 'READY'; alerts: ParentProtectionAlert[] };

export interface ProtectionAlertDeliveryClient {
  list(): Promise<ProtectionAlertFeedResult>;
}

/** Read/administer decrypted (client-side) family child data. */
export interface ParentFamilyDataGateway {
  getDashboard(): Promise<DashboardSnapshot>;
  getScreenTime(childId: string): Promise<ScreenTimeStatus>;
  updateScreenTime(childId: string, patch: Partial<Pick<ScreenTimeStatus, 'continuousUseLimitMinutes' | 'breakDurationMinutes'>>): Promise<{ auditEventId: string }>;
  getAppRules(childId: string): Promise<AppRule[]>;
  updateAppRule(childId: string, appId: string, patch: Partial<AppRule>): Promise<{ auditEventId: string }>;
  getWebProtection(childId: string): Promise<WebProtectionStatus>;
  getYouTubeStatus(childId: string): Promise<YouTubeStatus>;
  getLocationStatus(childId: string): Promise<LocationStatus>;
  getEyeProtectionStatus(childId: string): Promise<EyeProtectionStatus>;
  /** Enable/disable the on-device, reminder-only eye-protection prompt for one child -- no dimming, blocking overlay, or forced break; see EyeProtectionPage.tsx's own doc comment. */
  updateEyeProtection(childId: string, remindersEnabled: boolean): Promise<{ remindersEnabled: boolean }>;
  getPrayerSettings(childId: string): Promise<PrayerSettings>;
  /** PCA-FR-092: consolidated, category-level activity timeline for one child -- see ../domain/activityTimeline.ts's file header for what this is (and deliberately is not). Most-recent-first; `limit` caps the returned count. */
  getActivityTimeline(childId: string, limit?: number): Promise<ActivityTimelineEntry[]>;
}

export interface DeviceStatusClient {
  listDeviceStatuses(childId?: string): Promise<DeviceProtectionStatus[]>;
  getDeviceStatus(deviceId: string): Promise<DeviceProtectionStatus | null>;
}

export interface RequestClient {
  listRequests(status?: RequestStatus): Promise<FamilyRequest[]>;
  /**
   * PCA-FR-130: `decision === 'COUNTERED'` requires `counterOfferExtraMinutes`
   * (a shorter duration than the request's own `requestedExtraMinutes` --
   * see ../domain/bonusTime.ts's validateCounterOffer, which every real
   * caller must run before submitting); omitted/ignored for every other
   * decision. The real bound/shorter-than check is re-enforced server-side
   * regardless (backend/src/childrequests/ChildRequestService.ts) -- this
   * is UI-side validation for a good error message, never the authority.
   */
  decide(requestId: string, decision: 'APPROVED' | 'DENIED' | 'COUNTERED', counterOfferExtraMinutes?: number): Promise<{ auditEventId: string }>;
  /**
   * PCA-FR-130 "grant directly": an authorized parent granting bonus time
   * PROACTIVELY, with no pending child request -- role-gated identically to
   * `decide` (the SAME APPROVE_REQUEST family action; a Viewer/Child sees
   * `PermissionGate` hide/disable this the same way it already does for
   * `decide`). Returns the new (already-decided) request's id so the UI can
   * refresh the list without a full reload if desired.
   */
  grantBonusTime(childId: string, extraMinutes: number, reasonText?: string | null): Promise<{ auditEventId: string; requestId: string }>;
}

/**
 * doc 34: a narrow family Web Rule authoring interface -- deliberately NOT
 * routed through a central plaintext family-rule API (doc 34/52/53: no
 * MySQL-backed, centrally-readable family web-rule table exists or should
 * exist; family policy content stays E2EE). `revision` on every returned
 * entry is this child's current accepted local revision (doc 36's
 * LOCAL_DRAFT/PENDING_DELIVERY/DELIVERED/APPLIED/FAILED/STALE lifecycle) --
 * a caller must never treat a successful `setRule`/`removeRule` call here as
 * proof the child device has applied it (doc 36: "parent saved != child
 * applied").
 */
export interface WebRuleAdminClient {
  listRules(childId: string): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus; revision: number | null }>;
  setRule(childId: string, domain: string, listType: WebRuleListType): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus }>;
  removeRule(childId: string, domain: string, listType: WebRuleListType): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus }>;
}

/**
 * PCA-MYKIDS-BILL-1 (doc PCA_ADDENDUM_002 Section 18/18.1): the Parent Web
 * commercial self-service surface. Every mutating method here is the client
 * half of a server-authoritative flow -- in particular `beginCheckout`
 * never itself grants an entitlement increase (PCA-ADD-BILL-035/PCA-ADD-PA-049:
 * only authoritative server-side payment confirmation may raise
 * managedDeviceLimit). `isPaymentProviderAvailable` lets the UI honestly
 * capability-gate the checkout action instead of letting a call fail after
 * the fact (Section 11: "keep the checkout action capability-gated/disabled
 * honestly, no fake client-side completion").
 */
export interface BillingClient {
  getEntitlement(): Promise<EntitlementSnapshot>;
  getSubscription(): Promise<SubscriptionSnapshot>;
  listInvoices(): Promise<Invoice[]>;
  getInvoice(invoiceId: string): Promise<Invoice | null>;
  listPaymentMethods(): Promise<PaymentMethodSummary[]>;
  /** True only when a real, provider-neutral payment API (Agent45) is actually integrated and reachable -- never true merely because demo/dev fixtures are in use for everything else. */
  isPaymentProviderAvailable(): boolean;

  /** Creates a PENDING request for the given limit type/target and resolves it (standard quote, custom-quote-pending, or -- for PARENT_MEMBER_LIMIT, PCA-ADD-PA-054 -- no quote at all). */
  /**
   * Every commercial mutation below carries `stepUpToken`: a single-use grant
   * minted by `ServiceAuthClient.issueCommercialStepUp` for exactly that
   * operation from a fresh authenticator code (PCA-DEC-037,
   * COMMERCIAL_OWNER_AUTHORITY = ADMINISTRATOR + fresh TOTP step-up).
   */
  requestLimitIncrease(limitType: LimitType, targetLimit: number, stepUpToken: string): Promise<EntitlementChangeRequest>;
  /** Parent-initiated withdrawal -- valid only from PENDING/QUOTED (PCA-ADD-PA-030). */
  cancelRequest(requestId: string, stepUpToken: string): Promise<EntitlementChangeRequest>;
  /**
   * QUOTED -> PAYMENT_PENDING handoff to the payment provider
   * (`POST .../billing/checkout`). `returnUrl` is where the provider should
   * send the browser back to; the resolved `redirectUrl` in the response is
   * where the caller must actually navigate next (see
   * `domain/billing.ts`'s `isSameOriginRedirect`) -- this method never
   * itself performs that navigation, never returns an APPROVED state, and
   * never itself confirms payment.
   */
  beginCheckout(requestId: string, returnUrl: string, stepUpToken: string): Promise<CheckoutSession>;
  /** Re-reads a single request's current authoritative state -- used to poll a PAYMENT_PENDING request after a checkout redirect, never trusting the redirect itself. */
  getRequest(requestId: string): Promise<EntitlementChangeRequest | null>;
  /** Polling-only checkout-attempt status (`GET .../billing/checkout/:paymentAttemptId`) -- supplementary to `getRequest`, never authoritative confirmation on its own (PCA-ADD-BILL-035). */
  getCheckoutStatus(paymentAttemptId: string): Promise<CheckoutStatus | null>;

  /** Provider-hosted/tokenized payment-method entry point (PCA-ADD-BILL-024) -- MyKids itself never collects raw card fields. */
  beginAddPaymentMethod(): Promise<PaymentMethodSummary>;
  /** Turns off auto-renew for the family's own active subscription (`POST .../commercial/subscription/auto-renew/cancel`). Never itself cancels the subscription or charges/refunds anything -- flag/state only. */
  cancelAutoRenew(stepUpToken: string): Promise<{ auditEventId: string }>;
  /** Symmetric counterpart to `cancelAutoRenew` -- turns auto-renew back on (`POST .../commercial/subscription/auto-renew/resume`). */
  resumeAutoRenew(stepUpToken: string): Promise<{ auditEventId: string }>;
}

/**
 * PCA-MYKIDS-BILL-3: family-facing commercial notification read/acknowledge
 * surface (contract section "Commercial notifications"). List has NO
 * cursor/offset pagination -- `limit` only, clamped server-side to 200.
 */
export interface CommercialNotificationClient {
  list(limit?: number): Promise<CommercialNotification[]>;
  unreadCount(): Promise<number>;
  markRead(notificationId: string): Promise<void>;
  acknowledge(notificationId: string): Promise<void>;
}

/**
 * PCA-FR-093: family privacy-control intake surface against
 * backend/src/http/routes/retentionRoutes.ts. `getDefaults` is
 * family-scope-free (the architecture-baseline default,
 * PCA-DEC-003/PCA-FR-101); every other method is scoped to the caller's
 * own family. See retentionRoutes.ts's own doc comments: `submitPolicy`
 * validates+audits but this backend holds no policy payload storage
 * (never claim persistence to the UI), `deleteNow`/`requestExport` always
 * report a pending/not-yet-completed disposition, never a fabricated
 * "done" state.
 */
export interface RetentionClient {
  getDefaults(): Promise<RetentionDefaults>;
  submitPolicy(policy: RetentionPolicySettings): Promise<RetentionPolicySubmitResult>;
  deleteNow(actionId: string): Promise<DeleteNowResult>;
  requestExport(): Promise<ExportRequestResult>;
}

export interface WellbeingMessageAdminClient {
  getControl(): Promise<WellbeingMessageControlV1>;
  listCuratedSuggestions(category?: string): Promise<CuratedSuggestion[]>;
  setCuratedSuggestionEnabled(curatedId: string, enabled: boolean): Promise<WellbeingMessageControlV1>;
  createCustomMessage(message: Omit<WellbeingCustomMessage, 'messageId' | 'createdAtUtc' | 'updatedAtUtc'>): Promise<WellbeingMessageControlV1>;
  updateCustomMessage(messageId: string, patch: Partial<WellbeingCustomMessage>): Promise<WellbeingMessageControlV1>;
  duplicateCurated(curatedId: string): Promise<WellbeingMessageControlV1>;
  archiveCustomMessage(messageId: string): Promise<WellbeingMessageControlV1>;
  restoreCustomMessage(messageId: string): Promise<WellbeingMessageControlV1>;
}
