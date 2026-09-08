import type { DeviceSignatureVerifier } from '../deviceauth/DeviceSignatureVerifier.js';
import type { EnvelopeSignatureVerifier } from '../familyenvelope/EnvelopeSignatureVerifier.js';
import type { EnvelopeAcceptanceContext } from '../familyenvelope/FamilyEnvelopeVerifier.js';

/**
 * PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW.
 *
 * Neither `DeviceSignatureVerifier` (deviceauth) nor `EnvelopeSignatureVerifier`
 * (familyenvelope) has a reviewed concrete implementation anywhere in this
 * codebase yet -- both interfaces exist specifically so the surrounding
 * protocol can be built and tested now, with a real verifier substituted
 * later (see each interface's own doc comment, CRYPTO_SUITE =
 * WAITING_HUMAN_SECURITY_REVIEW, doc 09 PCA-DEC-020).
 *
 * These two verifiers are the PRODUCTION default this lane wires into
 * main.ts until that review happens: every verification attempt fails
 * closed (returns false), never open. This means device-session issuance
 * and inbound envelope acceptance are both, correctly, completely
 * non-functional in production today -- that is the honest state, not a
 * bug to work around. DO NOT replace these with a verifier that returns
 * `true`, a signature-format check without real cryptography, or any other
 * shortcut -- swapping in a reviewed concrete implementation is the only
 * correct fix, and is out of this lane's scope.
 */
export class RejectingDeviceSignatureVerifier implements DeviceSignatureVerifier {
  async verify(_publicKey: string, _message: string, _signature: string): Promise<boolean> {
    return false;
  }
}

export class RejectingEnvelopeSignatureVerifier implements EnvelopeSignatureVerifier {
  async verify(_publicKey: string, _canonicalBytes: string, _signature: string): Promise<boolean> {
    return false;
  }
}

/**
 * Epoch floor returned by rejectingResolveEnvelopeContext. No real envelope
 * can ever carry an epoch at or above Number.MAX_SAFE_INTEGER, so every
 * envelope evaluated against this context is rejected as
 * STALE_TRUST_SET_EPOCH before its signature is even examined.
 */
export const REJECTING_ENVELOPE_CONTEXT_EPOCH_FLOOR = Number.MAX_SAFE_INTEGER;

/**
 * PCA-FINAL-ASSESSMENT 2026-09-08 (FABLE-A007, closed structurally).
 *
 * Family-Trust-Set / key-epoch resolution (src/familytrustset) has no durable
 * production store yet, so production has no way to resolve a sender's public
 * key or the receiving family's current epoch floors. main.ts previously
 * wired a PLACEHOLDER here that returned an empty sender key with ZERO epoch
 * floors -- harmless only because RejectingEnvelopeSignatureVerifier rejects
 * everything, and a live anti-downgrade hole the moment a real verifier is
 * activated without a real resolver (an attacker could replay epoch-0
 * envelopes forever).
 *
 * This resolver is fail-closed BY CONSTRUCTION, independent of whichever
 * verifier is wired next to it: the epoch floors are unattainable, so
 * FamilyEnvelopeVerifier.evaluateEnvelope rejects every envelope with
 * STALE_TRUST_SET_EPOCH regardless of signature validity. Activating a
 * reviewed production crypto suite therefore also REQUIRES replacing this
 * resolver with a real FTS-backed one -- there is no longer a silent
 * placeholder that would let envelopes through by accident. Regression test:
 * test/runtime-sync/RejectingEnvelopeContextResolver.test.mjs.
 */
export function rejectingResolveEnvelopeContext(_senderKeyId: string, familyId: string, nowUtc: Date): EnvelopeAcceptanceContext {
  return {
    senderPublicKey: '',
    minimumAcceptedTrustSetEpoch: REJECTING_ENVELOPE_CONTEXT_EPOCH_FLOOR,
    minimumAcceptedKeyEpoch: REJECTING_ENVELOPE_CONTEXT_EPOCH_FLOOR,
    familyId,
    now: nowUtc,
  };
}
