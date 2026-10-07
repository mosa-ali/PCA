package org.pca.app.security

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import org.pca.app.firstdevice.P256DerSignature

/**
 * WAVE 6C: the REAL production DSK/DEK provider -- the Android side of the
 * first-device trust root, and the concrete implementation the certified
 * backend contract was waiting for (deviceprivate-key custody, exact-DSK
 * attestation, dual-signature bootstrap).
 *
 * CUSTODY PROPERTIES (each verified by tests, not assumed):
 *  - Keys are generated INSIDE the AndroidKeyStore (`KeyPairGenerator`
 *    over provider "AndroidKeyStore", curve secp256r1, PURPOSE_SIGN,
 *    DIGEST_SHA256). Private key material never exists outside the
 *    platform's key store boundary; there is no code path in this class
 *    that reads, exports, wraps, or copies a private key, and the
 *    platform makes it non-exportable by construction.
 *  - Every generated key is REQUIRED to be hardware-backed: after
 *    generation the pair is resolved back through
 *    `KeyFactory("AndroidKeyStore").getKeySpec(privateHandle, KeyInfo::class.java)`
 *    and `isInsideSecureHardware` must be true. On failure the entry is
 *    DELETED and [SecureKeyUnavailableException] is thrown -- a
 *    software-only key can never enter the trust-root path.
 *  - StrongBox is attempted first on API >= 28 (strongest available
 *    facility) and only when the device reports the feature; a
 *    StrongBox refusal (the platform's `StrongBoxUnavailableException`,
 *    matched by runtime class name, or a provider-level failure naming
 *    StrongBox) falls back to TEE-backed generation -- which the same
 *    hardware assertion above still enforces. Both levels are accepted by
 *    the backend verifier; software is not.
 *  - CREATE-ONCE: [generateSigningKeyPair]/[generateEncryptionKeyPair]
 *    refuse to run when the attempt-scoped alias already exists
 *    ([KeyAliasConflictException]) -- no silent regeneration, ever. The
 *    DSK's hardware attestation challenge is baked at generation:
 *    UTF-8 bytes of [ATTESTATION_CHALLENGE_PREFIX] + attemptId.
 *  - [signCanonicalDer] and [certificateChainDer] fail with
 *    [KeyMaterialMissingException] when material is absent -- callers must
 *    never "recover" by generating a replacement key.
 *
 * This class intentionally implements four narrow interfaces
 * ([DeviceKeyPairGenerator], [DeviceKeyPairDeletion],
 * [DeviceKeyAttestationEvidenceSource], [DskSignatureEngine]) because every
 * one of them is a view of the SAME AndroidKeyStore boundary; splitting it
 * into four classes would multiply that boundary, not reduce it.
 */
