package org.pca.app.runtime.policyproof

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
