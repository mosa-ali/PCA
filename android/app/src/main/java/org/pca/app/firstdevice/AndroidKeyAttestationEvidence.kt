package org.pca.app.firstdevice

import org.json.JSONArray
import org.json.JSONObject

/**
 * Wave 6C: assembles the Android Key Attestation evidence packet -- the ONE
 * exact JSON string submitted as `attestationEvidence` and hashed into the
 * DSK-signed bootstrap proof. The backend's verifier parses this envelope
 * strictly (`{"v":1,"platform":"ANDROID","attemptId","chain":[...]}`,
 * nothing else) and recomputes the hardware challenge from `attemptId`, so
 * the field set, value domains, and DER encodings must match exactly.
 *
 * BOUNDS: the certified service rejects evidence larger than 16,384 UTF-8
 * BYTES; [build] enforces the same bound client-side on the exact string
 * that would be transmitted (before any network call), so an oversized
 * chain fails closed locally instead of looping on a server 404.
 */
object AndroidKeyAttestationEvidence {
    const val MAX_EVIDENCE_BYTES = 16_384
    private const val MIN_CHAIN_CERTS = 2
    private const val MAX_CHAIN_CERTS = 6
    private val ATTEMPT_ID_PATTERN = Regex("^[A-Za-z0-9_-]{16,64}$")

    /**
     * Builds the evidence JSON from the DSK's hardware certificate chain
     * (leaf first, DER). Throws (fail closed) on any deviation: malformed
     * attemptId, chain outside 2..6 certificates, or a serialized packet
     * above the 16 KiB budget.
     */
    fun build(attemptId: String, chainDer: List<ByteArray>): String {
        require(ATTEMPT_ID_PATTERN.matches(attemptId)) { "attemptId must be 16..64 base64url characters" }
        require(chainDer.size in MIN_CHAIN_CERTS..MAX_CHAIN_CERTS) { "attestation chain must have 2..6 certificates" }
        val chain = JSONArray()
        for (der in chainDer) {
            require(der.isNotEmpty()) { "empty certificate in attestation chain" }
            chain.put(FirstDeviceCanonical.base64Url(der))
        }
        val json = JSONObject()
            .put("v", 1)
            .put("platform", "ANDROID")
            .put("attemptId", attemptId)
            .put("chain", chain)
        val text = json.toString()
        check(text.toByteArray(Charsets.UTF_8).size <= MAX_EVIDENCE_BYTES) {
            "attestation evidence exceeds the certified 16 KiB budget"
        }
        return text
    }
}
