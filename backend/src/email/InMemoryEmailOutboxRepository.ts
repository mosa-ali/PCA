import type {
  ClaimedEmailOutboxRow,
  EmailOutboxRepository,
  EmailOutboxStatus,
  InsertEmailOutboxInput,
  InsertEmailOutboxOutcome,
} from './EmailOutboxRepository.js';
import type { EncryptedPayload } from './emailOutboxEncryption.js';

interface StoredRow {
  outboxId: string;
  idempotencyKey: string;
  encryptedPayload: EncryptedPayload | null;
  status: EmailOutboxStatus;
  attemptCount: number;
  nextAttemptAt: Date;
  expiresAt: Date;
  lastError: string | null;
  providerMessageId: string | null;
}

/** Test/dev-only in-memory EmailOutboxRepository -- state does not survive a process restart, which is exactly the durability property the real MySqlEmailOutboxRepository exists to provide. Used by unit tests and by any caller that has not wired a real repository. */
export class InMemoryEmailOutboxRepository implements EmailOutboxRepository {
  private readonly rows = new Map<string, StoredRow>();
  private readonly idempotencyKeys = new Set<string>();

  async insert(input: InsertEmailOutboxInput): Promise<InsertEmailOutboxOutcome> {
    if (this.idempotencyKeys.has(input.idempotencyKey)) return 'DUPLICATE_IDEMPOTENCY_KEY';
    this.idempotencyKeys.add(input.idempotencyKey);
    this.rows.set(input.outboxId, {
      outboxId: input.outboxId,
      idempotencyKey: input.idempotencyKey,
      encryptedPayload: input.encryptedPayload,
      status: 'PENDING',
      attemptCount: 0,
      nextAttemptAt: input.initialClaimableAt,
      expiresAt: input.expiresAt,
      lastError: null,
      providerMessageId: null,
    });
    return 'INSERTED';
  }

  async claimDueRows(now: Date, limit: number, leaseMs: number): Promise<ClaimedEmailOutboxRow[]> {
    const claimed: ClaimedEmailOutboxRow[] = [];
    for (const row of this.rows.values()) {
      if (claimed.length >= limit) break;
      if (row.status !== 'PENDING') continue;
      if (row.nextAttemptAt.getTime() > now.getTime()) continue;
      if (row.expiresAt.getTime() <= now.getTime()) continue;
      if (row.encryptedPayload === null) continue;
      row.nextAttemptAt = new Date(now.getTime() + leaseMs);
      claimed.push({ outboxId: row.outboxId, encryptedPayload: row.encryptedPayload, attemptCount: row.attemptCount, expiresAt: row.expiresAt });
    }
    return claimed;
  }

  async markSent(outboxId: string, providerMessageId: string, _sentAt: Date): Promise<void> {
    const row = this.rows.get(outboxId);
    if (!row) return;
    row.status = 'SENT';
    row.providerMessageId = providerMessageId;
    row.encryptedPayload = null;
  }

  async recordFailureAndReschedule(outboxId: string, error: string, nextAttemptAt: Date, attemptCount: number): Promise<void> {
    const row = this.rows.get(outboxId);
    if (!row) return;
    row.lastError = error;
    row.attemptCount = attemptCount;
    row.nextAttemptAt = nextAttemptAt;
  }

  async markDeadLetter(outboxId: string, error: string, attemptCount: number): Promise<void> {
    const row = this.rows.get(outboxId);
    if (!row) return;
    row.status = 'DEAD_LETTER';
    row.lastError = error;
    row.attemptCount = attemptCount;
    row.encryptedPayload = null;
  }

  /** Test-only accessor -- reads back a row's current state for assertions. */
  getRowForTest(outboxId: string): Readonly<StoredRow> | undefined {
    return this.rows.get(outboxId);
  }

  /** Test-only accessor -- every row currently stored, for assertions that don't know an outboxId up front (e.g. "the caller enqueued something, and whatever it is must never contain plaintext PII"). */
  getAllRowsForTest(): ReadonlyArray<Readonly<StoredRow>> {
    return [...this.rows.values()];
  }
}
