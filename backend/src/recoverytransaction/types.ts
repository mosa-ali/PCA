export type OpaqueFamilyId = string;

export type RecoveryTransactionStatus = 'INITIATED' | 'COMPLETE' | 'FAILED';

/**
 * Local bookkeeping for one recovery transaction's lifecycle, keyed by
 * the immutable `recoveryTransactionId` (doc 09 Section 10). This record
 * is what makes "interrupted recovery resumes only the same one-time
 * transaction" true: `RecoveryTransactionStore.beginOrGetExisting`
 * creates exactly one row per id, ever -- a second begin/resume call with
 * the same id always returns the SAME record rather than starting a
 * second transaction.
 */
export interface RecoveryTransactionRecord {
  recoveryTransactionId: string;
  familyId: OpaqueFamilyId;
  status: RecoveryTransactionStatus;
  proposedTrustSetEpoch: number;
  proposedKeyEpoch: number;
  /** SHA-256 of the canonical candidate bytes plus its signature, bound on first finalize; raw candidate material is never persisted here. */
  candidateDigestSha256: string | null;
  initiatedAtUtc: Date;
  completedAtUtc: Date | null;
  /** Set only when status is FAILED -- the FamilyTrustSetRecoveryEngine rejection reason, so a resumed/repeated finalize call can report the same outcome without re-running acceptance. */
  failureReason: string | null;
}
