import type { EnvelopeAcceptanceContext } from '../familyenvelope/FamilyEnvelopeVerifier.js';
import type { FamilyEnvelope } from '../familyenvelope/types.js';
import { buildReceipt } from '../familysync/receipts.js';
import type { SyncCoordinator } from '../familysync/SyncCoordinator.js';
import type { SyncReceipt, SyncDecision } from '../familysync/types.js';
import { requiresCorrelationPredecessor } from '../familysync/policy.js';
import { RelayService } from '../relay/RelayService.js';
import { envelopeFromRelayCiphertext, envelopeToRawFamilyEnvelope } from './envelopeWireCodec.js';
import { MAX_INBOUND_LIST_SIZE } from './policy.js';

export interface ReconnectDrainOutcome {
  /** Currently eligible, server-accepted ciphertext. This is not device application evidence; recipient durable custody and explicit acknowledgement are separate. */
  applied: FamilyEnvelope[];
  receipts: SyncReceipt[];
  /** Outer queue IDs whose ciphertext is malformed or fails authenticated transport binding. Kept QUEUED without acceptance/acknowledgement; no forged inner IDs are reported. */
  unparseableMessageIds: string[];
  /** Bounded diagnostic window of deferred queue IDs; hasMore indicates continuation. No deferred record is acknowledged or discarded. */
  droppedForListBound: string[];
  /** Additional queued records remain beyond this bounded page/diagnostic window. */
  hasMore: boolean;
}

/**
 * Composes the receiver-side reconnect flow: RelayService (opaque
 * transport, unmodified) -> envelopeWireCodec (wire parse only, never
 * touches `payload`) -> SyncCoordinator.reconnectDrain (the FULL,
 * security + dependency-hold pipeline) -> fresh delivery revalidation.
 * Relay records remain queued until the recipient explicitly acknowledges
 * durable custody. Server acceptance receipts never prove OS application.
 *
 * `resolveContext` supplies, per sender key, the FTS-owned inputs
 * FamilyEnvelopeVerifier's own doc comment says this layer does not own
 * (senderPublicKey, epoch floor) -- this service never resolves them
 * itself. SyncCoordinator.reconnectDrain takes one EnvelopeAcceptanceContext
 * per call, which is why envelopes are grouped by senderKeyId before
 * draining each group.
 */
export class InboundReconnectService {
  constructor(
    private readonly relayService: RelayService,
    private readonly syncCoordinator: SyncCoordinator,
  ) {}

