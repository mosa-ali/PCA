// DEVELOPMENT_ONLY synthetic fixture data. None of this represents a real
// family, child, or account. Used only by the dev implementations of the
// typed API client interfaces when VITE_PCA_DEMO_MODE=true (see
// src/config/env.ts and src/api/client.ts). Never presented as production
// data -- the app shell renders a persistent demo-mode banner whenever this
// module is in use (see src/components/common/DemoBanner.tsx).

import type {
  AppRule,
  AuditEntrySummary,
  ChildSummary,
  DeviceProtectionStatus,
  EyeProtectionStatus,
  FamilyMember,
  FamilyRequest,
  LocationStatus,
  PrayerSettings,
  ScreenTimeStatus,
  ProtectionDisplayState,
  WebProtectionStatus,
  YouTubeStatus,
} from '../../domain/types';
import type { CuratedSuggestion, WellbeingMessageControlV1 } from '../../domain/wellbeing';

export const DEV_CHILDREN: ChildSummary[] = [
  {
    childId: 'child-amir',
    displayName: 'Amir (DEV)',
    ageProfile: 'PRE_TEEN',
    avatarInitial: 'A',
    deviceState: 'ACTIVE',
    screenTimeState: 'ACTIVE',
    breakState: 'ACTIVE',
    batteryPercent: 82,
    batteryState: 'ACTIVE',
    lastSeenUtc: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    lastSeenState: 'ACTIVE',
    dataFreshnessState: 'LIVE',
    protectionCapabilityState: 'ACTIVE',
    policyDeliveryState: 'ACTIVE',
    pendingRequestCount: 1,
    importantAlertCount: 0,
  },
  {
    childId: 'child-lina',
    displayName: 'Lina (DEV)',
    ageProfile: 'TEEN',
    avatarInitial: 'L',
    deviceState: 'LIMITED',
    screenTimeState: 'NEEDS_ATTENTION',
    breakState: 'PENDING_DELIVERY',
    batteryPercent: 14,
    batteryState: 'NEEDS_ATTENTION',
    lastSeenUtc: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    lastSeenState: 'LIMITED',
    dataFreshnessState: 'CACHED',
    protectionCapabilityState: 'PARTIALLY_APPLIED',
    policyDeliveryState: 'PENDING_DELIVERY',
    pendingRequestCount: 2,
    importantAlertCount: 1,
  },
  {
    childId: 'child-yousef',
    displayName: 'Yousef (DEV)',
    ageProfile: 'YOUNGER_CHILD',
    avatarInitial: 'Y',
    deviceState: 'OFFLINE',
    screenTimeState: 'UNAVAILABLE',
    breakState: 'UNAVAILABLE',
    batteryPercent: null,
    batteryState: 'UNAVAILABLE',
    lastSeenUtc: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    lastSeenState: 'OFFLINE',
    dataFreshnessState: 'UNAVAILABLE',
    protectionCapabilityState: 'EPOCH_STALE',
    policyDeliveryState: 'EPOCH_STALE',
    pendingRequestCount: 0,
    importantAlertCount: 2,
  },
];

export const DEV_SCREEN_TIME: Record<string, ScreenTimeStatus> = Object.fromEntries(
  DEV_CHILDREN.map((c) => [
    c.childId,
    {
      childId: c.childId,
      continuousUseLimitMinutes: 60,
      breakDurationMinutes: 30,
      continuousUseElapsedMinutes: c.childId === 'child-lina' ? 55 : 12,
      state: c.screenTimeState,
      qualifyingScope: ['SOCIAL', 'GAMES', 'VIDEO'],
      warningCadenceMinutes: [10, 5, 1],
    } satisfies ScreenTimeStatus,
  ]),
);

