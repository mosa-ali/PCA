import { createHash } from 'node:crypto';

// TEST-ONLY EnvelopeSignatureVerifier. Lives entirely under backend/test/
// -- excluded from the TypeScript build (tsconfig "include" is
// src/**/*.ts only), and nothing under backend/src/ imports from
// backend/test/, so it structurally cannot reach backend/dist/ or a
// production runtime.
//
// NOT a real signature scheme -- no asymmetric-key math, proves nothing
// about private-key possession. Exists only to exercise
// FamilyEnvelopeVerifier's acceptance logic (signature/replay/expiry/
// version-monotonicity/epoch checks) deterministically before a reviewed
// production EnvelopeSignatureVerifier is selected (CRYPTO_SUITE =
// WAITING_HUMAN_SECURITY_REVIEW, doc 09 PCA-DEC-020).
export function signTestOnlyEnvelope(publicKey, canonicalBytes) {
  return createHash('sha256').update(`${publicKey}:${canonicalBytes}`, 'utf8').digest('hex');
}

export function createTestOnlyEnvelopeSignatureVerifier() {
  return {
    async verify(publicKey, canonicalBytes, signature) {
      return signature === signTestOnlyEnvelope(publicKey, canonicalBytes);
    },
  };
}