  async reconnectDrainForRecipient(
    recipientDeviceId: string,
    recipientFamilyId: string,
    resolveContext: (senderKeyId: string, nowUtc: Date) => EnvelopeAcceptanceContext,
    nowUtc: Date,
  ): Promise<ReconnectDrainOutcome> {
    const queued = await this.relayService.listQueuedForRecipient(recipientDeviceId);
    // Reserve ample space beneath both mobile 4 MiB limits for JSON escaping,
    // durable snapshot metadata, receipts and diagnostics. Select before
    // coordinator acceptance: deferred records have no new acceptance writes.
    // Prevent a byte-full page of dependents from hiding their queued
    // correlation predecessors forever. Give predecessor IDs referenced by
    // valid dependents in the first count window priority for this page.
    // The coordinator still runs the ordinary dependency/signature pipeline;
    // this only changes which queued records are considered together.
    const priorityMessageIds = new Set<string>();
    for (const record of queued.slice(0, MAX_INBOUND_LIST_SIZE)) {
      const envelope = envelopeFromRelayCiphertext(record.ciphertext);
      if (record.recipientDeviceId === recipientDeviceId
          && record.familyId === recipientFamilyId
          && envelope
          && envelope.messageId === record.messageId
          && envelope.familyId === record.familyId
          && envelope.senderDeviceId === record.senderDeviceId
          && envelope.recipient.kind === 'DEVICE'
          && envelope.recipient.recipientDeviceId === recipientDeviceId
          && requiresCorrelationPredecessor(envelope.messageType)
          && envelope.correlationId !== null) {
        priorityMessageIds.add(envelope.correlationId);
      }
    }
    const priorityRecords = queued.filter((record) => priorityMessageIds.has(record.messageId));
    const priorityRecordIds = new Set(priorityRecords.map((record) => record.messageId));
    const orderedQueued = [
      ...priorityRecords,
      ...queued.filter((record) => !priorityRecordIds.has(record.messageId)),
    ];
    const attempted: typeof queued = [];
    let wrapperBytes = 0;
    for (const record of orderedQueued) {
      if (attempted.length === MAX_INBOUND_LIST_SIZE) break;
      const envelope = envelopeFromRelayCiphertext(record.ciphertext);
      const bytes = envelope
        ? Buffer.byteLength(JSON.stringify(envelopeToRawFamilyEnvelope(envelope)), 'utf8')
        : record.ciphertext.byteLength;
      if (wrapperBytes + bytes + 1 > 1024 * 1024) break;
      attempted.push(record);
      wrapperBytes += bytes + 1;
    }
    const attemptedIds = new Set(attempted.map((record) => record.messageId));
    const deferred = queued.filter((record) => !attemptedIds.has(record.messageId)).slice(0, MAX_INBOUND_LIST_SIZE);
    const droppedForListBound = deferred.map((record) => record.messageId);
    const hasMore = queued.length > attempted.length;

    const unparseableMessageIds: string[] = [];
    const bySenderKey = new Map<string, FamilyEnvelope[]>();
    // Global across every sender in this batch -- a HOLD_PENDING candidate
    // resolved during one sender's drain can reference a predecessor that
    // arrived under a DIFFERENT senderKeyId this same reconnect round (e.g.
    // a CHILD_REQUEST/PARENT_DECISION pair always has two distinct
    // senders), so acknowledgement/applied resolution must not be scoped
    // to a single sender's group.
    const allEnvelopesByMessageId = new Map<string, FamilyEnvelope>();
    for (const record of attempted) {
      const envelope = envelopeFromRelayCiphertext(record.ciphertext);
      if (!envelope
          || record.recipientDeviceId !== recipientDeviceId
          || record.familyId !== recipientFamilyId
          || envelope.messageId !== record.messageId
          || envelope.familyId !== record.familyId
          || envelope.senderDeviceId !== record.senderDeviceId
          || envelope.recipient.kind !== 'DEVICE'
          || envelope.recipient.recipientDeviceId !== recipientDeviceId) {
        unparseableMessageIds.push(record.messageId);
        continue;
      }
      const group = bySenderKey.get(envelope.senderKeyId) ?? [];
      group.push(envelope);
      bySenderKey.set(envelope.senderKeyId, group);
      allEnvelopesByMessageId.set(envelope.messageId, envelope);
    }

    const applied: FamilyEnvelope[] = [];
    const receipts: SyncReceipt[] = [];

    for (const [senderKeyId, envelopes] of bySenderKey) {
      const context = resolveContext(senderKeyId, nowUtc);
      // reconnectDrain sorts its own working copy internally but returns
      // results in that SAME sorted order (see SyncCoordinator.reconnectDrain),
      // not the original `envelopes` array order -- sort identically here so
      // results[i] pairs correctly with orderedEnvelopes[i].
      const orderedEnvelopes = [...envelopes].sort(
        (a, b) => a.issuedAt.getTime() - b.issuedAt.getTime() || a.messageId.localeCompare(b.messageId),
      );
      const results = await this.syncCoordinator.reconnectDrain(envelopes, context, resolveContext);

      for (const [index, result] of results.entries()) {
        const envelope = orderedEnvelopes[index];
        const decideDelivery = async (candidate: FamilyEnvelope, decision: SyncDecision): Promise<SyncDecision> => {
          if (decision.kind !== 'APPLY_NOW') return decision;
          const rejection = await this.syncCoordinator.deliveryRejection(
            candidate, resolveContext(candidate.senderKeyId, nowUtc),
          );
          return rejection ? { kind: 'REJECT', reason: rejection } : decision;
        };
        const decision = await decideDelivery(envelope, result.decision);
        receipts.push(buildReceipt(envelope, decision, nowUtc));
        if (decision.kind === 'APPLY_NOW') applied.push(envelope);
        for (const drainedItem of result.drained) {
          const candidate = allEnvelopesByMessageId.get(drainedItem.messageId);
          if (!candidate) continue; // never expose ciphertext outside this bounded relay batch
          const drainedDecision = await decideDelivery(candidate, drainedItem.decision);
          receipts.push(buildReceipt(candidate, drainedDecision, nowUtc));
          if (drainedDecision.kind === 'APPLY_NOW') applied.push(candidate);
        }
      }
    }

    const dedupedApplied = [...new Map(applied.map((envelope) => [envelope.messageId, envelope])).values()];

    const dedupedReceipts = [...new Map(receipts.map((receipt) => [receipt.messageId, receipt])).values()];
    return { applied: dedupedApplied, receipts: dedupedReceipts, unparseableMessageIds, droppedForListBound, hasMore };
  }

}
