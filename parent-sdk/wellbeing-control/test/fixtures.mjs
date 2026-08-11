export function baseMessage(overrides = {}) {
  return {
    messageId: 'msg-0001',
    enabled: true,
    category: 'GRATITUDE',
    languageTexts: {
      en: { title: 'Say thanks', body: 'Tell someone in your family thank you today.' },
    },
    schedule: {
      daysOfWeek: ['MON', 'WED', 'FRI'],
      timeWindows: [{ startMinute: 16 * 60, endMinute: 18 * 60 }],
    },
    delivery: {
      triggers: ['PERIODIC'],
      minimumIntervalMinutes: 60,
      maximumPerDay: 3,
      repeatCooldownMinutes: 30,
      lockScreenAllowed: false,
      dismissible: true,
      snoozable: true,
      requiresAdultSupervision: false,
    },
    target: { mode: 'ALL_CHILDREN', childProfileIds: [] },
    ...overrides,
  };
}

export function basePolicy(overrides = {}) {
  return {
    version: 1,
    policyId: 'policy-synthetic-0001',
    policyRevision: 1,
    familyScopeRef: 'family-synthetic-0001',
    targets: { mode: 'ALL_CHILDREN', childProfileIds: [] },
    enabled: true,
    selectedCuratedSuggestionIds: [],
    customMessages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function baseIdentity(overrides = {}) {
  return {
    operationId: 'op-0001',
    actorMemberId: 'member-synthetic-parent-0001',
    expectedRevision: 1,
    newRevision: 2,
    targetScope: { mode: 'ALL_CHILDREN', childProfileIds: [] },
    ...overrides,
  };
}
