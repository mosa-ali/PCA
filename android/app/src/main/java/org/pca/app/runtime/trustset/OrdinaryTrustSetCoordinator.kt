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
    /** Exact accepted predecessor used to sign pending, retained across catch-up and process death. */
    val pendingBase: AcceptedEpochRecord? = null,
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
        // Locally-created pending requests retain the exact accepted signing base. The wire
        // field is lineage metadata at the server boundary, but this client writes the precise
        // current floor so its durable custody record can be verified after restart.
        require(candidate.supersedesEpoch == prior.trustSetEpoch)
        validateTransition(prior, candidate)
        // A valid local owner signature proves authorship, not that the server accepted this
        // persisted floor. Before using it to authorize another DSK signature, require the
        // authenticated server projection to match the exact durable record. If the server
        // advanced, runtime reconciliation must verify/catch up the chain before retrying.
        val serverHead = try { api.getHead(prior.familyId) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { return@withLock false }
        if (serverHead != current.accepted || !store.confirmDurable(current)) return@withLock false
        val bytes = TrustSetEpochCodec.canonicalize(candidate).toByteArray(Charsets.UTF_8)
        val signature = signer.signCanonicalDer(signingAlias, bytes)
        require(signature.size == 64)
        val request = OrdinaryEpochRequest(Base64.getEncoder().encodeToString(bytes), Base64.getEncoder().encodeToString(signature))
        require(verifier.verify(owner.dskPublicKey, bytes, request.signatureBase64))
        store.compareAndSetDurably(current, current.copy(pending = request, pendingBase = current.accepted))
    }

    /** A timeout leaves the persisted request unchanged. Restart callers invoke this without preparing again. */
    suspend fun submitExact(): Boolean = flight.withLock { contact(false) }
    suspend fun reconcile(): Boolean = flight.withLock { contact(true) }

    /** Reconcile authenticated server records back to the trusted local floor. */
    suspend fun catchUp(maximumRecords: Int = 32): Int = flight.withLock {
        require(maximumRecords in 1..32)
        val initial = store.read() ?: return@withLock 0
        if (!hasTrustedFloor(initial)) return@withLock 0
        // Newer states retain the exact predecessor used to sign a pending request. Older v1/v2
        // states did not, and catch-up could already have advanced their accepted floor while
        // leaving the request behind. Authenticate a legacy request only if its claimed
        // predecessor can be proven on the accepted chain; otherwise preserve it while allowing
        // independent server catch-up to proceed.
        var provenPendingBase = initial.pendingBase
        val pendingEpoch = initial.pending?.let { pending ->
            if (initial.pendingBase != null) {
                verifyPending(initial, pending).first
            } else {
                val candidate = try {
                    TrustSetEpochCodec.decodeCanonical(canonicalBytes(pending))
                } catch (_: Exception) {
                    null
                }
                val predecessor = candidate?.supersedesEpoch?.let { epoch ->
                    resolveProvenPendingBase(initial, epoch)
                }
                if (predecessor == null) {
                    null
                } else {
                    try {
                        verifyPending(initial, pending, predecessor).also { provenPendingBase = predecessor }.first
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        null
                    }
                }
            }
        }
        val anchor = decode(initial.accepted)
        val chain = mutableListOf<AcceptedEpochRecord>()
        var cursor = try { api.getHead(anchor.familyId) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { return@withLock 0 }
        val targetHead = cursor
        while (true) {
            val candidate = decode(cursor)
            require(candidate.familyId == anchor.familyId)
            if (candidate.trustSetEpoch == anchor.trustSetEpoch) {
                require(cursor == initial.accepted)
                if (initial.pending != null && pendingEpoch?.trustSetEpoch?.let { it <= candidate.trustSetEpoch } == true) {
                    if (store.confirmDurable(initial) &&
                        store.compareAndSetDurably(initial, initial.copy(pending = null, pendingBase = null))) {
                        return@withLock 0
                    }
                }
                break
            }
            require(candidate.trustSetEpoch > anchor.trustSetEpoch && chain.size < maximumRecords)
            chain.add(cursor)
            val predecessor = candidate.supersedesEpoch
            require(predecessor == null || predecessor < candidate.trustSetEpoch)
            // `supersedesEpoch` is lineage metadata and may be absent or point to an older
            // accepted epoch. The immutable epoch-1 owner DSK authenticates each fetched hop;
            // never require metadata to form an immediate predecessor edge to the local floor.
            // Stop after the requested number of records: the earliest collected record is still
            // verified directly from the trusted local floor, so older records are unnecessary
            // and a distant server head remains adoptable through this bounded call.
            if (predecessor == null || predecessor <= anchor.trustSetEpoch || chain.size >= maximumRecords) break
            cursor = try { api.getEpoch(anchor.familyId, predecessor) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { return@withLock 0 }
            require(cursor.trustSetEpoch == predecessor)
        }
        // Verify the complete chain before persisting any hop. A malformed late hop must not
        // leave a partial floor advance that strands pending custody without its original base.
        val verifiedHops = mutableListOf<Pair<AcceptedEpochRecord, UntrustedTrustSetEpoch>>()
        var verificationFloor = anchor
        for (accepted in chain.asReversed()) {
            val prior = verificationFloor
            val candidate = decode(accepted)
            validateTransition(prior, candidate)
            val owner = owner(prior)
            require(accepted.signerDeviceId == owner.deviceId && accepted.signerKeyId == owner.dskKeyId)
            require(verifier.verify(owner.dskPublicKey, TrustSetEpochCodec.canonicalize(candidate).toByteArray(Charsets.UTF_8),
                accepted.request.signatureBase64))
            verifiedHops += accepted to candidate
            verificationFloor = candidate
        }
        require(verificationFloor == decode(targetHead))

        var progressed = 0
        var expected = initial
        for ((accepted, candidate) in verifiedHops) {
            val current = store.read() ?: return@withLock progressed
            if (current != expected || !store.confirmDurable(current)) return@withLock progressed
            // A verified accepted floor at or beyond the exact pending candidate makes that
            // persisted attempt stale. Keep its original predecessor until that point so a
            // restart during a multi-hop catch-up can still verify its signature.
            val clearPending = current.pending != null && pendingEpoch?.trustSetEpoch?.let { it <= candidate.trustSetEpoch } == true
            val next = OrdinaryEpochState(accepted,
                pending = if (clearPending) null else current.pending,
                rootAnchor = current.rootAnchor,
                pendingBase = if (clearPending) null else current.pending?.let { current.pendingBase ?: provenPendingBase },
            )
            if (!store.compareAndSetDurably(current, next)) return@withLock progressed
            progressed++
            expected = next
        }
        progressed
    }

    private suspend fun contact(status: Boolean): Boolean {
        val current = store.read() ?: return false
        if (!hasTrustedFloor(current)) return false
        val pending = current.pending ?: return false
        if (!store.confirmDurable(current)) return false
        val acceptedFloorEpoch = decode(current.accepted).trustSetEpoch
        val (pendingEpoch, pendingBytes) = try {
            verifyPending(current, pending)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            // Preserve the established corruption signal for v3 custody, but make a legacy
            // request with no provable predecessor a normal fail-closed no-op.
            if (current.pendingBase != null) throw failure
            return false
        }
        // A legacy state has no durable custody base. Its signed lineage pointer can establish
        // the base only when it names the exact still-current accepted record. A null or older
        // pointer must never inherit the current floor just because the signature verifies.
        if (current.pendingBase == null && pendingEpoch.supersedesEpoch != acceptedFloorEpoch) return false
        // A request signed from a prior accepted floor is never resubmitted after catch-up has
        // advanced that floor. Catch-up alone decides when the signed candidate is stale.
        if (current.pendingBase != null && current.pendingBase != current.accepted) return false
        val prior = decode(current.accepted)
        val response = try {
            if (status) api.status(prior.familyId, pending) else api.submit(prior.familyId, pending)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { return false }
        if (response.outcome == OrdinaryEpochOutcome.NOT_ACCEPTED || response.outcome == OrdinaryEpochOutcome.CONFLICT) return false
        val accepted = response.acceptedEpoch ?: return false
        // The exact accepted record is sufficient proof for this persisted request even when the
        // server head advanced concurrently. Adopt only this verified request now; the caller's
        // subsequent catchUp walks and verifies the newer head separately before advancing past it.
        if (accepted.request != pending) return false
        val candidate = decode(accepted)
        validateTransition(prior, candidate)
        require(candidate == pendingEpoch)
        val projectedHead = decode(response.acceptedHead)
        require(projectedHead.familyId == prior.familyId &&
            projectedHead.trustSetEpoch >= candidate.trustSetEpoch && projectedHead.keyEpoch >= candidate.keyEpoch)
        if (projectedHead.trustSetEpoch == candidate.trustSetEpoch) require(response.acceptedHead == accepted)
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
                require(accepted.supersedesEpoch == null || accepted.supersedesEpoch < accepted.trustSetEpoch)
            }
            require(verifier.verify(rootOwner.dskPublicKey, canonicalBytes(state.accepted.request),
                state.accepted.request.signatureBase64))
            true
        } catch (_: Exception) {
            false
        }
    }

    /** Validate durable request custody against the exact current accepted owner and floor. */
    private fun verifyPending(
        state: OrdinaryEpochState,
        request: OrdinaryEpochRequest,
        priorRecord: AcceptedEpochRecord = state.pendingBase ?: state.accepted,
    ): Pair<UntrustedTrustSetEpoch, ByteArray> {
        val prior = decode(priorRecord)
        val current = decode(state.accepted)
        val rootRecord = state.rootAnchor ?: error("missing_ordinary_trust_set_root")
        val root = decode(rootRecord)
        val priorOwner = owner(prior)
        val rootOwner = owner(root)
        val currentOwner = owner(current)
        require(prior.familyId == current.familyId && prior.familyId == root.familyId)
        require(prior.trustSetEpoch <= current.trustSetEpoch && prior.keyEpoch <= current.keyEpoch)
        if (prior.trustSetEpoch == current.trustSetEpoch) require(priorRecord == state.accepted)
        require(priorOwner.deviceId == rootOwner.deviceId && priorOwner.dskKeyId == rootOwner.dskKeyId &&
            priorOwner.dskPublicKey == rootOwner.dskPublicKey && currentOwner.deviceId == rootOwner.deviceId &&
            currentOwner.dskKeyId == rootOwner.dskKeyId && currentOwner.dskPublicKey == rootOwner.dskPublicKey)
        require(priorRecord.signerDeviceId == rootOwner.deviceId && priorRecord.signerKeyId == rootOwner.dskKeyId)
        require(verifier.verify(rootOwner.dskPublicKey, canonicalBytes(priorRecord.request), priorRecord.request.signatureBase64))
        require(priorOwner.deviceId == localDeviceId && priorOwner.dskKeyId == localSigningKeyId)
        val bytes = canonicalBytes(request)
        val candidate = TrustSetEpochCodec.decodeCanonical(bytes)
        validateTransition(prior, candidate)
        // A persisted pending request is locally signed from this exact durable base. Keep
        // custody separate from the server's looser lineage metadata contract: without this
        // binding a modified pendingBase could authorize replay from an invented floor.
        require(candidate.supersedesEpoch == prior.trustSetEpoch)
        require(verifier.verify(priorOwner.dskPublicKey, bytes, request.signatureBase64))
        return candidate to bytes
    }

    /** Resolve the accepted epoch named by a legacy pending request's signed metadata. */
    private suspend fun resolveProvenPendingBase(
        state: OrdinaryEpochState,
        targetEpoch: Int,
    ): AcceptedEpochRecord? {
        val rootRecord = state.rootAnchor ?: return null
        val root = try { decode(rootRecord) } catch (_: Exception) { return null }
        val rootOwner = try { owner(root) } catch (_: Exception) { return null }
        val accepted = try { decode(state.accepted) } catch (_: Exception) { return null }
        if (targetEpoch !in 1..accepted.trustSetEpoch || root.familyId != accepted.familyId) return null
        val predecessor = when (targetEpoch) {
            root.trustSetEpoch -> rootRecord
            accepted.trustSetEpoch -> state.accepted
            else -> try {
                api.getEpoch(accepted.familyId, targetEpoch)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                return null
            }
        }
        val prior = try { decode(predecessor) } catch (_: Exception) { return null }
        if (predecessor.trustSetEpoch != targetEpoch || prior.familyId != accepted.familyId ||
            prior.trustSetEpoch > accepted.trustSetEpoch || prior.keyEpoch > accepted.keyEpoch ||
            (prior.supersedesEpoch != null && prior.supersedesEpoch >= prior.trustSetEpoch)) return null
        if (targetEpoch == root.trustSetEpoch && predecessor != rootRecord) return null
        val priorOwner = try { owner(prior) } catch (_: Exception) { return null }
        if (priorOwner.deviceId != rootOwner.deviceId || priorOwner.dskKeyId != rootOwner.dskKeyId ||
            priorOwner.dskPublicKey != rootOwner.dskPublicKey || predecessor.signerDeviceId != rootOwner.deviceId ||
            predecessor.signerKeyId != rootOwner.dskKeyId) return null
        val bytes = try { TrustSetEpochCodec.canonicalize(prior).toByteArray(Charsets.UTF_8) }
        catch (_: Exception) { return null }
        return if (verifier.verify(rootOwner.dskPublicKey, bytes, predecessor.request.signatureBase64)) predecessor else null
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
        require(prior.keyEpoch >= 1 && next.keyEpoch >= prior.keyEpoch &&
            (next.supersedesEpoch == null || next.supersedesEpoch < next.trustSetEpoch))
        val beforeOwner = owner(prior)
        val afterOwner = owner(next)
        require(afterOwner.deviceId == beforeOwner.deviceId && afterOwner.dskKeyId == beforeOwner.dskKeyId &&
            afterOwner.dskPublicKey == beforeOwner.dskPublicKey)
        require(next.entries.map { it.deviceId }.distinct().size == next.entries.size)
        require(next.entries.flatMap { listOf(it.dskKeyId, it.dekKeyId) }.distinct().size == next.entries.size * 2)
        require(next.entries.flatMap { listOf(it.dskPublicKey, it.dekPublicKey) }.distinct().size == next.entries.size * 2)
    }
}
