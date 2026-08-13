import type { OpaqueFamilyId, SenderKeyId } from './types.js';
import type { DataVersionLedger } from './DataVersionLedger.js';

/**
 * In-memory reference DataVersionLedger. Like InMemoryReplayLedger, this is
 * ordinary bookkeeping with no crypto-sensitive algorithm choice, so it is
 * a real, usable default -- not a test-only stand-in. Production device
 * storage may substitute a persistent implementation of the same
 * interface.
 *
 * PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: keyed by a nested Map
 * (familyId -> senderKeyId -> version), not a delimiter-joined string key
 * -- see InMemoryReplayLedger.ts's identical doc comment on why a joined
 * string key is unsafe here (opaque ids have no charset restriction).
 */
export class InMemoryDataVersionLedger implements DataVersionLedger {
  private readonly lastVersionByFamily = new Map<OpaqueFamilyId, Map<SenderKeyId, string>>();

  async getLastAcceptedVersion(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): Promise<string | null> {
    return this.lastVersionByFamily.get(familyId)?.get(senderKeyId) ?? null;
  }

  /**
   * Unconditionally sets the recorded version -- this ledger trusts its
   * caller (FamilyEnvelopeVerifier.evaluateEnvelope) to invoke this ONLY
   * on full envelope acceptance, which already enforces monotonicity for
   * an ordinary POLICY_UPDATE before ever reaching this call. A max-only
   * ("only advance forward") guard here would be wrong: it would silently
   * defeat SIGNED_ROLLBACK's entire purpose by never letting an accepted
   * rollback to a LOWER version actually become the new floor, so a
   * legitimate post-rollback envelope at an intermediate version would be
   * incorrectly rejected as non-monotonic against the stale,
   * pre-rollback floor.
   */
  async recordAcceptedVersion(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, semanticVersion: string): Promise<void> {
    let bySender = this.lastVersionByFamily.get(familyId);
    if (!bySender) {
      bySender = new Map();
      this.lastVersionByFamily.set(familyId, bySender);
    }
    bySender.set(senderKeyId, semanticVersion);
  }
}
