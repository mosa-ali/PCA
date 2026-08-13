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
 * LIVENESS NOTE (not a safety gap): a family-wide drain is triggered only
 * by `submit()` accepting a NEW envelope for that family -- there is no
 * background timer inside this class. A successor whose dependency becomes
 * satisfied while it is still mid-flight through its own admission screen
 * (a genuine concurrent-arrival race) is not retroactively drained by
 * whichever call finishes first. It converges on EITHER the family's next
 * accepted envelope (any sender) OR its own resubmission -- both are real
 * convergence paths: `submitInternal`'s identical-resubmission branch
 * re-resolves the pending candidate's dependency fresh via
 * `resolvePendingCandidate` rather than echoing the stale stored verdict,
 * so a device's ordinary reconnect/retry of the same envelope genuinely
 * unblocks it. It is never lost, never applied twice, and never applied
 * out of order in the meantime.
 */
export class SyncCoordinator {
  private readonly maxPendingLifetimeMs: number;
  private readonly maxPendingPerSender: number;
  private readonly maxPendingPerFamily: number;
  private readonly maxPendingGlobal: number;
  /**
   * PCA11_ORDERING_CONCURRENCY red-team finding (HIGH): the underlying,
   * already-accepted evaluateEnvelope reads the message-idempotency ledger
   * (and the replay ledger) before its one internal `await` and writes them
   * only after. Two concurrent submit() calls sharing a messageId can
   * therefore both pass every synchronous check before either has recorded
   * anything -- for byte-identical content this only mislabels the second
   * caller's `idempotent` flag; for CONFLICTING content sharing the same
   * messageId, it is worse: both could reach "accepted" and the ledger
   * would simply be overwritten by whichever finishes last, silently
   * skipping the MESSAGE_ID_CONFLICT rejection entirely. That check-then-act
   * pattern lives in FamilyEnvelopeVerifier.ts, a pre-existing accepted
   * module this lane must not reimplement or alter the acceptance
   * semantics of.
   *
   * Fixed entirely within this class instead, with a per-(familyId,
   * messageId) serialization queue: every submit() call for the same key is
   * chained strictly after the previous one completes, so evaluateEnvelope
   * is never invoked twice concurrently for the same messageId -- by the
   * time a second (or third, ...) call for that key actually runs, the
   * first one's ledger writes have already landed, so idempotency and
   * conflict detection both observe true, settled state. An identical
   * (byte-for-byte) concurrent resubmission is additionally short-circuited
   * onto the SAME in-flight promise as a pure optimization (skips a
   * redundant signature verification) -- this is safe/optional, never
   * required for correctness, since the serialization queue alone already
   * guarantees the right outcome even without it.
   */
  private readonly chainByKey = new Map<string, Promise<unknown>>();
  private readonly inFlightIdenticalByKey = new Map<string, { canonicalBytes: string; promise: Promise<SubmitResult> }>();

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
    const canonicalBytes = canonicalizeEnvelope(envelope);
    // PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: keyed by context.familyId
    // (the caller's AUTHORITATIVE, session-derived family identity), never
    // envelope.familyId (a self-declared, untrusted field a forged
    // envelope could set to any value) -- see
    // FamilyEnvelopeVerifier.EnvelopeAcceptanceContext's familyId doc
    // comment. Every pending-queue/sequence-ledger operation below is
    // likewise scoped by context.familyId, never envelope.familyId, so a
    // forged-family envelope can never touch another family's queue or
    // sequence state even before evaluateEnvelope's own FAMILY_ID_MISMATCH
    // check (run inside every evaluateEnvelope call below) rejects it.
    const key = `${context.familyId} ${envelope.messageId}`;

    const identicalInFlight = this.inFlightIdenticalByKey.get(key);
    if (identicalInFlight && identicalInFlight.canonicalBytes === canonicalBytes) {
      return identicalInFlight.promise;
    }

