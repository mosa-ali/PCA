package org.pca.app.security

/**
 * Opaque local BLOB storage for device key material, by alias. Says
 * nothing about key GENERATION, purpose, or algorithm -- storage only.
 * Actual DSK/DEK key-pair generation (see [DeviceKeyPairGenerator]) is a
 * distinct, crypto-suite-gated concern. A concrete implementation's own
 * choice of AT-REST protection (e.g. Android-Keystore-backed AES-GCM,
 * matching doc 09 Section 7's "OS-backed key protection" requirement for
 * LOCAL storage) is not the family E2EE signature/AEAD/KDF suite
 * selection gated behind CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW --
 * that gate is about the DSK/DEK/FDEK construction itself (doc 09 Section
 * 3.1), not about how already-generated opaque key bytes are protected
 * once at rest on this device.
 */
interface SecureKeyStore {
    fun hasBlob(alias: String): Boolean
    fun storeBlob(alias: String, blobBase64: String)
    fun loadBlob(alias: String): String?
    fun deleteBlob(alias: String)
    fun aliases(): Set<String>
}

/** In-memory reference SecureKeyStore -- ordinary bookkeeping, not itself crypto-sensitive, real and usable for composition/dev builds, but NOT durable across process death and never a substitute for at-rest protection in a real device build. */
class InMemorySecureKeyStore : SecureKeyStore {
    private val blobs = mutableMapOf<String, String>()

    override fun hasBlob(alias: String): Boolean = blobs.containsKey(alias)
    override fun storeBlob(alias: String, blobBase64: String) { blobs[alias] = blobBase64 }
    override fun loadBlob(alias: String): String? = blobs[alias]
    override fun deleteBlob(alias: String) { blobs.remove(alias) }
    override fun aliases(): Set<String> = blobs.keys.toSet()
}
