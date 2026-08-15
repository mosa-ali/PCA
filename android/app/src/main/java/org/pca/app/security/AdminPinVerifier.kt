package org.pca.app.security

/**
 * Local, OFFLINE Admin PIN verification boundary. The PIN itself and any
 * derived verifier MUST NEVER leave this device -- never transmitted to
 * the backend, never included in any family envelope. This is a
 * LOCAL-DEVICE administrative gate only (e.g. "confirm before disabling
 * enforcement locally" or "confirm before leaving Standard Mode
 * settings"), never a family E2EE authority mechanism, and never a
 * substitute for FTS-authorized signing -- entering the correct PIN on
 * this device grants no family-wide authority whatsoever, only a local UI
 * gate on this device's own enforcement behavior.
 *
 * Verifier construction: hashing/storing/verifying a LOCAL PIN via a
 * standard, platform/JDK-provided KDF is NOT the same concern as the
 * family E2EE key hierarchy/signature suite gated behind CRYPTO_SUITE =
 * WAITING_HUMAN_SECURITY_REVIEW (doc 09 PCA-SEC-016 prohibits a custom/
 * home-grown construction for THAT suite -- DSK/DEK/FDEK envelope crypto,
 * doc 09 Section 3.1). See [Pbkdf2AdminPinVerifier]'s doc comment for the
 * full reasoning and [ThrottledAdminPinVerifier] for the production
 * composition (KDF verify + rate-limiting/progressive delay). Only the
 * family-envelope signing/verification half (unrelated to this interface)
 * remains fail-closed pending that review.
 *
 * `CharArray`, not `String`, for PIN material: a String is interned and
 * immutable for the life of the JVM/process, so it cannot be reliably
 * zeroed from memory after use; a CharArray can be explicitly cleared by
 * the caller once verification completes.
 */
interface AdminPinVerifier {
    fun isPinSet(): Boolean
    fun verify(candidatePin: CharArray): Boolean
    fun setPin(newPin: CharArray)
    fun clearPin()
}
