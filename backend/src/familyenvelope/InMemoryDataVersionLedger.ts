import { compareSemanticVersions } from './policy.js';
import type { OpaqueFamilyId, SenderKeyId } from './types.js';
import type { AdvancePolicyVersionResult, DataVersionLedger } from './DataVersionLedger.js';

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
   * A single JS process's synchronous Map access is trivially atomic
   * between one `await` and the next -- see MySqlDataVersionLedger's doc
   * comment for why the durable backend needs a genuine read-compare-write
   * CAS loop to get the same guarantee across processes. Still enforces
   * the same "strictly newer than the CURRENT value" contract as the real
   * implementation, not merely "always succeeds," so callers written
   * against one backend behave the same against the other.
   */
  async advancePolicyVersionIfNewer(
    familyId: OpaqueFamilyId,
    senderKeyId: SenderKeyId,
    candidateVersion: string,
  ): Promise<AdvancePolicyVersionResult> {
    const current = await this.getLastAcceptedVersion(familyId, senderKeyId);
    if (current !== null && compareSemanticVersions(candidateVersion, current) <= 0) {
      return 'stale';
    }
    this.setVersion(familyId, senderKeyId, candidateVersion);
    return 'advanced';
  }

  /**
   * Unconditionally sets the recorded version -- reserved for the
   * SIGNED_ROLLBACK acceptance path. A max-only ("only advance forward")
   * guard here would be wrong: it would silently defeat SIGNED_ROLLBACK's
   * entire purpose by never letting an accepted rollback to a LOWER
   * version actually become the new floor, so a legitimate post-rollback
   * envelope at an intermediate version would be incorrectly rejected as
   * non-monotonic against the stale, pre-rollback floor.
   */
  async recordAuthorizedRollbackVersion(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, rollbackVersion: string): Promise<void> {
    this.setVersion(familyId, senderKeyId, rollbackVersion);
  }

  private setVersion(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, semanticVersion: string): void {
    let bySender = this.lastVersionByFamily.get(familyId);
    if (!bySender) {
      bySender = new Map();
      this.lastVersionByFamily.set(familyId, bySender);
    }
    bySender.set(senderKeyId, semanticVersion);
  }
}
