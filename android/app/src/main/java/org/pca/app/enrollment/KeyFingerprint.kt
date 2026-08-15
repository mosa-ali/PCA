package org.pca.app.enrollment

import java.security.MessageDigest

/**
 * PCA-FR-140/141: deterministic, bounded fingerprint of PUBLIC key material, for the parent to
 * visually confirm this device's key against what the parent app shows (short authentication
 * string / SAS-style confirmation, doc 08 PCA-FR-141). Exactly mirrors the backend's own
 * algorithm (backend/src/pairing/fingerprint.ts's `computeKeyFingerprint`) -- SHA-256 over the
 * exact public-key bytes as submitted (never private key material), formatted as hyphen-separated
 * 4-character hex groups -- so a device computing this over its own freshly-generated public key
 * produces the IDENTICAL string the server later reports once that same key is persisted and
 * fingerprinted server-side (backend/src/pairing/PairingService.ts). A mismatch between what this
 * device displays and what the parent's device/app displays is a genuine, real end-to-end signal
 * that the key material in transit was substituted, not merely a cosmetic label.
 */
fun computeKeyFingerprint(publicKeyBase64: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(publicKeyBase64.toByteArray(Charsets.UTF_8))
    val hex = digest.joinToString("") { "%02x".format(it) }
    return hex.chunked(4).joinToString("-")
}

/** This device's own DSK/DEK fingerprints, computed locally right after key generation -- before either key is ever sent over the network. */
data class DeviceKeyFingerprints(val signingKeyFingerprint: String, val encryptionKeyFingerprint: String)
