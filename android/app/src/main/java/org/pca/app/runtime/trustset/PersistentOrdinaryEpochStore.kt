package org.pca.app.runtime.trustset

import java.util.Base64
import org.json.JSONObject
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.EpochBounds

/** Uses OS-protected persistence; no Room migration or private-key serialization. */
class PersistentOrdinaryEpochStore(
    private val store: PersistentStateStore,
    private val key: String = "ordinary_trust_set_v1",
) : OrdinaryEpochStore {
    override fun read(): OrdinaryEpochState? = synchronized(store.coordinationLock) {
        val raw = store.getString(key) ?: return@synchronized null
        try {
            require(raw.length <= MAX_STATE_UTF16_UNITS)
            StrictJsonMemberNames.requireUnique(raw)
            val json = JSONObject(raw)
            val version = json.get("version")
            val rootAnchor: AcceptedEpochRecord?
            val pendingBase: AcceptedEpochRecord?
            val acceptedBase: AcceptedEpochRecord?
            when (version) {
                1 -> {
                    require(json.keys().asSequence().toSet() == LEGACY_STATE_KEYS)
                    rootAnchor = null
                    pendingBase = null
                    acceptedBase = null
                }
                2 -> {
                    require(json.keys().asSequence().toSet() == CURRENT_STATE_KEYS)
                    rootAnchor = if (json.isNull("rootAnchor")) null else readAccepted(json.getJSONObject("rootAnchor"))
                    pendingBase = null
                    acceptedBase = null
                }
                3 -> {
                    require(json.keys().asSequence().toSet() == CURRENT_V3_STATE_KEYS)
                    rootAnchor = if (json.isNull("rootAnchor")) null else readAccepted(json.getJSONObject("rootAnchor"))
                    pendingBase = if (json.isNull("pendingBase")) null else readAccepted(json.getJSONObject("pendingBase"))
                    acceptedBase = null
                }
                4 -> {
                    require(json.keys().asSequence().toSet() == CURRENT_V4_STATE_KEYS)
                    rootAnchor = if (json.isNull("rootAnchor")) null else readAccepted(json.getJSONObject("rootAnchor"))
                    pendingBase = if (json.isNull("pendingBase")) null else readAccepted(json.getJSONObject("pendingBase"))
                    acceptedBase = if (json.isNull("acceptedBase")) null else readAccepted(json.getJSONObject("acceptedBase"))
                }
                else -> error("unsupported_ordinary_trust_set_version")
            }
            val accepted = readAccepted(json.getJSONObject("accepted"))
            val pending = if (json.isNull("pending")) null else readRequest(json.getJSONObject("pending"))
            OrdinaryEpochState(accepted, pending, rootAnchor, pendingBase, acceptedBase).also(::validateState)
        } catch (_: Exception) {
            throw IllegalStateException("corrupt_ordinary_trust_set_state")
        }
    }

    override fun compareAndSetDurably(expected: OrdinaryEpochState?, next: OrdinaryEpochState): Boolean =
        synchronized(store.coordinationLock) {
            val current = read()
            // Ordinary CAS can advance only a previously bootstrapped durable floor.
            // The empty-store transition is reserved for the root-anchor verifier below.
            if (current == null || current.rootAnchor == null) return@synchronized false
            if (current != expected) return@synchronized false
            try {
                validateState(next)
                // A legacy v1 state has no root. It cannot acquire one later from a projection.
                if (next.rootAnchor != current.rootAnchor) return@synchronized false
                val old = TrustSetEpochCodec.decodeCanonical(decodeCanonicalRequest(current.accepted.request))
                val new = TrustSetEpochCodec.decodeCanonical(decodeCanonicalRequest(next.accepted.request))
                require(old.familyId == new.familyId && new.keyEpoch >= old.keyEpoch)
                if (next.accepted == current.accepted) {
                    if (next.acceptedBase != current.acceptedBase) return@synchronized false
                } else {
                    require(new.trustSetEpoch > old.trustSetEpoch && new.supersedesEpoch == old.trustSetEpoch)
                    if (next.acceptedBase != current.accepted) return@synchronized false
                    val previousOwner = old.entries.single {
                        it.role == TrustSetRole.OWNER && it.status == TrustSetMembershipStatus.ACTIVE
                    }
                    require(next.accepted.signerDeviceId == previousOwner.deviceId &&
                        next.accepted.signerKeyId == previousOwner.dskKeyId)
                }
                if (next.pending == null) {
                    if (next.pendingBase != null) return@synchronized false
                } else if (next.pending != current.pending) {
                    // A new immutable request can only be signed from the exact accepted floor
                    // that was current when it entered durable custody.
                    if (next.pendingBase != current.accepted) return@synchronized false
                } else if (next.pendingBase != current.pendingBase && current.pendingBase != null) {
                    return@synchronized false
                }
                writeDurably(next)
            } catch (_: Exception) {
                false
            }
        }

    /** Only the verifier that checked durable statement B may create the initial accepted floor. */
    internal fun initializeFromVerifiedRoot(next: OrdinaryEpochState): Boolean = synchronized(store.coordinationLock) {
        if (read() != null || next.rootAnchor == null || next.rootAnchor != next.accepted) return@synchronized false
        try {
            validateState(next)
            val root = TrustSetEpochCodec.decodeCanonical(decodeCanonicalRequest(next.accepted.request))
            require(root.trustSetEpoch == 1 && root.keyEpoch == 1 && root.supersedesEpoch == null)
            writeDurably(next)
        } catch (_: Exception) {
            false
        }
    }

    override fun confirmDurable(expected: OrdinaryEpochState): Boolean = synchronized(store.coordinationLock) {
        try { store.flush(); read() == expected } catch (_: Exception) { false }
    }

    private fun validateState(state: OrdinaryEpochState) {
        val acceptedEpoch = validateAccepted(state.accepted)
        state.rootAnchor?.let { root ->
            val rootEpoch = validateAccepted(root)
            require(rootEpoch.trustSetEpoch == 1 && rootEpoch.keyEpoch == 1 && rootEpoch.supersedesEpoch == null)
            require(rootEpoch.entries.size == 1 && rootEpoch.entries.single().role == TrustSetRole.OWNER &&
                rootEpoch.entries.single().status == TrustSetMembershipStatus.ACTIVE)
            val rootOwner = rootEpoch.entries.single()
            require(rootEpoch.familyId == acceptedEpoch.familyId)
            require(acceptedEpoch.trustSetEpoch >= 1 && acceptedEpoch.keyEpoch >= 1)
            if (state.accepted == root) {
                require(state.acceptedBase == null)
                require(state.accepted.signerDeviceId == rootOwner.deviceId && state.accepted.signerKeyId == rootOwner.dskKeyId)
            } else if (state.acceptedBase == null) {
                // v1-v3 rows were written while ordinary epochs required the root owner to
                // remain current. They may be read as stable-root history but cannot imply a
                // transfer predecessor after upgrade.
                require(acceptedEpoch.trustSetEpoch > rootEpoch.trustSetEpoch)
                val acceptedOwner = acceptedEpoch.entries.single {
                    it.role == TrustSetRole.OWNER && it.status == TrustSetMembershipStatus.ACTIVE
                }
                require(acceptedOwner.deviceId == rootOwner.deviceId && acceptedOwner.dskKeyId == rootOwner.dskKeyId &&
                    acceptedOwner.dskPublicKey == rootOwner.dskPublicKey &&
                    state.accepted.signerDeviceId == rootOwner.deviceId && state.accepted.signerKeyId == rootOwner.dskKeyId)
            } else {
                val baseRecord = requireNotNull(state.acceptedBase)
                val baseEpoch = validateAccepted(baseRecord)
                require(baseEpoch.familyId == rootEpoch.familyId && baseEpoch.trustSetEpoch >= rootEpoch.trustSetEpoch &&
                    baseEpoch.trustSetEpoch < acceptedEpoch.trustSetEpoch && baseEpoch.keyEpoch >= rootEpoch.keyEpoch &&
                    acceptedEpoch.keyEpoch >= baseEpoch.keyEpoch && acceptedEpoch.supersedesEpoch == baseEpoch.trustSetEpoch)
                if (baseEpoch.trustSetEpoch == rootEpoch.trustSetEpoch) require(baseRecord == root)
                val baseOwner = baseEpoch.entries.single {
                    it.role == TrustSetRole.OWNER && it.status == TrustSetMembershipStatus.ACTIVE
                }
                require(state.accepted.signerDeviceId == baseOwner.deviceId && state.accepted.signerKeyId == baseOwner.dskKeyId)
            }
        }
        if (state.pending == null) {
            require(state.pendingBase == null)
        } else {
            state.pendingBase?.let { baseRecord ->
                val base = validateAccepted(baseRecord)
                require(base.familyId == acceptedEpoch.familyId && base.trustSetEpoch <= acceptedEpoch.trustSetEpoch &&
                    base.keyEpoch <= acceptedEpoch.keyEpoch)
                if (base.trustSetEpoch == acceptedEpoch.trustSetEpoch) require(baseRecord == state.accepted)
                val candidate = TrustSetEpochCodec.decodeCanonical(decodeCanonicalRequest(state.pending))
                require(candidate.familyId == base.familyId && candidate.trustSetEpoch > base.trustSetEpoch &&
                    candidate.supersedesEpoch == base.trustSetEpoch && candidate.keyEpoch >= base.keyEpoch)
            }
        }
    }

    private fun validateAccepted(record: AcceptedEpochRecord): UntrustedTrustSetEpoch {
        require(record.trustSetEpoch >= 1 && record.keyEpoch >= 1)
        val bytes = decodeCanonicalRequest(record.request)
        val epoch = TrustSetEpochCodec.decodeCanonical(bytes)
        require(TrustSetEpochCodec.canonicalize(epoch).toByteArray(Charsets.UTF_8).contentEquals(bytes))
        require(epoch.trustSetEpoch == record.trustSetEpoch && epoch.keyEpoch == record.keyEpoch)
        require(record.signerDeviceId.isNotBlank() && record.signerKeyId.isNotBlank())
        decodeSignature(record.request.signatureBase64)
        return epoch
    }

    private fun decodeCanonicalRequest(request: OrdinaryEpochRequest): ByteArray {
        require(request.canonicalEpochBase64.length <= TrustSetEpochCodec.MAX_CANONICAL_UTF16_UNITS * 4)
        val bytes = Base64.getDecoder().decode(request.canonicalEpochBase64)
        require(Base64.getEncoder().encodeToString(bytes) == request.canonicalEpochBase64)
        return bytes
    }

    private fun decodeSignature(value: String): ByteArray {
        require(value.length == 88)
        val bytes = Base64.getDecoder().decode(value)
        require(bytes.size == 64 && Base64.getEncoder().encodeToString(bytes) == value)
        return bytes
    }

    private fun readAccepted(json: JSONObject): AcceptedEpochRecord {
        require(json.keys().asSequence().toSet() == ACCEPTED_KEYS)
        return AcceptedEpochRecord(
            OrdinaryEpochRequest(json.getString("canonicalEpochBase64"), json.getString("signatureBase64")),
            json.getString("signerDeviceId"), json.getString("signerKeyId"),
            EpochBounds.decodeJson(json, "trustSetEpoch"), EpochBounds.decodeJson(json, "keyEpoch"),
        )
    }

    private fun readRequest(json: JSONObject): OrdinaryEpochRequest {
        require(json.keys().asSequence().toSet() == REQUEST_KEYS)
        return OrdinaryEpochRequest(json.getString("canonicalEpochBase64"), json.getString("signatureBase64"))
    }

    private fun encodeAccepted(record: AcceptedEpochRecord) = encodeRequest(record.request)
        .put("signerDeviceId", record.signerDeviceId).put("signerKeyId", record.signerKeyId)
        .put("trustSetEpoch", record.trustSetEpoch).put("keyEpoch", record.keyEpoch)

    private fun encodeRequest(request: OrdinaryEpochRequest) = JSONObject()
        .put("canonicalEpochBase64", request.canonicalEpochBase64).put("signatureBase64", request.signatureBase64)

    private fun writeDurably(next: OrdinaryEpochState): Boolean {
        val accepted = encodeAccepted(next.accepted)
        val rootAnchor = next.rootAnchor?.let(::encodeAccepted) ?: JSONObject.NULL
        val pendingBase = next.pendingBase?.let(::encodeAccepted) ?: JSONObject.NULL
        val acceptedBase = next.acceptedBase?.let(::encodeAccepted) ?: JSONObject.NULL
        store.putString(
            key,
            JSONObject().put("version", 4).put("accepted", accepted)
                .put("rootAnchor", rootAnchor).put("pending", next.pending?.let(::encodeRequest) ?: JSONObject.NULL)
                .put("pendingBase", pendingBase).put("acceptedBase", acceptedBase).toString(),
        )
        store.flush()
        return read() == next
    }

    private companion object {
        const val MAX_STATE_UTF16_UNITS = 4_194_304
        val REQUEST_KEYS = setOf("canonicalEpochBase64", "signatureBase64")
        val ACCEPTED_KEYS = REQUEST_KEYS + setOf("signerDeviceId", "signerKeyId", "trustSetEpoch", "keyEpoch")
        val LEGACY_STATE_KEYS = setOf("version", "accepted", "pending")
        val CURRENT_STATE_KEYS = setOf("version", "accepted", "rootAnchor", "pending")
        val CURRENT_V3_STATE_KEYS = CURRENT_STATE_KEYS + "pendingBase"
        val CURRENT_V4_STATE_KEYS = CURRENT_V3_STATE_KEYS + "acceptedBase"
    }
}
