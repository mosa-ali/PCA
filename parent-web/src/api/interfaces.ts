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

export interface AuthenticatedSession {
  accountId: string;
  displayName: string;
  familyId: string;
  memberId: string;
  role: FamilyRole;
  serviceAuthenticated: boolean;
}

/** Result of a self-service registration/verification call -- PCA-AUTH-SESSION-1 (FAMILY_SERVICE_SESSION_V1). Never leaks whether an email already existed. */
export interface RegistrationResult {
  status: 'PENDING_VERIFICATION';
}

/** Service-level (account) authentication -- separate from family authority. */
export interface ServiceAuthClient {
  getSession(): Promise<AuthenticatedSession | null>;
  signIn(email: string, password: string): Promise<AuthenticatedSession>;
  signOut(): Promise<void>;
  /** Re-authentication for a step-up-protected action; binds to an action id. */
  stepUp(actionId: string): Promise<{ granted: boolean; expiresAtUtc: string }>;
  /**
   * PCA-AUTH-SESSION-1 (PCA-DEC-026): self-service registration. Server
   * validates password===passwordConfirmation itself. Always resolves to
   * the identical PENDING_VERIFICATION result, whether the email was new
   * or already registered -- never an enumeration oracle a caller can
   * branch on.
   */
  register(email: string, password: string, passwordConfirmation: string): Promise<RegistrationResult>;
  /**
   * Consumes the one-time emailed verification code. On success this
   * establishes the session (same effect as signIn) and returns it --
   * first verification for a brand-new family also triggers genesis, so
   * `familyId` may be null if genesis is not currently available (see
   * ../real/realServiceAuthClient.ts's header).
   */
  verifyEmail(email: string, code: string): Promise<AuthenticatedSession>;
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
  enabled: boolean;
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
  enabled?: boolean;
}

export interface SafeZonePatch {
  ciphertextB64?: string;
  nonceB64?: string;
  keyEpoch?: number;
  enabled?: boolean;
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
  decide(requestId: string, decision: 'APPROVED' | 'DENIED'): Promise<{ auditEventId: string }>;
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
  requestLimitIncrease(limitType: LimitType, targetLimit: number): Promise<EntitlementChangeRequest>;
  /** Parent-initiated withdrawal -- valid only from PENDING/QUOTED (PCA-ADD-PA-030). */
  cancelRequest(requestId: string): Promise<EntitlementChangeRequest>;
  /**
   * QUOTED -> PAYMENT_PENDING handoff to the payment provider
   * (`POST .../billing/checkout`). `returnUrl` is where the provider should
   * send the browser back to; the resolved `redirectUrl` in the response is
   * where the caller must actually navigate next (see
   * `domain/billing.ts`'s `isSameOriginRedirect`) -- this method never
   * itself performs that navigation, never returns an APPROVED state, and
   * never itself confirms payment.
   */
  beginCheckout(requestId: string, returnUrl: string): Promise<CheckoutSession>;
  /** Re-reads a single request's current authoritative state -- used to poll a PAYMENT_PENDING request after a checkout redirect, never trusting the redirect itself. */
  getRequest(requestId: string): Promise<EntitlementChangeRequest | null>;
  /** Polling-only checkout-attempt status (`GET .../billing/checkout/:paymentAttemptId`) -- supplementary to `getRequest`, never authoritative confirmation on its own (PCA-ADD-BILL-035). */
  getCheckoutStatus(paymentAttemptId: string): Promise<CheckoutStatus | null>;

  /** Provider-hosted/tokenized payment-method entry point (PCA-ADD-BILL-024) -- MyKids itself never collects raw card fields. */
  beginAddPaymentMethod(): Promise<PaymentMethodSummary>;
  cancelAutoRenew(): Promise<{ auditEventId: string }>;
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
