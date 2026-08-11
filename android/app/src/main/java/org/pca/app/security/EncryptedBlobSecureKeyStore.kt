package org.pca.app.security

import android.content.Context
import org.pca.app.foundation.EncryptedSharedPreferencesStateStore

/**
 * SecureKeyStore backed by EncryptedSharedPreferences (Android-Keystore-
 * protected, doc 09 Section 7's local at-rest baseline -- see
 * [EncryptedSharedPreferencesStateStore] for the same rationale that
 * applies here). Stores an index of known aliases alongside each blob so
 * [aliases] can be enumerated without needing a directory listing API.
 */
class EncryptedBlobSecureKeyStore(
    context: Context,
    fileName: String = "pca_secure_key_store",
) : SecureKeyStore {
    private val store = EncryptedSharedPreferencesStateStore(context, fileName)

    override fun hasBlob(alias: String): Boolean = store.contains(blobKey(alias))

    override fun storeBlob(alias: String, blobBase64: String) {
        store.putString(blobKey(alias), blobBase64)
        store.putString(ALIAS_INDEX_KEY, (currentAliases() + alias).joinToString(","))
    }

    override fun loadBlob(alias: String): String? = store.getString(blobKey(alias))

    override fun deleteBlob(alias: String) {
        store.remove(blobKey(alias))
        store.putString(ALIAS_INDEX_KEY, (currentAliases() - alias).joinToString(","))
    }

    override fun aliases(): Set<String> = currentAliases()

    private fun currentAliases(): Set<String> =
        store.getString(ALIAS_INDEX_KEY)?.split(",")?.filter { it.isNotEmpty() }?.toSet() ?: emptySet()

    private fun blobKey(alias: String) = "blob:$alias"

    private companion object {
        const val ALIAS_INDEX_KEY = "__aliases__"
    }
}
