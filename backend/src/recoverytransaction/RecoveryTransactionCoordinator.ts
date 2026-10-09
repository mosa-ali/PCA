import { acceptRecoveryEpoch } from '../familytrustset/FamilyTrustSetRecoveryEngine.js';
import { isFamilyEpochNumber } from '../familyepoch/bounds.js';
import type { RecoveryFtsRejectionReason } from '../familytrustset/FamilyTrustSetRecoveryEngine.js';
import type { FamilyTrustSetStore } from '../familytrustset/FamilyTrustSetStore.js';
import type { RecoveryTransactionLedger } from '../familytrustset/RecoveryTransactionLedger.js';
import type { TrustSetSignatureVerifier } from '../familytrustset/TrustSetSignatureVerifier.js';
import type { FamilyTrustSetEpoch } from '../familytrustset/types.js';
import type { OpenedRecoveryEnvelope } from '../recovery/RecoveryEnvelopeCipher.js';
import type { RecoveryTransactionStore } from './RecoveryTransactionStore.js';
import type { RecoveryTransactionRecord } from './types.js';

export type FinalizeRecoveryOutcome =
  | { outcome: 'COMPLETE'; record: RecoveryTransactionRecord }
  | { outcome: 'REJECTED'; reason: RecoveryFtsRejectionReason; record: RecoveryTransactionRecord };

const finalizeQueues = new WeakMap<RecoveryTransactionStore, Map<string, Promise<void>>>();

/**
 * Serialize finalization for one transaction within this process, including
 * calls made through different coordinators that share the same store object.
 * A durable multi-process implementation must additionally serialize
 * finalization by transaction ID and enforce terminal transitions atomically
 * in its persistence layer; this queue is not a distributed lock.
 */
async function withFinalizeQueue<T>(
  store: RecoveryTransactionStore,
  recoveryTransactionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  let byTransactionId = finalizeQueues.get(store);
  if (!byTransactionId) {
    byTransactionId = new Map();
    finalizeQueues.set(store, byTransactionId);
  }

  const previous = byTransactionId.get(recoveryTransactionId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  byTransactionId.set(recoveryTransactionId, queued);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (byTransactionId.get(recoveryTransactionId) === queued) {
      byTransactionId.delete(recoveryTransactionId);
      if (byTransactionId.size === 0) finalizeQueues.delete(store);
    }
  }
}

function assertCandidateEpoch(candidateEpoch: Pick<FamilyTrustSetEpoch, 'trustSetEpoch' | 'keyEpoch'>): void {
  if (!isFamilyEpochNumber(candidateEpoch.trustSetEpoch, 1) || !isFamilyEpochNumber(candidateEpoch.keyEpoch, 1)) {
    throw new Error('Recovery candidate epochs must be exact integers within the supported family epoch range.');
  }
}

function snapshotCandidateEpoch(candidateEpoch: FamilyTrustSetEpoch): FamilyTrustSetEpoch {
  return {
    ...candidateEpoch,
    entries: Array.isArray(candidateEpoch.entries)
      ? candidateEpoch.entries.map((entry) => entry !== null && typeof entry === 'object' ? { ...entry } : entry)
      : candidateEpoch.entries,
    issuedAt: candidateEpoch.issuedAt instanceof Date
      ? new Date(candidateEpoch.issuedAt.getTime())
      : candidateEpoch.issuedAt,
  };
}

function isBoundOpenedEnvelope(
  recoveryTransactionId: string,
  familyId: string,
  opened: OpenedRecoveryEnvelope,
): boolean {
  return (
    opened.recoveryTransactionId === recoveryTransactionId &&
    opened.familyId === familyId &&
    isFamilyEpochNumber(opened.boundTrustSetEpoch, 1) &&
    isFamilyEpochNumber(opened.boundKeyEpoch, 0)
  );
}

function transactionMatchesCandidate(
  existing: RecoveryTransactionRecord,
  recoveryTransactionId: string,
  candidateEpoch: Pick<FamilyTrustSetEpoch, 'familyId' | 'trustSetEpoch' | 'keyEpoch'>,
): boolean {
  return (
    existing.recoveryTransactionId === recoveryTransactionId &&
    existing.familyId === candidateEpoch.familyId &&
    existing.proposedTrustSetEpoch === candidateEpoch.trustSetEpoch &&
    existing.proposedKeyEpoch === candidateEpoch.keyEpoch
  );
}

