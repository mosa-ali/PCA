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

/** Session authority resolved immediately before a device acknowledgement. */
export interface RelayRecipientAuthoritySnapshot {
  readonly familyId: string;
  readonly dskKeyId: string;
  readonly trustSetEpoch: number;
  readonly keyEpoch: number;
}

/** Both accepted Trust Set members whose authority allows an outbound enqueue. */
export interface RelayEnvelopeAuthoritySnapshot {
  readonly familyId: string;
  readonly trustSetEpoch: number;
  readonly keyEpoch: number;
  readonly sender: { readonly deviceId: string; readonly dskKeyId: string };
  readonly recipient: { readonly deviceId: string; readonly dskKeyId: string };
  /** Present only when a Parent account, in addition to its device, authored the enqueue. */
  readonly parentAccountId?: string;
}

/** The accepted head or exact session DSK changed before the ACK could persist. */
export class RelayAuthorityChangedError extends Error {
  constructor() {
    super('Relay authority changed before persistence.');
    this.name = 'RelayAuthorityChangedError';
  }
}

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
  createOrMatchEnvelope(record: RelayEnvelopeRecord, authority?: RelayEnvelopeAuthoritySnapshot): Promise<CreateEnvelopeResult>;
  findForRecipient(recipientDeviceId: OpaqueDeviceId, messageId: MessageId): Promise<RelayEnvelopeRecord | null>;
  listQueuedForRecipient(recipientDeviceId: OpaqueDeviceId, now: Date): Promise<RelayEnvelopeRecord[]>;
  /** Stable, bounded transport traversal; family and recipient are authenticated caller inputs. */
  listQueuedPageForRecipient(recipientDeviceId: OpaqueDeviceId, familyId: string, now: Date, input: RelayQueuePageInput, authority?: RelayRecipientAuthoritySnapshot): Promise<RelayQueuePage>;
  /** Bounded exact correlation predecessor lookup. It must not move the base page position. */
  findQueuedForRecipient(recipientDeviceId: OpaqueDeviceId, familyId: string, messageIds: readonly MessageId[], now: Date, authority?: RelayRecipientAuthoritySnapshot): Promise<RelayQueuedRecord[]>;
  /** Best-effort operational cleanup; expired ciphertext must not accumulate in relay storage. */
  purgeExpired?(now: Date): Promise<number>;
  acknowledgeAtomically(
    recipientDeviceId: OpaqueDeviceId,
    messageId: MessageId,
    acknowledgedAt: Date,
    authority?: RelayRecipientAuthoritySnapshot,
  ): Promise<AcknowledgeResult>;
}
