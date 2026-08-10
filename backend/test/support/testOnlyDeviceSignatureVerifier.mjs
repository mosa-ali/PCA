import { createHash } from 'node:crypto';

// TEST-ONLY DeviceSignatureVerifier. This file lives entirely under
// backend/test/ -- it is not part of the TypeScript build (tsconfig's
// "include" is src/**/*.ts only) and nothing under backend/src/ imports
// from backend/test/, so it structurally cannot reach backend/dist/ or a
// production runtime.
//
// This is NOT a real signature scheme: it performs no asymmetric-key math
// and proves nothing about private-key possession. It exists only to
// exercise DeviceAuthService's challenge lifecycle (issue/verify/replay
// protection/expiry) deterministically before a reviewed production
// DeviceSignatureVerifier is selected (CRYPTO_SUITE =
// WAITING_HUMAN_SECURITY_REVIEW, doc 09 PCA-DEC-020). Use
// signTestOnlyChallenge to produce a "signature" this verifier accepts,
// and mutate the message/publicKey/signature independently in tests to
// prove rejection of each.
export function signTestOnlyChallenge(publicKey, message) {
  return createHash('sha256').update(`${publicKey}:${message}`, 'utf8').digest('hex');
}

export function createTestOnlyDeviceSignatureVerifier() {
  return {
    async verify(publicKey, message, signature) {
      return signature === signTestOnlyChallenge(publicKey, message);
    },
  };
}
