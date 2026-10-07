import type { EnvelopeAcceptanceContext } from '../familyenvelope/FamilyEnvelopeVerifier.js';
import type { FamilyEnvelope } from '../familyenvelope/types.js';
import { buildReceipt } from '../familysync/receipts.js';
import type { SyncCoordinator } from '../familysync/SyncCoordinator.js';
import type { SyncReceipt, SyncDecision } from '../familysync/types.js';
import { requiresCorrelationPredecessor } from '../familysync/policy.js';
import { RelayService } from '../relay/RelayService.js';
import { envelopeFromRelayCiphertext, envelopeToRawFamilyEnvelope } from './envelopeWireCodec.js';
import { MAX_INBOUND_LIST_SIZE } from './policy.js';
import { MAX_RELAY_SUPPLEMENT_RECORDS, relayQueuePosition, type RelayQueuedRecord } from '../relay/queuePage.js';
import { decodeRelayContinuation, encodeRelayContinuation, validateRelayNavigationScope, type RelayNavigationScope } from './relayContinuation.js';

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
  /** Navigation only; unresolved queue work is distinct from campaign continuation. */
  nextCursor: string | null;
  hasUnresolved: boolean;
  sessionIncarnation: string | null;
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
    navigation?: { sessionIncarnation: string; cursor?: string },
  ): Promise<ReconnectDrainOutcome> {
    // Non-HTTP callers can inspect one fresh bounded page. The production
    // route always supplies the validated session incarnation for continuation.
    const scope: RelayNavigationScope | null = navigation ? {
      familyId: recipientFamilyId, recipientDeviceId, sessionIncarnation: navigation.sessionIncarnation,
    } : null;
    if (scope) validateRelayNavigationScope(scope);
    const continuation = navigation?.cursor !== undefined && scope
      ? decodeRelayContinuation(navigation.cursor, scope, nowUtc) : null;
    const page = await this.relayService.listQueuedPageForRecipient(recipientDeviceId, recipientFamilyId, nowUtc, {
      after: continuation?.after ?? null, highWater: continuation?.highWater ?? null, limit: MAX_INBOUND_LIST_SIZE,
    });
    const queued = page.records;
    if (page.hasMore && (queued.length === 0 || page.highWater === null)) throw new Error('Invalid relay page progress.');
    const decodeBoundRecord = (record: RelayQueuedRecord): FamilyEnvelope | null => {
      const envelope = record.ciphertext === null ? null : envelopeFromRelayCiphertext(record.ciphertext);
      return envelope && record.recipientDeviceId === recipientDeviceId && record.familyId === recipientFamilyId
        && envelope.messageId === record.messageId && envelope.familyId === record.familyId
        && envelope.senderDeviceId === record.senderDeviceId && envelope.recipient.kind === 'DEVICE'
        && envelope.recipient.recipientDeviceId === recipientDeviceId ? envelope : null;
    };
    const decoded = new Map<string, FamilyEnvelope>();
    const unparseableMessageIds: string[] = [];
    const priorityMessageIds = new Set<string>();
    for (const record of queued) {
      const envelope = decodeBoundRecord(record);
      if (!envelope) continue;
      decoded.set(record.messageId, envelope);
      if (requiresCorrelationPredecessor(envelope.messageType) && envelope.correlationId !== null
          && priorityMessageIds.size < MAX_RELAY_SUPPLEMENT_RECORDS) priorityMessageIds.add(envelope.correlationId);
    }
    const baseIds = new Set(queued.map((record) => record.messageId));
    const supplements = await this.relayService.findQueuedForRecipient(recipientDeviceId, recipientFamilyId,
      [...priorityMessageIds].filter((id) => !baseIds.has(id)), nowUtc);
    for (const record of supplements) {
      const envelope = decodeBoundRecord(record);
      if (envelope) decoded.set(record.messageId, envelope);
    }
    const attempted: RelayQueuedRecord[] = [];
    const attemptedIds = new Set<string>();
    let wrapperBytes = 0;
    const wrapperSize = (record: RelayQueuedRecord): number => {
      const envelope = decoded.get(record.messageId);
      return envelope ? Buffer.byteLength(JSON.stringify(envelopeToRawFamilyEnvelope(envelope)), 'utf8') + 1 : 0;
    };
    // A bounded predecessor reservation prevents a byte-full dependent head
    // hiding its predecessor, while leaving most capacity for base progress.
    for (const record of [...queued.filter((item) => priorityMessageIds.has(item.messageId)), ...supplements]) {
      if (!decoded.has(record.messageId) || attemptedIds.has(record.messageId)) continue;
      const bytes = wrapperSize(record);
      if (attempted.length >= MAX_RELAY_SUPPLEMENT_RECORDS || wrapperBytes + bytes > 256 * 1024) continue;
      attempted.push(record); attemptedIds.add(record.messageId); wrapperBytes += bytes;
    }
    const processedBase: RelayQueuedRecord[] = [];
    for (const record of queued) {
      if (!decoded.has(record.messageId)) {
        unparseableMessageIds.push(record.messageId);
        processedBase.push(record);
        continue;
      }
      if (attemptedIds.has(record.messageId)) { processedBase.push(record); continue; }
      const bytes = wrapperSize(record);
      if (attempted.length >= MAX_INBOUND_LIST_SIZE || wrapperBytes + bytes > 1024 * 1024) {
        break;
      }
      attempted.push(record); attemptedIds.add(record.messageId); wrapperBytes += bytes;
      processedBase.push(record);
    }
    const droppedForListBound = queued.slice(processedBase.length)
      .filter((record) => !attemptedIds.has(record.messageId)).map((record) => record.messageId);
    const hasMore = page.hasMore || processedBase.length < queued.length;
    // Advance malformed/individually oversized and attempted base records,
    // but stop before an ordinary wrapper excluded by the aggregate budget.
    // Otherwise a permanently held byte-full head could starve the tail on
    // every sweep. Supplements never advance this contiguous base position.
    if (hasMore && processedBase.length === 0) throw new Error('Relay base page made no progress.');
    const nextCursor = hasMore && scope && page.highWater && processedBase.length
      ? encodeRelayContinuation({ version: 1, scope, after: relayQueuePosition(processedBase[processedBase.length - 1]!),
          highWater: page.highWater, startedAtMs: continuation?.startedAtMs ?? nowUtc.getTime() }) : null;
    const bySenderKey = new Map<string, FamilyEnvelope[]>();
    // Global across every sender in this batch -- a HOLD_PENDING candidate
    // resolved during one sender's drain can reference a predecessor that
    // arrived under a DIFFERENT senderKeyId this same reconnect round (e.g.
    // a CHILD_REQUEST/PARENT_DECISION pair always has two distinct
    // senders), so acknowledgement/applied resolution must not be scoped
    // to a single sender's group.
    const allEnvelopesByMessageId = new Map<string, FamilyEnvelope>();
    for (const record of attempted) {
      const envelope = decoded.get(record.messageId);
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
    const hasUnresolved = unparseableMessageIds.length > 0 || droppedForListBound.length > 0
      || dedupedReceipts.some((receipt) => receipt.outcome !== 'APPLIED');
    return { applied: dedupedApplied, receipts: dedupedReceipts, unparseableMessageIds, droppedForListBound,
      hasMore, nextCursor, hasUnresolved, sessionIncarnation: scope?.sessionIncarnation ?? null };
  }

}
