import type { MessageId, OpaqueDeviceId, RelayEnvelopeRecord } from './types.js';
import type { RelayQueuePage, RelayQueuePageInput, RelayQueuedRecord } from './queuePage.js';

export type CreateEnvelopeResult =
  | { outcome: 'CREATED'; record: RelayEnvelopeRecord }
  | { outcome: 'IDEMPOTENT_MATCH'; record: RelayEnvelopeRecord }
  | { outcome: 'CONFLICT' };

export type AcknowledgeResult =
  | { outcome: 'ACKNOWLEDGED'; record: RelayEnvelopeRecord }
  | { outcome: 'EXPIRED' }
  | { outcome: 'NOT_FOUND' };

/**
 * Persistence port for the opaque relay. A deterministic in-memory
 * implementation exists for tests; MySqlRelayRepository is the production
 * implementation.
 *
 * messageId is the idempotency authority: createOrMatchEnvelope must detect
 * a duplicate submission of the identical envelope and return it unchanged
 * (IDEMPOTENT_MATCH) rather than creating a second queued copy, while a
 * conflicting reuse of the same messageId with different content must be
 * rejected (CONFLICT), never silently overwritten.
 *
 * Retrieval and acknowledgement are scoped by recipientDeviceId. An
 * envelope addressed to a different recipient must be indistinguishable
 * from a nonexistent envelope (NOT_FOUND in both cases) -- a device must
 * never be able to read another recipient's envelope by guessing messageId.
 */
export interface RelayRepository {
  createOrMatchEnvelope(record: RelayEnvelopeRecord): Promise<CreateEnvelopeResult>;
  findForRecipient(recipientDeviceId: OpaqueDeviceId, messageId: MessageId): Promise<RelayEnvelopeRecord | null>;
  listQueuedForRecipient(recipientDeviceId: OpaqueDeviceId, now: Date): Promise<RelayEnvelopeRecord[]>;
  /** Stable, bounded transport traversal; family and recipient are authenticated caller inputs. */
  listQueuedPageForRecipient(recipientDeviceId: OpaqueDeviceId, familyId: string, now: Date, input: RelayQueuePageInput): Promise<RelayQueuePage>;
  /** Bounded exact correlation predecessor lookup. It must not move the base page position. */
  findQueuedForRecipient(recipientDeviceId: OpaqueDeviceId, familyId: string, messageIds: readonly MessageId[], now: Date): Promise<RelayQueuedRecord[]>;
  /** Best-effort operational cleanup; expired ciphertext must not accumulate in relay storage. */
  purgeExpired?(now: Date): Promise<number>;
  acknowledgeAtomically(
    recipientDeviceId: OpaqueDeviceId,
    messageId: MessageId,
    acknowledgedAt: Date,
  ): Promise<AcknowledgeResult>;
}