export const DEV_APP_RULES: Record<string, AppRule[]> = Object.fromEntries(
  DEV_CHILDREN.map((c) => [
    c.childId,
    [
      { appId: 'app-games', appName: 'Puzzle Quest (DEV)', category: 'GAMES', allowed: true, dailyLimitMinutes: 45 },
      { appId: 'app-social', appName: 'Chatter (DEV)', category: 'SOCIAL', allowed: c.childId !== 'child-yousef', dailyLimitMinutes: 30 },
      { appId: 'app-video', appName: 'ClipStream (DEV)', category: 'VIDEO', allowed: true, dailyLimitMinutes: 60 },
    ] satisfies AppRule[],
  ]),
);

export const DEV_WEB_PROTECTION: Record<string, WebProtectionStatus> = Object.fromEntries(
  DEV_CHILDREN.map((c) => [
    c.childId,
    {
      childId: c.childId,
      filteringLevel: c.ageProfile === 'YOUNGER_CHILD' ? 'STRICT' : 'AGE_DEFAULT',
      blockedCategoryCount: 12,
      allowlistCount: 5,
      state: c.protectionCapabilityState,
    } satisfies WebProtectionStatus,
  ]),
);

export const DEV_YOUTUBE: Record<string, YouTubeStatus> = Object.fromEntries(
  DEV_CHILDREN.map((c) => [
    c.childId,
    {
      childId: c.childId,
      // The native YouTube Android app has no compliant Restricted Mode signal
      // path in this build. Never turn a synthetic age heuristic into an
      // enabled/disabled safety claim.
      safeContentCapability: {
        status: 'UNSUPPORTED',
        source: 'UNAVAILABLE',
      },
      visibilityState: c.deviceState,
      approvedChannelCount: 8,
    } satisfies YouTubeStatus,
  ]),
);

export const DEV_LOCATION: Record<string, LocationStatus> = Object.fromEntries(
  DEV_CHILDREN.map((c) => [
    c.childId,
    {
      childId: c.childId,
      lastSeenUtc: c.lastSeenUtc,
      accuracyMeters: c.deviceState === 'OFFLINE' ? null : 25,
      state: c.lastSeenState,
      isStale: c.deviceState === 'OFFLINE',
    } satisfies LocationStatus,
  ]),
);

export const DEV_EYE: Record<string, EyeProtectionStatus> = Object.fromEntries(
  DEV_CHILDREN.map((c) => [
    c.childId,
    {
      childId: c.childId,
      remindersEnabled: true,
      state: c.deviceState === 'OFFLINE' ? 'UNAVAILABLE' : 'ACTIVE',
      lastReminderUtc: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    } satisfies EyeProtectionStatus,
  ]),
);

export const DEV_PRAYER: Record<string, PrayerSettings> = Object.fromEntries(
  DEV_CHILDREN.map((c) => [
    c.childId,
    {
      childId: c.childId,
      calculationMethod: 'UMM_AL_QURA',
      remindersEnabled: true,
      state: c.deviceState === 'OFFLINE' ? 'UNAVAILABLE' : 'ACTIVE',
    } satisfies PrayerSettings,
  ]),
);

export const DEV_DEVICE_STATUS: DeviceProtectionStatus[] = DEV_CHILDREN.map((c) => ({
  childId: c.childId,
  deviceId: `device-${c.childId}`,
  deviceLabel: `${c.displayName} phone`,
  osFamily: c.childId === 'child-lina' ? 'IOS' : 'ANDROID',
  appVersion: '1.4.0',
  protectionState: toProtectionDisplayState(c.childId),
  lastAcknowledgedPolicyRevision: c.childId === 'child-yousef' ? 11 : 14,
  trustSetEpoch: c.childId === 'child-yousef' ? 3 : 4,
  keyEpoch: c.childId === 'child-yousef' ? 3 : 4,
}));

function toProtectionDisplayState(childId: string): ProtectionDisplayState {
  return childId === 'child-amir'
    ? 'PROTECTED'
    : childId === 'child-lina'
      ? 'STANDARD'
      : 'NOT_SUPPORTED';
}