/**
 * Composes FamilyTrustSetRecoveryEngine with resumable local lifecycle
 * bookkeeping (RecoveryTransactionStore) so that:
 *
 *   - `beginOrResume` is always called first and is itself idempotent per
 *     `recoveryTransactionId` -- calling it again after an interruption
 *     (app killed, network drop, process restart) returns the SAME
 *     record, never a second one, so two owners / two valid transactions
 *     / mixed epochs cannot arise from retrying the same recovery.
 *   - `finalize` is safe to call more than once for the same id: once a
 *     transaction reaches COMPLETE or FAILED, a repeat call returns the
 *     cached outcome WITHOUT re-invoking acceptRecoveryEpoch (so it never
 *     touches the store or the RecoveryTransactionLedger a second time).
 *     A repeat call while still INITIATED can safely retry an attempt that
 *     failed before the Trust Set commit. The accepted epoch and this
 *     lifecycle record are written through separate ports: if the epoch
 *     commits but `markComplete` fails or the process exits before it, the
 *     one-time ledger has no read receipt that proves which transaction
 *     applied it. Retrying can therefore observe an already-advanced Trust
 *     Set without safely reconstructing the transaction outcome. The
 *     current transaction store and ledger are in-memory references; a
 *     durable implementation needs an approved atomic outcome/receipt
 *     boundary before this case can be called crash-safe.
 *
 * This class delivers no envelopes and talks to no transport itself --
 * "opaque transport, device-side authority verification" (PCA-13 Section
 * 13): the caller is responsible for retrieving the recovery envelope and
 * delivering/receiving RECOVERY_TRANSACTION envelopes via the existing
 * src/familyenvelope + src/relay machinery.
 */
export class RecoveryTransactionCoordinator {
  constructor(private readonly transactions: RecoveryTransactionStore) {}

  async beginOrResume(
    recoveryTransactionId: string,
    candidateEpoch: Pick<FamilyTrustSetEpoch, 'familyId' | 'trustSetEpoch' | 'keyEpoch'>,
    now: Date,
  ): Promise<RecoveryTransactionRecord> {
    assertCandidateEpoch(candidateEpoch);
    return this.transactions.beginOrGetExisting({
      recoveryTransactionId,
      familyId: candidateEpoch.familyId,
      proposedTrustSetEpoch: candidateEpoch.trustSetEpoch,
      proposedKeyEpoch: candidateEpoch.keyEpoch,
      now,
    });
  }

  async finalize(
    recoveryTransactionId: string,
    candidateEpoch: FamilyTrustSetEpoch,
    opened: OpenedRecoveryEnvelope,
    store: FamilyTrustSetStore,
    verifier: TrustSetSignatureVerifier,
    ledger: RecoveryTransactionLedger,
    now: Date,
  ): Promise<FinalizeRecoveryOutcome> {
    const candidateSnapshot = snapshotCandidateEpoch(candidateEpoch);
    const openedSnapshot = { ...opened };
    const nowSnapshot = new Date(now.getTime());
    assertCandidateEpoch(candidateSnapshot);
    // The opened value is the recovery authority. Check its immutable
    // transaction/family binding before creating or retrieving lifecycle
    // state, so an unrelated envelope cannot create or consume a record.
    if (!isBoundOpenedEnvelope(recoveryTransactionId, candidateSnapshot.familyId, openedSnapshot)) {
      throw new Error('Opened recovery envelope does not match the requested transaction and candidate family.');
    }

    return withFinalizeQueue(this.transactions, recoveryTransactionId, async () => {
      const existing = await this.transactions.beginOrGetExisting({
        recoveryTransactionId,
        familyId: candidateSnapshot.familyId,
        proposedTrustSetEpoch: candidateSnapshot.trustSetEpoch,
        proposedKeyEpoch: candidateSnapshot.keyEpoch,
        now: nowSnapshot,
      });

      if (!transactionMatchesCandidate(existing, recoveryTransactionId, candidateSnapshot)) {
        return { outcome: 'REJECTED', reason: 'ENVELOPE_EPOCH_MISMATCH', record: existing };
      }

      if (existing.status === 'COMPLETE') {
        return { outcome: 'COMPLETE', record: existing };
      }
      if (existing.status === 'FAILED') {
        return {
          outcome: 'REJECTED',
          reason: (existing.failureReason ?? 'RECOVERY_TRANSACTION_ALREADY_USED') as RecoveryFtsRejectionReason,
          record: existing,
        };
      }

      const verdict = await acceptRecoveryEpoch(candidateSnapshot, openedSnapshot, store, verifier, ledger);
      if (verdict.accepted) {
        const completed = await this.transactions.markComplete(recoveryTransactionId, nowSnapshot);
        if (!completed) throw new Error('Recovery transaction disappeared after accepted recovery.');
        if (completed.status === 'FAILED') {
          return {
            outcome: 'REJECTED',
            reason: (completed.failureReason ?? 'RECOVERY_TRANSACTION_ALREADY_USED') as RecoveryFtsRejectionReason,
            record: completed,
          };
        }
        if (completed.status !== 'COMPLETE') throw new Error('Recovery transaction did not reach a terminal state.');
        return { outcome: 'COMPLETE', record: completed };
      }
      const failed = await this.transactions.markFailed(recoveryTransactionId, verdict.reason, nowSnapshot);
      if (!failed) throw new Error('Recovery transaction disappeared after rejected recovery.');
      if (failed.status === 'COMPLETE') return { outcome: 'COMPLETE', record: failed };
      if (failed.status !== 'FAILED') throw new Error('Recovery transaction did not reach a terminal state.');
      return {
        outcome: 'REJECTED',
        reason: (failed.failureReason ?? verdict.reason) as RecoveryFtsRejectionReason,
        record: failed,
      };
    });
  }
}
