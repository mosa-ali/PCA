import { canonicalizeEnvelope } from './canonicalize.js';
import { isProtocolCompatible } from './protocolCompatibility.js';
import { compareSemanticVersions, requiresStrictVersionIncrease } from './policy.js';
import type { DataVersionLedger } from './DataVersionLedger.js';
import type { EnvelopeSignatureVerifier } from './EnvelopeSignatureVerifier.js';
import type { MessageIdempotencyLedger } from './MessageIdempotencyLedger.js';
import type { ReplayLedger } from './ReplayLedger.js';
import type { FamilyEnvelope, OpaqueFamilyId } from './types.js';

export type EnvelopeRejectionReason =
  | 'UNSUPPORTED_PROTOCOL_MAJOR'
  | 'FAMILY_ID_MISMATCH'
  | 'MESSAGE_ID_CONFLICT'
  | 'EXPIRED'
  | 'STALE_TRUST_SET_EPOCH'
  | 'STALE_KEY_EPOCH'
  | 'REPLAYED'
  | 'VERSION_NOT_MONOTONIC'
  | 'INVALID_SIGNATURE';

export type EnvelopeVerdict =
  | { accepted: true; idempotent: boolean }
  | { accepted: false; reason: EnvelopeRejectionReason };

/**
 * HOLD-PENDING STATUS (PCA-11, backend/src/familysync/SyncCoordinator.ts):
 * doc 22 Section 5's "a future policy can wait for a signed predecessor
 * until expiry; it MUST NOT skip an intervening version" is now
 * implemented, but at the SYNCHRONIZATION-COORDINATOR layer, not inside
 * this module. This module's own version check immediately below
 * (requiresStrictVersionIncrease) is UNCHANGED and, taken alone, still
 * cannot detect a gap: any envelope whose semanticVersion is higher than
 * the current floor is still accepted as soon as evaluateEnvelope is
 * asked to evaluate it, because a version jump (1.0.0 -> 3.0.0 with
 * 1.x/2.x never issued) is always indistinguishable on the wire from "an
 * intermediate version was issued but is delayed in transit" -- doc 22
 * Section 3 gives POLICY_UPDATE no adjacency/predecessor field (unlike
 * FTS_UPDATE's `supersedesEpoch`), so semanticVersion alone can never
 * safely imply "hold this."
 *
 * What SyncCoordinator adds on top, without changing this module's own
 * behavior: it holds a candidate pending (never calling this function on
 * it) whenever it can detect, from OTHER already-accepted wire fields, a
 * genuine unresolved predecessor:
 *   1. `correlationId` adjacency, for message types the coordinator
 *      configures as correlation-dependent (PARENT_DECISION on its
 *      CHILD_REQUEST; RETENTION_RECEIPT on its RETENTION_DELETION_INSTRUCTION)
 *      -- held until an accepted envelope with messageId === correlationId
 *      exists, or the candidate expires.
 *   2. Opt-in numeric `sequenceOrNonce` adjacency, for a (familyId,
 *      senderKeyId) pair a caller has explicitly declared uses numeric
 *      sequence mode (see familysync/policy.ts's parseNumericSequence) --
 *      held whenever the parsed sequence number is more than one past the
 *      last applied sequence for that sender, of ANY messageType
 *      including POLICY_UPDATE, so a numeric-sequence sender's
 *      POLICY_UPDATE stream genuinely gets doc 22 Section 5's gap-hold
 *      behavior.
 * Every held candidate is re-run through this exact function (dryRun
 * screened first, then for real at drain) before ever being treated as
 * accepted -- a pending item is never pre-trusted.
 *
 * REMAINING, INHERENT PROTOCOL LIMITATION (not a missing feature -- a
 * wire-contract fact): a sender using an opaque `replayNonce` instead of
 * numeric `sequenceOrNonce`, sending a message type outside the
 * correlationId-dependent set, has NO adjacency signal on the wire at
 * all. No implementation at any layer can safely hold such a message
 * pending on "the message before it," because there is no way to express
 * what "before it" even means for an opaque nonce. That sender's
 * messages continue to use only this module's existing anti-downgrade
 * floor check (never moves backward, but can still skip forward) --
 * exactly the FAIL-SAFE-but-not-gap-filling behavior this constant used
 * to describe as the whole system's limitation. Fixing it fully would
 * require a new wire field (e.g. a sender-declared previous-version or
 * previous-messageId reference), which PCA-11's brief explicitly forbids
 * inventing unilaterally.
 */
