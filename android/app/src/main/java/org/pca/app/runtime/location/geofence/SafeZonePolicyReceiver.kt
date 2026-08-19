package org.pca.app.runtime.location.geofence

import org.json.JSONArray
import org.json.JSONObject

/**
 * Opaque Safe Zone envelope as received from the family relay/storage path.
 * The fields are routing/version/authentication metadata; [ciphertext] is the
 * only place the readable policy may exist outside the local family vault.
 * The server-side SafeZoneRepository stores the same opaque material and
 * never receives the decoded payload represented by [SafeZonePolicyPayload].
 */
data class SafeZonePolicyEnvelope(
    val familyId: String,
    val recipientEndpointId: String,
    val senderDeviceId: String,
    val senderKeyId: String,
    val trustSetEpoch: Long,
    val keyEpoch: Long,
    val revision: Long,
    val zoneId: String,
    val ciphertext: ByteArray,
    val nonce: ByteArray,
    val signature: String,
    val issuedAtEpochMillis: Long,
    val expiresAtEpochMillis: Long,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is SafeZonePolicyEnvelope) return false
        return familyId == other.familyId &&
            recipientEndpointId == other.recipientEndpointId &&
            senderDeviceId == other.senderDeviceId &&
            senderKeyId == other.senderKeyId &&
            trustSetEpoch == other.trustSetEpoch &&
            keyEpoch == other.keyEpoch &&
            revision == other.revision &&
            zoneId == other.zoneId &&
            ciphertext.contentEquals(other.ciphertext) &&
            nonce.contentEquals(other.nonce) &&
            signature == other.signature &&
            issuedAtEpochMillis == other.issuedAtEpochMillis &&
            expiresAtEpochMillis == other.expiresAtEpochMillis
    }

    override fun hashCode(): Int {
        var result = familyId.hashCode()
        result = 31 * result + recipientEndpointId.hashCode()
        result = 31 * result + senderDeviceId.hashCode()
        result = 31 * result + senderKeyId.hashCode()
        result = 31 * result + trustSetEpoch.hashCode()
        result = 31 * result + keyEpoch.hashCode()
        result = 31 * result + revision.hashCode()
        result = 31 * result + zoneId.hashCode()
        result = 31 * result + ciphertext.contentHashCode()
        result = 31 * result + nonce.contentHashCode()
        result = 31 * result + signature.hashCode()
        result = 31 * result + issuedAtEpochMillis.hashCode()
        result = 31 * result + expiresAtEpochMillis.hashCode()
        return result
    }
}

/** Plaintext exists only between the family crypto boundary and local policy application. */
data class SafeZonePolicyPayload(
    val familyId: String,
    val recipientEndpointId: String,
    val zoneId: String,
    val revision: Long,
    val keyEpoch: Long,
    val zone: GeofenceZone,
)

/**
 * Canonical local payload shape for the reviewed family crypto implementation
 * to produce/consume. This codec is not a crypto implementation and is never
 * called by the relay. It rejects extra keys and mismatched authenticated
 * metadata before a policy can reach [GeofenceZoneStore].
 */
object SafeZonePolicyPayloadCodec {
    private val allowedKeys = setOf(
        "familyId",
        "recipientEndpointId",
        "zoneId",
        "revision",
        "keyEpoch",
        "label",
        "latitude",
        "longitude",
        "radiusMeters",
        "enabled",
        "transitionTypes",
    )
    private val opaqueToken = Regex("^[A-Za-z0-9_-]{1,128}$")

    /** Local/test-side serialization contract; callers must encrypt these bytes before relay. */
    fun encode(payload: SafeZonePolicyPayload): ByteArray {
        require(isValidToken(payload.familyId))
        require(isValidToken(payload.recipientEndpointId))
        require(isValidToken(payload.zoneId))
        require(payload.revision > 0L)
        require(payload.keyEpoch > 0L)
        val json = JSONObject()
            .put("familyId", payload.familyId)
            .put("recipientEndpointId", payload.recipientEndpointId)
            .put("zoneId", payload.zoneId)
            .put("revision", payload.revision)
            .put("keyEpoch", payload.keyEpoch)
            .put("label", payload.zone.label)
            .put("latitude", payload.zone.centerLatitude)
            .put("longitude", payload.zone.centerLongitude)
            .put("radiusMeters", payload.zone.radiusMeters)
            .put("enabled", payload.zone.enabled)
            .put("transitionTypes", JSONArray(payload.zone.transitionTypes.map { it.name }.sorted()))
        return json.toString().toByteArray(Charsets.UTF_8)
    }

