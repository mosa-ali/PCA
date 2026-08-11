package org.pca.app.foundation

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Reference PersistentStateStore backed by EncryptedSharedPreferences (an
 * Android-Keystore-protected master key wrapping AES256_SIV key encryption
 * and AES256_GCM value encryption) -- doc 09 Section 7's "OS-backed key
 * protection" baseline for local encryption-at-rest.
 *
 * This is LOCAL DEVICE-AT-REST protection ONLY. It has no relationship to,
 * and must never be confused with, the family E2EE key hierarchy
 * (DSK/DEK/FDEK, doc 09 Section 3.1) -- that suite selection remains
 * CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW. EncryptedSharedPreferences
 * is a standard, official Jetpack library using AndroidX-selected,
 * platform-reviewed constructions for local storage protection, not a
 * custom cryptographic primitive PCA is choosing itself (doc 09
 * PCA-SEC-016 prohibits only the latter).
 */
class EncryptedSharedPreferencesStateStore(
    context: Context,
    fileName: String,
) : PersistentStateStore {
    private val appContext = context.applicationContext

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            appContext,
            fileName,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    override fun getString(key: String): String? = prefs.getString(key, null)

    override fun putString(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    override fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }

    override fun contains(key: String): Boolean = prefs.contains(key)

    override fun clear() {
        prefs.edit().clear().apply()
    }
}
