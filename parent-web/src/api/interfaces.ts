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

export interface AuthenticatedSession {
  accountId: string;
  displayName: string;
  familyId: string;
  memberId: string;
  role: FamilyRole;
  serviceAuthenticated: boolean;
}

/** Service-level (account) authentication -- separate from family authority. */
export interface ServiceAuthClient {
  getSession(): Promise<AuthenticatedSession | null>;
  signIn(email: string, password: string): Promise<AuthenticatedSession>;
  signOut(): Promise<void>;
  /** Re-authentication for a step-up-protected action; binds to an action id. */
  stepUp(actionId: string): Promise<{ granted: boolean; expiresAtUtc: string }>;
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
