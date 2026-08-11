import { canonicalizeEnvelope } from '../familyenvelope/canonicalize.js';
import { evaluateEnvelope } from '../familyenvelope/FamilyEnvelopeVerifier.js';
import type { EnvelopeAcceptanceContext } from '../familyenvelope/FamilyEnvelopeVerifier.js';
import type { DataVersionLedger } from '../familyenvelope/DataVersionLedger.js';
import type { EnvelopeSignatureVerifier } from '../familyenvelope/EnvelopeSignatureVerifier.js';
import type { MessageIdempotencyLedger } from '../familyenvelope/MessageIdempotencyLedger.js';
import type { ReplayLedger } from '../familyenvelope/ReplayLedger.js';
import type { FamilyEnvelope, MessageId, OpaqueFamilyId } from '../familyenvelope/types.js';
import {
  MAX_PENDING_GLOBAL,
  MAX_PENDING_LIFETIME_MS,
  MAX_PENDING_PER_FAMILY,
  MAX_PENDING_PER_SENDER,
  parseNumericSequence,
  requiresCorrelationPredecessor,
} from './policy.js';
import type { PendingQueueStore } from './PendingQueueStore.js';
import type { SequenceProgressLedger } from './SequenceProgressLedger.js';
import type { PendingEnvelopeRecord, SyncDecision } from './types.js';

export const MAX_PENDING_CANONICAL_BYTES = 128 * 1024;

export interface SyncCoordinatorOptions {
  /**
   * Opt-in predicate: gap detection via `sequenceOrNonce` only ever runs
   * for a (familyId, senderKeyId) this predicate approves. Defaults to
   * "no one" -- an opaque-nonce sender is never mistakenly gap-checked
   * unless the caller explicitly knows that sender uses numeric sequence
   * mode (see policy.ts's parseNumericSequence doc for why this must stay
   * opt-in rather than sniffed from the string shape alone).
   */
  isNumericSequenceSender: (familyId: OpaqueFamilyId, senderKeyId: string) => boolean;
  maxPendingLifetimeMs?: number;
  /** Must match (or be no looser than) the caps the injected PendingQueueStore itself enforces -- these exist only so a rejection can name the SPECIFIC bound hit (sender/family/global) instead of one generic "queue full"; the store's own insert() remains the actual, authoritative enforcement (defense in depth if the two are ever wired with different numbers). */
  maxPendingPerSender?: number;
  maxPendingPerFamily?: number;
  maxPendingGlobal?: number;
}

export interface DrainedOutcome {
  messageId: MessageId;
  decision: SyncDecision;
}

export interface SubmitResult {
  decision: SyncDecision;
  drained: DrainedOutcome[];
}

type DependencyVerdict =
  | { kind: 'HOLD'; reason: 'MISSING_CORRELATION_PREDECESSOR'; waitingOnMessageId: MessageId }
  | { kind: 'HOLD'; reason: 'MISSING_SEQUENCE_PREDECESSOR'; waitingOnSequence: number }
  | { kind: 'REJECT'; reason: 'SEQUENCE_NOT_MONOTONIC' };

