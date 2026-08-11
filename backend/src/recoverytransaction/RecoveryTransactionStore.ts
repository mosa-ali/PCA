import type { OpaqueFamilyId, RecoveryTransactionRecord } from './types.js';

export interface BeginRecoveryTransactionInput {
  recoveryTransactionId: string;
  familyId: OpaqueFamilyId;
  proposedTrustSetEpoch: number;
  proposedKeyEpoch: number;
  now: Date;
}

/**
 * Persistence port for recovery-transaction lifecycle bookkeeping,
 * distinct from RecoveryTransactionLedger (src/familytrustset): the
 * ledger is the narrow, security-critical "has this id been consumed"
 * atomic gate that FamilyTrustSetRecoveryEngine checks; this store is the
 * broader (and less security-sensitive) lifecycle record a caller uses to
 * implement resumability and to answer "what happened to transaction X"
 * after a crash/restart, independent of whether the ledger claim itself
 * ever succeeded.
 */
export interface RecoveryTransactionStore {
  /**
   * Atomically creates a new INITIATED record for `recoveryTransactionId`
   * if none exists, or returns the EXISTING record unchanged if one
   * already does (regardless of its status) -- this is the operation
   * that makes "resume only the same one-time transaction" true: it never
   * creates a second record for an id that already has one, even if the
   * caller supplies different `proposedTrustSetEpoch`/`proposedKeyEpoch`
   * values on the retry (those are ignored when a record already exists;
   * the FIRST attempt's proposal is authoritative).
   */
  beginOrGetExisting(input: BeginRecoveryTransactionInput): Promise<RecoveryTransactionRecord>;
  get(recoveryTransactionId: string): Promise<RecoveryTransactionRecord | null>;
  markComplete(recoveryTransactionId: string, now: Date): Promise<RecoveryTransactionRecord | null>;
  markFailed(recoveryTransactionId: string, reason: string, now: Date): Promise<RecoveryTransactionRecord | null>;
}

export class InMemoryRecoveryTransactionStore implements RecoveryTransactionStore {
  private readonly records = new Map<string, RecoveryTransactionRecord>();

  async beginOrGetExisting(input: BeginRecoveryTransactionInput): Promise<RecoveryTransactionRecord> {
    const existing = this.records.get(input.recoveryTransactionId);
    if (existing) return existing;
    const record: RecoveryTransactionRecord = {
      recoveryTransactionId: input.recoveryTransactionId,
      familyId: input.familyId,
      status: 'INITIATED',
      proposedTrustSetEpoch: input.proposedTrustSetEpoch,
      proposedKeyEpoch: input.proposedKeyEpoch,
      initiatedAtUtc: input.now,
      completedAtUtc: null,
      failureReason: null,
    };
    this.records.set(input.recoveryTransactionId, record);
    return record;
  }

  async get(recoveryTransactionId: string): Promise<RecoveryTransactionRecord | null> {
    return this.records.get(recoveryTransactionId) ?? null;
  }

  async markComplete(recoveryTransactionId: string, now: Date): Promise<RecoveryTransactionRecord | null> {
    const existing = this.records.get(recoveryTransactionId);
    if (!existing) return null;
    const updated: RecoveryTransactionRecord = { ...existing, status: 'COMPLETE', completedAtUtc: now, failureReason: null };
    this.records.set(recoveryTransactionId, updated);
    return updated;
  }

  async markFailed(recoveryTransactionId: string, reason: string, now: Date): Promise<RecoveryTransactionRecord | null> {
    const existing = this.records.get(recoveryTransactionId);
    if (!existing) return null;
    const updated: RecoveryTransactionRecord = { ...existing, status: 'FAILED', completedAtUtc: now, failureReason: reason };
    this.records.set(recoveryTransactionId, updated);
    return updated;
  }
}
