package org.pca.app.security

import java.security.interfaces.ECPublicKey

/**
 * Generates a device's Signing Key pair (DSK) or Encryption/Key-Agreement
 * Key pair (DEK) -- doc 09 Section 3.1. DSK and DEK are always distinct
 * roles and MUST be generated as separate key pairs, never derived from
 * one another or reused across roles (mirrors the DSK/DEK role separation
 * already enforced server-side, backend/src/device and
 * backend/src/deviceauth).
 *
 * WAVE 6C (owner-authorized Android DSK implementation): the production
 * implementation is [AndroidKeystoreDskProvider] -- every key is generated
 * inside the AndroidKeyStore (TEE-backed, or StrongBox where the device
 * supports it), so the private key is NON-EXPORTABLE by platform
 * construction and is never returned as raw bytes through this or any
 * other application API. The interface still returns only a public key and
 * an opaque alias referencing where the key material lives.
 *
 * [attemptId] (Wave 6C) scopes BOTH aliases of one enrollment attempt
 * (`pca.dsk.<attemptId>` / `pca.dek.<attemptId>`) and, for the DSK, is baked
 * into the key's hardware attestation challenge at generation time: the
 * challenge bytes are exactly the UTF-8 encoding of
 * `"PCA_ANDROID_DSK_ATTESTATION_V1|<attemptId>"` -- byte-recomputable by the
 * backend verifier from the evidence packet's own attemptId field. This is
 * an attempt-scoped correlator, NOT the bootstrap ceremony nonce: the
 * certified contract (backend/src/familytrustset/AttestationVerifier.ts
 * MUST-NOTs) forbids treating the certificate challenge as ceremony
 * freshness, because the DSK and its attestation record are minted at
 * enrollment, before any ceremony exists; ceremony freshness is carried by
 * the DSK-signed bootstrap proof over challengeId/nonce.
 *
 * CREATE-ONCE: a second generation call for the same (role, attemptId) with
 * an existing alias throws [KeyAliasConflictException]. Keys are never
 * silently regenerated, never silently replaced, and a missing alias at
 * signing time is [KeyMaterialMissingException] -- fail closed, never
 * "recover" by minting a new key.
 *
 * [GeneratedKeyPair.publicKeyBase64] is the repository-canonical SEC1
 * UNCOMPRESSED encoding (`0x04 || X || Y`, exactly 65 bytes) in UNPADDED
 * base64url (RFC 4648 Section 5): the single encoding this key's public
 * half is ever represented by -- registration, ceremony challenge, proof
 * bytes, epoch-1 canonical bytes, and backend equality checks all compare
 * this exact string. XML-DER SPKI is never sent over the wire.
 */
interface DeviceKeyPairGenerator {
    fun generateSigningKeyPair(attemptId: String): GeneratedKeyPair
    fun generateEncryptionKeyPair(attemptId: String): GeneratedKeyPair
}

data class GeneratedKeyPair(
    val publicKeyBase64: String,
    val privateKeyAlias: String,
)

/**
 * Thrown by [NotApprovedDeviceKeyPairGenerator] (and any other pre-approval
 * [DeviceKeyPairGenerator]) to make a missing crypto-suite approval a
 * caller-visible, catchable signal rather than a silent no-op.
 * [org.pca.app.enrollment.EnrollmentCoordinator] catches exactly this type
 * to route into `EnrollmentState.CryptoReviewRequired` -- it must never be
 * caught alongside a generic `Exception` that would also swallow unrelated
 * bugs. The production Wave-6C provider does NOT throw this: its keys are
 * approved; it throws the typed failures below instead.
 */
class CryptoSuiteNotApprovedException :
    IllegalStateException("PRODUCTION_CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW -- no key pair may be generated yet")

/**
 * Wave 6C: the platform could not produce (or attest) a hardware-backed
 * key on this device -- e.g. no TEE-backed AndroidKeyStore provider is
 * available. Fail closed: no software-only key may ever enter the trust
 * root path. Callers route to `EnrollmentState.SecureKeyUnavailable`.
 */
class SecureKeyUnavailableException(message: String) : IllegalStateException(message)

/**
 * Wave 6C: a generation call found the attempt's alias already present.
 * Keys are create-once; silently replacing or reusing another key under the
 * same attempt identity is forbidden.
 */
class KeyAliasConflictException(message: String) : IllegalStateException(message)

/**
 * Wave 6C: a signing/attestation operation required key material that is no
 * longer present (deleted, cleared by OS, or never created). Fail closed:
 * NEVER regenerate as a "recovery" -- a replacement DSK could not be the
 * enrolled DSK the ceremony is bound to (backend M1), and a replacement
 * after a committed root is exactly the forbidden second-root path.
 */
