import type { EnvelopeAcceptanceContext } from '../familyenvelope/FamilyEnvelopeVerifier.js';
import type { FamilyEnvelope } from '../familyenvelope/types.js';
import { buildDrainedReceipts, buildReceipt } from '../familysync/receipts.js';
import type { SyncCoordinator } from '../familysync/SyncCoordinator.js';
import type { SyncReceipt } from '../familysync/types.js';
import { RelayError, RelayService } from '../relay/RelayService.js';
import { envelopeFromRelayCiphertext } from './envelopeWireCodec.js';
import { MAX_INBOUND_LIST_SIZE } from './policy.js';

export interface ReconnectDrainOutcome {
  /** Envelopes this call fully applied -- STILL CIPHERTEXT (payload untouched). Decrypting/dispatching them is the caller's job (see doc 40 Section 6). */
  applied: FamilyEnvelope[];
  receipts: SyncReceipt[];
  /** Relay queue entries that failed to parse as a well-formed FamilyEnvelope -- left QUEUED (not acknowledged) rather than silently discarded, so a legitimate sender retransmitting is never worse off. */
  unparseableMessageIds: string[];
  /** Queued items beyond MAX_INBOUND_LIST_SIZE this call did not even attempt -- always reported, never silently dropped; a subsequent reconnect attempt picks them up. */
  droppedForListBound: string[];
}

/**
 * Composes the receiver-side reconnect flow: RelayService (opaque
 * transport, unmodified) -> envelopeWireCodec (wire parse only, never
 * touches `payload`) -> SyncCoordinator.reconnectDrain (the FULL,
 * unmodified security + dependency-hold pipeline) -> RelayService
 * acknowledgement for everything that ends up APPLY_NOW -> receipts.ts for
 * local, metadata-only status.
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
    resolveContext: (senderKeyId: string, nowUtc: Date) => EnvelopeAcceptanceContext,
    nowUtc: Date,
  ): Promise<ReconnectDrainOutcome> {
    const queued = await this.relayService.listQueuedForRecipient(recipientDeviceId);
    const attempted = queued.slice(0, MAX_INBOUND_LIST_SIZE);
    const droppedForListBound = queued.slice(MAX_INBOUND_LIST_SIZE).map((record) => record.messageId);

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
      if (!envelope) {
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
      const results = await this.syncCoordinator.reconnectDrain(envelopes, context);

      results.forEach((result, index) => {
        const envelope = orderedEnvelopes[index];
        receipts.push(buildReceipt(envelope, result.decision, nowUtc));
        if (result.decision.kind === 'APPLY_NOW') {
          applied.push(envelope);
        }
        if (result.drained.length > 0) {
          receipts.push(...buildDrainedReceipts(envelope.familyId, result.drained, nowUtc));
          for (const drainedItem of result.drained) {
            if (drainedItem.decision.kind === 'APPLY_NOW') {
              const drainedEnvelope = allEnvelopesByMessageId.get(drainedItem.messageId);
              if (drainedEnvelope) applied.push(drainedEnvelope);
            }
          }
        }
      });
    }

    const dedupedApplied = [...new Map(applied.map((envelope) => [envelope.messageId, envelope])).values()];
    await this.acknowledgeApplied(recipientDeviceId, dedupedApplied);

    return { applied: dedupedApplied, receipts, unparseableMessageIds, droppedForListBound };
  }

  /** Best-effort: an already-expired or already-acknowledged relay record is not a failure here -- SyncCoordinator has already decided this envelope is APPLY_NOW based on its own (independent) ledgers. */
  private async acknowledgeApplied(recipientDeviceId: string, applied: readonly FamilyEnvelope[]): Promise<void> {
    for (const envelope of applied) {
      try {
        await this.relayService.acknowledgeEnvelope(recipientDeviceId, envelope.messageId);
      } catch (error) {
        if (!(error instanceof RelayError)) throw error;
      }
    }
  }
}
