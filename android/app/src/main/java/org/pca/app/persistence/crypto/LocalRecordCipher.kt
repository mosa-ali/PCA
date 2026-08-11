package org.pca.app.persistence.crypto

/**
 * Ciphertext + IV pair for one encrypted Room column, plus the encoded
 * plaintext byte length so callers can size-check without decrypting
 * (PCA-LOCAL-DB-1 Section 8). Room stores [ciphertext]/[iv] as native BLOB
 * columns -- no Room TypeConverter indirection needed.
 */
data class EncryptedField(
    val ciphertext: ByteArray,
    val iv: ByteArray,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is EncryptedField) return false
        return ciphertext.contentEquals(other.ciphertext) && iv.contentEquals(other.iv)
    }

    override fun hashCode(): Int = 31 * ciphertext.contentHashCode() + iv.contentHashCode()
}

/**
 * Encryption-at-rest boundary for individual sensitive Room field values
 * (PCA-LOCAL-DB-1 Section 8; doc 10 Section 13 PCA-DEC-022 option (b)).
 *
 * This is application-level field encryption backed by Android Keystore key
 * material -- deliberately NOT a claim on PRODUCTION_CRYPTO_SUITE (doc 09
 * Section 3's family E2EE key hierarchy remains
 * CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW). [LocalRecordCipher] only
 * protects this device's own local Room database file against extraction
 * (e.g. rooted-device file copy, backup exfiltration) using standard
 * platform cryptography (AES/GCM via AndroidKeyStore) -- it makes no
 * multi-party/E2EE claim and does not require human security review to
 * exist, but the CRYPTO_SUITE gate is unaffected by it.
 */
interface LocalRecordCipher {
    fun encrypt(plaintext: String): EncryptedField
    fun decrypt(field: EncryptedField): String

    /** Convenience null-safe wrapper for optional sensitive fields. */
    fun encryptOrNull(plaintext: String?): EncryptedField? = plaintext?.let(::encrypt)

    fun decryptOrNull(field: EncryptedField?): String? = field?.let(::decrypt)
}