export const DEV_REQUESTS: FamilyRequest[] = [
  {
    requestId: 'req-1',
    childId: 'child-amir',
    childDisplayName: 'Amir (DEV)',
    type: 'BONUS_TIME',
    reasonText: 'Finished homework early (DEV fixture text)',
    createdAtUtc: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    status: 'PENDING',
    correlationId: 'corr-1',
    requestedExtraMinutes: 30,
    grantedExtraMinutes: null,
  },
  {
    requestId: 'req-2',
    childId: 'child-lina',
    childDisplayName: 'Lina (DEV)',
    type: 'UNBLOCK_SITE',
    reasonText: 'School research site (DEV fixture text)',
    createdAtUtc: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    status: 'PENDING',
    correlationId: 'corr-2',
  },
  {
    requestId: 'req-3',
    childId: 'child-lina',
    childDisplayName: 'Lina (DEV)',
    type: 'EXCEPTION',
    reasonText: null,
    createdAtUtc: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    status: 'APPROVED',
    correlationId: 'corr-3',
  },
  // PCA-FR-131 (CAPABILITY_HONEST_INSTALL_APPROVAL): two fixtures deliberately showing BOTH
  // honest outcomes -- a device with real Device Owner authority (req-4, still pending a parent
  // decision, so installEnforcementOutcome is null: "enforced" is never claimed before it has
  // actually happened) and a device with none (req-5, already decided APPROVED but
  // installEnforcementOutcome stays REQUEST_ONLY -- "approved" is never silently shown as
  // "enforced").
  {
    requestId: 'req-4',
    childId: 'child-amir',
    childDisplayName: 'Amir (DEV)',
    type: 'INSTALL_APPROVAL',
    reasonText: null,
    createdAtUtc: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    status: 'PENDING',
    correlationId: 'corr-4',
    installTargetPackageName: 'com.example.newgame',
    installTargetAppLabel: 'Puzzle Quest 2 (DEV)',
    installCapabilityState: 'ENFORCED',
    installEnforcementOutcome: null,
  },
  {
    requestId: 'req-5',
    childId: 'child-yousef',
    childDisplayName: 'Yousef (DEV)',
    type: 'INSTALL_APPROVAL',
    reasonText: null,
    createdAtUtc: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    status: 'APPROVED',
    correlationId: 'corr-5',
    installTargetPackageName: 'com.example.chatapp',
    installTargetAppLabel: 'ChatterBox (DEV)',
    installCapabilityState: 'REQUEST_ONLY',
    installEnforcementOutcome: 'REQUEST_ONLY',
  },
];

export const DEV_MEMBERS: FamilyMember[] = [
  {
    memberId: 'member-owner',
    displayName: 'You (Owner, DEV)',
    role: 'OWNER',
    endpointLabel: 'This browser',
    deviceCount: 1,
    status: 'ACTIVE',
    lastAcknowledgedPolicyRevision: 14,
  },
  {
    memberId: 'member-admin',
    displayName: 'Sara (Administrator, DEV)',
    role: 'ADMINISTRATOR',
    endpointLabel: 'Sara’s phone',
    deviceCount: 1,
    status: 'ACTIVE',
    lastAcknowledgedPolicyRevision: 14,
  },
  {
    memberId: 'member-viewer',
    displayName: 'Grandma (Viewer, DEV)',
    role: 'VIEWER',
    endpointLabel: 'Tablet',
    deviceCount: 1,
    status: 'PENDING_DELIVERY',
    lastAcknowledgedPolicyRevision: 13,
  },
  {
    memberId: 'member-amir',
    displayName: 'Amir (Child, DEV)',
    role: 'CHILD',
    endpointLabel: 'Amir’s phone',
    deviceCount: 1,
    status: 'ACTIVE',
    lastAcknowledgedPolicyRevision: 14,
  },
];