/**
 * PCA-11 synchronization coordinator. Wraps -- never reimplements --
 * FamilyEnvelopeVerifier.evaluateEnvelope (signature/replay/expiry/epoch/
 * version, all doc-22-accepted) and adds exactly the one capability that
 * module's own doc comment discloses as missing: holding a
 * dependency-gated envelope pending until its predecessor arrives or it
 * expires (see policy.ts and types.ts for the two dependency signals this
 * uses: correlationId adjacency and opt-in numeric sequenceOrNonce
 * adjacency -- both already-accepted wire fields, no new one invented).
 *
 * DOES NOT INVENT FAMILY AUTHORITY: neither Relay delivery, nor elapsed
 * wait time, nor repeated delivery, nor a caller's "please apply" request
 * ever bypasses evaluateEnvelope. A pending item is re-run through the
 * FULL security pipeline at drain time, exactly like a freshly-submitted
 * one -- a bad-signature or now-stale-epoch pending candidate is rejected
 * at drain, never silently promoted just because its predecessor arrived.
 *
 * LIVENESS NOTE (not a safety gap): draining a family's pending queue is
 * triggered only by `submit()` accepting a NEW envelope for that family --
 * there is no background timer inside this class. A successor whose
 * dependency becomes satisfied while it is still mid-flight through its
 * own admission screen (a genuine concurrent-arrival race) is not
 * retroactively drained by whichever call finishes first; it converges on
 * the family's next accepted envelope (from any sender) or its own
 * resubmission -- exactly what a real device's next reconnect/retry does.
 * It is never lost, never applied twice, and never applied out of order in
 * the meantime.
 */
export class SyncCoordinator {
  private readonly maxPendingLifetimeMs: number;
  private readonly maxPendingPerSender: number;
  private readonly maxPendingPerFamily: number;
  private readonly maxPendingGlobal: number;

  constructor(
    private readonly pendingStore: PendingQueueStore,
    private readonly sequenceLedger: SequenceProgressLedger,
    private readonly replayLedger: ReplayLedger,
    private readonly versionLedger: DataVersionLedger,
    private readonly messageIdempotencyLedger: MessageIdempotencyLedger,
    private readonly verifier: EnvelopeSignatureVerifier,
    private readonly options: SyncCoordinatorOptions,
  ) {
    this.maxPendingLifetimeMs = options.maxPendingLifetimeMs ?? MAX_PENDING_LIFETIME_MS;
    this.maxPendingPerSender = options.maxPendingPerSender ?? MAX_PENDING_PER_SENDER;
    this.maxPendingPerFamily = options.maxPendingPerFamily ?? MAX_PENDING_PER_FAMILY;
    this.maxPendingGlobal = options.maxPendingGlobal ?? MAX_PENDING_GLOBAL;
  }

  /** Removes and returns every pending record whose effectiveExpiresAt has passed. Callers may turn each into an EXPIRED SyncReceipt (see receipts.ts). Expired state is never later applicable -- it is deleted, not merely flagged. */
  sweepExpired(nowUtc: Date): PendingEnvelopeRecord[] {
    const expired = this.pendingStore.listExpired(nowUtc);
    for (const record of expired) this.pendingStore.remove(record.familyId, record.messageId);
    return expired;
  }

