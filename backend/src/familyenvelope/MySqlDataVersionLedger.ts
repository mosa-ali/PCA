import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import { compareSemanticVersions } from './policy.js';
import type { OpaqueFamilyId, SenderKeyId } from './types.js';
import type { AdvancePolicyVersionResult, DataVersionLedger } from './DataVersionLedger.js';

interface VersionRow {
  last_accepted_version: string;
}

/**
 * Bounds `advancePolicyVersionIfNewer`'s read-compare-write retry loop --
 * see its own doc comment for why a retry is needed at all. Bounded so a
 * pathological, unending stream of concurrent higher-version writers can
 * never spin this forever; exhausting the budget fails closed as 'stale'
 * (never silently applies an unverified write).
 */
const MAX_VERSION_CAS_ATTEMPTS = 8;

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
 * PCA-17E POLICY_VERSION_MULTI_INSTANCE_TOCTOU: the old single
 * `recordAcceptedVersion` was an unconditional `ON DUPLICATE KEY UPDATE`
 * -- pure last-write-wins, with no notion of "is this actually newer than
 * what's there now." Two backend instances concurrently accepting two
 * DIFFERENT POLICY_UPDATE versions for the same sender (each individually
 * valid against the floor IT read, before either had written) could
 * resolve with the durable floor left at the LOWER of the two if that
 * writer's commit landed last -- a genuine anti-downgrade violation, not
 * merely a relative-ordering curiosity. See DataVersionLedger.ts's own doc
 * comment for the full split rationale (SIGNED_ROLLBACK_SEPARATION).
 *
 * `advancePolicyVersionIfNewer` fixes this with the SAME
 * "UPDATE ... WHERE guard; if zero rows affected, re-read to find out why"
 * idiom every other repository in this codebase already uses for
 * compare-and-swap under READ COMMITTED (see db/pool.ts's runInTransaction
 * doc comment) -- not a DB-side string/numeric comparison (semantic
 * versions are dotted triples; MySQL has no built-in dotted-version
 * comparator, and this schema deliberately stores them as plain strings,
 * see migration 0002), but an application-level read-compare-write loop
 * whose WHERE clause pins the UPDATE to the EXACT previously-read value:
 * if another instance's commit changed the row in between, the UPDATE
 * matches zero rows (not "some" rows -- MySQL's row lock ensures the
 * UPDATE's WHERE evaluation itself always sees the latest committed value,
 * blocking until any concurrent in-flight writer for this exact row
 * resolves first), and the loop re-reads the new floor and re-compares
 * before retrying. This converges correctly regardless of commit order:
 * whichever version is genuinely the highest ends up durably stored, and
 * any candidate that turns out to be stale against the LATEST floor
 * (even if it was valid against a floor this loop read moments earlier)
 * is correctly reported 'stale', never silently applied.
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

  async advancePolicyVersionIfNewer(
    familyId: OpaqueFamilyId,
    senderKeyId: SenderKeyId,
    candidateVersion: string,
  ): Promise<AdvancePolicyVersionResult> {
    for (let attempt = 0; attempt < MAX_VERSION_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.getLastAcceptedVersion(familyId, senderKeyId);
      if (current !== null && compareSemanticVersions(candidateVersion, current) <= 0) {
        return 'stale';
      }
      const now = new Date();
      if (current === null) {
        // No row yet observed -- attempt the FIRST-EVER insert for this
        // sender. If a concurrent instance wins this exact race, our
        // INSERT fails with a duplicate-key error (not silently
        // overwritten); loop back and re-read/re-compare against whatever
        // that winner just committed.
        try {
          await runInTransaction((conn) =>
            execute(
              conn,
              `INSERT INTO envelope_data_version_ledger (family_id, sender_key_id, last_accepted_version, updated_at) VALUES (?, ?, ?, ?)`,
              [familyId, senderKeyId, candidateVersion, now],
            ),
          );
          return 'advanced';
        } catch (error) {
          if (!isDuplicateEntry(error)) throw error;
          continue;
        }
      }
      // Optimistic CAS: only take effect if the row's value is still
      // EXACTLY what we just read as `current` -- if a concurrent writer's
      // commit already moved it, this UPDATE affects zero rows and we loop
      // back to re-read/re-compare against the new floor.
      const { rowCount } = await runInTransaction((conn) =>
        execute(
          conn,
          `UPDATE envelope_data_version_ledger
           SET last_accepted_version = ?, updated_at = ?
           WHERE family_id = ? AND sender_key_id = ? AND last_accepted_version = ?`,
          [candidateVersion, now, familyId, senderKeyId, current],
        ),
      );
      if (rowCount > 0) return 'advanced';
    }
    // Exhausted retries under a pathological write-contention race -- fail
    // closed as stale rather than silently applying an unverified write.
    return 'stale';
  }

  /**
   * Reserved for the SIGNED_ROLLBACK acceptance path ONLY -- see
   * DataVersionLedger.ts's own doc comment for why this remains
   * unconditional (doc 22 Section 6: a rollback moves the floor down to
   * its named target regardless of the current value).
   */
  async recordAuthorizedRollbackVersion(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId, rollbackVersion: string): Promise<void> {
    const now = new Date();
    await runInTransaction((conn) =>
      execute(
        conn,
        `INSERT INTO envelope_data_version_ledger (family_id, sender_key_id, last_accepted_version, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE last_accepted_version = VALUES(last_accepted_version), updated_at = VALUES(updated_at)`,
        [familyId, senderKeyId, rollbackVersion, now],
      ),
    );
  }
}
