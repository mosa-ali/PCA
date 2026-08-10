import { canonicalizeEnvelope } from './canonicalize.js';
import type { DataVersionLedger } from './DataVersionLedger.js';
import type { EnvelopeSignatureVerifier } from './EnvelopeSignatureVerifier.js';
import type { ReplayLedger } from './ReplayLedger.js';
import type { FamilyEnvelope } from './types.js';

export type EnvelopeRejectionReason =
  | 'EXPIRED'
  | 'STALE_TRUST_SET_EPOCH'
  | 'STALE_KEY_EPOCH'
  | 'REPLAYED'
  | 'VERSION_NOT_MONOTONIC'
  | 'INVALID_SIGNATURE';

export type EnvelopeVerdict = { accepted: true } | { accepted: false; reason: EnvelopeRejectionReason };

/**
 * Everything a receiving device needs to decide acceptance THAT THIS
 * MODULE DOES NOT OWN: `senderPublicKey` is resolved by the caller from
 * the Family Trust Set entry matching `envelope.senderKeyId` (FTS is a
 * separate, later workstream -- this module never looks one up itself);
 * `minimumAcceptedTrustSetEpoch`/`minimumAcceptedKeyEpoch` are the
 * receiving device's own current epoch floor, also FTS-owned state.
 */
export interface EnvelopeAcceptanceContext {
  senderPublicKey: string;
  minimumAcceptedTrustSetEpoch: number;
  minimumAcceptedKeyEpoch: number;
  now: Date;
}

/**
 * Implements doc 09 PCA-SEC-022: a receiving device MUST reject an
 * envelope that fails ANY of signature verification, sequence/nonce
 * replay, expiry, or version-monotonicity -- each is checked
 * independently below, never folded into one combined boolean. The
 * trustSetEpoch/keyEpoch staleness checks (Section 4) are additional,
 * also-independent checks.
 *
 * Assumes `envelope` already passed structural validation (see
 * parseFamilyEnvelope) -- this function only performs the semantic
 * acceptance checks.
 *
 * Ledger state (replay, last-accepted version) is advanced ONLY on full
 * acceptance -- a rejected envelope, for any reason, must never move
 * either ledger forward, or a legitimate retransmission could become
 * permanently unprocessable.
 */
export async function evaluateEnvelope(
  envelope: FamilyEnvelope,
  context: EnvelopeAcceptanceContext,
  verifier: EnvelopeSignatureVerifier,
  replayLedger: ReplayLedger,
  versionLedger: DataVersionLedger,
): Promise<EnvelopeVerdict> {
  // Cheap, purely-local checks first, so an obviously-bad envelope never
  // pays for the (comparatively expensive) signature-verification call --
  // this bounds cost, it is not a shortcut around checking the signature:
  // every branch below that does not return early still reaches it.
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
  if (envelope.messageType !== 'ROLLBACK') {
    const lastVersion = versionLedger.getLastAcceptedVersion(envelope.senderKeyId);
    if (lastVersion !== null && envelope.dataVersion <= lastVersion) {
      return { accepted: false, reason: 'VERSION_NOT_MONOTONIC' };
    }
  }

  const canonicalBytes = canonicalizeEnvelope(envelope);
  const validSignature = await verifier.verify(context.senderPublicKey, canonicalBytes, envelope.signature);
  if (!validSignature) {
    return { accepted: false, reason: 'INVALID_SIGNATURE' };
  }

  replayLedger.recordProcessed(envelope.senderKeyId, envelope.sequenceOrNonce);
  versionLedger.recordAcceptedVersion(envelope.senderKeyId, envelope.dataVersion);

  return { accepted: true };
}
