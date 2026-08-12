package org.pca.app.runtime.sync.envelope

/**
 * Runtime mirror of backend/src/familyenvelope/types.ts's `FamilyEnvelope`
 * (doc 40 Section 7) -- the protocol-neutral wire structure every
 * family-control message shares. This module never decrypts, generates, or
 * inspects [payload] beyond opaque bytes, and implements no signature math
 * itself (see EnvelopeSignatureVerifier).
 */
sealed class RecipientBinding {
    data class Device(val recipientDeviceId: String) : RecipientBinding()
    data class Group(val recipientGroup: String) : RecipientBinding()
}

data class FamilyEnvelope(
    val protocolMajor: Int,
    val protocolMinor: Int,
    val messageId: String,
    val familyId: String,
    val senderDeviceId: String,
    val recipient: RecipientBinding,
    val senderKeyId: String,
    val messageType: String,
    val trustSetEpoch: Long,
    val keyEpoch: Long,
    val sequenceOrNonce: String,
    val issuedAtEpochMillis: Long,
    val expiresAtEpochMillis: Long,
    val semanticVersion: String,
    val correlationId: String?,
    val payload: ByteArray,
    val signature: String,
) {
    // Kotlin data classes default ByteArray equality to reference identity
    // (Any.equals), which would make two structurally-identical envelopes
    // compare unequal -- override with contentEquals/contentHashCode so
    // equality (and test assertions) reflect actual payload bytes.
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is FamilyEnvelope) return false
        return protocolMajor == other.protocolMajor &&
            protocolMinor == other.protocolMinor &&
            messageId == other.messageId &&
            familyId == other.familyId &&
            senderDeviceId == other.senderDeviceId &&
            recipient == other.recipient &&
            senderKeyId == other.senderKeyId &&
            messageType == other.messageType &&
            trustSetEpoch == other.trustSetEpoch &&
            keyEpoch == other.keyEpoch &&
            sequenceOrNonce == other.sequenceOrNonce &&
            issuedAtEpochMillis == other.issuedAtEpochMillis &&
            expiresAtEpochMillis == other.expiresAtEpochMillis &&
            semanticVersion == other.semanticVersion &&
            correlationId == other.correlationId &&
            payload.contentEquals(other.payload) &&
            signature == other.signature
    }

    override fun hashCode(): Int {
        var result = protocolMajor
        result = 31 * result + protocolMinor
        result = 31 * result + messageId.hashCode()
        result = 31 * result + familyId.hashCode()
        result = 31 * result + senderDeviceId.hashCode()
        result = 31 * result + recipient.hashCode()
        result = 31 * result + senderKeyId.hashCode()
        result = 31 * result + messageType.hashCode()
        result = 31 * result + trustSetEpoch.hashCode()
        result = 31 * result + keyEpoch.hashCode()
        result = 31 * result + sequenceOrNonce.hashCode()
        result = 31 * result + issuedAtEpochMillis.hashCode()
        result = 31 * result + expiresAtEpochMillis.hashCode()
        result = 31 * result + semanticVersion.hashCode()
        result = 31 * result + (correlationId?.hashCode() ?: 0)
        result = 31 * result + payload.contentHashCode()
        result = 31 * result + signature.hashCode()
        return result
    }
}