    /** Returns null for every malformed, over-broad, mismatched, or unsafe payload. */
    fun decode(plaintext: ByteArray, envelope: SafeZonePolicyEnvelope): SafeZonePolicyPayload? {
        val json = try {
            JSONObject(String(plaintext, Charsets.UTF_8))
        } catch (_: Exception) {
            return null
        }
        val keys = json.keys().asSequence().toSet()
        if (keys != allowedKeys) return null

        val familyId = json.opt("familyId") as? String ?: return null
        val recipientEndpointId = json.opt("recipientEndpointId") as? String ?: return null
        val zoneId = json.opt("zoneId") as? String ?: return null
        val revisionNumber = json.opt("revision") as? Number ?: return null
        val keyEpochNumber = json.opt("keyEpoch") as? Number ?: return null
        val revision = revisionNumber.toLong()
        val keyEpoch = keyEpochNumber.toLong()
        if (
            !isValidToken(familyId) ||
            !isValidToken(recipientEndpointId) ||
            !isValidToken(zoneId) ||
            familyId != envelope.familyId ||
            recipientEndpointId != envelope.recipientEndpointId ||
            zoneId != envelope.zoneId ||
            revision != envelope.revision ||
            keyEpoch != envelope.keyEpoch ||
            revisionNumber.toDouble() != revision.toDouble() ||
            keyEpochNumber.toDouble() != keyEpoch.toDouble()
        ) return null

        val label = json.opt("label") as? String ?: return null
        val latitude = json.opt("latitude") as? Number ?: return null
        val longitude = json.opt("longitude") as? Number ?: return null
        val radiusMeters = json.opt("radiusMeters") as? Number ?: return null
        val enabled = json.opt("enabled") as? Boolean ?: return null
        if (
            label.isBlank() || label.length > 256 || label.contains('|') || label.contains('\n') ||
            !latitude.toDouble().isFinite() || latitude.toDouble() !in -90.0..90.0 ||
            !longitude.toDouble().isFinite() || longitude.toDouble() !in -180.0..180.0 ||
            !radiusMeters.toDouble().isFinite() || radiusMeters.toDouble() <= 0.0
        ) return null

        val transitionsJson = json.optJSONArray("transitionTypes") ?: return null
        if (transitionsJson.length() == 0) return null
        val transitionTypes = mutableSetOf<GeofenceTransitionType>()
        for (index in 0 until transitionsJson.length()) {
            val value = transitionsJson.optString(index, "")
            val transition = runCatching { GeofenceTransitionType.valueOf(value) }.getOrNull() ?: return null
            transitionTypes += transition
        }
        if (transitionTypes.size != transitionsJson.length()) return null

        val zone = try {
            GeofenceZone(
                zoneId = zoneId,
                label = label,
                centerLatitude = latitude.toDouble(),
                centerLongitude = longitude.toDouble(),
                radiusMeters = radiusMeters.toDouble(),
                enabled = enabled,
                transitionTypes = transitionTypes,
                revision = revision,
            )
        } catch (_: IllegalArgumentException) {
            return null
        }
        return SafeZonePolicyPayload(familyId, recipientEndpointId, zoneId, revision, keyEpoch, zone)
    }

    private fun isValidToken(value: String): Boolean = opaqueToken.matches(value)
}

enum class SafeZoneFamilyRole { OWNER, ADMINISTRATOR, VIEWER, CHILD }

data class SafeZoneAuthorizedSender(
    val role: SafeZoneFamilyRole,
    val publicSigningKey: String,
)

/**
 * Coordinator/runtime binding to the verified local Family Trust Set. A
 * service session or an endpoint ID alone is never enough. Implementations
 * must return null/false generically for unknown, revoked, or cross-family
 * identities and must enforce the current trust/key epoch.
 */
interface SafeZoneFamilyAuthority {
    suspend fun isRecipientAuthorized(familyId: String, recipientEndpointId: String, trustSetEpoch: Long, keyEpoch: Long): Boolean

    suspend fun resolveAuthorizedSender(
        familyId: String,
        senderDeviceId: String,
        senderKeyId: String,
        trustSetEpoch: Long,
        keyEpoch: Long,
    ): SafeZoneAuthorizedSender?
}

/** Reviewed family signature boundary; production must verify the signed envelope metadata. */
interface SafeZoneEnvelopeSignatureVerifier {
    suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): Boolean
}

/** Reviewed family AEAD/KEM boundary; null means authentication/decryption failure. */
interface SafeZonePayloadDecryptor {
    suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray?
}

/** Production default until the human-reviewed family crypto suite is approved. */
class RejectingSafeZoneEnvelopeSignatureVerifier : SafeZoneEnvelopeSignatureVerifier {
    override suspend fun verify(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): Boolean = false
}

/** Production default until the human-reviewed family crypto suite is approved. */
class RejectingSafeZonePayloadDecryptor : SafeZonePayloadDecryptor {
    override suspend fun decrypt(envelope: SafeZonePolicyEnvelope, senderPublicSigningKey: String): ByteArray? = null
}

