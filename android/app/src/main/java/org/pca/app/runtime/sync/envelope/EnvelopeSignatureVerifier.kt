package org.pca.app.runtime.sync.envelope

/**
 * Mirrors backend/src/familyenvelope/EnvelopeSignatureVerifier.ts's
 * interface exactly (doc 40 Section 7). NO concrete signature algorithm is
 * selected or implemented anywhere behind this interface -- production
 * suite selection is gated behind
 *
 *     PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW
 *
 * (doc 09 Section 3.1/3.6, PCA-DEC-020). `publicKey` is always the
 * sender's registered DSK.
 */
interface EnvelopeSignatureVerifier {
    suspend fun verify(publicKey: String, canonicalBytes: String, signature: String): Boolean
}

/**
 * The shipped default: fails CLOSED, never open. Every verification
 * attempt returns false until a reviewed concrete implementation replaces
 * this. Do not replace with a verifier that returns true, a format-only
 * check, or any other shortcut -- see doc 40 Section 7/10 and
 * backend/src/runtime-sync/RejectingCryptoVerifiers.ts for the identical
 * posture on the backend side.
 */
class RejectingEnvelopeSignatureVerifier : EnvelopeSignatureVerifier {
    override suspend fun verify(publicKey: String, canonicalBytes: String, signature: String): Boolean = false
}
