import { isPlausibleCiphertext, isPlausibleOpaqueId, resolveRelayTtlMs, computeExpiryInstant } from './policy.js';
import type { AcknowledgeResult, CreateEnvelopeResult, RelayRepository } from './RelayRepository.js';
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

  constructor(repository: RelayRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
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

    const ttlMs = resolveRelayTtlMs(input.ttlMs);
    const createdAt = this.now();
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
        return result.record;
      case 'CONFLICT':
        throw new RelayError('CONFLICT');
    }
  }

  async listQueuedForRecipient(recipientDeviceId: OpaqueDeviceId): Promise<RelayEnvelopeRecord[]> {
    if (!isPlausibleOpaqueId(recipientDeviceId)) throw new RelayError('INVALID_INPUT');
    return this.repository.listQueuedForRecipient(recipientDeviceId, this.now());
  }

  async fetchEnvelope(recipientDeviceId: OpaqueDeviceId, messageId: MessageId): Promise<RelayEnvelopeRecord> {
    if (!isPlausibleOpaqueId(recipientDeviceId) || !isPlausibleOpaqueId(messageId)) {
      throw new RelayError('INVALID_INPUT');
    }
    const record = await this.repository.findForRecipient(recipientDeviceId, messageId);
    if (!record) throw new RelayError('NOT_FOUND');
    if (record.state === 'QUEUED' && this.now().getTime() >= record.expiresAt.getTime()) {
      throw new RelayError('EXPIRED');
    }
    return record;
  }

  /** Acknowledgement is idempotent, but an already-expired envelope can never become ACKNOWLEDGED by a late ack. */
  async acknowledgeEnvelope(recipientDeviceId: OpaqueDeviceId, messageId: MessageId): Promise<RelayEnvelopeRecord> {
    if (!isPlausibleOpaqueId(recipientDeviceId) || !isPlausibleOpaqueId(messageId)) {
      throw new RelayError('INVALID_INPUT');
    }
    const result: AcknowledgeResult = await this.repository.acknowledgeAtomically(
      recipientDeviceId,
      messageId,
      this.now(),
    );
    switch (result.outcome) {
      case 'ACKNOWLEDGED':
        return result.record;
      case 'EXPIRED':
        throw new RelayError('EXPIRED');
      case 'NOT_FOUND':
        throw new RelayError('NOT_FOUND');
    }
  }
}
