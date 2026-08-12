/**
 * Local scheduling priority for bounded reconnect-batch delivery, derived
 * ONLY from an already-accepted wire field (`FamilyEnvelope.messageType`)
 * -- no new authority is invented, and a message's priority tier never
 * changes what evaluateEnvelope/SyncCoordinator ultimately decide about it,
 * only which items get the current bounded batch's limited slots first.
 * Mirrors contracts/runtime-sync/catalogue.json's priorityMessageTypeMap.
 */
export const PRIORITY_TIERS = [
  'TRUST_SECURITY',
  'POLICY',
  'DECISION',
  'APPLICATION_RECEIPT',
  'CRITICAL_STATE',
  'ACTIVITY_SUMMARY',
] as const;

export type PriorityTier = (typeof PRIORITY_TIERS)[number];

const TIER_RANK: Record<PriorityTier, number> = Object.fromEntries(
  PRIORITY_TIERS.map((tier, index) => [tier, index]),
) as Record<PriorityTier, number>;

const MESSAGE_TYPE_TIER: Record<string, PriorityTier> = {
  KEY_ROTATION: 'TRUST_SECURITY',
  DEVICE_REVOKE: 'TRUST_SECURITY',
  TAMPER_ALERT: 'TRUST_SECURITY',
  FTS_UPDATE: 'TRUST_SECURITY',
  RECOVERY_TRANSACTION: 'TRUST_SECURITY',
  SIGNED_ROLLBACK: 'TRUST_SECURITY',
  POLICY_UPDATE: 'POLICY',
  RETENTION_DELETION_INSTRUCTION: 'POLICY',
  CHILD_REQUEST: 'DECISION',
  PARENT_DECISION: 'DECISION',
  POLICY_RECEIPT: 'APPLICATION_RECEIPT',
  RETENTION_RECEIPT: 'APPLICATION_RECEIPT',
  LOCATION_RESPONSE: 'CRITICAL_STATE',
  STATUS_SNAPSHOT: 'CRITICAL_STATE',
  ACTIVITY_SUMMARY: 'ACTIVITY_SUMMARY',
};

const DEFAULT_TIER: PriorityTier = 'ACTIVITY_SUMMARY';

export function priorityTierForMessageType(messageType: string): PriorityTier {
  return MESSAGE_TYPE_TIER[messageType] ?? DEFAULT_TIER;
}

export function priorityRank(messageType: string): number {
  return TIER_RANK[priorityTierForMessageType(messageType)];
}

export interface PrioritizableItem {
  messageType: string;
  enqueuedAtEpochMillis: number;
}

/**
 * Stable sort: highest-priority tier first, ties broken by enqueue order
 * (earliest first) -- never by arbitrary/insertion-order-dependent
 * comparator instability, so the same input always orders identically.
 */
export function sortByPriority<T extends PrioritizableItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const rankDiff = priorityRank(a.messageType) - priorityRank(b.messageType);
    if (rankDiff !== 0) return rankDiff;
    return a.enqueuedAtEpochMillis - b.enqueuedAtEpochMillis;
  });
}
