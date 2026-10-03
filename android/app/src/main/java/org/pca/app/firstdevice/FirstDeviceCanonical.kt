package org.pca.app.firstdevice

import java.security.MessageDigest
import java.security.interfaces.ECPublicKey
import java.text.SimpleDateFormat
import java.util.Base64
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import org.pca.app.security.canonicalSec1PublicKeyBase64

/**
 * Wave 6C: byte-exact Android mirrors of the certified backend canonical
 * encoders (backend/src/familytrustset/FirstDeviceBootstrapProof.ts,
 * canonicalize.ts). Every function here exists so an Android device can
 * produce the EXACT byte strings the backend re-encodes and compares; any
 * drift is a rejection, so the encodings are pinned by shared golden
 * vectors (contracts/first-device-bootstrap/canonical-vectors.json) that
 * BOTH sides' test suites validate.
 *
 * Encoding rules (mirrored, not reinterpreted):
 *  - netstring framing: `${utf8ByteLength}:${value}` concatenation; length
 *    prefixes are UTF-8 BYTE counts (ASCII by construction here).
 *  - base64url: RFC 4648 Section 5, UNPADDED (`-`/`_`, no `=`); padding is
 *    a rejection at the backend, so `withoutPadding()` is mandatory.
 *  - ISO timestamps: exactly `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'` (UTC, literal
 *    uppercase Z, ALWAYS three fractional digits) -- the shape JavaScript's
 *    `Date.toISOString()` produces and the only shape the backend's
 *    round-trip check accepts. `expiresAt` is echoed VERBATIM from the
 *    server challenge response; only device-generated `issuedAt` is
 *    formatted here.
 *  - public keys: canonical SEC1 uncompressed `0x04 || X || Y` (65 bytes),
 *    unpadded base64url -- the exact same helper the keystore provider
 *    uses, so every representation of one DSK is byte-identical.
 */
object FirstDeviceCanonical {
    const val PROOF_DOMAIN = "PCA_FIRST_DEVICE_BOOTSTRAP_V1"
    const val PROOF_VERSION = 1
    const val DSK_ALGORITHM = "ECDSA_P256_SHA256"

    /**
     * Domain-separated prefix of the DSK hardware attestation challenge
     * (same value as AndroidKeystoreDskProvider.ATTESTATION_CHALLENGE_PREFIX;
     * a unit test pins the two constants equal).
     */
    const val ATTESTATION_CHALLENGE_PREFIX = "PCA_ANDROID_DSK_ATTESTATION_V1|"

    fun challengeBytes(attemptId: String): ByteArray = (ATTESTATION_CHALLENGE_PREFIX + attemptId).toByteArray(Charsets.UTF_8)

    fun netstringField(value: String): String = "${value.toByteArray(Charsets.UTF_8).size}:$value"

    fun sha256Hex(data: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }

    fun sha256Hex(text: String): String = sha256Hex(text.toByteArray(Charsets.UTF_8))

    fun base64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    /** Canonical SEC1 uncompressed public-key encoding for one EC P-256 key. */
    fun canonicalPublicKeyBase64(key: ECPublicKey): String = canonicalSec1PublicKeyBase64(key)

    /** Device-generated `issuedAt` in the exact backend-accepted shape. */
    fun isoUtcMillis(date: Date): String {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(date)
    }

    /**
     * The 13-field PCA_FIRST_DEVICE_BOOTSTRAP_V1 proof (statement A).
     * [expiresAt] MUST be the server challenge's own ISO string, passed
     * through verbatim (never re-formatted).
     */
    fun encodeProof(
        familyId: String,
        deviceId: String,
        ceremonyId: String,
        challengeId: String,
        nonce: String,
        expiresAt: String,
        dskKeyId: String,
        dskPublicKeyBase64: String,
        epoch1Sha256Hex: String,
        attestationEvidenceDigest: String?,
    ): String {
        val fields = listOf(
            PROOF_DOMAIN,
            PROOF_VERSION.toString(),
            familyId,
            deviceId,
            ceremonyId,
            challengeId,
            nonce,
            expiresAt,
            DSK_ALGORITHM,
            dskKeyId,
            dskPublicKeyBase64,
            epoch1Sha256Hex,
            attestationEvidenceDigest ?: "null",
        )
        return fields.joinToString("") { netstringField(it) }
    }

    /**
     * The epoch-1 canonical bytes (statement B, certified Wave-5B format,
     * unchanged): 6 + 7N netstring fields -- familyId, trustSetEpoch,
     * keyEpoch, entry count, the seven per-entry fields, issuedAt, and the
     * literal `null` supersedes marker. Exactly one ACTIVE OWNER entry.
     */
    fun encodeEpoch1(
        familyId: String,
        deviceId: String,
        dskKeyId: String,
        dskPublicKeyBase64: String,
        dekKeyId: String,
        dekPublicKeyBase64: String,
        issuedAtIso: String,
    ): String {
        val fields = listOf(
            familyId,
            "1",
            "1",
            "1",
            deviceId,
            "OWNER",
            dskKeyId,
            dskPublicKeyBase64,
            dekKeyId,
            dekPublicKeyBase64,
            "ACTIVE",
            issuedAtIso,
            "null",
        )
        return fields.joinToString("") { netstringField(it) }
    }
}
