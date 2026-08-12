import type { DeviceSignatureVerifier } from '../deviceauth/DeviceSignatureVerifier.js';
import type { EnvelopeSignatureVerifier } from '../familyenvelope/EnvelopeSignatureVerifier.js';

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
