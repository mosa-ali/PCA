package org.pca.app.runtime.policyproof

import org.pca.app.firstdevice.FirstDeviceRootState
import org.pca.app.firstdevice.FirstDeviceRootStore
import org.pca.app.security.AndroidKeystoreDskProvider

/** Signing seam for the exact DSK of the enrolled recipient device, never a family owner key. */
interface CurrentDeviceDskProofSigner {
    fun signProof(fields: DevicePolicyApplicationProofV1.ProofFields, canonicalTranscript: ByteArray): ByteArray
    fun signBootstrapNonce(familyId: String, deviceId: String, nonceBase64Url: String): ByteArray
}

/** Production fail-closed binding until a durable current-device DSK custody source is added. */
object UnavailableCurrentDeviceDskProofSigner : CurrentDeviceDskProofSigner {
    override fun signProof(fields: DevicePolicyApplicationProofV1.ProofFields, canonicalTranscript: ByteArray): ByteArray = unavailable()
    override fun signBootstrapNonce(familyId: String, deviceId: String, nonceBase64Url: String): ByteArray = unavailable()
    private fun unavailable(): Nothing = throw IllegalStateException("current_device_dsk_custody_unavailable")
}

/** Narrow seam for a custody-checked current-device DSK operation. */
interface CurrentDeviceDskKeyAccess {
    fun assertCustody(alias: String, expectedPublicKeyBase64: String)
    fun sign(alias: String, message: ByteArray): ByteArray
}

/** Existing AndroidKeyStore DSK implementation; it never creates or repairs a key. */
class AndroidKeystoreCurrentDeviceDskKeyAccess(
    private val provider: AndroidKeystoreDskProvider,
) : CurrentDeviceDskKeyAccess {
    override fun assertCustody(alias: String, expectedPublicKeyBase64: String) =
        provider.assertSigningKeyCustody(alias, expectedPublicKeyBase64)

    override fun sign(alias: String, message: ByteArray): ByteArray = provider.signCanonicalDer(alias, message)
}

/**
 * Binds activation PoP and proof signing to this installation's committed
 * first-device root and its original AndroidKeyStore DSK. The backend still
 * makes every lifecycle decision; this adapter grants no local ACTIVE state.
 */
class AndroidCurrentDeviceDskProofSigner(
    private val rootStore: FirstDeviceRootStore,
    private val keyAccess: CurrentDeviceDskKeyAccess,
) : CurrentDeviceDskProofSigner {
    override fun signProof(fields: DevicePolicyApplicationProofV1.ProofFields, canonicalTranscript: ByteArray): ByteArray {
        val expected = DevicePolicyApplicationProofV1.canonicalTranscript(fields)
        require(expected.contentEquals(canonicalTranscript)) { "proof_transcript_mismatch" }
        return sign(fields.familyId, fields.deviceId, canonicalTranscript)
    }

    override fun signBootstrapNonce(familyId: String, deviceId: String, nonceBase64Url: String): ByteArray {
        DevicePolicyApplicationProofV1.decode32ByteBase64Url(nonceBase64Url)
        return sign(familyId, deviceId, nonceBase64Url.toByteArray(Charsets.UTF_8))
    }

    private fun sign(familyId: String, deviceId: String, message: ByteArray): ByteArray {
        val root = rootStore.current() ?: error("current_device_root_unavailable")
        check(root.state == FirstDeviceRootState.ROOT_COMMITTED && root.familyId == familyId &&
            root.seed.deviceId == deviceId) { "current_device_dsk_scope_mismatch" }
        keyAccess.assertCustody(root.seed.dskAlias, root.seed.dskPublicKeyBase64)
        return keyAccess.sign(root.seed.dskAlias, message).also {
            DevicePolicyApplicationProofV1.validateCanonicalSignature(it)
        }
    }
}