enum class SafeZonePolicyReceiveResult {
    APPLIED,
    REJECTED,
    BLOCKED_CRYPTO_REVIEW,
}

/**
 * Child-side chain:
 * opaque relay record -> local family/recipient authority -> signature
 * verification -> local decrypt/authenticate -> strict payload validation ->
 * encrypted local zone policy store. No server callback or remote
 * notification exists here; [GeofenceMonitor] consumes the same local store
 * and [GeofenceAlertPort] posts only a local entry/exit notification.
 */
class SafeZonePolicyReceiver(
    private val localFamilyId: String,
    private val localEndpointId: String,
    private val authority: SafeZoneFamilyAuthority,
    private val signatureVerifier: SafeZoneEnvelopeSignatureVerifier,
    private val decryptor: SafeZonePayloadDecryptor,
    private val zoneStore: GeofenceZoneStore,
    private val zoneStateStore: GeofenceZoneStateStore,
) {
    suspend fun receive(
        envelope: SafeZonePolicyEnvelope,
        nowEpochMillis: Long,
    ): SafeZonePolicyReceiveResult {
        if (!isStructurallyValid(envelope)) return SafeZonePolicyReceiveResult.REJECTED
        if (nowEpochMillis < envelope.issuedAtEpochMillis || nowEpochMillis >= envelope.expiresAtEpochMillis) {
            return SafeZonePolicyReceiveResult.REJECTED
        }
        if (envelope.familyId != localFamilyId || envelope.recipientEndpointId != localEndpointId) {
            return SafeZonePolicyReceiveResult.REJECTED
        }

        val recipientAuthorized = runCatching {
            authority.isRecipientAuthorized(envelope.familyId, localEndpointId, envelope.trustSetEpoch, envelope.keyEpoch)
        }.getOrDefault(false)
        if (!recipientAuthorized) return SafeZonePolicyReceiveResult.REJECTED

        val sender = runCatching {
            authority.resolveAuthorizedSender(
                envelope.familyId,
                envelope.senderDeviceId,
                envelope.senderKeyId,
                envelope.trustSetEpoch,
                envelope.keyEpoch,
            )
        }.getOrNull() ?: return SafeZonePolicyReceiveResult.REJECTED
        if (sender.role != SafeZoneFamilyRole.OWNER && sender.role != SafeZoneFamilyRole.ADMINISTRATOR) {
            return SafeZonePolicyReceiveResult.REJECTED
        }

        val verified = runCatching { signatureVerifier.verify(envelope, sender.publicSigningKey) }.getOrDefault(false)
        if (!verified) return SafeZonePolicyReceiveResult.REJECTED

        val plaintext = runCatching { decryptor.decrypt(envelope, sender.publicSigningKey) }.getOrNull()
            ?: return SafeZonePolicyReceiveResult.BLOCKED_CRYPTO_REVIEW
        return try {
            val payload = SafeZonePolicyPayloadCodec.decode(plaintext, envelope)
                ?: return SafeZonePolicyReceiveResult.REJECTED
            val current = zoneStore.loadZones().firstOrNull { it.zoneId == payload.zoneId }
            if (current != null && payload.revision <= current.revision) {
                return SafeZonePolicyReceiveResult.REJECTED
            }
            // A policy revision changes the meaning of the zone id. Do not
            // carry membership/debounce state across new geometry or a
            // re-enable; clear it before replacing the zone so a state-store
            // failure leaves the previously applied policy in place rather
            // than pairing new geometry with an old baseline.
            zoneStateStore.clear(payload.zoneId)
            zoneStore.addOrReplace(payload.zone)
            SafeZonePolicyReceiveResult.APPLIED
        } catch (_: Exception) {
            SafeZonePolicyReceiveResult.REJECTED
        } finally {
            // Do not leave decrypted JSON bytes in the temporary buffer after
            // the local encrypted-at-rest store has accepted the policy.
            plaintext.fill(0)
        }
    }

    private fun isStructurallyValid(envelope: SafeZonePolicyEnvelope): Boolean {
        val token = Regex("^[A-Za-z0-9_-]{1,128}$")
        return token.matches(envelope.familyId) &&
            token.matches(envelope.recipientEndpointId) &&
            token.matches(envelope.senderDeviceId) &&
            token.matches(envelope.senderKeyId) &&
            token.matches(envelope.zoneId) &&
            envelope.trustSetEpoch > 0L &&
            envelope.keyEpoch > 0L &&
            envelope.revision > 0L &&
            envelope.ciphertext.isNotEmpty() &&
            envelope.nonce.isNotEmpty() &&
            envelope.signature.isNotBlank() &&
            envelope.issuedAtEpochMillis >= 0L &&
            envelope.expiresAtEpochMillis > envelope.issuedAtEpochMillis
    }
}
