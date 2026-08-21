// Shared domain types for the parent-web typed API boundary.
//
// IMPORTANT (see docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 5.2):
// in production, fields like `label`, `messageText`, location, URLs and
// activity detail arrive as an authenticated-encrypted payload that only a
// trusted parent browser context can decrypt client-side -- PCA
// infrastructure never holds readable family content. The types below model
// the *decrypted, client-side* shape the UI works with once a stubbed crypto
// layer (see src/security/cryptoLayer.ts) has opened the envelope. All
// concrete values used by the `dev` fixture implementation are synthetic and
// clearly marked DEVELOPMENT_ONLY at the call site.

import type { FamilyRole } from './roles';

export type CapabilityState =
  | 'ACTIVE'
  | 'LIMITED'
  | 'UNAVAILABLE'
  | 'NEEDS_ATTENTION'
  | 'OFFLINE'
  | 'PENDING_DELIVERY'
  | 'PARTIALLY_APPLIED'
  | 'EPOCH_STALE'
  | 'REVOKED';

export type ProtectionDisplayState = 'STANDARD' | 'PROTECTED' | 'AUTHORIZATION_REQUIRED' | 'NOT_SUPPORTED';

/**
 * PCA-FR-131 (CAPABILITY_HONEST_INSTALL_APPROVAL): mirrors
 * `backend/src/childrequests/types.ts`'s `InstallApprovalCapabilityState` and Android/iOS's own
 * copies of the same vocabulary verbatim -- never a boolean. `AUTHORIZATION_REQUIRED` and
 * `NOT_SUPPORTED` intentionally reuse the exact same string values `ProtectionDisplayState`
 * already uses (and the same `state.*` i18n/CSS keys -- see `StatusBadge.tsx`), since they mean
 * the identical thing in both places: a parent should never learn two different words for "this
 * device cannot currently enforce."
 */
export type InstallApprovalCapabilityState = 'ENFORCED' | 'REQUEST_ONLY' | 'AUTHORIZATION_REQUIRED' | 'NOT_SUPPORTED' | 'PLATFORM_LIMITED';

export interface FamilyEpochInfo {
  trustSetEpoch: number;
  keyEpoch: number;
  lastAcknowledgedPolicyRevision: number;
}

export type DataFreshnessState = 'LIVE' | 'CACHED' | 'UNAVAILABLE';

export interface ChildSummary {
  childId: string;
  displayName: string;
  ageProfile: 'YOUNGER_CHILD' | 'PRE_TEEN' | 'TEEN';
  avatarInitial: string;
  deviceState: CapabilityState;
  screenTimeState: CapabilityState;
  breakState: CapabilityState;
  batteryPercent: number | null;
  batteryState: CapabilityState;
  lastSeenUtc: string | null;
  lastSeenState: CapabilityState;
  dataFreshnessState: DataFreshnessState;
  protectionCapabilityState: CapabilityState;
  policyDeliveryState: CapabilityState;
  pendingRequestCount: number;
  importantAlertCount: number;
}

export interface DashboardSnapshot {
  children: ChildSummary[];
  familyEpoch: FamilyEpochInfo;
  generatedAtUtc: string;
  isFixtureData: boolean;
}

export interface ScreenTimeStatus {
  childId: string;
  continuousUseLimitMinutes: number;
  breakDurationMinutes: number;
  continuousUseElapsedMinutes: number;
  state: CapabilityState;
  qualifyingScope: string[];
  warningCadenceMinutes: number[];
}

export interface AppRule {
  appId: string;
  appName: string;
  category: string;
  allowed: boolean;
  dailyLimitMinutes: number | null;
}

export interface WebProtectionStatus {
  childId: string;
  filteringLevel: 'AGE_DEFAULT' | 'STRICT' | 'CUSTOM';
  blockedCategoryCount: number;
  allowlistCount: number;
  state: CapabilityState;
}

/** PCA-FR-053: a boolean would falsely imply that the native YouTube app exposes a signal. */
export type YouTubeSafeContentState = 'ENABLED' | 'DISABLED' | 'UNSUPPORTED' | 'UNKNOWN';
export type YouTubeSafeContentSource = 'YOUTUBE_RESTRICTED_MODE' | 'UNAVAILABLE';

