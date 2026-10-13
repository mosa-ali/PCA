package org.pca.app.security

import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.atomic.AtomicLong

/**
 * TEST-ONLY. Lives under `src/test`, so it is never compiled into any production or androidTest
 * (device) artifact -- it exists solely so [org.pca.app.enrollment.EnrollmentCoordinator]'s
 * bootstrap flow can be exercised end to end in a JVM unit test without touching the real
 * hardware-backed [AndroidKeystoreDskProvider]. Produces deterministic, correctly-shaped (43-char
 * base64url, matching a 32-byte key, no padding) public key strings and canonical attempt-bound
 * aliases -- never a real cryptographic key pair, never referenced from `PcaAppGraph.kt` or any
 * other production composition file (pinned by the static scans in EnrollmentStaticScanTest and
 * FirstDeviceStaticScanTest).
 *
 * Uses `Base64.getUrlEncoder().withoutPadding()`, not the standard encoder -- confirmed against a
 * real live backend run that the standard encoder's occasional `+`/`/`/`=` characters fail the
 * backend's `isPlausiblePublicKey` base64url round-trip check (see [DeviceKeyPairGenerator]'s own
 * doc comment for the full explanation).
 */
class TestConformanceDeviceKeyPairGenerator(
    private val secureKeyStore: SecureKeyStore = InMemorySecureKeyStore(),
) : DeviceKeyPairGenerator {
    private val counter = AtomicLong(0)

    override fun generateSigningKeyPair(attemptId: String): GeneratedKeyPair = generate("pca.dsk", attemptId)
    override fun generateEncryptionKeyPair(attemptId: String): GeneratedKeyPair = generate("pca.dek", attemptId)

    private fun generate(alias: String, attemptId: String): GeneratedKeyPair {
        val canonicalAlias = "$alias.$attemptId"
        // Mix the complete alias and a thread-safe generation ordinal through a full-width
        // digest. The previous String.hashCode()+counter byte pattern collided whenever the
        // low byte of two alias hashes differed by the counter delta (which made the two-device
        // fingerprint regression probabilistically flaky).
        val seed = "$canonicalAlias\u0000${counter.getAndIncrement()}"
        val fakeKeyBytes = MessageDigest.getInstance("SHA-256").digest(seed.toByteArray(Charsets.UTF_8))
        val publicKeyBase64 = Base64.getUrlEncoder().withoutPadding().encodeToString(fakeKeyBytes)
        secureKeyStore.storeBlob(canonicalAlias, "fake-private-key-material-for-tests-only")
        return GeneratedKeyPair(publicKeyBase64 = publicKeyBase64, privateKeyAlias = canonicalAlias)
    }
}
