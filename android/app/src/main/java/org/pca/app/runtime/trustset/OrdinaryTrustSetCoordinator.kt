package org.pca.app.runtime.trustset

import java.util.Base64
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.CancellationException
import org.pca.app.security.DskSignatureEngine

/** Wire identity is exactly these two values. Device/key identity comes from the authenticated session. */
data class OrdinaryEpochRequest(val canonicalEpochBase64: String, val signatureBase64: String) {
    override fun toString() = "OrdinaryEpochRequest(redacted)"
}
data class AcceptedEpochRecord(val request: OrdinaryEpochRequest, val signerDeviceId: String,
    val signerKeyId: String, val trustSetEpoch: Int, val keyEpoch: Int)
enum class OrdinaryEpochOutcome { ACCEPTED, IDEMPOTENT_MATCH, NOT_ACCEPTED, CONFLICT }
data class OrdinaryEpochResponse(val outcome: OrdinaryEpochOutcome, val acceptedEpoch: AcceptedEpochRecord?,
    val acceptedHead: AcceptedEpochRecord)
interface OrdinaryTrustSetApi {
    suspend fun submit(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse
    suspend fun status(familyId: String, request: OrdinaryEpochRequest): OrdinaryEpochResponse
    suspend fun getEpoch(familyId: String, trustSetEpoch: Int): AcceptedEpochRecord
    suspend fun getHead(familyId: String): AcceptedEpochRecord
}

/** Must verify with the PREVIOUS accepted owner's DSK, not a key supplied by the new candidate. */
fun interface OrdinaryEpochSignatureVerifier {
    fun verify(publicKey: String, canonicalBytes: ByteArray, signature: String): Boolean
}
data class OrdinaryEpochState(
    val accepted: AcceptedEpochRecord,
    val pending: OrdinaryEpochRequest? = null,
    /** Immutable device-local bootstrap root. Legacy states decode with no root and cannot be upgraded. */
    val rootAnchor: AcceptedEpochRecord? = null,
)
interface OrdinaryEpochStore {
    /** Present corrupt state must throw; absence must never be inferred from decoding failure. */
    fun read(): OrdinaryEpochState?
    fun compareAndSetDurably(expected: OrdinaryEpochState?, next: OrdinaryEpochState): Boolean
    fun confirmDurable(expected: OrdinaryEpochState): Boolean
}

/** No lifecycle changes or root creation. A separately verified bootstrap anchor is required. */
class OrdinaryTrustSetCoordinator(private val store: OrdinaryEpochStore, private val api: OrdinaryTrustSetApi,
    private val signer: DskSignatureEngine, private val verifier: OrdinaryEpochSignatureVerifier,
    private val localDeviceId: String, private val localSigningKeyId: String, private val signingAlias: String) {
    private val flight = Mutex()

    suspend fun prepare(candidate: UntrustedTrustSetEpoch): Boolean = flight.withLock {
        val current = store.read() ?: return@withLock false
        if (!hasTrustedFloor(current)) return@withLock false
        if (current.pending != null) return@withLock false
        val prior = decode(current.accepted)
        val owner = owner(prior)
        require(owner.deviceId == localDeviceId && owner.dskKeyId == localSigningKeyId)
        validateTransition(prior, candidate)
        val bytes = TrustSetEpochCodec.canonicalize(candidate).toByteArray(Charsets.UTF_8)
        val signature = signer.signCanonicalDer(signingAlias, bytes)
        require(signature.size == 64)
        val request = OrdinaryEpochRequest(Base64.getEncoder().encodeToString(bytes), Base64.getEncoder().encodeToString(signature))
        require(verifier.verify(owner.dskPublicKey, bytes, request.signatureBase64))
        store.compareAndSetDurably(current, current.copy(pending = request))
    }

    /** A timeout leaves the persisted request unchanged. Restart callers invoke this without preparing again. */
    suspend fun submitExact(): Boolean = flight.withLock { contact(false) }
    suspend fun reconcile(): Boolean = flight.withLock { contact(true) }

    /** Walk signed predecessor links backwards, then verify forward from the trusted floor. */
    suspend fun catchUp(maximumRecords: Int = 32): Int = flight.withLock {
        require(maximumRecords in 1..32)
        val initial = store.read() ?: return@withLock 0
        if (!hasTrustedFloor(initial)) return@withLock 0
        val anchor = decode(initial.accepted)
        val chain = mutableListOf<AcceptedEpochRecord>()
        var cursor = try { api.getHead(anchor.familyId) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { return@withLock 0 }
        while (true) {
            val candidate = decode(cursor)
            require(candidate.familyId == anchor.familyId)
            if (candidate.trustSetEpoch == anchor.trustSetEpoch) {
                require(cursor == initial.accepted)
                break
            }
            require(candidate.trustSetEpoch > anchor.trustSetEpoch && chain.size < maximumRecords)
            chain.add(cursor)
            val predecessor = candidate.supersedesEpoch ?: error("missing_ordinary_predecessor")
            require(predecessor >= anchor.trustSetEpoch && predecessor < candidate.trustSetEpoch)
            if (predecessor == anchor.trustSetEpoch) break
            cursor = try { api.getEpoch(anchor.familyId, predecessor) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { return@withLock 0 }
            require(cursor.trustSetEpoch == predecessor)
        }
        var progressed = 0
        for (accepted in chain.asReversed()) {
            val current = store.read() ?: return@withLock progressed
            if (!store.confirmDurable(current)) return@withLock progressed
            val prior = decode(current.accepted)
            val candidate = decode(accepted)
            validateTransition(prior, candidate)
            val owner = owner(prior)
            require(accepted.signerDeviceId == owner.deviceId && accepted.signerKeyId == owner.dskKeyId)
            require(verifier.verify(owner.dskPublicKey, TrustSetEpochCodec.canonicalize(candidate).toByteArray(Charsets.UTF_8),
                accepted.request.signatureBase64))
            val pending = current.pending.takeUnless { it == accepted.request }
            if (!store.compareAndSetDurably(current, OrdinaryEpochState(accepted, pending, current.rootAnchor))) return@withLock progressed
            progressed++
        }
        progressed
    }

    private suspend fun contact(status: Boolean): Boolean {
        val current = store.read() ?: return false
        if (!hasTrustedFloor(current)) return false
        val pending = current.pending ?: return false
        if (!store.confirmDurable(current)) return false
        val prior = decode(current.accepted)
        val priorOwner = owner(prior)
        require(priorOwner.deviceId == localDeviceId && priorOwner.dskKeyId == localSigningKeyId)
        val pendingBytes = canonicalBytes(pending)
        validateTransition(prior, TrustSetEpochCodec.decodeCanonical(pendingBytes))
        require(verifier.verify(priorOwner.dskPublicKey, pendingBytes, pending.signatureBase64))
        val response = try {
            if (status) api.status(prior.familyId, pending) else api.submit(prior.familyId, pending)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { return false }
        if (response.outcome == OrdinaryEpochOutcome.NOT_ACCEPTED || response.outcome == OrdinaryEpochOutcome.CONFLICT) return false
        val accepted = response.acceptedEpoch ?: return false
        // Never skip unseen epochs. Reconcile a chain separately; preserve pending until this exact proof is available.
        if (accepted.request != pending || response.acceptedHead != accepted) return false
        val candidate = decode(accepted)
        validateTransition(prior, candidate)
        val owner = owner(prior)
        require(accepted.signerDeviceId == owner.deviceId && accepted.signerKeyId == owner.dskKeyId)
        val bytes = TrustSetEpochCodec.canonicalize(candidate).toByteArray(Charsets.UTF_8)
        require(verifier.verify(owner.dskPublicKey, bytes, accepted.request.signatureBase64))
        return store.compareAndSetDurably(current, OrdinaryEpochState(accepted, rootAnchor = current.rootAnchor))
    }

    private fun decode(record: AcceptedEpochRecord): UntrustedTrustSetEpoch {
        val bytes = canonicalBytes(record.request)
        val candidate = TrustSetEpochCodec.decodeCanonical(bytes)
        require(candidate.trustSetEpoch == record.trustSetEpoch && candidate.keyEpoch == record.keyEpoch)
        require(candidate.keyEpoch >= 1)
        return candidate
    }

    /** Re-check both the immutable epoch-1 proof and the locally accepted signing floor. */
    private fun hasTrustedFloor(state: OrdinaryEpochState): Boolean {
        val rootRecord = state.rootAnchor ?: return false
        return try {
            val root = decode(rootRecord)
            require(root.trustSetEpoch == 1 && root.keyEpoch == 1 && root.supersedesEpoch == null)
            val rootOwner = owner(root)
            require(rootRecord.signerDeviceId == rootOwner.deviceId && rootRecord.signerKeyId == rootOwner.dskKeyId)
            require(verifier.verify(rootOwner.dskPublicKey, canonicalBytes(rootRecord.request),
                rootRecord.request.signatureBase64))

            val accepted = decode(state.accepted)
            val acceptedOwner = owner(accepted)
            require(accepted.familyId == root.familyId && accepted.trustSetEpoch >= 1 && accepted.keyEpoch >= 1)
            require(acceptedOwner.deviceId == rootOwner.deviceId && acceptedOwner.dskKeyId == rootOwner.dskKeyId &&
                acceptedOwner.dskPublicKey == rootOwner.dskPublicKey &&
                state.accepted.signerDeviceId == rootOwner.deviceId && state.accepted.signerKeyId == rootOwner.dskKeyId)
            if (accepted.trustSetEpoch == 1) {
                require(state.accepted == rootRecord)
            } else {
                require(accepted.supersedesEpoch != null && accepted.supersedesEpoch < accepted.trustSetEpoch)
            }
            require(verifier.verify(rootOwner.dskPublicKey, canonicalBytes(state.accepted.request),
                state.accepted.request.signatureBase64))
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun canonicalBytes(request: OrdinaryEpochRequest): ByteArray {
        require(request.canonicalEpochBase64.length <= TrustSetEpochCodec.MAX_CANONICAL_UTF8_BYTES * 4)
        val bytes = Base64.getDecoder().decode(request.canonicalEpochBase64)
        require(bytes.size <= TrustSetEpochCodec.MAX_CANONICAL_UTF8_BYTES &&
            Base64.getEncoder().encodeToString(bytes) == request.canonicalEpochBase64)
        val epoch = TrustSetEpochCodec.decodeCanonical(bytes)
        require(TrustSetEpochCodec.canonicalize(epoch).toByteArray(Charsets.UTF_8).contentEquals(bytes))
        return bytes
    }

    private fun owner(epoch: UntrustedTrustSetEpoch): UntrustedTrustSetEntry =
        epoch.entries.single { it.role == TrustSetRole.OWNER && it.status == TrustSetMembershipStatus.ACTIVE }

    private fun validateTransition(prior: UntrustedTrustSetEpoch, next: UntrustedTrustSetEpoch) {
        require(next.familyId == prior.familyId && next.trustSetEpoch > prior.trustSetEpoch)
        require(prior.keyEpoch >= 1 && next.keyEpoch >= prior.keyEpoch && next.supersedesEpoch == prior.trustSetEpoch)
        val beforeOwner = owner(prior)
        val afterOwner = owner(next)
        require(afterOwner.deviceId == beforeOwner.deviceId && afterOwner.dskKeyId == beforeOwner.dskKeyId &&
            afterOwner.dskPublicKey == beforeOwner.dskPublicKey)
        require(next.entries.map { it.deviceId }.distinct().size == next.entries.size)
        require(next.entries.flatMap { listOf(it.dskKeyId, it.dekKeyId) }.distinct().size == next.entries.size * 2)
        require(next.entries.flatMap { listOf(it.dskPublicKey, it.dekPublicKey) }.distinct().size == next.entries.size * 2)
    }
}
