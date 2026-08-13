import { execute, isDeadlock, isDuplicateEntry, runInTransaction, SoftFailure } from '../db/pool.js';
import type { PoolConnection } from 'mysql2/promise';
import { compareSemanticVersions } from './policy.js';
import { MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY, REPLAY_LEDGER_CAPACITY_PER_SENDER } from './policy.js';
import type {
  EnvelopeAcceptanceCommitInput,
  EnvelopeAcceptanceCommitResult,
  EnvelopeAcceptanceTransaction,
} from './EnvelopeAcceptanceTransaction.js';
import type { OpaqueFamilyId, SenderKeyId } from './types.js';

type AcceptanceSoftCode = 'MESSAGE_ID_CONFLICT' | 'REPLAYED' | 'VERSION_NOT_MONOTONIC';

/** Bounds the read-back retry when a concurrent eviction races our own duplicate-key readback (see MySqlMessageIdempotencyLedger's identical TOCTOU note) -- never a normal-path loop. */
const MAX_IDEMPOTENCY_READBACK_ATTEMPTS = 3;

/** Bounds retrying the WHOLE transaction after an InnoDB-detected deadlock (see db/pool.ts's isDeadlock doc comment) -- InnoDB has already rolled the aborted attempt back by the time this fires, so a fresh attempt starts from clean state every time. */
const MAX_DEADLOCK_RETRY_ATTEMPTS = 3;

interface IdempotencyRow {
  canonical_bytes: Buffer;
}

interface VersionRow {
  last_accepted_version: string;
}

/**
 * The PCA-17F production acceptance authority: every ledger-mutating step
 * of a single envelope's acceptance decision runs inside ONE MySQL
 * transaction, so MessageIdempotencyLedger's "a row means fully accepted"
 * contract is actually true for every OTHER transaction reading it -- see
 * EnvelopeAcceptanceTransaction.ts's doc comment for the full defect this
 * closes and why ROLLBACK, not a compensating DELETE, is the mechanism.
 *
 * LOCK ORDER (fixed, deterministic, never varies by call): message-id row
 * -> replay row -> version row. Every call takes locks in this exact
 * order, so two concurrent transactions can only ever contend on ONE
 * shared row at a time (whichever the two calls' inputs actually overlap
 * on) and block-then-proceed, never form a wait cycle purely from this
 * function's own lock acquisition pattern. A genuine InnoDB deadlock can
 * still occur (e.g. interaction with the eviction housekeeping issued by a
 * different connection, or MySQL's own next-key gap-locking on the unique
 * indexes) -- MAX_DEADLOCK_RETRY_ATTEMPTS bounds a safe, fresh retry of the
 * entire transaction in that case; exhausting the budget fails closed
 * (rethrows), never silently returns an unverified accept.
 */
export class MySqlEnvelopeAcceptanceTransaction implements EnvelopeAcceptanceTransaction {
  constructor(
    private readonly messageIdempotencyCapacity: number = MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY,
    private readonly replayCapacityPerSender: number = REPLAY_LEDGER_CAPACITY_PER_SENDER,
  ) {}

