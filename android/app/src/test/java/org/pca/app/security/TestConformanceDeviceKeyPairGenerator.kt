package org.pca.app.security

import java.util.Base64

/**
 * TEST-ONLY. Lives under `src/test`, so it is never compiled into any production or androidTest
 * (device) artifact -- it exists solely so [org.pca.app.enrollment.EnrollmentCoordinator]'s
 * bootstrap flow can be exercised end to end in a JVM unit test without touching the real,
 * unreviewed [DeviceKeyPairGenerator]. Produces deterministic, correctly-shaped (43-char
 * base64url, matching a 32-byte key, no padding) public key strings and a fresh, unique alias per
 * call -- never a real cryptographic key pair, never referenced from `PcaAppGraph.kt` or any
 * other production composition file (grep-provable: `PcaAppGraph` only constructs
 * [NotApprovedDeviceKeyPairGenerator]).
 *
 * Uses `Base64.getUrlEncoder().withoutPadding()`, not the standard encoder -- confirmed against a
 * real live backend run that the standard encoder's occasional `+`/`/`/`=` characters fail the
 * backend's `isPlausiblePublicKey` base64url round-trip check (see [DeviceKeyPairGenerator]'s own
 * doc comment for the full explanation).
 */
class TestConformanceDeviceKeyPairGenerator(
    private val secureKeyStore: SecureKeyStore = InMemorySecureKeyStore(),
) : DeviceKeyPairGenerator {
    private var counter = 0

    override fun generateSigningKeyPair(): GeneratedKeyPair = generate("test-dsk")
    override fun generateEncryptionKeyPair(): GeneratedKeyPair = generate("test-dek")

    private fun generate(alias: String): GeneratedKeyPair {
        val uniqueAlias = "$alias-${counter++}"
        val fakeKeyBytes = ByteArray(32) { (uniqueAlias.hashCode() + it).toByte() }
        val publicKeyBase64 = Base64.getUrlEncoder().withoutPadding().encodeToString(fakeKeyBytes)
        secureKeyStore.storeBlob(uniqueAlias, "fake-private-key-material-for-tests-only")
        return GeneratedKeyPair(publicKeyBase64 = publicKeyBase64, privateKeyAlias = uniqueAlias)
    }
}
