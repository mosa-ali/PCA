import { execute, runInTransaction } from '../db/pool.js';
import type { SenderKeyId } from './types.js';
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
 * `recordAcceptedVersion` is intentionally UNCONDITIONAL here too (same
 * contract as the in-memory version, not a max-only guard) -- see
 * DataVersionLedger.ts's own doc comment: a SIGNED_ROLLBACK acceptance
 * must be able to move this floor DOWN, and the caller
 * (FamilyEnvelopeVerifier) is trusted to only ever invoke this on full
 * acceptance, having already enforced ordinary monotonicity itself before
 * reaching this call for a POLICY_UPDATE.
 */
export class MySqlDataVersionLedger implements DataVersionLedger {
  async getLastAcceptedVersion(senderKeyId: SenderKeyId): Promise<string | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<VersionRow>(
        conn,
        `SELECT last_accepted_version FROM envelope_data_version_ledger WHERE sender_key_id = ?`,
        [senderKeyId],
      ),
    );
    return rows[0]?.last_accepted_version ?? null;
  }

  async recordAcceptedVersion(senderKeyId: SenderKeyId, semanticVersion: string): Promise<void> {
    const now = new Date();
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO envelope_data_version_ledger (sender_key_id, last_accepted_version, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE last_accepted_version = VALUES(last_accepted_version), updated_at = VALUES(updated_at)`,
        [senderKeyId, semanticVersion, now],
      ),
    );
  }
}