  async submit(envelope: FamilyEnvelope, context: EnvelopeAcceptanceContext): Promise<SubmitResult> {
    this.sweepExpired(context.now);

    const canonicalBytes = canonicalizeEnvelope(envelope);

    const existingPending = this.pendingStore.get(envelope.familyId, envelope.messageId);
    if (existingPending) {
      if (existingPending.canonicalBytes === canonicalBytes) {
        return {
          decision: {
            kind: 'HOLD_PENDING',
            reason: existingPending.reason,
            ...(existingPending.waitingOnMessageId !== null ? { waitingOnMessageId: existingPending.waitingOnMessageId } : {}),
            ...(existingPending.waitingOnSequence !== null ? { waitingOnSequence: existingPending.waitingOnSequence } : {}),
          },
          drained: [],
        };
      }
      return { decision: { kind: 'REJECT', reason: 'PENDING_MESSAGE_ID_CONFLICT' }, drained: [] };
    }

    const alreadyAccepted = this.messageIdempotencyLedger.getAcceptedCanonicalBytes(envelope.messageId) !== null;
    if (!alreadyAccepted) {
      const dependency = this.resolveDependency(envelope);
      if (dependency?.kind === 'REJECT') {
        return { decision: { kind: 'REJECT', reason: dependency.reason }, drained: [] };
      }
      if (dependency?.kind === 'HOLD') {
        // Screen the candidate through the FULL security pipeline (signature
        // included) in dry-run mode before ever spending bounded queue
        // capacity on it -- "a bad-signature pending candidate must reject,
        // never queue as trusted" (PCA-11 test matrix). Dry-run performs no
        // ledger side effects, so this candidate is re-evaluated for real,
        // unconditionally, at drain time -- screening here is a queue-admission
        // filter, never a second acceptance path.
        const screen = await evaluateEnvelope(
          envelope,
          context,
          this.verifier,
          this.replayLedger,
          this.versionLedger,
          this.messageIdempotencyLedger,
          { dryRun: true },
        );
        if (!screen.accepted) {
          return { decision: { kind: 'REJECT', reason: screen.reason }, drained: [] };
        }
        const rejection = this.tryEnqueuePending(envelope, canonicalBytes, dependency, context.now);
        if (rejection) return { decision: { kind: 'REJECT', reason: rejection }, drained: [] };
        return {
          decision: {
            kind: 'HOLD_PENDING',
            reason: dependency.reason,
            ...(dependency.reason === 'MISSING_CORRELATION_PREDECESSOR'
              ? { waitingOnMessageId: dependency.waitingOnMessageId }
              : { waitingOnSequence: dependency.waitingOnSequence }),
          },
          drained: [],
        };
      }
    }

    const verdict = await evaluateEnvelope(
      envelope,
      context,
      this.verifier,
      this.replayLedger,
      this.versionLedger,
      this.messageIdempotencyLedger,
    );
    if (!verdict.accepted) {
      return { decision: { kind: 'REJECT', reason: verdict.reason }, drained: [] };
    }

    this.recordSequenceIfApplicable(envelope);
    const drained = await this.drainFamily(envelope.familyId, context);
    return { decision: { kind: 'APPLY_NOW', idempotent: verdict.idempotent }, drained };
  }

  /** Deterministic reconnect batch drain: sorts by (issuedAt, messageId) -- never by relay arrival order, which is not authoritative -- and submits each in turn. Idempotent: replaying the exact same batch again produces the same end state (every already-applied/still-ineligible item resolves via submit()'s own idempotency/dedupe). */
  async reconnectDrain(envelopes: FamilyEnvelope[], context: EnvelopeAcceptanceContext): Promise<SubmitResult[]> {
    const ordered = [...envelopes].sort(
      (a, b) => a.issuedAt.getTime() - b.issuedAt.getTime() || a.messageId.localeCompare(b.messageId),
    );
    const results: SubmitResult[] = [];
    for (const envelope of ordered) {
      results.push(await this.submit(envelope, context));
    }
    return results;
  }

  private resolveDependency(envelope: FamilyEnvelope): DependencyVerdict | null {
    if (requiresCorrelationPredecessor(envelope.messageType) && envelope.correlationId !== null) {
      const predecessorAccepted = this.messageIdempotencyLedger.getAcceptedCanonicalBytes(envelope.correlationId) !== null;
      if (!predecessorAccepted) {
        return { kind: 'HOLD', reason: 'MISSING_CORRELATION_PREDECESSOR', waitingOnMessageId: envelope.correlationId };
      }
    }
    if (this.options.isNumericSequenceSender(envelope.familyId, envelope.senderKeyId)) {
      const sequence = parseNumericSequence(envelope.sequenceOrNonce);
      if (sequence !== null) {
        const lastApplied = this.sequenceLedger.getLastAppliedSequence(envelope.familyId, envelope.senderKeyId);
        if (lastApplied !== null) {
          if (sequence <= lastApplied) return { kind: 'REJECT', reason: 'SEQUENCE_NOT_MONOTONIC' };
          if (sequence > lastApplied + 1) {
            return { kind: 'HOLD', reason: 'MISSING_SEQUENCE_PREDECESSOR', waitingOnSequence: lastApplied + 1 };
          }
        }
      }
    }
    return null;
  }

