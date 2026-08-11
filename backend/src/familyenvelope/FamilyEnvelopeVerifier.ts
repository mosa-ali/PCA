import { canonicalizeEnvelope } from './canonicalize.js';
import { isProtocolCompatible } from './protocolCompatibility.js';
import { compareSemanticVersions, requiresStrictVersionIncrease } from './policy.js';
import type { DataVersionLedger } from './DataVersionLedger.js';
import type { EnvelopeSignatureVerifier } from './EnvelopeSignatureVerifier.js';
import type { MessageIdempotencyLedger } from './MessageIdempotencyLedger.js';
import type { ReplayLedger } from './ReplayLedger.js';
import type { FamilyEnvelope } from './types.js';

export type EnvelopeRejectionReason =
  | 'UNSUPPORTED_PROTOCOL_MAJOR'
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
 * HONEST CAPABILITY DISCLOSURE (do not remove without genuinely
 * implementing the missing behavior below): doc 22 Section 5 requires
 * "a future policy can wait for a signed predecessor until expiry; it
 * MUST NOT skip an intervening version," with an explicit Section 7
 * contract-test row ("offline child receives ordered N+2 before N+1 ->
 * holds pending until predecessor/expiry; never skips state"). This
 * module does NOT implement that hold-pending/gap-fill behavior: the
 * version check below (requiresStrictVersionIncrease) only enforces
 * "never move the floor backward or sideways" -- any envelope whose
 * semanticVersion is HIGHER than the current floor is accepted
 * immediately and becomes the new floor, even if an intermediate
 * version (e.g. floor=1.0.0, candidate=3.0.0) exists and simply hasn't
 * arrived yet. When that intermediate version (2.0.0) later arrives, it
 * is safely and correctly rejected as VERSION_NOT_MONOTONIC forever --
 * so this gap is FAIL-SAFE (a receiver never applies something out of
 * order, never double-applies, never corrupts its floor) but NOT
 * FEATURE-COMPLETE (the skipped intermediate version's content is never
 * applied, where doc 22 wants it queued and applied once its gap is
 * filled).
 *
 * Why this is disclosed rather than "fixed" in this slice: doc 22
 * Section 3's wire contract gives POLICY_UPDATE no adjacency/predecessor
 * field (unlike FTS_UPDATE's `supersedesEpoch`) -- semanticVersion is an
 * arbitrary dotted-triple a sender may legitimately jump across (e.g.
 * 1.0.0 -> 1.5.0 with 1.1-1.4 never issued is valid, indistinguishable
 * on the wire from "1.1-1.4 were issued but delayed in transit"). A
 * correct gap-detection/hold-pending implementation needs either a
 * sender-declared "previous version" field this wire contract doesn't
 * have, or must be built on `sequenceOrNonce` adjacency instead (only
 * when a sender opts into numeric senderSequence mode rather than an
 * opaque replayNonce) -- a genuinely different, larger feature (a bounded
 * per-sender pending-envelope queue with its own drain/expiry logic and
 * a changed evaluateEnvelope return contract, since a caller would need
 * to learn about newly-unblocked pending envelopes, not just the one it
 * just submitted). Building that correctly needs its own dedicated,
 * reviewed slice rather than a rushed addition here.
 */
export const OUT_OF_ORDER_HOLD_PENDING_IMPLEMENTED = false;

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
export async function evaluateEnvelope(
  envelope: FamilyEnvelope,
  context: EnvelopeAcceptanceContext,
  verifier: EnvelopeSignatureVerifier,
  replayLedger: ReplayLedger,
  versionLedger: DataVersionLedger,
  messageIdempotencyLedger: MessageIdempotencyLedger,
): Promise<EnvelopeVerdict> {
  if (!isProtocolCompatible(envelope.protocolMajor)) {
    return { accepted: false, reason: 'UNSUPPORTED_PROTOCOL_MAJOR' };
  }

  const canonicalBytes = canonicalizeEnvelope(envelope);
  const priorAccepted = messageIdempotencyLedger.getAcceptedCanonicalBytes(envelope.messageId);
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
  if (replayLedger.hasProcessed(envelope.senderKeyId, envelope.sequenceOrNonce)) {
    return { accepted: false, reason: 'REPLAYED' };
  }
  if (requiresStrictVersionIncrease(envelope.messageType)) {
    const lastVersion = versionLedger.getLastAcceptedVersion(envelope.senderKeyId);
    if (lastVersion !== null && compareSemanticVersions(envelope.semanticVersion, lastVersion) <= 0) {
      return { accepted: false, reason: 'VERSION_NOT_MONOTONIC' };
    }
  }

  const validSignature = await verifier.verify(context.senderPublicKey, canonicalBytes, envelope.signature);
  if (!validSignature) {
    return { accepted: false, reason: 'INVALID_SIGNATURE' };
  }

  replayLedger.recordProcessed(envelope.senderKeyId, envelope.sequenceOrNonce);
  if (envelope.messageType === 'POLICY_UPDATE' || envelope.messageType === 'SIGNED_ROLLBACK') {
    versionLedger.recordAcceptedVersion(envelope.senderKeyId, envelope.semanticVersion);
  }
  messageIdempotencyLedger.recordAccepted(envelope.messageId, canonicalBytes);

  return { accepted: true, idempotent: false };
}
