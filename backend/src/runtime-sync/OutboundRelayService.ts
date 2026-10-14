import { RelayError, RelayService } from '../relay/RelayService.js';
import type { DeviceRepository } from '../device/DeviceRepository.js';
import { MAX_OUTBOUND_BATCH_SIZE } from './policy.js';
import { sortByPriority } from './priority.js';
import { RelayAuthorityChangedError, type RelayEnvelopeAuthoritySnapshot, type RelayRecipientAuthoritySnapshot } from '../relay/RelayRepository.js';
import { isPlausibleOpaqueId } from '../relay/policy.js';

export interface OutboundEnvelopeItem {
  messageId: string;
  recipientDeviceId: string;
  ciphertext: Buffer;
  /** Used ONLY for local batch-slot priority ordering (priority.ts) -- never trusted as, or substituted for, any FamilyEnvelope field the relay/verifier itself checks. */
  messageType: string;
  enqueuedAtEpochMillis: number;
  ttlMs?: number;
  /** Optional absolute expiry inherited from the signed envelope. */
  validUntil?: Date;
}

export type OutboundItemOutcome =
  | { messageId: string; outcome: 'QUEUED' }
  | { messageId: string; outcome: 'CROSS_FAMILY_RECIPIENT' }
  | { messageId: string; outcome: 'CONFLICT' }
  | { messageId: string; outcome: 'EXPIRED' }
  | { messageId: string; outcome: 'AUTHORITY_CHANGED' }
  | { messageId: string; outcome: 'INVALID' };

export interface OutboundBatchResult {
  results: OutboundItemOutcome[];
  /**
   * messageIds present in the request but not attempted this round because
   * the batch bound was already reached -- always reported explicitly
   * (never silently truncated), so the caller's own durable outbox can
   * simply leave them PENDING for the next reconnect attempt.
   */
  droppedForBatchBound: string[];
}

/** A trust-set recipient lookup failed, so its delivery authorization is unknown. */
export class RecipientAuthorizationUnavailableError extends Error {
  constructor() {
    super('Recipient authorization is unavailable.');
    this.name = 'RecipientAuthorizationUnavailableError';
  }
}

/**
 * Bounded batch wrapper around RelayService.queueEnvelope. Adds exactly
 * two things RelayService itself deliberately does not do (see its own
 * `familyId`/recipient doc comments -- it is ciphertext-blind, not a
 * family-authority source):
 *
 * 1. Cross-family IDOR closure: `recipientDeviceId` must resolve, via the
 *    existing family-scoped DeviceRepository.findDeviceForFamily, to a
 *    real device in the CALLER's own authenticated family before an
 *    envelope is ever queued for it. A recipient that exists but belongs
 *    to a different family is rejected exactly like a nonexistent one
 *    (CROSS_FAMILY_RECIPIENT), never distinguished from INVALID -- same
 *    non-enumeration posture as every other lookup in this codebase.
 * 2. Optional accepted-Trust-Set recipient eligibility, evaluated only
 *    after directory scope/revocation/browser checks and only for items in
 *    the attempted priority slice. This is enqueue eligibility, not final
 *    delivery authority: the recipient session and envelope cryptography
 *    must be revalidated when the queued item is drained/applied.
 * 3. A bounded batch: never more than MAX_OUTBOUND_BATCH_SIZE items
 *    attempted per call, highest-priority tier first (priority.ts).
 *
 * `senderDeviceId`/`familyId` must always come from the caller's verified
 * device session (see runtimeSyncRoutes.ts) -- this class trusts them
 * completely and performs no session validation itself.
 */
export class OutboundRelayService {
  constructor(
    private readonly relayService: RelayService,
    private readonly deviceRepository: DeviceRepository,
  ) {}

  async submitBatch(
    senderDeviceId: string,
    familyId: string,
    items: readonly OutboundEnvelopeItem[],
    authorizeRecipient: (recipientDeviceId: string) => Promise<false | RelayEnvelopeAuthoritySnapshot>,
  ): Promise<OutboundBatchResult> {
    // Copy absolute expiry dates before the first async recipient lookup, so
    // mutation of an input Date cannot lengthen retention during a slow read.
    // Also snapshot ciphertext before that lookup: RelayService's own copy
    // occurs after this boundary, so retaining a caller-owned Buffer here
    // would let an in-flight mutation change the bytes eventually queued.
    const capturedItems = items.map((item) => ({
      ...item,
      ciphertext: Buffer.isBuffer(item.ciphertext) ? Buffer.from(item.ciphertext) : item.ciphertext,
      validUntil: item.validUntil instanceof Date ? new Date(item.validUntil.getTime()) : item.validUntil,
    }));
    const prioritized = sortByPriority(capturedItems);
    const attempted = prioritized.slice(0, MAX_OUTBOUND_BATCH_SIZE);
    const droppedForBatchBound = prioritized.slice(MAX_OUTBOUND_BATCH_SIZE).map((item) => item.messageId);

    const results: OutboundItemOutcome[] = [];
    for (const item of attempted) {
      results.push(await this.submitOne(senderDeviceId, familyId, item, authorizeRecipient));
    }
    return { results, droppedForBatchBound };
  }

