import type { FamilyEnvelope } from '../familyenvelope/types.js';
import type { DrainedOutcome } from './SyncCoordinator.js';
import type { PendingEnvelopeRecord, SyncDecision, SyncOutcomeKind, SyncReceipt } from './types.js';

function outcomeForDecision(decision: SyncDecision): { outcome: SyncOutcomeKind; reason: string | null } {
  switch (decision.kind) {
    case 'APPLY_NOW':
      return { outcome: 'APPLIED', reason: decision.idempotent ? 'idempotent redelivery' : null };
    case 'HOLD_PENDING':
      return { outcome: 'HELD_PENDING', reason: decision.reason };
    case 'REJECT':
      return { outcome: 'REJECTED', reason: decision.reason };
  }
}

/** Builds the local, metadata-only receipt for a just-submitted envelope's outcome. See types.ts's SyncReceipt doc for why this never carries plaintext. */
export function buildReceipt(envelope: FamilyEnvelope, decision: SyncDecision, atUtc: Date): SyncReceipt {
  const { outcome, reason } = outcomeForDecision(decision);
  return { familyId: envelope.familyId, messageId: envelope.messageId, outcome, atUtc, reason };
}

export function buildDrainedReceipts(familyId: string, drained: DrainedOutcome[], atUtc: Date): SyncReceipt[] {
  return drained.map((entry) => {
    const { outcome, reason } = outcomeForDecision(entry.decision);
    return { familyId, messageId: entry.messageId, outcome, atUtc, reason };
  });
}

export function buildExpiredReceipts(expired: PendingEnvelopeRecord[], atUtc: Date): SyncReceipt[] {
  return expired.map((record) => ({
    familyId: record.familyId,
    messageId: record.messageId,
    outcome: 'EXPIRED',
    atUtc,
    reason: record.reason,
  }));
}
