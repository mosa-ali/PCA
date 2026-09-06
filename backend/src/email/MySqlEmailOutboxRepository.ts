import { execute, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type {
  ClaimedEmailOutboxRow,
  EmailOutboxRepository,
  InsertEmailOutboxInput,
  InsertEmailOutboxOutcome,
} from './EmailOutboxRepository.js';

interface ClaimRow {
  outbox_id: string;
  encrypted_iv: string;
  encrypted_auth_tag: string;
  encrypted_payload: string | null;
  attempt_count: number;
  expires_at: Date;
}

/**
 * PCA-DW-W2-15F -- durable, MySQL-backed email outbox (migrations/
 * 0038_email_outbox.sql). See that migration's own header for why this
 * stores an AES-256-GCM ciphertext rather than a raw email/code column.
 *
 * CLAIM LOCKING: `claimDueRows` runs `SELECT ... FOR UPDATE SKIP LOCKED`
 * inside a transaction, then immediately pushes each claimed row's
 * next_attempt_at forward by `leaseMs` and commits -- reserving the row
 * (a concurrent worker's own SKIP LOCKED select simply skips it) without
 * holding the transaction open across the actual network send, which must
 * never happen inside a DB transaction. If this process crashes between
 * claiming and recording an outcome, the row becomes claimable again once
 * its lease (not a real backoff decision, just a reservation) elapses --
 * self-healing, at the cost of a possible extra attempt, never a lost one.
 */
export class MySqlEmailOutboxRepository implements EmailOutboxRepository {
  async insert(input: InsertEmailOutboxInput): Promise<InsertEmailOutboxOutcome> {
    try {
      await runInTransaction((conn) =>
        execute(
          conn,
          `INSERT INTO email_outbox
             (outbox_id, idempotency_key, encrypted_iv, encrypted_auth_tag, encrypted_payload, status, attempt_count, next_attempt_at, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, ?)`,
          [
            input.outboxId,
            input.idempotencyKey,
            input.encryptedPayload.ivBase64,
            input.encryptedPayload.authTagBase64,
            input.encryptedPayload.ciphertextBase64,
            input.createdAt,
            input.createdAt,
            input.expiresAt,
          ],
        ),
      );
      return 'INSERTED';
    } catch (error) {
      if (isDuplicateEntry(error)) return 'DUPLICATE_IDEMPOTENCY_KEY';
      throw error;
    }
  }

  async claimDueRows(now: Date, limit: number, leaseMs: number): Promise<ClaimedEmailOutboxRow[]> {
    const safeLimit = Math.max(0, Math.min(1000, Math.trunc(limit)));
    if (safeLimit === 0) return [];
    return runInTransaction(async (conn) => {
      const { rows } = await execute<ClaimRow>(
        conn,
        `SELECT outbox_id, encrypted_iv, encrypted_auth_tag, encrypted_payload, attempt_count, expires_at
         FROM email_outbox
         WHERE status = 'PENDING' AND next_attempt_at <= ? AND expires_at > ? AND encrypted_payload IS NOT NULL
         ORDER BY next_attempt_at
         LIMIT ${safeLimit}
         FOR UPDATE SKIP LOCKED`,
        [now, now],
      );
      const leaseUntil = new Date(now.getTime() + leaseMs);
      const claimed: ClaimedEmailOutboxRow[] = [];
      for (const row of rows) {
        await execute(conn, `UPDATE email_outbox SET next_attempt_at = ? WHERE outbox_id = ?`, [leaseUntil, row.outbox_id]);
        claimed.push({
          outboxId: row.outbox_id,
          encryptedPayload: {
            ivBase64: row.encrypted_iv,
            authTagBase64: row.encrypted_auth_tag,
            ciphertextBase64: row.encrypted_payload as string,
          },
          attemptCount: row.attempt_count,
          expiresAt: row.expires_at,
        });
      }
      return claimed;
    });
  }

  async markSent(outboxId: string, providerMessageId: string, sentAt: Date): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `UPDATE email_outbox SET status = 'SENT', provider_message_id = ?, completed_at = ?, encrypted_payload = NULL, encrypted_iv = '', encrypted_auth_tag = '' WHERE outbox_id = ?`,
        [providerMessageId, sentAt, outboxId],
      ),
    );
  }

  async recordFailureAndReschedule(outboxId: string, error: string, nextAttemptAt: Date, attemptCount: number): Promise<void> {
    await runInTransaction((conn) =>
      execute(conn, `UPDATE email_outbox SET last_error = ?, attempt_count = ?, next_attempt_at = ? WHERE outbox_id = ?`, [
        error.slice(0, 512),
        attemptCount,
        nextAttemptAt,
        outboxId,
      ]),
    );
  }

  async markDeadLetter(outboxId: string, error: string, attemptCount: number): Promise<void> {
    await runInTransaction((conn) =>
      execute(
        conn,
        `UPDATE email_outbox SET status = 'DEAD_LETTER', last_error = ?, attempt_count = ?, completed_at = ?, encrypted_payload = NULL, encrypted_iv = '', encrypted_auth_tag = '' WHERE outbox_id = ?`,
        [error.slice(0, 512), attemptCount, new Date(), outboxId],
      ),
    );
  }
}