class AndroidKeystoreDskProvider(
    private val providerName: String = ANDROID_KEYSTORE_PROVIDER,
) : DeviceKeyPairGenerator, DeviceKeyPairDeletion, DeviceKeyAttestationEvidenceSource, DskSignatureEngine {

    private val keyStore: KeyStore by lazy {
        KeyStore.getInstance(providerName).apply { load(null) }
    }

    override fun generateSigningKeyPair(attemptId: String): GeneratedKeyPair =
        generate(role = ROLE_DSK, attemptId = attemptId, attestationChallenge = challengeFor(attemptId))

    override fun generateEncryptionKeyPair(attemptId: String): GeneratedKeyPair =
        generate(role = ROLE_DEK, attemptId = attemptId, attestationChallenge = null)

    /** Alias for the DSK of one attempt; deterministic, non-secret, safe to persist. */
    fun signingKeyAlias(attemptId: String): String = "$ALIAS_PREFIX_DSK$attemptId"

    /** Alias for the DEK of one attempt. */
    fun encryptionKeyAlias(attemptId: String): String = "$ALIAS_PREFIX_DEK$attemptId"

    @Synchronized
    private fun generate(role: String, attemptId: String, attestationChallenge: ByteArray?): GeneratedKeyPair {
        require(attemptId.isNotBlank()) { "attemptId must not be blank" }
        val alias = if (role == ROLE_DSK) signingKeyAlias(attemptId) else encryptionKeyAlias(attemptId)
        if (keyStore.containsAlias(alias)) {
            throw KeyAliasConflictException("key material already exists for this attempt ($alias); create-once policy")
        }
        val keyPair = try {
            generateKeyPair(alias, attestationChallenge, stronglyBoxed = true)
        } catch (e: java.security.ProviderException) {
            // A StrongBox refusal NEVER falls through silently: it is the one
            // and only exception shape accepted as "fall back to TEE". On
            // API >= 28 devices the platform throws
            // StrongBoxUnavailableException (a ProviderException subtype, so
            // it lands here); on older platforms this class itself raises a
            // ProviderException naming StrongBox. The platform class is
            // matched by runtime class name (API-gated types stay
            // unreferenced so minSdk 26 stays lint-clean). Anything else is
            // rethrown. Any partially created entry is deleted first.
            if (e.isStrongBoxRefusal()) {
                deleteEntryQuietly(alias)
                // Stage-B fix (Agent-1 MINOR-2): a failure of the TEE FALLBACK
                // itself must clean up any partially created entry too --
                // create-once means a lingering partial alias would otherwise
                // permanently block this attempt.
                try {
                    generateKeyPair(alias, attestationChallenge, stronglyBoxed = false)
                } catch (fallbackFailure: Throwable) {
                    deleteEntryQuietly(alias)
                    throw fallbackFailure
                }
            } else {
                deleteEntryQuietly(alias)
                throw e
            }
        } catch (e: Throwable) {
            deleteEntryQuietly(alias)
            throw e
        }

        // HARDWARE ASSERTION: no software-backed key may ever enroll.
        val publicKey = keyPair.public as? ECPublicKey
            ?: run { deleteEntryQuietly(alias); throw SecureKeyUnavailableException("generated key is not EC P-256") }
        val secure = try {
            val keyInfo = KeyFactory.getInstance(keyPair.private.algorithm, providerName)
                .getKeySpec(keyPair.private, KeyInfo::class.java)
            keyInfo.isInsideSecureHardware
        } catch (e: Exception) {
            false
        }
        if (!secure) {
            deleteEntryQuietly(alias)
            throw SecureKeyUnavailableException("device could not provide a hardware-backed key; refusing a software-only DSK/DEK")
        }
        return GeneratedKeyPair(publicKeyBase64 = canonicalSec1PublicKeyBase64(publicKey), privateKeyAlias = alias)
    }

    private fun generateKeyPair(alias: String, attestationChallenge: ByteArray?, stronglyBoxed: Boolean): java.security.KeyPair {
        val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false)
        if (attestationChallenge != null) {
            builder.setAttestationChallenge(attestationChallenge)
        }
        if (stronglyBoxed) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
                throw java.security.ProviderException("StrongBox requires API 28")
            }
            builder.setIsStrongBoxBacked(true)
        }
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, providerName)
        generator.initialize(builder.build())
        return generator.generateKeyPair()
    }

    // ---- DeviceKeyPairDeletion ----

    @Synchronized
    override fun deleteKeyPair(alias: String) {
        if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
    }

    @Synchronized
    override fun deleteOrphanedAttemptKeys(keepAttemptIds: Set<String>) {
        val aliases = keyStore.aliases().toList()
        for (alias in aliases) {
            val attemptId = when {
                alias.startsWith(ALIAS_PREFIX_DSK) -> alias.removePrefix(ALIAS_PREFIX_DSK)
                alias.startsWith(ALIAS_PREFIX_DEK) -> alias.removePrefix(ALIAS_PREFIX_DEK)
                else -> continue
            }
            if (attemptId !in keepAttemptIds) keyStore.deleteEntry(alias)
        }
    }

    // ---- DeviceKeyAttestationEvidenceSource ----

    override fun certificateChainDer(alias: String): List<ByteArray> {
        val chain = try {
            keyStore.getCertificateChain(alias)
        } catch (e: Exception) {
            throw KeyMaterialMissingException("attestation chain unavailable for the device key")
        }
        if (chain == null || chain.isEmpty()) {
            throw KeyMaterialMissingException("device key has no attestation certificate chain")
        }
        return chain.map { it.encoded }
    }

    // ---- DskSignatureEngine ----

    override fun signCanonicalDer(alias: String, message: ByteArray): ByteArray {
        val privateKey: PrivateKey = try {
            keyStore.getKey(alias, null) as? PrivateKey
                ?: throw KeyMaterialMissingException("device signing key is missing; refusing to regenerate")
        } catch (e: KeyMaterialMissingException) {
            throw e
        } catch (e: Exception) {
            throw KeyMaterialMissingException("device signing key is unavailable; refusing to regenerate")
        }
        val der = try {
            Signature.getInstance("SHA256withECDSA").run {
                initSign(privateKey)
                update(message)
                sign()
            }
        } catch (e: Exception) {
            throw KeyMaterialMissingException("device signing key could not sign; refusing to regenerate")
        }
        return P256DerSignature.toLowSIeeeP1363(der)
    }

    /** Read-only original-key check for cached-session custody. Never creates or repairs keys. */
    fun assertSigningKeyCustody(alias: String, expectedPublicKeyBase64: String) {
        try {
            val privateHandle = keyStore.getKey(alias, null) as? PrivateKey ?: throw KeyMaterialMissingException("Device key unavailable")
            val info = KeyFactory.getInstance("EC", ANDROID_KEYSTORE_PROVIDER).getKeySpec(privateHandle, KeyInfo::class.java)
            val publicKey = keyStore.getCertificate(alias)?.publicKey as? ECPublicKey ?: throw KeyMaterialMissingException("Device key unavailable")
            if (!info.isInsideSecureHardware || info.purposes and KeyProperties.PURPOSE_SIGN == 0 ||
                canonicalSec1PublicKeyBase64(publicKey) != expectedPublicKeyBase64) {
                throw KeyMaterialMissingException("Device key unavailable")
            }
        } catch (_: Exception) { throw KeyMaterialMissingException("Device key unavailable; refusing to regenerate") }
    }

    private fun deleteEntryQuietly(alias: String) {
        try {
            if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
        } catch (_: Exception) {
            // Best-effort cleanup on a failed generation; the typed failure
            // below is what callers act on.
        }
    }

    /**
     * Is this ProviderException the platform refusing StrongBox (as opposed
     * to a real generation failure that must propagate)? The API-28 platform
     * type is matched by RUNTIME CLASS NAME -- referencing it directly would
     * trip lint's NewApi rule against minSdk 26 -- plus a message/cause
     * check for older platforms and wrapped failures.
     */
    private fun java.security.ProviderException.isStrongBoxRefusal(): Boolean {
        if (javaClass.simpleName == STRONGBOX_UNAVAILABLE_EXCEPTION_NAME) return true
        if (message?.contains("StrongBox", ignoreCase = true) == true) return true
        val underlying = cause ?: return false
        return underlying.javaClass.simpleName == STRONGBOX_UNAVAILABLE_EXCEPTION_NAME ||
            underlying.message?.contains("StrongBox", ignoreCase = true) == true
    }

    companion object {
        const val ANDROID_KEYSTORE_PROVIDER = "AndroidKeyStore"

        /**
         * Runtime class name of `android.security.keystore.StrongBoxUnavailableException`
         * (API 28+). Kept as a STRING on purpose: the type itself must not be
         * referenced from minSdk-26 code (lint NewApi), and class-name
         * matching is exactly equivalent for our fallback decision.
         */
        private const val STRONGBOX_UNAVAILABLE_EXCEPTION_NAME = "StrongBoxUnavailableException"

        /** Alias namespaces this application owns; the only prefixes orphan cleanup ever touches. */
        const val ALIAS_PREFIX_DSK = "pca.dsk."
        const val ALIAS_PREFIX_DEK = "pca.dek."

        /**
         * Wave 6C: domain-separated prefix of the DSK hardware attestation
         * challenge. The full challenge is this prefix + the attempt id, as
         * UTF-8 bytes; the backend verifier recomputes it byte-exactly from
         * the evidence packet's attemptId (see
         * backend/src/familytrustset/AndroidKeyAttestationVerifier.ts).
         */
        const val ATTESTATION_CHALLENGE_PREFIX = "PCA_ANDROID_DSK_ATTESTATION_V1|"

        private const val ROLE_DSK = "dsk"
        private const val ROLE_DEK = "dek"

        /** The exact challenge bytes for one attempt (recomputable on both sides). */
        fun challengeFor(attemptId: String): ByteArray = (ATTESTATION_CHALLENGE_PREFIX + attemptId).toByteArray(Charsets.UTF_8)
    }
}
