package org.pca.app.runtime.policyproof

import java.security.MessageDigest
import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.trustset.StrictJsonMemberNames

private fun decodeCanonicalSignature(value: String): ByteArray {
    require(value.length == 86 && value.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '_' || it == '-' })
    val decoded = Base64.getUrlDecoder().decode(value)
    require(decoded.size == 64 && Base64.getUrlEncoder().withoutPadding().encodeToString(decoded) == value)
    DevicePolicyApplicationProofV1.validateCanonicalSignature(decoded)
    return decoded
}

/** Durable, encrypted-state-store-backed exact-byte retry queue for application proofs. */
class PersistentDevicePolicyApplicationProofOutbox(
    private val store: PersistentStateStore,
    private val maxProofs: Int = 16,
    private val maxSnapshotBytes: Int = 64 * 1024,
) {
    init { require(maxProofs in 1..64 && maxSnapshotBytes in 1..256 * 1024) }

    data class PendingProof(
        val fields: DevicePolicyApplicationProofV1.ProofFields,
        val signatureBase64Url: String,
        val createdAtEpochMillis: Long,
    ) {
        /** Hash of the exact canonical transcript bytes followed by the 64-byte signature. */
        fun requestFingerprintBase64Url(): String {
            val transcript = DevicePolicyApplicationProofV1.canonicalTranscript(fields)
            val signature = decodeCanonicalSignature(signatureBase64Url)
            return DevicePolicyApplicationProofV1.encodeBase64Url(
                MessageDigest.getInstance("SHA-256").digest(transcript + signature),
            )
        }
    }

    private val lock = store.coordinationLock

    /** Persist and read back before the caller sends any network request. */
    fun enqueue(proof: PendingProof, nowEpochMillis: Long): PendingProof = synchronized(lock) {
        validate(proof)
        if (nowEpochMillis < proof.createdAtEpochMillis || nowEpochMillis - proof.createdAtEpochMillis >= RETENTION_MILLIS) unavailable()
        val current = read()
        val challengeId = proof.fields.challenge.challengeId
        val existing = current.find { it.fields.challenge.challengeId == challengeId }
        if (existing != null) {
            if (existing == proof && nowEpochMillis >= existing.createdAtEpochMillis &&
                nowEpochMillis - existing.createdAtEpochMillis < RETENTION_MILLIS) return@synchronized existing
            unavailable()
        }
        if (current.size >= maxProofs || current.any { it.createdAtEpochMillis > proof.createdAtEpochMillis }) unavailable()
        write(current + proof)
        read().find { it.fields.challenge.challengeId == challengeId } ?: unavailable()
    }

    /** Exact request bytes remain retryable for 14 days, including after challenge expiry. */
    fun pending(nowEpochMillis: Long): List<PendingProof> = synchronized(lock) {
        if (nowEpochMillis < 0) unavailable()
        val current = read()
        if (current.any { nowEpochMillis < it.createdAtEpochMillis }) unavailable()
        val live = current.filter { nowEpochMillis >= it.createdAtEpochMillis && nowEpochMillis - it.createdAtEpochMillis < RETENTION_MILLIS }
        if (live != current) write(live)
        live
    }

    /** Remove only after server acceptance and only for the exact accepted request fingerprint. */
    fun markAccepted(challengeId: String, acceptedFingerprintBase64Url: String): Boolean = synchronized(lock) {
        val current = read()
        val proof = current.find { it.fields.challenge.challengeId == challengeId } ?: return@synchronized false
        if (!constantTimeEquals(proof.requestFingerprintBase64Url(), acceptedFingerprintBase64Url)) unavailable()
        write(current.filterNot { it.fields.challenge.challengeId == challengeId })
        true
    }

    fun snapshot(): List<PendingProof> = synchronized(lock) { read() }

    private fun validate(proof: PendingProof) {
        if (proof.createdAtEpochMillis < 0) unavailable()
        try {
            DevicePolicyApplicationProofV1.canonicalTranscript(proof.fields)
        decodeCanonicalSignature(proof.signatureBase64Url)
        } catch (_: Exception) { unavailable() }
    }

    private fun read(): List<PendingProof> {
        try {
            val raw = store.getString(storageKey) ?: run {
                if (store.contains(storageKey)) unavailable()
                return emptyList()
            }
            if (raw.toByteArray(Charsets.UTF_8).size > maxSnapshotBytes) unavailable()
            StrictJsonMemberNames.requireUnique(raw)
            val root = JSONObject(raw)
            if (root.length() != 2 || root.getInt("version") != VERSION) unavailable()
            val array = root.getJSONArray("proofs")
            if (array.length() > maxProofs) unavailable()
            val seen = HashSet<String>()
            val proofs = (0 until array.length()).map { index ->
                val item = array.getJSONObject(index)
                val fieldsObject = item.getJSONObject("fields")
                val fields = parseFields(fieldsObject)
                val challengeId = fields.challenge.challengeId
                if (!seen.add(challengeId)) unavailable()
                val createdAt = item.get("createdAt")
                if (createdAt !is Long && createdAt !is Int) unavailable()
                PendingProof(fields, item.getString("signature"), (createdAt as Number).toLong()).also(::validate)
            }
            return proofs
        } catch (_: Exception) { unavailable() }
    }

    private fun write(proofs: List<PendingProof>) {
        try {
            val rows = JSONArray()
            proofs.forEach { proof ->
                rows.put(JSONObject()
                    .put("fields", fieldsJson(proof.fields))
                    .put("signature", proof.signatureBase64Url)
                    .put("createdAt", proof.createdAtEpochMillis))
            }
            val raw = JSONObject().put("version", VERSION).put("proofs", rows).toString()
            if (raw.toByteArray(Charsets.UTF_8).size > maxSnapshotBytes) unavailable()
            store.putString(storageKey, raw)
            store.flush()
            if (store.getString(storageKey) != raw) unavailable()
        } catch (_: Exception) { unavailable() }
    }

    private fun fieldsJson(fields: DevicePolicyApplicationProofV1.ProofFields) = JSONObject()
        .put("familyId", fields.familyId)
        .put("deviceId", fields.deviceId)
        .put("policyEnvelopeMessageId", fields.policyEnvelopeMessageId)
        .put("policyEnvelopeSha256", fields.policyEnvelopeSha256Base64Url)
        .put("trustSetEpoch", fields.trustSetEpoch)
        .put("keyEpoch", fields.keyEpoch)
        .put("applicationResult", fields.applicationResult.name)
        .put("challenge", JSONObject()
            .put("challengeId", fields.challenge.challengeId)
            .put("challengeNonce", fields.challenge.nonceBase64Url)
            .put("challengeExpiresAt", fields.challenge.expiresAt))

    private fun parseFields(json: JSONObject): DevicePolicyApplicationProofV1.ProofFields {
        if (json.length() != 8) unavailable()
        val challenge = json.getJSONObject("challenge")
        if (challenge.length() != 3) unavailable()
        return DevicePolicyApplicationProofV1.ProofFields(
            familyId = json.getString("familyId"),
            deviceId = json.getString("deviceId"),
            policyEnvelopeMessageId = json.getString("policyEnvelopeMessageId"),
            policyEnvelopeSha256Base64Url = json.getString("policyEnvelopeSha256"),
            trustSetEpoch = json.getLong("trustSetEpoch"),
            keyEpoch = json.getLong("keyEpoch"),
            applicationResult = DevicePolicyApplicationProofV1.ApplicationResult.valueOf(json.getString("applicationResult")),
            challenge = DevicePolicyApplicationProofV1.Challenge(
                challengeId = challenge.getString("challengeId"),
                nonceBase64Url = challenge.getString("challengeNonce"),
                expiresAt = challenge.getString("challengeExpiresAt"),
            ),
        )
    }

    private fun constantTimeEquals(left: String, right: String): Boolean =
        MessageDigest.isEqual(left.toByteArray(Charsets.US_ASCII), right.toByteArray(Charsets.US_ASCII))

    private fun unavailable(): Nothing = throw DevicePolicyApplicationProofOutboxUnavailable()

    private companion object {
        const val VERSION = 1
        const val RETENTION_MILLIS = 14L * 24 * 60 * 60 * 1000
        const val storageKey = "device.policy.application-proof.v1.outbox"
    }
}

class DevicePolicyApplicationProofOutboxUnavailable : IllegalStateException("device_policy_application_proof_outbox_unavailable")
