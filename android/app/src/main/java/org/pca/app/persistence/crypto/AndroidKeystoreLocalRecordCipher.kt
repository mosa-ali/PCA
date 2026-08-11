package org.pca.app.persistence.crypto

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Production [LocalRecordCipher]: AES/GCM/NoPadding with a non-exportable
 * key generated inside AndroidKeyStore (PCA-LOCAL-DB-1 Section 8/9). The raw
 * key material never leaves the secure keystore process boundary and is
 * never written to Room, SharedPreferences, or any file this app controls --
 * only opaque ciphertext+IV pairs are persisted.
 *
 * No hard-coded key, no key in SharedPreferences plaintext (Section 9).
 */
class AndroidKeystoreLocalRecordCipher(
    private val keyAlias: String = DEFAULT_KEY_ALIAS,
) : LocalRecordCipher {

    private val keyStore: KeyStore by lazy {
        KeyStore.getInstance(ANDROID_KEYSTORE_PROVIDER).apply { load(null) }
    }

    private val secretKey: SecretKey by lazy { loadOrCreateKey() }

    override fun encrypt(plaintext: String): EncryptedField {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return EncryptedField(ciphertext = ciphertext, iv = cipher.iv)
    }

    override fun decrypt(field: EncryptedField): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        val spec = GCMParameterSpec(GCM_TAG_LENGTH_BITS, field.iv)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)
        val plaintext = cipher.doFinal(field.ciphertext)
        return String(plaintext, Charsets.UTF_8)
    }

    private fun loadOrCreateKey(): SecretKey {
        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }

        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEYSTORE_PROVIDER,
        )
        val spec = KeyGenParameterSpec.Builder(
            keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(KEY_SIZE_BITS)
            // Family E2EE authentication (doc 09) is a separate concern from
            // this local-at-rest boundary -- no user-authentication gate is
            // applied here, matching EncryptedSharedPreferencesStateStore's
            // always-available local-storage baseline.
            .setRandomizedEncryptionRequired(true)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    private companion object {
        const val DEFAULT_KEY_ALIAS = "pca_local_record_cipher_key_v1"
        const val ANDROID_KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_LENGTH_BITS = 128
        const val KEY_SIZE_BITS = 256
    }
}
