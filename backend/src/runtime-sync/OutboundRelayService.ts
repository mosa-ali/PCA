import { RelayError, RelayService } from '../relay/RelayService.js';
import type { DeviceRepository } from '../device/DeviceRepository.js';
import { MAX_OUTBOUND_BATCH_SIZE } from './policy.js';
import { sortByPriority } from './priority.js';

export interface OutboundEnvelopeItem {
  messageId: string;
  recipientDeviceId: string;
  ciphertext: Buffer;
  /** Used ONLY for local batch-slot priority ordering (priority.ts) -- never trusted as, or substituted for, any FamilyEnvelope field the relay/verifier itself checks. */
  messageType: string;
  enqueuedAtEpochMillis: number;
  ttlMs?: number;
}

export type OutboundItemOutcome =
  | { messageId: string; outcome: 'QUEUED' }
  | { messageId: string; outcome: 'CROSS_FAMILY_RECIPIENT' }
  | { messageId: string; outcome: 'CONFLICT' }
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
 * 2. A bounded batch: never more than MAX_OUTBOUND_BATCH_SIZE items
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
  ): Promise<OutboundBatchResult> {
    const prioritized = sortByPriority(items);
    const attempted = prioritized.slice(0, MAX_OUTBOUND_BATCH_SIZE);
    const droppedForBatchBound = prioritized.slice(MAX_OUTBOUND_BATCH_SIZE).map((item) => item.messageId);

    const results: OutboundItemOutcome[] = [];
    for (const item of attempted) {
      results.push(await this.submitOne(senderDeviceId, familyId, item));
    }
    return { results, droppedForBatchBound };
  }

  /** Manual ack path (a caller that fetched via /inbound but wants to ack one item explicitly, e.g. after a decrypt failure it still wants to stop redelivering). Relay's own recipient-scoping already makes another device's messageId indistinguishable from NOT_FOUND. */
  async acknowledgeAsRecipient(recipientDeviceId: string, messageId: string): Promise<void> {
    await this.relayService.acknowledgeEnvelope(recipientDeviceId, messageId);
  }

  private async submitOne(senderDeviceId: string, familyId: string, item: OutboundEnvelopeItem): Promise<OutboundItemOutcome> {
    const recipient = await this.deviceRepository.findDeviceForFamily(familyId, item.recipientDeviceId);
    if (!recipient) {
      return { messageId: item.messageId, outcome: 'CROSS_FAMILY_RECIPIENT' };
    }

    try {
      await this.relayService.queueEnvelope({
        messageId: item.messageId,
        familyId,
        senderDeviceId,
        recipientDeviceId: item.recipientDeviceId,
        ciphertext: item.ciphertext,
        ttlMs: item.ttlMs,
      });
      return { messageId: item.messageId, outcome: 'QUEUED' };
    } catch (error) {
      if (error instanceof RelayError) {
        return { messageId: item.messageId, outcome: error.code === 'CONFLICT' ? 'CONFLICT' : 'INVALID' };
      }
      throw error;
    }
  }
}
