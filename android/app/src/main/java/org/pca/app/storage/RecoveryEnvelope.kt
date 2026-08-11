package org.pca.app.storage

/**
 * Client-side mirror of the opaque recovery envelope the backend relays
 * (doc 09 Section 3.4/PCA-SEC-018, backend/src/recovery). This app treats
 * the envelope as fully opaque, base64-encoded ciphertext; it never
 * decrypts, generates, or interprets its contents -- that requires the
 * Recovery Secret plus a reviewed KDF/AEAD construction, gated behind
 * CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW. This device's only
 * responsibilities regarding the envelope are: fetch it, store it
 * (offline-durable, see [RecoveryEnvelopeStore]), and hand it unmodified
 * to a future recovery-transaction flow (doc 09 Section 10 -- not built
 * by this baseline).
 */
data class RecoveryEnvelope(
    val familyId: String,
    val envelopeId: String,
    val createdAtEpochMillis: Long,
    val trustSetEpoch: Int,
    val keyEpoch: Int,
    val ciphertextBase64: String,
)

/** Client-side contract for backend's opaque recovery-envelope relay surface. */
interface RecoveryEnvelopeApiClient {
    suspend fun fetchRecoveryEnvelope(familyId: String): RecoveryEnvelope?
    suspend fun storeRecoveryEnvelope(envelope: RecoveryEnvelope)
}

/**
 * Local, offline-durable copy of the most recently fetched recovery
 * envelope -- doc 09 Section 3.4's offline recovery data model: a device
 * must be able to start a recovery transaction using a LOCALLY-held
 * envelope even without connectivity to re-fetch it. This store never
 * inspects `ciphertextBase64` content, only persists it.
 */
interface RecoveryEnvelopeStore {
    fun current(): RecoveryEnvelope?
    fun save(envelope: RecoveryEnvelope)
    fun clear()
}

/** In-memory reference RecoveryEnvelopeStore -- real and usable for composition/dev builds, not itself offline-durable across process death (a real device build must back this with [org.pca.app.storage.EncryptedVault] or equivalent). */
class InMemoryRecoveryEnvelopeStore : RecoveryEnvelopeStore {
    private var envelope: RecoveryEnvelope? = null

    override fun current(): RecoveryEnvelope? = envelope
    override fun save(envelope: RecoveryEnvelope) { this.envelope = envelope }
    override fun clear() { envelope = null }
}
