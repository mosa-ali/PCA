package org.pca.app.security

/**
 * Generates a device's Signing Key pair (DSK) or Encryption/Key-Agreement
 * Key pair (DEK) -- doc 09 Section 3.1. DSK and DEK are always distinct
 * roles and MUST be generated as separate key pairs, never derived from
 * one another or reused across roles (mirrors the DSK/DEK role separation
 * already enforced server-side, backend/src/device and
 * backend/src/deviceauth).
 *
 * NO concrete signature/KEM algorithm is selected or implemented anywhere
 * behind this interface. Production suite selection (curve choice, KEM
 * construction) is gated behind CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW
 * (doc 09 Section 3.1/3.6). This interface exists so the rest of the
 * enrollment/pairing client flow can be built and tested now, with a
 * reviewed concrete generator substituted later without touching callers.
 *
 * The private key is NEVER returned as raw bytes -- only a public key
 * (opaque, base64-encoded, the only thing ever transmitted to the
 * backend/relay per doc 09 Section 5.1's "public keys ... not sensitive
 * on their own") and a [SecureKeyStore] alias referencing where the
 * private key material lives. A concrete implementation backed by
 * hardware-backed Android Keystore may never be ABLE to export the
 * private key at all, by platform design -- this interface's shape does
 * not assume otherwise.
 */
interface DeviceKeyPairGenerator {
    fun generateSigningKeyPair(): GeneratedKeyPair
    fun generateEncryptionKeyPair(): GeneratedKeyPair
}

data class GeneratedKeyPair(
    val publicKeyBase64: String,
    val privateKeyAlias: String,
)
