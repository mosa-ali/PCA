package org.pca.app.storage

/**
 * Encrypted local vault for family-scoped structured records (e.g. a
 * locally-cached, already-decrypted view of family policy/state this
 * device is authoritative for). This is a DIFFERENT concern from
 * [org.pca.app.foundation.PersistentStateStore] (generic key-value) and
 * [org.pca.app.security.SecureKeyStore] (opaque key blobs) -- the vault
 * is where structured application records live once this device has
 * already decrypted them under its own FDEK (a concern this module does
 * not implement -- FDEK construction is gated behind CRYPTO_SUITE =
 * WAITING_HUMAN_SECURITY_REVIEW, doc 09 Section 3.1). This interface only
 * defines the local storage contract; it never performs decryption
 * itself and never receives ciphertext directly -- callers hand it
 * already-plaintext records to protect at rest (doc 09 Section 7).
 */
interface EncryptedVault {
    fun getRecord(key: String): String?
    fun putRecord(key: String, value: String)
    fun deleteRecord(key: String)
    fun allKeys(): Set<String>
    /** Irreversibly erases every record -- e.g. on family departure/device revocation/factory-reset-equivalent local wipe. */
    fun wipe()
}

/** In-memory reference EncryptedVault -- ordinary bookkeeping, real and usable for composition/dev builds, NOT durable and NOT a substitute for at-rest protection in a real device build. */
class InMemoryEncryptedVault : EncryptedVault {
    private val records = mutableMapOf<String, String>()

    override fun getRecord(key: String): String? = records[key]
    override fun putRecord(key: String, value: String) { records[key] = value }
    override fun deleteRecord(key: String) { records.remove(key) }
    override fun allKeys(): Set<String> = records.keys.toSet()
    override fun wipe() { records.clear() }
}
