package org.pca.app.persistence.crypto

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Reference [LocalRecordCipher] for plain-JVM unit tests that cannot reach
 * AndroidKeyStore (e.g. `testDebugUnitTest` without Robolectric's keystore
 * shadow). Uses a real AES/GCM cipher so round-trip and tamper-detection
 * behavior matches production, but the key lives only in process memory and
 * is regenerated every instance -- MUST NOT be used for real family data
 * (mirrors this codebase's existing `InMemoryEncryptedVault` /
 * `InMemorySecureKeyStore` reference-implementation pattern).
 */
class InMemoryLocalRecordCipher : LocalRecordCipher {
    private val secretKey: SecretKey = KeyGenerator.getInstance("AES").apply {
        init(256, SecureRandom())
    }.generateKey()

    override fun encrypt(plaintext: String): EncryptedField {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return EncryptedField(ciphertext = ciphertext, iv = cipher.iv)
    }

    override fun decrypt(field: EncryptedField): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH_BITS, field.iv))
        return String(cipher.doFinal(field.ciphertext), Charsets.UTF_8)
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_LENGTH_BITS = 128
    }
}
