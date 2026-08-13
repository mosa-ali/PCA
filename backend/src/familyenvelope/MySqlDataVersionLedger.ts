import { execute, runInTransaction } from '../db/pool.js';
import type { OpaqueFamilyId, SenderKeyId } from './types.js';
import type { DataVersionLedger } from './DataVersionLedger.js';

interface VersionRow {
  last_accepted_version: string;
}

/**
 * Durable, MySQL-backed DataVersionLedger -- the PCA-SYNC-DURABILITY-1
 * drop-in replacement for InMemoryDataVersionLedger. Losing this ledger's
 * state on restart is a genuine anti-downgrade regression, not merely a
 * convenience loss: FamilyEnvelopeVerifier.evaluateEnvelope only rejects a
 * stale-version POLICY_UPDATE by comparing against
 * getLastAcceptedVersion's return value, so a restart that resets this to
 * "no prior version" would let an old, previously-superseded (but still
 * validly signed at the time it was issued) POLICY_UPDATE be re-accepted
 * as if it were new -- a silent policy rollback.
 *
 * PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: primary key is now
 * (family_id, sender_key_id) (migration 0004) -- `family_id` is ALWAYS the
 * caller's authoritative, session-derived family identity, never
 * envelope.familyId (see EnvelopeAcceptanceContext.familyId doc comment).
 *
 * `recordAcceptedVersion` remains intentionally UNCONDITIONAL (same
 * contract as the in-memory version, not a max-only guard, and NOT changed
 * to a conflict-detecting/atomic-CAS write by this lane) -- see
 * DataVersionLedger.ts's own doc comment: a SIGNED_ROLLBACK acceptance
 * must be able to move this floor DOWN, and the caller
 * (FamilyEnvelopeVerifier) is trusted to only ever invoke this on full
 * acceptance, having already enforced ordinary monotonicity itself before
 * reaching this call for a POLICY_UPDATE. A genuine two-instance race
 * where both processes concurrently accept two different POLICY_UPDATE
 * versions for the same sender (each individually valid against the floor
 * it read) can still resolve to "last write wins" here -- unlike
 * MessageIdempotencyLedger's canonical-bytes column, there is no
 * "conflicting content under the same key" concept to detect for a bare
 * version-floor value, and forcing a monotonic-only CAS here would break
 * SIGNED_ROLLBACK's documented ability to move the floor down. This is a
 * pre-existing, deliberate design tradeoff this lane did not alter --
 * genuinely out of scope for the MESSAGE_ID_CONFLICT race this lane's
 * brief specifically targets (see MySqlMessageIdempotencyLedger).
 */
export class MySqlDataVersionLedger implements DataVersionLedger {
  async getLastAcceptedVersion(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): Promise<string | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<VersionRow>(
        conn,
        `SELECT last_accepted_version FROM envelope_data_version_ledger WHERE family_id = ? AND sender_key_id = ?`,
        [familyId, senderKeyId],
      ),
    );
    return rows[0]?.last_accepted_version ?? null;
  }

  async recordAcceptedVersion(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, semanticVersion: string): Promise<void> {
    const now = new Date();
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO envelope_data_version_ledger (family_id, sender_key_id, last_accepted_version, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE last_accepted_version = VALUES(last_accepted_version), updated_at = VALUES(updated_at)`,
        [familyId, senderKeyId, semanticVersion, now],
      ),
    );
  }
}
