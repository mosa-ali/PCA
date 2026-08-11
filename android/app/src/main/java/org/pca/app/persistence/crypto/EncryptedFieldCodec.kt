package org.pca.app.persistence.crypto

import android.util.Base64

/**
 * Room columns store encrypted values as Base64 text (not raw `ByteArray`)
 * so entities stay plain `data class`es with correct generated
 * `equals`/`hashCode` -- `ByteArray` columns would need hand-written
 * structural equality everywhere, which is easy to get wrong across 15+
 * entities and easy to silently regress.
 */
fun EncryptedField.toColumns(): Pair<String, String> =
    Base64.encodeToString(ciphertext, Base64.NO_WRAP) to Base64.encodeToString(iv, Base64.NO_WRAP)

fun encryptedFieldOf(ciphertextB64: String, ivB64: String): EncryptedField = EncryptedField(
    ciphertext = Base64.decode(ciphertextB64, Base64.NO_WRAP),
    iv = Base64.decode(ivB64, Base64.NO_WRAP),
)

fun LocalRecordCipher.encryptToColumns(plaintext: String): Pair<String, String> = encrypt(plaintext).toColumns()

fun LocalRecordCipher.decryptFromColumns(ciphertextB64: String, ivB64: String): String =
    decrypt(encryptedFieldOf(ciphertextB64, ivB64))

fun LocalRecordCipher.encryptToColumnsOrNull(plaintext: String?): Pair<String, String>? =
    plaintext?.let { encryptToColumns(it) }

fun LocalRecordCipher.decryptFromColumnsOrNull(ciphertextB64: String?, ivB64: String?): String? =
    if (ciphertextB64 == null || ivB64 == null) null else decryptFromColumns(ciphertextB64, ivB64)