// actionType/targetScope MUST be drawn from the same canonical
// ParentOperation/TargetScopeKind vocabulary the real backend uses
// (backend/src/familyrbac/types.ts) and that parent-web/src/i18n's
// audit.actionTypes/audit.targetScopeKinds dictionaries translate --
// Audit.tsx's own doc comment calls out "the exact anti-pattern already
// flagged and fixed once this session, in ProtectionAlertPanel's
// raw-enum-dump, must not recur here". A fixture value outside that
// vocabulary (e.g. a composite 'child-lina/screen-time' description) has no
// i18n translation and falls back to the raw untranslated string in the
// rendered table, which is exactly that anti-pattern re-appearing via demo
// data rather than app code.
export const DEV_AUDIT: AuditEntrySummary[] = [
  {
    eventId: 'audit-1',
    actionType: 'EDIT_CHILD_POLICY',
    actorMemberId: 'member-owner',
    targetScope: 'CHILD_PROFILE',
    trustSetEpoch: 4,
    policyRevision: 14,
    timestampUtc: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    resultStatus: 'SUCCESS',
    reasonCategory: null,
    correlationId: 'corr-audit-1',
  },
  {
    eventId: 'audit-2',
    actionType: 'DENIED_AUTHORIZATION_ATTEMPT',
    actorMemberId: 'member-viewer',
    targetScope: 'CHILD_PROFILE',
    trustSetEpoch: 4,
    policyRevision: 14,
    timestampUtc: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    resultStatus: 'DENIED',
    reasonCategory: 'INSUFFICIENT_ROLE',
    correlationId: 'corr-audit-2',
  },
];

export const DEV_CURATED_SUGGESTIONS: CuratedSuggestion[] = [
  {
    curatedId: 'curated-1',
    languageTexts: [
      { languageTag: 'en', text: 'Nice work today! Time for a short break.' },
      { languageTag: 'ar', text: 'أحسنت اليوم! حان وقت استراحة قصيرة.' },
    ],
    category: 'BREAK_REMINDER',
    requiresAdultSupervision: false,
    recommendedTriggers: ['BREAK_DUE'],
  },
  {
    curatedId: 'curated-2',
    languageTexts: [
      { languageTag: 'en', text: 'Remember to check in with a family member.' },
      { languageTag: 'ar', text: 'تذكّر التواصل مع أحد أفراد العائلة.' },
    ],
    category: 'SAFETY_CHECK_IN',
    requiresAdultSupervision: true,
    recommendedTriggers: ['SCHEDULED_TIME_WINDOW'],
  },
  {
    curatedId: 'curated-3',
    languageTexts: [
      { languageTag: 'en', text: 'You are doing great. Keep it up!' },
      { languageTag: 'ar', text: 'أنت تبلي بلاءً حسناً. واصل ذلك!' },
    ],
    category: 'ENCOURAGEMENT',
    requiresAdultSupervision: false,
    recommendedTriggers: ['APP_LAUNCH'],
  },
];

export const DEV_WELLBEING_CONTROL: WellbeingMessageControlV1 = {
  version: 1,
  policyRevision: 3,
  targets: DEV_CHILDREN.map((c) => c.childId),
  enabled: true,
  selectedCuratedSuggestionIds: ['curated-1'],
  customMessages: [
    {
      messageId: 'custom-1',
      sourceCuratedId: null,
      languageTexts: [
        { languageTag: 'en', text: 'We are proud of you, habibi!' },
        { languageTag: 'ar', text: 'نحن فخورون بك يا حبيبي!' },
      ],
      category: 'ENCOURAGEMENT',
      enabled: true,
      archived: false,
      startDate: null,
      endDate: null,
      daysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      timeWindows: [{ startLocalTime: '16:00', endLocalTime: '19:00' }],
      triggers: ['APP_LAUNCH'],
      minimumIntervalMinutes: 120,
      maximumPerDay: 3,
      repeatCooldownMinutes: 1440,
      lockScreenAllowed: false,
      dismissible: true,
      snoozable: true,
      requiresAdultSupervision: false,
      targetChildIds: ['child-amir'],
      createdAtUtc: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAtUtc: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    },
  ],
  updatedAtUtc: new Date().toISOString(),
};
