package org.pca.app.runtime.trustset

import org.json.JSONObject
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.EpochBounds

/** Uses the existing OS-protected persistence port; no Room migration or private-key serialization. */
class PersistentOrdinaryEpochStore(private val store: PersistentStateStore,
    private val key: String = "ordinary_trust_set_v1") : OrdinaryEpochStore {
    override fun read(): OrdinaryEpochState? = synchronized(store.coordinationLock) {
        val raw = store.getString(key) ?: return@synchronized null
        try {
            require(raw.length <= 2097152)
            val json = JSONObject(raw)
            require(json.keys().asSequence().toSet() == setOf("version", "accepted", "pending"))
            require(json.get("version") == 1)
            val accepted = json.getJSONObject("accepted")
            require(accepted.keys().asSequence().toSet() == setOf("canonicalEpochBase64", "signatureBase64",
                "signerDeviceId", "signerKeyId", "trustSetEpoch", "keyEpoch"))
            OrdinaryEpochState(AcceptedEpochRecord(request(accepted), accepted.getString("signerDeviceId"),
                accepted.getString("signerKeyId"), EpochBounds.decodeJson(accepted, "trustSetEpoch"), EpochBounds.decodeJson(accepted, "keyEpoch")),
                if (json.isNull("pending")) null else json.getJSONObject("pending").let {
                    require(it.keys().asSequence().toSet() == setOf("canonicalEpochBase64", "signatureBase64"))
                    request(it)
                })
        } catch (_: Exception) { throw IllegalStateException("corrupt_ordinary_trust_set_state") }
    }
    override fun compareAndSetDurably(expected: OrdinaryEpochState?, next: OrdinaryEpochState): Boolean =
        synchronized(store.coordinationLock) {
            if (read() != expected) return@synchronized false
            try {
                val accepted = encode(next.accepted.request).put("signerDeviceId", next.accepted.signerDeviceId)
                    .put("signerKeyId", next.accepted.signerKeyId).put("trustSetEpoch", next.accepted.trustSetEpoch)
                    .put("keyEpoch", next.accepted.keyEpoch)
                store.putString(key, JSONObject().put("version", 1).put("accepted", accepted)
                    .put("pending", next.pending?.let(::encode) ?: JSONObject.NULL).toString())
                store.flush()
                read() == next
            } catch (_: Exception) { false }
        }
    override fun confirmDurable(expected: OrdinaryEpochState): Boolean = synchronized(store.coordinationLock) {
        try { store.flush(); read() == expected } catch (_: Exception) { false }
    }
    private fun request(json: JSONObject) = OrdinaryEpochRequest(json.getString("canonicalEpochBase64"), json.getString("signatureBase64"))
    private fun encode(request: OrdinaryEpochRequest) = JSONObject().put("canonicalEpochBase64", request.canonicalEpochBase64)
        .put("signatureBase64", request.signatureBase64)
}
