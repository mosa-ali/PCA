import type { SenderKeyId } from './types.js';
import type { DataVersionLedger } from './DataVersionLedger.js';

/**
 * In-memory reference DataVersionLedger. Like InMemoryReplayLedger, this is
 * ordinary bookkeeping with no crypto-sensitive algorithm choice, so it is
 * a real, usable default -- not a test-only stand-in. Production device
 * storage may substitute a persistent implementation of the same
 * interface.
 */
export class InMemoryDataVersionLedger implements DataVersionLedger {
  private readonly lastVersionBySender = new Map<SenderKeyId, number>();

  getLastAcceptedVersion(senderKeyId: SenderKeyId): number | null {
    return this.lastVersionBySender.get(senderKeyId) ?? null;
  }

  /**
   * Unconditionally sets the recorded version -- this ledger trusts its
   * caller (FamilyEnvelopeVerifier.evaluateEnvelope) to invoke this ONLY
   * on full envelope acceptance, which already enforces monotonicity for
   * every non-ROLLBACK message before ever reaching this call. A
   * max-only ("only advance forward") guard here would be wrong: it would
   * silently defeat the ROLLBACK exemption's entire purpose by never
   * letting an accepted rollback to a LOWER version actually become the
   * new floor, so a legitimate post-rollback envelope at an intermediate
   * version would be incorrectly rejected as non-monotonic against the
   * stale, pre-rollback floor.
   */
  recordAcceptedVersion(senderKeyId: SenderKeyId, dataVersion: number): void {
    this.lastVersionBySender.set(senderKeyId, dataVersion);
  }
}
