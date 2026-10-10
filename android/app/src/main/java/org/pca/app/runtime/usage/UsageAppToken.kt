package org.pca.app.runtime.usage

import java.security.MessageDigest

/** Stable local token for an observed package name; never expose the OS package string downstream. */
object UsageAppToken {
    fun forPackageName(packageName: String): String {
        require(packageName.isNotEmpty() && packageName.length <= 256)
        val digest = MessageDigest.getInstance("SHA-256").digest(packageName.toByteArray(Charsets.UTF_8))
        return digest.joinToString(separator = "") { "%02x".format(it) }.take(TOKEN_LENGTH)
    }

    private const val TOKEN_LENGTH = 16
}