export interface YouTubeSafeContentCapability {
  status: YouTubeSafeContentState;
  source: YouTubeSafeContentSource;
}

export interface YouTubeStatus {
  childId: string;
  safeContentCapability: YouTubeSafeContentCapability;
  visibilityState: CapabilityState;
  approvedChannelCount: number;
}

export interface LocationStatus {
  childId: string;
  lastSeenUtc: string | null;
  accuracyMeters: number | null;
  state: CapabilityState;
  isStale: boolean;
}

export interface EyeProtectionStatus {
  childId: string;
  remindersEnabled: boolean;
  state: CapabilityState;
  lastReminderUtc: string | null;
}

export interface PrayerSettings {
  childId: string;
  calculationMethod: string;
  remindersEnabled: boolean;
  state: CapabilityState;
}

export interface DeviceProtectionStatus {
  childId: string;
  deviceId: string;
  deviceLabel: string;
  osFamily: 'ANDROID' | 'IOS';
  appVersion: string;
  protectionState: ProtectionDisplayState;
  lastAcknowledgedPolicyRevision: number;
  trustSetEpoch: number;
  keyEpoch: number;
}

export type RequestType =
  | 'BONUS_TIME'
  | 'UNBLOCK_APP'
  | 'UNBLOCK_SITE'
  | 'EXCEPTION'
  | 'DEVICE_PAIRING'
  | 'INSTALL_APPROVAL';

/** `COUNTERED` (PCA-FR-130): the deciding parent granted a SHORTER duration than a BONUS_TIME request asked for -- terminal, exactly like APPROVED/DENIED (see `requestsPage.decisionCountered`). */
export type RequestStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'COUNTERED' | 'EXPIRED' | 'CANCELLED';

export interface FamilyRequest {
  requestId: string;
  childId: string;
  childDisplayName: string;
  type: RequestType;
  reasonText: string | null;
  createdAtUtc: string;
  status: RequestStatus;
  correlationId: string;
  /** PCA-FR-130: only ever set for `type === 'BONUS_TIME'`. The child's ASK. */
  requestedExtraMinutes?: number | null;
  /** PCA-FR-130: only ever set once decided APPROVED or COUNTERED -- the actual granted amount (equal to `requestedExtraMinutes` for APPROVED, the parent's own shorter figure for COUNTERED). */
  grantedExtraMinutes?: number | null;
  /** PCA-FR-131: only ever set for `type === 'INSTALL_APPROVAL'` -- the device package/app identifier the request is about. */
  installTargetPackageName?: string | null;
  /** PCA-FR-131: best-effort human-readable app name for the same target; may be null even for an INSTALL_APPROVAL request (device could not resolve one). */
  installTargetAppLabel?: string | null;
  /**
   * PCA-FR-131: the reporting device's own honest capability snapshot AT REQUEST-CREATION TIME --
   * shown to the parent BEFORE they decide, so "approve" never silently implies "and this will
   * definitely be blocked." See `installEnforcementOutcome` below for the separate, later,
   * post-decision field -- the two are deliberately never merged into one.
   */
  installCapabilityState?: InstallApprovalCapabilityState | null;
  /**
   * PCA-FR-131: the device's own honest, SEPARATE report of what it actually did once it applied
   * the parent's decision (populated only once `status === 'APPLIED_ACKNOWLEDGED'`-equivalent
   * reporting has occurred) -- null until then. May legitimately differ from
   * `installCapabilityState` above (e.g. authority lost between request and decision); that
   * divergence is the honesty mechanism working, not an inconsistency to reconcile. This UI must
   * never substitute `status === 'APPROVED'` for this field, nor treat a null value as "enforced
   * by default."
   */
  installEnforcementOutcome?: InstallApprovalCapabilityState | null;
}

export interface FamilyMember {
  memberId: string;
  displayName: string;
  role: FamilyRole;
  endpointLabel: string;
  deviceCount: number;
  status: CapabilityState;
  lastAcknowledgedPolicyRevision: number | null;
}

export interface AuditEntrySummary {
  eventId: string;
  actionType: string;
  actorMemberId: string;
  targetScope: string;
  trustSetEpoch: number;
  policyRevision: number;
  timestampUtc: string;
  resultStatus: 'SUCCESS' | 'DENIED' | 'PENDING';
  reasonCategory: string | null;
  correlationId: string;
}
