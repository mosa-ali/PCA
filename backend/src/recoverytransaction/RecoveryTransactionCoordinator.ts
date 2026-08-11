import { acceptRecoveryEpoch } from '../familytrustset/FamilyTrustSetRecoveryEngine.js';
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
 *     A repeat call while still INITIATED (the crash-mid-flight case)
 *     safely re-attempts acceptance -- RecoveryTransactionLedger's own
 *     atomicity means this can only ever resolve to the same eventual
 *     state as the original attempt, never a second successful
 *     application (see FamilyTrustSetRecoveryEngine's doc comment on the
 *     claim-then-commit ordering and its limitations).
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
    const existing = await this.transactions.beginOrGetExisting({
      recoveryTransactionId,
      familyId: candidateEpoch.familyId,
      proposedTrustSetEpoch: candidateEpoch.trustSetEpoch,
      proposedKeyEpoch: candidateEpoch.keyEpoch,
      now,
    });

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

    const verdict = await acceptRecoveryEpoch(candidateEpoch, opened, store, verifier, ledger);
    if (verdict.accepted) {
      const completed = await this.transactions.markComplete(recoveryTransactionId, now);
      return { outcome: 'COMPLETE', record: completed! };
    }
    const failed = await this.transactions.markFailed(recoveryTransactionId, verdict.reason, now);
    return { outcome: 'REJECTED', reason: verdict.reason, record: failed! };
  }
}