  private tryEnqueuePending(
    envelope: FamilyEnvelope,
    canonicalBytes: string,
    dependency: Extract<DependencyVerdict, { kind: 'HOLD' }>,
    receivedAt: Date,
  ): 'PENDING_ENVELOPE_TOO_LARGE' | 'PENDING_SENDER_QUEUE_FULL' | 'PENDING_FAMILY_QUEUE_FULL' | 'PENDING_GLOBAL_QUEUE_FULL' | null {
    if (canonicalBytes.length > MAX_PENDING_CANONICAL_BYTES) return 'PENDING_ENVELOPE_TOO_LARGE';
    if (this.pendingStore.countForSender(envelope.familyId, envelope.senderKeyId) >= this.maxPendingPerSender) {
      return 'PENDING_SENDER_QUEUE_FULL';
    }
    if (this.pendingStore.countForFamily(envelope.familyId) >= this.maxPendingPerFamily) {
      return 'PENDING_FAMILY_QUEUE_FULL';
    }
    if (this.pendingStore.countGlobal() >= this.maxPendingGlobal) {
      return 'PENDING_GLOBAL_QUEUE_FULL';
    }
    const effectiveExpiresAt = new Date(
      Math.min(envelope.expiresAt.getTime(), receivedAt.getTime() + this.maxPendingLifetimeMs),
    );
    const record: PendingEnvelopeRecord = {
      familyId: envelope.familyId,
      senderKeyId: envelope.senderKeyId,
      messageId: envelope.messageId,
      envelope,
      canonicalBytes,
      receivedAt,
      effectiveExpiresAt,
      reason: dependency.reason,
      waitingOnMessageId: dependency.reason === 'MISSING_CORRELATION_PREDECESSOR' ? dependency.waitingOnMessageId : null,
      waitingOnSequence: dependency.reason === 'MISSING_SEQUENCE_PREDECESSOR' ? dependency.waitingOnSequence : null,
    };
    const inserted = this.pendingStore.insert(record);
    return inserted ? null : 'PENDING_FAMILY_QUEUE_FULL';
  }

  private recordSequenceIfApplicable(envelope: FamilyEnvelope): void {
    if (!this.options.isNumericSequenceSender(envelope.familyId, envelope.senderKeyId)) return;
    const sequence = parseNumericSequence(envelope.sequenceOrNonce);
    if (sequence !== null) this.sequenceLedger.recordAppliedSequence(envelope.familyId, envelope.senderKeyId, sequence);
  }

  private async drainFamily(familyId: OpaqueFamilyId, context: EnvelopeAcceptanceContext): Promise<DrainedOutcome[]> {
    const outcomes: DrainedOutcome[] = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      const candidates = this.pendingStore
        .listForFamily(familyId)
        .filter((record) => context.now.getTime() < record.effectiveExpiresAt.getTime())
        .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.messageId.localeCompare(b.messageId));

      for (const record of candidates) {
        const dependency = this.resolveDependency(record.envelope);
        if (dependency === null) {
          this.pendingStore.remove(familyId, record.messageId);
          const verdict = await evaluateEnvelope(
            record.envelope,
            context,
            this.verifier,
            this.replayLedger,
            this.versionLedger,
            this.messageIdempotencyLedger,
          );
          if (verdict.accepted) {
            this.recordSequenceIfApplicable(record.envelope);
            outcomes.push({ messageId: record.messageId, decision: { kind: 'APPLY_NOW', idempotent: verdict.idempotent } });
          } else {
            outcomes.push({ messageId: record.messageId, decision: { kind: 'REJECT', reason: verdict.reason } });
          }
          progressed = true;
          break;
        }
        if (dependency.kind === 'REJECT') {
          this.pendingStore.remove(familyId, record.messageId);
          outcomes.push({ messageId: record.messageId, decision: { kind: 'REJECT', reason: dependency.reason } });
          progressed = true;
          break;
        }
      }
    }
    return outcomes;
  }
}