export const OUT_OF_ORDER_HOLD_PENDING_IMPLEMENTED = true;

/**
 * Everything a receiving device needs to decide acceptance THAT THIS
 * MODULE DOES NOT OWN: `senderPublicKey` is resolved by the caller from
 * the Family Trust Set entry matching `envelope.senderKeyId` (FTS is a
 * separate workstream, src/familytrustset -- this module never looks one
 * up itself, and performs no sender-role authorization -- see
 * ReceiverPipeline.ts for the full pipeline shape including the stages
 * this module does not implement); `minimumAcceptedTrustSetEpoch`/
 * `minimumAcceptedKeyEpoch` are the receiving device's own current epoch
 * floor, also FTS-owned state.
 */
export interface EnvelopeAcceptanceContext {
  senderPublicKey: string;
  minimumAcceptedTrustSetEpoch: number;
  minimumAcceptedKeyEpoch: number;
  /**
   * PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY. The AUTHORITATIVE family
   * identity the caller has already established for this acceptance
   * decision (in production: the caller's device session -- see
   * backend/src/http/routes/runtimeSyncRoutes.ts's requireDeviceSession,
   * which resolves `request.runtimeSyncFamilyId` from a cryptographically
   * verified session token, never from client-supplied request data). This
   * is NEVER the same thing as `envelope.familyId`, which is merely a
   * self-declared field inside the (possibly forged) envelope the sender
   * supplied -- signed by the SENDER's own key, which says nothing about
   * whether that sender is authorized to submit on behalf of the family it
   * claims. evaluateEnvelope below rejects with FAMILY_ID_MISMATCH
   * whenever `envelope.familyId !== familyId`, and every ledger
   * lookup/write this module performs is keyed by THIS familyId, never
   * envelope.familyId -- so even if that check were ever bypassed by a
   * future caller, cross-family ledger state still cannot collide (see
   * ReplayLedger/DataVersionLedger/MessageIdempotencyLedger's own
   * family-scoping).
   */
  familyId: OpaqueFamilyId;
  now: Date;
}

/**
 * Implements doc 22 PCA-API-002's receiver-side envelope checks this
 * protocol-neutral layer owns (parse/schema bounds are parse.ts's job,
 * already assumed done by the time `envelope` reaches here): protocol
 * compatibility, message-id idempotency, anti-replay, expiry, trust/key
 * epoch, ANTI-DOWNGRADE semantic ordering (never move the version floor
 * backward -- see OUT_OF_ORDER_HOLD_PENDING_IMPLEMENTED above for the
 * one doc 22 Section 5 ordering behavior this does NOT yet implement:
 * holding a future version pending until an intervening gap is filled),
 * and signature verification. FTS/key lookup, sender-role authorization,
 * and payload decrypt/schema/authorization are NOT implemented here (see
 * ReceiverPipeline.ts) -- `context` receives their outputs (the resolved
 * key, the epoch floor) as trusted inputs.
 *
 * Every check below is independent (doc 09 PCA-SEC-022) -- failing ANY
 * one rejects the envelope; none are folded into a single combined
 * heuristic. Cheap, purely-local checks run before the comparatively
 * expensive signature-verification call so an obviously-bad envelope
 * never pays for it -- this bounds cost, it is not a shortcut around
 * checking the signature: every branch that does not return early still
 * reaches it.
 *
 * Ledger state (message-id idempotency, replay, semantic-version floor)
 * is advanced ONLY on full acceptance -- a rejected envelope, for any
 * reason, must never move any ledger forward, or a legitimate
 * retransmission/resubmission could become permanently unprocessable.
 *
 * MESSAGE-ID IDEMPOTENCY SHORT-CIRCUIT: if this exact messageId was
 * already fully accepted with BYTE-IDENTICAL canonical content, this
 * returns `{ accepted: true, idempotent: true }` immediately, without
 * re-running the remaining checks -- doc 22 Section 7's "valid signed
 * policy delivered twice -> exactly one application and stable receipt."
 * This is safe against forgery because `messageId` is itself part of the
 * signed canonical bytes (canonicalize.ts): an attacker cannot get a
 * DIFFERENT envelope accepted by reusing a stolen messageId, since any
 * change to the envelope changes its canonical bytes and therefore fails
 * the exact-match comparison, falling through to MESSAGE_ID_CONFLICT
 * instead of a short-circuited accept.
 *
 * SEMANTIC-VERSION LEDGER SCOPE: consulted/updated ONLY for
 * POLICY_UPDATE (strict increase enforced) and SIGNED_ROLLBACK (exempt
 * from the check, and its target version becomes the new floor on
 * acceptance -- doc 22 Section 6: "a rollback is a message type, not a
 * relaxed monotonicity check"). Every other message type never touches
 * this ledger -- their semanticVersion values live on an unrelated
 * timeline this ledger must not be polluted by.
 */