  /** Manual ack path (a caller that fetched via /inbound but wants to ack one item explicitly, e.g. after a decrypt failure it still wants to stop redelivering). Relay's own recipient-scoping already makes another device's messageId indistinguishable from NOT_FOUND. */
  async acknowledgeAsRecipient(
    recipientDeviceId: string,
    messageId: string,
    authority?: RelayRecipientAuthoritySnapshot,
  ): Promise<void> {
    await this.relayService.acknowledgeEnvelope(recipientDeviceId, messageId, authority);
  }

  private async submitOne(
    senderDeviceId: string,
    familyId: string,
    item: OutboundEnvelopeItem,
    authorizeRecipient: (recipientDeviceId: string) => Promise<false | RelayEnvelopeAuthoritySnapshot>,
  ): Promise<OutboundItemOutcome> {
    const recipient = await this.deviceRepository.findDeviceForFamily(familyId, item.recipientDeviceId);
    if (!recipient) {
      return { messageId: item.messageId, outcome: 'CROSS_FAMILY_RECIPIENT' };
    }
    // Device revocation is terminal: the recipient cannot establish or
    // retain a runtime-sync session, so accepting new relay ciphertext for
    // it would leave inaccessible ciphertext queued until expiry.
    if (recipient.status === 'REVOKED') {
      return { messageId: item.messageId, outcome: 'INVALID' };
    }
    // BROWSER endpoints have no DEK and are never family E2EE recipients;
    // reject before the ciphertext reaches the opaque relay store.
    if (recipient.platform === 'BROWSER') {
      return { messageId: item.messageId, outcome: 'INVALID' };
    }
    if (typeof authorizeRecipient !== 'function') {
      return { messageId: item.messageId, outcome: 'INVALID' };
    }
    // Directory family scope is checked first to preserve the existing
    // non-enumerating CROSS_FAMILY_RECIPIENT result. A live same-family row
    // still needs an exact accepted Trust Set sender+recipient snapshot before
    // ciphertext is queued. Missing/malformed authority fails closed.
    let authority: RelayEnvelopeAuthoritySnapshot;
    const authorization: unknown = await authorizeRecipient(item.recipientDeviceId);
    if (authorization === false || authorization === null || typeof authorization !== 'object' || Array.isArray(authorization)) {
      return { messageId: item.messageId, outcome: 'INVALID' };
    }
    const snapshot = authorization as RelayEnvelopeAuthoritySnapshot;
    if (snapshot.familyId !== familyId ||
        snapshot.sender?.deviceId !== senderDeviceId ||
        typeof snapshot.sender?.dskKeyId !== 'string' || snapshot.sender.dskKeyId.length === 0 ||
        snapshot.recipient?.deviceId !== item.recipientDeviceId ||
        typeof snapshot.recipient?.dskKeyId !== 'string' || snapshot.recipient.dskKeyId.length === 0 ||
        !Number.isSafeInteger(snapshot.trustSetEpoch) || snapshot.trustSetEpoch < 1 ||
        !Number.isSafeInteger(snapshot.keyEpoch) || snapshot.keyEpoch < 1 ||
        (snapshot.parentAccountId !== undefined &&
          !isPlausibleOpaqueId(snapshot.parentAccountId))) {
      return { messageId: item.messageId, outcome: 'INVALID' };
    }
    authority = {
      familyId: snapshot.familyId,
      trustSetEpoch: snapshot.trustSetEpoch,
      keyEpoch: snapshot.keyEpoch,
      sender: { deviceId: snapshot.sender.deviceId, dskKeyId: snapshot.sender.dskKeyId },
      recipient: { deviceId: snapshot.recipient.deviceId, dskKeyId: snapshot.recipient.dskKeyId },
      ...(snapshot.parentAccountId === undefined ? {} : { parentAccountId: snapshot.parentAccountId }),
    };

    try {
      await this.relayService.queueEnvelope({
        messageId: item.messageId,
        familyId,
        senderDeviceId,
        recipientDeviceId: item.recipientDeviceId,
        ciphertext: item.ciphertext,
        ttlMs: item.ttlMs,
        validUntil: item.validUntil,
        authority,
      });
      return { messageId: item.messageId, outcome: 'QUEUED' };
    } catch (error) {
      if (error instanceof RelayError) {
        if (error.code === 'CONFLICT') return { messageId: item.messageId, outcome: 'CONFLICT' };
        if (error.code === 'EXPIRED') return { messageId: item.messageId, outcome: 'EXPIRED' };
        return { messageId: item.messageId, outcome: 'INVALID' };
      }
      if (error instanceof RelayAuthorityChangedError) return { messageId: item.messageId, outcome: 'AUTHORITY_CHANGED' };
      throw error;
    }
  }
}