    const previousInChain = this.chainByKey.get(key) ?? Promise.resolve();
    const runPromise: Promise<SubmitResult> = previousInChain.then(
      () => this.submitInternal(envelope, context, canonicalBytes),
      () => this.submitInternal(envelope, context, canonicalBytes),
    );
    // The chain link must never itself reject (a rejected chain link would
    // permanently wedge every future submission for this key) -- settle
    // to undefined either way, purely as an ordering token. `chainLink` is
    // stored once and reused for the identity check below, since calling
    // `.catch()` again would create a brand-new Promise object every time.
    const chainLink = runPromise.then(
      () => undefined,
      () => undefined,
    );
    this.chainByKey.set(key, chainLink);
    this.inFlightIdenticalByKey.set(key, { canonicalBytes, promise: runPromise });
    try {
      return await runPromise;
    } finally {
      if (this.inFlightIdenticalByKey.get(key)?.promise === runPromise) {
        this.inFlightIdenticalByKey.delete(key);
      }
      // Bound chainByKey's growth: if no newer call replaced our chain link
      // while we were running, this key has no more pending work -- remove
      // it rather than retaining one Map entry per messageId ever seen.
      if (this.chainByKey.get(key) === chainLink) {
        this.chainByKey.delete(key);
      }
    }
  }

  private async submitInternal(envelope: FamilyEnvelope, context: EnvelopeAcceptanceContext, canonicalBytes: string): Promise<SubmitResult> {
    this.sweepExpired(context.now);
    // PCA-17C: every bookkeeping/queueing operation below uses
    // context.familyId (authoritative), never envelope.familyId -- see the
    // doc comment on submit()'s `key` above. A forged-family envelope is
    // scoped, for pending-queue/sequence/idempotency-lookup purposes, as if
    // it belonged to the AUTHORITATIVE family, and is always ultimately
    // rejected by evaluateEnvelope's FAMILY_ID_MISMATCH check below (in
    // either the dry-run screen or the real evaluation) -- it can never
    // reach APPLY_NOW, and never touches any other family's state.
    const familyId = context.familyId;

    const existingPending = this.pendingStore.get(familyId, envelope.messageId);
    if (existingPending) {
      if (existingPending.canonicalBytes === canonicalBytes) {
        // PCA11_ORDERING_CONCURRENCY red-team finding: resubmitting the exact
        // same still-pending envelope must re-check eligibility, not just
        // echo back the stored HOLD_PENDING verdict -- a device's own natural
        // retry/resubmit is a legitimate convergence path (documented on
        // SyncCoordinator above), so it must actually be able to promote and
        // apply a candidate whose dependency has since resolved, exactly like
        // drainFamily would.
        const decision = await this.resolvePendingCandidate(existingPending, context);
        const drained = decision.kind === 'APPLY_NOW' ? await this.drainFamily(familyId, context) : [];
        return { decision, drained };
      }
      return { decision: { kind: 'REJECT', reason: 'PENDING_MESSAGE_ID_CONFLICT' }, drained: [] };
    }

    const alreadyAccepted = (await this.messageIdempotencyLedger.getAcceptedCanonicalBytes(familyId, envelope.messageId)) !== null;
    if (!alreadyAccepted) {
      const dependency = await this.resolveDependency(envelope, familyId);
      if (dependency?.kind === 'REJECT') {
        return { decision: { kind: 'REJECT', reason: dependency.reason }, drained: [] };
      }
      if (dependency?.kind === 'HOLD') {
        // Cheap, synchronous capacity pre-check FIRST -- an already-at-capacity
        // sender/family/global queue is rejected before paying the expensive
        // dry-run signature-verification cost below (PCA11_SYNC_SECURITY
        // red-team finding: a capacity-exhausted sender could otherwise force
        // full verification work on every subsequent submission just to be
        // told "queue full" afterward). The dry-run screen and the real
        // insert() below both still independently re-check capacity -- this
        // is a fast-fail, not the sole enforcement point.
        const capacityRejection = this.checkPendingCapacity(envelope, familyId, canonicalBytes);
        if (capacityRejection) {
          return { decision: { kind: 'REJECT', reason: capacityRejection }, drained: [] };
        }
        // Screen the candidate through the FULL security pipeline (signature
        // included) in dry-run mode before ever spending bounded queue
        // capacity on it -- "a bad-signature pending candidate must reject,
        // never queue as trusted" (PCA-11 test matrix). Dry-run performs no
        // ledger side effects, so this candidate is re-evaluated for real,
        // unconditionally, at drain time -- screening here is a queue-admission
        // filter, never a second acceptance path. This is also where a
        // forged-family envelope (envelope.familyId !== context.familyId)
        // gets caught and rejected as FAMILY_ID_MISMATCH before it could
        // ever be queued as a trusted pending candidate.
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
        const rejection = this.tryEnqueuePending(envelope, familyId, canonicalBytes, dependency, context.now);
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

    await this.recordSequenceIfApplicable(envelope, familyId);
    const drained = await this.drainFamily(familyId, context);
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

  /**
   * `familyId` is always the caller's AUTHORITATIVE family identity
   * (context.familyId, or a pending record's already-authoritative
   * record.familyId), never envelope.familyId -- see submit()'s doc
   * comment above.
   */
  private async resolveDependency(envelope: FamilyEnvelope, familyId: OpaqueFamilyId): Promise<DependencyVerdict | null> {
    if (requiresCorrelationPredecessor(envelope.messageType) && envelope.correlationId !== null) {
      const predecessorAccepted =
        (await this.messageIdempotencyLedger.getAcceptedCanonicalBytes(familyId, envelope.correlationId)) !== null;
      if (!predecessorAccepted) {
        return { kind: 'HOLD', reason: 'MISSING_CORRELATION_PREDECESSOR', waitingOnMessageId: envelope.correlationId };
      }
    }
    if (this.options.isNumericSequenceSender(familyId, envelope.senderKeyId)) {
      const sequence = parseNumericSequence(envelope.sequenceOrNonce);
      if (sequence !== null) {
        const lastApplied = await this.sequenceLedger.getLastAppliedSequence(familyId, envelope.senderKeyId);
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

  private checkPendingCapacity(
    envelope: FamilyEnvelope,
    familyId: OpaqueFamilyId,
    canonicalBytes: string,
  ): 'PENDING_ENVELOPE_TOO_LARGE' | 'PENDING_SENDER_QUEUE_FULL' | 'PENDING_FAMILY_QUEUE_FULL' | 'PENDING_GLOBAL_QUEUE_FULL' | null {
    if (canonicalBytes.length > MAX_PENDING_CANONICAL_BYTES) return 'PENDING_ENVELOPE_TOO_LARGE';
    if (this.pendingStore.countForSender(familyId, envelope.senderKeyId) >= this.maxPendingPerSender) {
      return 'PENDING_SENDER_QUEUE_FULL';
    }
    if (this.pendingStore.countForFamily(familyId) >= this.maxPendingPerFamily) {
      return 'PENDING_FAMILY_QUEUE_FULL';
    }
    if (this.pendingStore.countGlobal() >= this.maxPendingGlobal) {
      return 'PENDING_GLOBAL_QUEUE_FULL';
    }
    return null;
  }

  private tryEnqueuePending(
    envelope: FamilyEnvelope,
    familyId: OpaqueFamilyId,
    canonicalBytes: string,
    dependency: Extract<DependencyVerdict, { kind: 'HOLD' }>,
    receivedAt: Date,
  ): 'PENDING_ENVELOPE_TOO_LARGE' | 'PENDING_SENDER_QUEUE_FULL' | 'PENDING_FAMILY_QUEUE_FULL' | 'PENDING_GLOBAL_QUEUE_FULL' | null {
    const capacityRejection = this.checkPendingCapacity(envelope, familyId, canonicalBytes);
    if (capacityRejection) return capacityRejection;
    const effectiveExpiresAt = new Date(
      Math.min(envelope.expiresAt.getTime(), receivedAt.getTime() + this.maxPendingLifetimeMs),
    );
    const record: PendingEnvelopeRecord = {
      familyId,
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
    // Re-check for a precise reason rather than a generic fallback -- a rare
    // TOCTOU window between the check above and this insert (another
    // concurrent submission growing the same bound in between) is the only
    // way `inserted` is false here; re-running the same check immediately
    // after names exactly which bound it was.
    return inserted ? null : (this.checkPendingCapacity(envelope, familyId, canonicalBytes) ?? 'PENDING_FAMILY_QUEUE_FULL');
  }

  private async recordSequenceIfApplicable(envelope: FamilyEnvelope, familyId: OpaqueFamilyId): Promise<void> {
    if (!this.options.isNumericSequenceSender(familyId, envelope.senderKeyId)) return;
    const sequence = parseNumericSequence(envelope.sequenceOrNonce);
    if (sequence !== null) await this.sequenceLedger.recordAppliedSequence(familyId, envelope.senderKeyId, sequence);
  }

  /**
   * Re-resolves ONE pending candidate against current ledger state: if its
   * dependency now resolves, removes it from the pending store and runs it
   * through the REAL (non-dry-run) security pipeline -- exactly the same
   * treatment a fresh submission gets, never a shortcut. If still blocked,
   * refreshes the stored record's dependency metadata (reason/waitingOn may
   * have advanced, e.g. a sequence gap narrowing) and leaves it queued.
   * Shared by drainFamily (family-wide sweep) and submitInternal's
   * identical-resubmission path, so both use one code path for "is this
   * candidate eligible now."
   */
  private async resolvePendingCandidate(record: PendingEnvelopeRecord, context: EnvelopeAcceptanceContext): Promise<SyncDecision> {
    // record.familyId is already the AUTHORITATIVE family identity (set
    // from context.familyId at enqueue time in tryEnqueuePending, never
    // envelope.familyId) -- reused here rather than context.familyId only
    // because resolvePendingCandidate is also called from drainFamily,
    // where the CURRENT context is for whichever envelope triggered the
    // drain, not necessarily this specific record's own original context.
    // Both are required to agree for this record to ever have been queued
    // at all (drainFamily only iterates one family's queue at a time), so
    // record.familyId and context.familyId are always equal in practice
    // here -- record.familyId is used as the unambiguous source of truth.
    const dependency = await this.resolveDependency(record.envelope, record.familyId);
    if (dependency === null) {
      this.pendingStore.remove(record.familyId, record.messageId);
      const verdict = await evaluateEnvelope(
        record.envelope,
        context,
        this.verifier,
        this.replayLedger,
        this.versionLedger,
        this.messageIdempotencyLedger,
      );
      if (verdict.accepted) {
        await this.recordSequenceIfApplicable(record.envelope, record.familyId);
        return { kind: 'APPLY_NOW', idempotent: verdict.idempotent };
      }
      return { kind: 'REJECT', reason: verdict.reason };
    }
    if (dependency.kind === 'REJECT') {
      this.pendingStore.remove(record.familyId, record.messageId);
      return { kind: 'REJECT', reason: dependency.reason };
    }
    this.pendingStore.insert({
      ...record,
      reason: dependency.reason,
      waitingOnMessageId: dependency.reason === 'MISSING_CORRELATION_PREDECESSOR' ? dependency.waitingOnMessageId : null,
      waitingOnSequence: dependency.reason === 'MISSING_SEQUENCE_PREDECESSOR' ? dependency.waitingOnSequence : null,
    });
    return {
      kind: 'HOLD_PENDING',
      reason: dependency.reason,
      ...(dependency.reason === 'MISSING_CORRELATION_PREDECESSOR'
        ? { waitingOnMessageId: dependency.waitingOnMessageId }
        : { waitingOnSequence: dependency.waitingOnSequence }),
    };
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
        const decision = await this.resolvePendingCandidate(record, context);
        if (decision.kind === 'HOLD_PENDING') continue; // no progress on this one this pass
        outcomes.push({ messageId: record.messageId, decision });
        progressed = true;
        break;
      }
    }
    return outcomes;
  }
}