class KeyMaterialMissingException(message: String) : IllegalStateException(message)

/**
 * Wave 6C: deletion capability for device key material. Kept as a SEPARATE
 * interface (not added to [DeviceKeyPairGenerator]) so every existing
 * generator implementation -- including the fail-closed default and
 * conformance fakes -- stays valid without pretending to support deletion;
 * callers use `keyPairGenerator as? DeviceKeyPairDeletion`.
 */
interface DeviceKeyPairDeletion {
    /** Deletes the single keystore entry behind [alias] if present. Never touches anything else. */
    fun deleteKeyPair(alias: String)

    /**
     * Deletes every key material entry this application owns whose alias is
     * scoped to an attempt id NOT in [keepAttemptIds] (prefix scan over the
     * app's own `pca.dsk.` / `pca.dek.` alias namespace only). Used to
     * reclaim keys orphaned by a process death between generation and the
     * durable attempt record write. Must never touch aliases referenced by
     * a live or committed record.
     */
    fun deleteOrphanedAttemptKeys(keepAttemptIds: Set<String>)
}

/**
 * Wave 6C: read access to the hardware attestation certificate chain of one
 * generated DSK (Android Key Attestation). Returns DER certificate bytes,
 * leaf first, exactly as AndroidKeyStore presents them; the chain is
 * assembled into the evidence JSON by
 * [org.pca.app.firstdevice.AndroidKeyAttestationEvidence]. Kept separate
 * from [DeviceKeyPairGenerator] for the same interface-segregation reason
 * as [DeviceKeyPairDeletion].
 */
interface DeviceKeyAttestationEvidenceSource {
    fun certificateChainDer(alias: String): List<ByteArray>
}

/**
 * Wave 6C: raw DSK signing operation used by the first-device trust-root
 * ceremony (bootstrap proof + epoch-1). Implementations sign with
 * SHA256withECDSA inside the key's own hardware boundary and return the
 * canonicalized IEEE-P1363 fixed-width 64-byte low-S form (see
 * [org.pca.app.firstdevice.P256DerSignature]), unpadded base64url applied
 * by callers. Kept separate from [DeviceKeyPairGenerator] so ceremony code
 * depends on the narrowest possible capability.
 */
interface DskSignatureEngine {
    /** Signs [message] with the private key behind [alias]; throws [KeyMaterialMissingException] when absent. */
    fun signCanonicalDer(alias: String, message: ByteArray): ByteArray
}

/**
 * The pre-approval production default retained for any composition that has
 * not yet been migrated to the Wave-6C provider (mirrors
 * [org.pca.app.runtime.sync.envelope.RejectingEnvelopeSignatureVerifier]'s
 * fail-closed posture): every call throws
 * [CryptoSuiteNotApprovedException] rather than fabricating or selecting
 * any concrete algorithm. Production composition (PcaAppGraph) wires
 * [AndroidKeystoreDskProvider] instead; this class remains as the explicit
 * fail-closed fallback and as the negative side of the static scans that
 * forbid test generators from ever reaching production.
 */
class NotApprovedDeviceKeyPairGenerator : DeviceKeyPairGenerator {
    override fun generateSigningKeyPair(attemptId: String): GeneratedKeyPair = throw CryptoSuiteNotApprovedException()
    override fun generateEncryptionKeyPair(attemptId: String): GeneratedKeyPair = throw CryptoSuiteNotApprovedException()
}

/** PADS or strips a BigInteger coordinate to the fixed 32-byte P-256 width (big-endian, no sign byte). */
internal fun ecCoordinateFixed32(value: java.math.BigInteger): ByteArray {
    val raw = value.toByteArray()
    return when {
        raw.size == 32 -> raw
        raw.size == 33 && raw[0] == 0.toByte() -> raw.copyOfRange(1, 33) // strip sign byte
        raw.size < 32 -> ByteArray(32).also { raw.copyInto(it, 32 - raw.size) }
        else -> throw IllegalStateException("EC coordinate wider than 32 bytes")
    }
}

/**
 * Canonical SEC1 uncompressed encoding of a P-256 public key: `0x04 || X || Y`
 * (65 bytes), unpadded base64url. Every consumer of this key's public half
 * must use exactly this representation.
 */
internal fun canonicalSec1PublicKeyBase64(key: ECPublicKey): String {
    val x = ecCoordinateFixed32(key.w.affineX)
    val y = ecCoordinateFixed32(key.w.affineY)
    val point = ByteArray(65)
    point[0] = 0x04
    x.copyInto(point, 1)
    y.copyInto(point, 33)
    return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(point)
}
