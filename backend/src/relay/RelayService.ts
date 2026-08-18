import { isPlausibleCiphertext, isPlausibleOpaqueId, resolveRelayTtlMs, computeExpiryInstant } from './policy.js';
import type { AcknowledgeResult, CreateEnvelopeResult, RelayRepository } from './RelayRepository.js';
import { buildRelayDiagnosticEvent, type RelayDiagnosticEvent, type RelayDiagnosticOutcome } from './diagnostics.js';
import type { MessageId, OpaqueDeviceId, OpaqueFamilyId, RelayEnvelopeRecord } from './types.js';

export type RelayErrorCode = 'INVALID_INPUT' | 'CONFLICT' | 'NOT_FOUND' | 'EXPIRED';

/** Fixed, generic messages per code -- never interpolates ciphertext or identifiers. */
export class RelayError extends Error {
  readonly code: RelayErrorCode;
  constructor(code: RelayErrorCode) {
    super(RELAY_ERROR_MESSAGES[code]);
    this.name = 'RelayError';
    this.code = code;
  }
}

const RELAY_ERROR_MESSAGES: Record<RelayErrorCode, string> = {
  INVALID_INPUT: 'Relay envelope input is malformed.',
  CONFLICT: 'A different envelope is already queued under this message id.',
  // Intentionally identical wording/code for "does not exist" and "exists
  // for a different recipient" -- a recipient must not be able to learn
  // that a messageId exists by guessing.
  NOT_FOUND: 'Envelope was not found.',
  EXPIRED: 'Envelope has expired.',
};

export interface QueueEnvelopeInput {
  messageId: MessageId;
  familyId: OpaqueFamilyId;
  senderDeviceId: OpaqueDeviceId;
  recipientDeviceId: OpaqueDeviceId;
  ciphertext: Buffer;
  /** Optional; omit to use the server default. Server rejects anything above the policy maximum -- see policy.ts. */
  ttlMs?: number;
}

export class RelayService {
  private readonly repository: RelayRepository;
  private readonly now: () => Date;
  private readonly diagnosticSink: ((event: RelayDiagnosticEvent) => void) | undefined;

  constructor(
    repository: RelayRepository,
    now: () => Date = () => new Date(),
    diagnosticSink?: (event: RelayDiagnosticEvent) => void,
  ) {
    this.repository = repository;
    this.now = now;
    this.diagnosticSink = diagnosticSink;
  }

  private emitDiagnostic(record: RelayEnvelopeRecord, outcome: RelayDiagnosticOutcome): void {
    if (!this.diagnosticSink) return;
    try {
      this.diagnosticSink(buildRelayDiagnosticEvent(record, outcome));
    } catch {
      // Diagnostics are best-effort and must never alter delivery semantics.
    }
  }

  private async purgeExpired(now: Date): Promise<void> {
    if (!this.repository.purgeExpired) return;
    try {
      await this.repository.purgeExpired(now);
    } catch {
      // Expiry filtering remains enforced by the read/ack queries; cleanup is housekeeping.
    }
  }

  /**
   * The relay never inspects `ciphertext` beyond its byte length -- it is
   * stored and returned intact, never parsed, decrypted, or logged.
   */
  async queueEnvelope(input: QueueEnvelopeInput): Promise<RelayEnvelopeRecord> {
    if (
      !isPlausibleOpaqueId(input.messageId) ||
      !isPlausibleOpaqueId(input.familyId) ||
      !isPlausibleOpaqueId(input.senderDeviceId) ||
      !isPlausibleOpaqueId(input.recipientDeviceId)
    ) {
      throw new RelayError('INVALID_INPUT');
    }
    if (!isPlausibleCiphertext(input.ciphertext)) throw new RelayError('INVALID_INPUT');

    const now = this.now();
    await this.purgeExpired(now);
    const ttlMs = resolveRelayTtlMs(input.ttlMs);
    const createdAt = now;
    const record: RelayEnvelopeRecord = {
      messageId: input.messageId,
      familyId: input.familyId,
      senderDeviceId: input.senderDeviceId,
      recipientDeviceId: input.recipientDeviceId,
      ciphertext: input.ciphertext,
      state: 'QUEUED',
      createdAt,
      expiresAt: computeExpiryInstant(createdAt, ttlMs),
      acknowledgedAt: null,
    };

    const result: CreateEnvelopeResult = await this.repository.createOrMatchEnvelope(record);
    switch (result.outcome) {
      case 'CREATED':
      case 'IDEMPOTENT_MATCH':
        this.emitDiagnostic(result.record, 'QUEUED');
        return result.record;
      case 'CONFLICT':
        throw new RelayError('CONFLICT');
    }
  }

  async listQueuedForRecipient(recipientDeviceId: OpaqueDeviceId): Promise<RelayEnvelopeRecord[]> {
    if (!isPlausibleOpaqueId(recipientDeviceId)) throw new RelayError('INVALID_INPUT');
    const now = this.now();
    await this.purgeExpired(now);
    const records = await this.repository.listQueuedForRecipient(recipientDeviceId, now);
    records.forEach((record) => this.emitDiagnostic(record, 'LISTED'));
    return records;
  }

  async fetchEnvelope(recipientDeviceId: OpaqueDeviceId, messageId: MessageId): Promise<RelayEnvelopeRecord> {
    if (!isPlausibleOpaqueId(recipientDeviceId) || !isPlausibleOpaqueId(messageId)) {
      throw new RelayError('INVALID_INPUT');
    }
    const record = await this.repository.findForRecipient(recipientDeviceId, messageId);
    if (!record) throw new RelayError('NOT_FOUND');
    const now = this.now();
    const expired = record.state === 'EXPIRED' || (record.state === 'QUEUED' && now.getTime() >= record.expiresAt.getTime());
    await this.purgeExpired(now);
    if (expired) {
      this.emitDiagnostic(record, 'EXPIRED');
      throw new RelayError('EXPIRED');
    }
    this.emitDiagnostic(record, 'DELIVERED');
    return record;
  }

  /** Acknowledgement is idempotent, but an already-expired envelope can never become ACKNOWLEDGED by a late ack. */
  async acknowledgeEnvelope(recipientDeviceId: OpaqueDeviceId, messageId: MessageId): Promise<RelayEnvelopeRecord> {
    if (!isPlausibleOpaqueId(recipientDeviceId) || !isPlausibleOpaqueId(messageId)) {
      throw new RelayError('INVALID_INPUT');
    }
    const now = this.now();
    const result: AcknowledgeResult = await this.repository.acknowledgeAtomically(
      recipientDeviceId,
      messageId,
      now,
    );
    await this.purgeExpired(now);
    switch (result.outcome) {
      case 'ACKNOWLEDGED':
        this.emitDiagnostic(result.record, 'ACKNOWLEDGED');
        return result.record;
      case 'EXPIRED':
        throw new RelayError('EXPIRED');
      case 'NOT_FOUND':
        throw new RelayError('NOT_FOUND');
    }
  }
}
