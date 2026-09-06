import type { EncryptedPayload } from './emailOutboxEncryption.js';

export type EmailOutboxStatus = 'PENDING' | 'SENT' | 'DEAD_LETTER';

export interface InsertEmailOutboxInput {
  readonly outboxId: string;
  readonly idempotencyKey: string;
  readonly encryptedPayload: EncryptedPayload;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/** A row claimed for processing -- the ciphertext is still present (not yet purged), since the processor needs to decrypt and attempt delivery. */
export interface ClaimedEmailOutboxRow {
  readonly outboxId: string;
  readonly encryptedPayload: EncryptedPayload;
  readonly attemptCount: number;
  readonly expiresAt: Date;
}

export type InsertEmailOutboxOutcome = 'INSERTED' | 'DUPLICATE_IDEMPOTENCY_KEY';

export interface EmailOutboxRepository {
  /** Inserts a new PENDING row, due immediately. Returns DUPLICATE_IDEMPOTENCY_KEY (never throws) if idempotencyKey already exists -- the caller already enqueued this logical send once. */
  insert(input: InsertEmailOutboxInput): Promise<InsertEmailOutboxOutcome>;

  /**
   * Atomically claims up to `limit` PENDING rows that are due
   * (next_attempt_at <= now) and not yet expired, reserving each with a
   * short claim lease (pushing next_attempt_at forward by `leaseMs`) so a
   * concurrent worker cannot claim the same row -- see
   * MySqlEmailOutboxRepository's own doc comment for the exact locking
   * shape. A row whose lease expires without a matching markSent/
   * recordFailureAndReschedule/markDeadLetter call becomes claimable again.
   */
  claimDueRows(now: Date, limit: number, leaseMs: number): Promise<ClaimedEmailOutboxRow[]>;

  /** Marks a row SENT and purges its ciphertext (see migration 0038's header on why: bounding how long the necessary at-rest exposure window exists). */
  markSent(outboxId: string, providerMessageId: string, sentAt: Date): Promise<void>;

  /** Reschedules a row for another attempt at `nextAttemptAt`, recording the failure and the new attempt count. Ciphertext is retained -- there will be another send attempt. */
  recordFailureAndReschedule(outboxId: string, error: string, nextAttemptAt: Date, attemptCount: number): Promise<void>;

  /** Marks a row DEAD_LETTER (attempts exhausted, or the row expired) and purges its ciphertext -- no further attempt will ever be made. */
  markDeadLetter(outboxId: string, error: string, attemptCount: number): Promise<void>;
}
