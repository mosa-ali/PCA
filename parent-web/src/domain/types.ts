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

export interface YouTubeStatus {
  childId: string;
  restrictedModeEnabled: boolean;
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
  | 'DEVICE_PAIRING';

export type RequestStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CANCELLED';

export interface FamilyRequest {
  requestId: string;
  childId: string;
  childDisplayName: string;
  type: RequestType;
  reasonText: string | null;
  createdAtUtc: string;
  status: RequestStatus;
  correlationId: string;
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
