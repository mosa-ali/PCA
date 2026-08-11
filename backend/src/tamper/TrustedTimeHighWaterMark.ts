/**
 * Doc 21 Section 3's clock-rollback response: "Persisted trusted-time
 * high-water mark (doc 11 Section 5.1) | Do not extend policy/retention
 * expiry; use the greater trusted bound; request time correction." No
 * such high-water-mark mechanism exists anywhere else in the codebase
 * (confirmed by search) -- this is a genuine, previously-unbuilt piece of
 * PCA-13's required scope, not a restatement of an existing check.
 *
 * The device persists the LATEST trusted timestamp it has ever observed
 * (`persistedHighWaterMarkUtc`). Every subsequent read of the device
 * clock is evaluated against it: if the device clock now reads EARLIER
 * than the high-water mark, the clock has been rolled back (accidentally
 * or adversarially) and must never be trusted for expiry/retention
 * decisions -- the trusted "now" stays pinned at the high-water mark
 * instead of regressing, so an expired envelope or retention window
 * cannot be "un-expired" by winding the clock backward.
 */
export interface ClockEvaluation {
  isRollbackDetected: boolean;
  /** The value all expiry/retention decisions must use: the greater of the persisted high-water mark and the freshly observed device clock. Never earlier than either. */
  trustedNowUtc: Date;
}

export function evaluateDeviceClock(persistedHighWaterMarkUtc: Date | null, observedNowUtc: Date): ClockEvaluation {
  if (persistedHighWaterMarkUtc === null) {
    // First-ever observation: nothing to roll back from yet.
    return { isRollbackDetected: false, trustedNowUtc: observedNowUtc };
  }
  const isRollbackDetected = observedNowUtc.getTime() < persistedHighWaterMarkUtc.getTime();
  return {
    isRollbackDetected,
    trustedNowUtc: isRollbackDetected ? persistedHighWaterMarkUtc : observedNowUtc,
  };
}

/**
 * The value the caller should persist as the new high-water mark after
 * this evaluation -- monotonically non-decreasing by construction (it is
 * always `max(persisted, evaluation.trustedNowUtc)`), so a caller cannot
 * accidentally regress the persisted mark itself even via a bug that
 * feeds a rolled-back `trustedNowUtc` back in.
 */
export function advanceHighWaterMark(persistedHighWaterMarkUtc: Date | null, evaluation: ClockEvaluation): Date {
  if (persistedHighWaterMarkUtc === null) return evaluation.trustedNowUtc;
  return evaluation.trustedNowUtc.getTime() > persistedHighWaterMarkUtc.getTime()
    ? evaluation.trustedNowUtc
    : persistedHighWaterMarkUtc;
}