  async commitAcceptance(input: EnvelopeAcceptanceCommitInput): Promise<EnvelopeAcceptanceCommitResult> {
    for (let attempt = 0; attempt < MAX_DEADLOCK_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const idempotent = await runInTransaction((conn) => this.runAcceptance(conn, input));
        if (!idempotent) {
          // Best-effort resource-abuse housekeeping ONLY, never on the
          // critical/correctness path -- runs AFTER this call's own
          // transaction has already committed, so it can never change the
          // acceptance decision already returned to the caller (PCA-17F
          // section 18: capacity trimming must not run inside, or block,
          // the acceptance transaction itself).
          this.trimAfterCommit(input.familyId, input.senderKeyId).catch(() => {});
        }
        return { outcome: 'accepted', idempotent };
      } catch (error) {
        if (error instanceof SoftFailure) {
          return { outcome: 'rejected', reason: error.outcome as AcceptanceSoftCode };
        }
        if (isDeadlock(error) && attempt < MAX_DEADLOCK_RETRY_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    // Unreachable (the loop above always returns or throws), but keeps
    // TypeScript's control-flow analysis happy without an unsafe assertion.
    throw new Error('MySqlEnvelopeAcceptanceTransaction: exhausted deadlock retry budget unexpectedly');
  }

  /** Returns `true` iff this envelope short-circuited as already-idempotent (a concurrent winner's identical content, fully committed before this call's own transaction observed it) -- `false` means THIS call newly recorded acceptance. Throws SoftFailure<AcceptanceSoftCode> for every rejection path; runInTransaction's own catch/rollback (in pool.ts) rolls back every write this attempt made before that SoftFailure propagates, so a rejected candidate never leaves ANY of the three ledgers mutated. */
  private async runAcceptance(conn: PoolConnection, input: EnvelopeAcceptanceCommitInput): Promise<boolean> {
    const now = new Date();

    // Step 1: message-id idempotency arbitration. A plain INSERT (no ON
    // DUPLICATE KEY UPDATE) against the (family_id, message_id) unique
    // index -- see MySqlMessageIdempotencyLedger's identical mechanism.
    // Unlike that class, this INSERT's lock is held for the rest of THIS
    // transaction (not released at an inner commit), so no other
    // transaction can observe this row -- committed or otherwise -- until
    // this whole acceptance decision resolves.
    if (this.messageIdempotencyCapacity > 0) {
      const bytes = Buffer.from(input.canonicalBytes, 'utf8');
      let recorded = false;
      for (let readback = 0; readback < MAX_IDEMPOTENCY_READBACK_ATTEMPTS && !recorded; readback += 1) {
        try {
          await execute(
            conn,
            `INSERT INTO envelope_message_idempotency_ledger (family_id, message_id, canonical_bytes, recorded_at) VALUES (?, ?, ?, ?)`,
            [input.familyId, input.messageId, bytes, now],
          );
          recorded = true;
        } catch (error) {
          if (!isDuplicateEntry(error)) throw error;
          // Another transaction's INSERT for this exact key already
          // committed (this SELECT, under READ COMMITTED, reliably
          // observes it -- see db/pool.ts's runInTransaction doc comment).
          // A transaction that is STILL IN FLIGHT can never be the cause
          // of this branch: its conflicting INSERT would still be holding
          // an uncommitted row lock, which would block OUR INSERT above
          // rather than let it fail with ER_DUP_ENTRY -- exactly the
          // property that makes the premature-visibility race impossible
          // under this design.
          const { rows } = await execute<IdempotencyRow>(
            conn,
            `SELECT canonical_bytes FROM envelope_message_idempotency_ledger WHERE family_id = ? AND message_id = ?`,
            [input.familyId, input.messageId],
          );
          const existing = rows[0];
          if (!existing) continue; // TOCTOU against a concurrent eviction -- retry the insert, bounded.
          const existingBytes = existing.canonical_bytes.toString('utf8');
          if (existingBytes !== input.canonicalBytes) {
            throw new SoftFailure<AcceptanceSoftCode>('MESSAGE_ID_CONFLICT');
          }
          // Identical content, already fully committed by a prior winner:
          // this call must not claim replay/version on that winner's
          // behalf (PCA-17E acceptance-ordering rule, preserved here).
          return true;
        }
      }
      if (!recorded) throw new SoftFailure<AcceptanceSoftCode>('MESSAGE_ID_CONFLICT');
    }

    // Step 2: replay claim. Plain INSERT against the (family_id,
    // sender_key_id, sequence_or_nonce) unique index -- see
    // MySqlReplayLedger.claimProcessed's identical mechanism. A collision
    // here means a DIFFERENT, already-committed envelope won this
    // (sender, nonce) slot; this SoftFailure rolls back step 1's INSERT
    // together with everything else in this transaction.
    if (this.replayCapacityPerSender > 0) {
      try {
        await execute(
          conn,
          `INSERT INTO envelope_replay_ledger (family_id, sender_key_id, sequence_or_nonce, recorded_at) VALUES (?, ?, ?, ?)`,
          [input.familyId, input.senderKeyId, input.sequenceOrNonce, now],
        );
      } catch (error) {
        if (!isDuplicateEntry(error)) throw error;
        throw new SoftFailure<AcceptanceSoftCode>('REPLAYED');
      }
    }

    // Step 3: semantic-version arbitration, only for the two message types
    // that touch this ledger at all (see DataVersionLedger.ts).
    if (input.messageType === 'POLICY_UPDATE') {
      await this.advancePolicyVersionOrThrow(conn, input.familyId, input.senderKeyId, input.semanticVersion, now);
    } else if (input.messageType === 'SIGNED_ROLLBACK') {
      // Unconditional, same as MySqlDataVersionLedger.recordAuthorizedRollbackVersion
      // -- reserved for this path only, doc 22 Section 6.
      await execute(
        conn,
        `INSERT INTO envelope_data_version_ledger (family_id, sender_key_id, last_accepted_version, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE last_accepted_version = VALUES(last_accepted_version), updated_at = VALUES(updated_at)`,
        [input.familyId, input.senderKeyId, input.semanticVersion, now],
      );
    }

    return false;
  }

  /**
   * `SELECT ... FOR UPDATE` (not the old MySqlDataVersionLedger's
   * optimistic read-compare-write retry loop) -- inside a single
   * transaction that already holds other row locks for its whole
   * duration, pessimistic locking is simpler and correct: this acquires
   * the (family_id, sender_key_id) row's exclusive lock (or a gap lock, if
   * no row exists yet) for the rest of this transaction, so no concurrent
   * acceptance transaction for the SAME sender can even READ the current
   * floor until this one commits or rolls back -- there is no window for
   * two transactions to both read a stale floor and both believe they are
   * newer, so no CAS retry is needed here the way the old per-call design
   * required one.
   */
  private async advancePolicyVersionOrThrow(
    conn: PoolConnection,
    familyId: OpaqueFamilyId,
    senderKeyId: SenderKeyId,
    candidateVersion: string,
    now: Date,
  ): Promise<void> {
    const { rows } = await execute<VersionRow>(
      conn,
      `SELECT last_accepted_version FROM envelope_data_version_ledger WHERE family_id = ? AND sender_key_id = ? FOR UPDATE`,
      [familyId, senderKeyId],
    );
    const current = rows[0]?.last_accepted_version ?? null;
    if (current !== null && compareSemanticVersions(candidateVersion, current) <= 0) {
      throw new SoftFailure<AcceptanceSoftCode>('VERSION_NOT_MONOTONIC');
    }
    if (current === null) {
      await execute(
        conn,
        `INSERT INTO envelope_data_version_ledger (family_id, sender_key_id, last_accepted_version, updated_at) VALUES (?, ?, ?, ?)`,
        [familyId, senderKeyId, candidateVersion, now],
      );
      return;
    }
    await execute(
      conn,
      `UPDATE envelope_data_version_ledger SET last_accepted_version = ?, updated_at = ? WHERE family_id = ? AND sender_key_id = ?`,
      [candidateVersion, now, familyId, senderKeyId],
    );
  }

  /**
   * Bounded GLOBAL/per-sender eviction, run in its OWN transaction(s) after
   * this call's acceptance transaction has already committed -- see
   * MySqlMessageIdempotencyLedger.trimIfOverCapacity and
   * MySqlReplayLedger.trimIfOverCapacity's identical reasoning (a cheap
   * COUNT first, deadlocks/lock-wait-timeouts swallowed, never on the
   * correctness path). Running this INSIDE the acceptance transaction
   * would hold its already-multi-row lock set for longer and needlessly
   * raise deadlock risk against unrelated concurrent acceptances (PCA-17F
   * section 18) for a purely best-effort resource bound that cannot change
   * a decision already committed and returned.
   */
  private async trimAfterCommit(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): Promise<void> {
    await Promise.allSettled([
      this.trimMessageIdempotency(),
      this.trimReplay(familyId, senderKeyId),
    ]);
  }

  private async trimMessageIdempotency(): Promise<void> {
    try {
      const { rows: countRows } = await runInTransaction((conn) =>
        execute<{ n: number }>(conn, `SELECT COUNT(*) AS n FROM envelope_message_idempotency_ledger`),
      );
      const total = countRows[0]?.n ?? 0;
      if (total <= this.messageIdempotencyCapacity) return;
      await runInTransaction((conn) =>
        execute(
          conn,
          `DELETE FROM envelope_message_idempotency_ledger
           WHERE id NOT IN (
             SELECT id FROM (
               SELECT id FROM envelope_message_idempotency_ledger
               ORDER BY id DESC
               LIMIT ?
             ) keep
           )`,
          [this.messageIdempotencyCapacity],
        ),
      );
    } catch {
      // Best-effort eviction -- see this class's doc comment.
    }
  }

  private async trimReplay(familyId: OpaqueFamilyId, senderKeyId: SenderKeyId): Promise<void> {
    try {
      const { rows: countRows } = await runInTransaction((conn) =>
        execute<{ n: number }>(
          conn,
          `SELECT COUNT(*) AS n FROM envelope_replay_ledger WHERE family_id = ? AND sender_key_id = ?`,
          [familyId, senderKeyId],
        ),
      );
      const total = countRows[0]?.n ?? 0;
      if (total <= this.replayCapacityPerSender) return;
      await runInTransaction((conn) =>
        execute(
          conn,
          `DELETE FROM envelope_replay_ledger
           WHERE family_id = ? AND sender_key_id = ?
             AND id NOT IN (
               SELECT id FROM (
                 SELECT id FROM envelope_replay_ledger
                 WHERE family_id = ? AND sender_key_id = ?
                 ORDER BY id DESC
                 LIMIT ?
               ) keep
             )`,
          [familyId, senderKeyId, familyId, senderKeyId, this.replayCapacityPerSender],
        ),
      );
    } catch {
      // Best-effort eviction -- see this class's doc comment.
    }
  }
}