export interface EvaluateEnvelopeOptions {
  /**
   * MINIMAL, EXPLICITLY-RECORDED ADDITION for PCA-11 (backend/src/familysync):
   * runs every check below, INCLUDING signature verification, but skips the
   * three ledger-mutating side effects on acceptance (replayLedger.claimProcessed,
   * versionLedger.advancePolicyVersionIfNewer/recordAuthorizedRollbackVersion,
   * messageIdempotencyLedger.recordAccepted).
   * Lets a caller cheaply screen a candidate envelope (e.g. "is this pending
   * out-of-order envelope even legitimate before I spend bounded queue
   * capacity holding it") WITHOUT that screening itself counting as
   * acceptance -- the same envelope must still pass this function again,
   * with dryRun false/omitted, to actually be accepted. Defaults to false,
   * so every pre-existing call site (and its accept-side-effect guarantees)
   * is completely unchanged. This module's core acceptance semantics are
   * otherwise untouched by this addition.
   */
  dryRun?: boolean;
}

export async function evaluateEnvelope(
  envelope: FamilyEnvelope,
  context: EnvelopeAcceptanceContext,
  verifier: EnvelopeSignatureVerifier,
  replayLedger: ReplayLedger,
  versionLedger: DataVersionLedger,
  messageIdempotencyLedger: MessageIdempotencyLedger,
  options: EvaluateEnvelopeOptions = {},
): Promise<EnvelopeVerdict> {
  if (!isProtocolCompatible(envelope.protocolMajor)) {
    return { accepted: false, reason: 'UNSUPPORTED_PROTOCOL_MAJOR' };
  }

  // PCA-17C RUNTIME-SYNC-ACCEPTANCE-INTEGRITY: the envelope's OWN
  // self-declared familyId is untrusted sender input -- it is signed by the
  // SENDER's key, which proves who sent it, never which family it is
  // authorized to submit for. Checked cheaply, before any ledger I/O or
  // signature verification, and before the messageId-idempotency
  // short-circuit below (a forged-family envelope must never be able to
  // probe or short-circuit against another family's idempotency state).
  if (envelope.familyId !== context.familyId) {
    return { accepted: false, reason: 'FAMILY_ID_MISMATCH' };
  }

  const canonicalBytes = canonicalizeEnvelope(envelope);
  const priorAccepted = await messageIdempotencyLedger.getAcceptedCanonicalBytes(context.familyId, envelope.messageId);
  if (priorAccepted !== null) {
    if (priorAccepted === canonicalBytes) {
      return { accepted: true, idempotent: true };
    }
    return { accepted: false, reason: 'MESSAGE_ID_CONFLICT' };
  }

  if (context.now.getTime() >= envelope.expiresAt.getTime()) {
    return { accepted: false, reason: 'EXPIRED' };
  }
  if (envelope.trustSetEpoch < context.minimumAcceptedTrustSetEpoch) {
    return { accepted: false, reason: 'STALE_TRUST_SET_EPOCH' };
  }
  if (envelope.keyEpoch < context.minimumAcceptedKeyEpoch) {
    return { accepted: false, reason: 'STALE_KEY_EPOCH' };
  }
  if (await replayLedger.hasProcessed(context.familyId, envelope.senderKeyId, envelope.sequenceOrNonce)) {
    return { accepted: false, reason: 'REPLAYED' };
  }
  if (requiresStrictVersionIncrease(envelope.messageType)) {
    const lastVersion = await versionLedger.getLastAcceptedVersion(context.familyId, envelope.senderKeyId);
    if (lastVersion !== null && compareSemanticVersions(envelope.semanticVersion, lastVersion) <= 0) {
      return { accepted: false, reason: 'VERSION_NOT_MONOTONIC' };
    }
  }

  const validSignature = await verifier.verify(context.senderPublicKey, canonicalBytes, envelope.signature);
  if (!validSignature) {
    return { accepted: false, reason: 'INVALID_SIGNATURE' };
  }

  if (options.dryRun) {
    return { accepted: true, idempotent: false };
  }

  // PCA-17E ACCEPTANCE-ORDERING (REPLAY_MULTI_INSTANCE_TOCTOU /
  // POLICY_VERSION_MULTI_INSTANCE_TOCTOU): the message-idempotency claim
  // is still attempted FIRST (unchanged from PCA-17C, see below), but the
  // replay claim and version CAS that follow are now themselves genuinely
  // atomic per-ledger operations (claimProcessed / advancePolicyVersionIfNewer),
  // not the old check-then-act hasProcessed/recordProcessed and
  // read-then-unconditionally-set pair. A rejected race LOSER must not
  // leave any of these three ledgers in a state that would incorrectly
  // affect a FUTURE, genuinely legitimate submission -- so every claim
  // this call itself wins is explicitly released (compensating undo, a
  // saga, not a single cross-ledger DB transaction -- each ledger's own
  // atomicity guarantee is per-ledger, exactly as
  // MessageIdempotencyLedger.ts's interface doc already required before
  // this lane) the moment a LATER step in this same sequence determines
  // the envelope must, after all, be rejected. Ordering:
  //
  //  1. messageIdempotencyLedger.recordAccepted -- unchanged from PCA-17C
  //     (see its own doc comment below): arbitrates the cross-instance
  //     SAME-messageId race. 'conflict' rejects immediately (nothing was
  //     written by us to undo). 'already-idempotent' means a concurrent
  //     winner ALREADY fully accepted this exact envelope (replay + any
  //     version write already recorded by THAT winner) -- this call must
  //     not re-claim replay/version on the winner's behalf, so it returns
  //     immediately as a safe accept.
  //  2. replayLedger.claimProcessed -- only reached once this call is the
  //     durable winner of step 1 ('recorded'). 'already-claimed' means a
  //     DIFFERENT envelope (necessarily a different messageId, since this
  //     messageId's idempotency claim just succeeded) already won this
  //     exact (senderKeyId, sequenceOrNonce) slot -- a genuine replay/
  //     collision. This call must release its own just-won idempotency
  //     row before rejecting, or a future legitimate retry of THIS
  //     messageId would incorrectly short-circuit to a stable accept for
  //     an envelope that was actually rejected as replayed.
  //  3. versionLedger.advancePolicyVersionIfNewer -- only reached for
  //     POLICY_UPDATE, once both prior claims are durably ours. 'stale'
  //     means a concurrent winner already advanced the floor past this
  //     envelope's version between this module's early, non-authoritative
  //     monotonicity pre-check (above) and this atomic CAS -- this call
  //     must release BOTH prior claims before rejecting.
  //
  // SIGNED_ROLLBACK never reaches step 3's CAS (see
  // recordAuthorizedRollbackVersion's own doc comment: it is exempt from
  // monotonicity entirely and always succeeds), so it has nothing to
  // compensate for.
  const recordResult = await messageIdempotencyLedger.recordAccepted(context.familyId, envelope.messageId, canonicalBytes);
  if (recordResult.outcome === 'conflict') {
    return { accepted: false, reason: 'MESSAGE_ID_CONFLICT' };
  }
  if (recordResult.outcome === 'already-idempotent') {
    return { accepted: true, idempotent: true };
  }

  const replayClaim = await replayLedger.claimProcessed(context.familyId, envelope.senderKeyId, envelope.sequenceOrNonce);
  if (replayClaim === 'already-claimed') {
    await messageIdempotencyLedger.releaseAccepted(context.familyId, envelope.messageId);
    return { accepted: false, reason: 'REPLAYED' };
  }

  if (envelope.messageType === 'POLICY_UPDATE') {
    const versionResult = await versionLedger.advancePolicyVersionIfNewer(context.familyId, envelope.senderKeyId, envelope.semanticVersion);
    if (versionResult === 'stale') {
      await replayLedger.releaseClaim(context.familyId, envelope.senderKeyId, envelope.sequenceOrNonce);
      await messageIdempotencyLedger.releaseAccepted(context.familyId, envelope.messageId);
      return { accepted: false, reason: 'VERSION_NOT_MONOTONIC' };
    }
  } else if (envelope.messageType === 'SIGNED_ROLLBACK') {
    await versionLedger.recordAuthorizedRollbackVersion(context.familyId, envelope.senderKeyId, envelope.semanticVersion);
  }

  return { accepted: true, idempotent: false };
}
