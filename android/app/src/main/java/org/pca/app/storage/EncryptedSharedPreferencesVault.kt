package org.pca.app.storage

import android.content.Context
import org.pca.app.foundation.EncryptedSharedPreferencesStateStore

/**
 * EncryptedVault backed by EncryptedSharedPreferences -- see
 * [EncryptedSharedPreferencesStateStore] for the at-rest protection
 * rationale (doc 09 Section 7), which applies identically here. Tracks
 * its own key index the same way [org.pca.app.security.EncryptedBlobSecureKeyStore]
 * does, since EncryptedSharedPreferences exposes no directory-listing API
 * over its (encrypted) key names.
 */
class EncryptedSharedPreferencesVault(
    context: Context,
    fileName: String = "pca_encrypted_vault",
) : EncryptedVault {
    private val store = EncryptedSharedPreferencesStateStore(context, fileName)

    override fun getRecord(key: String): String? = store.getString(recordKey(key))

    override fun putRecord(key: String, value: String) {
        store.putString(recordKey(key), value)
        store.putString(KEY_INDEX_KEY, (currentKeys() + key).joinToString(","))
    }

    override fun deleteRecord(key: String) {
        store.remove(recordKey(key))
        store.putString(KEY_INDEX_KEY, (currentKeys() - key).joinToString(","))
    }

    override fun allKeys(): Set<String> = currentKeys()

    override fun wipe() {
        store.clear()
    }

    private fun currentKeys(): Set<String> =
        store.getString(KEY_INDEX_KEY)?.split(",")?.filter { it.isNotEmpty() }?.toSet() ?: emptySet()

    private fun recordKey(key: String) = "record:$key"

    private companion object {
        const val KEY_INDEX_KEY = "__keys__"
    }
}
