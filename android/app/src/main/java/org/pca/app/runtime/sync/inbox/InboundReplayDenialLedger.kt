package org.pca.app.runtime.sync.inbox

import java.util.Base64
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.runtime.EpochBounds
import org.pca.app.runtime.sync.envelope.FamilyEnvelope
import org.pca.app.runtime.sync.envelope.RecipientBinding

/** Inputs must come from authenticated, permanent retirement authority, not envelope syntax. */
data class InboundReplayRetirementBoundary(
    val scope: RuntimeInboxScope,
    val authorityBinding: String,
    val minimumTrustSetEpoch: Long,
    val minimumKeyEpoch: Long,
    /** Each entry authenticates permanent numeric mode AND a closed prefix for this sender key. */
    val closedNumericPrefixes: Map<String, Long> = emptyMap(),
)

class InboundReplayDenialUnavailable : Exception("Replay denial unavailable")

/** Durable permanent denial independent of message IDs, clocks and application receipt retention. */
class PersistentInboundReplayDenialLedger(
    private val store: PersistentStateStore,
    private val expectedDeviceId: String,
) {
    private val coordinationLock: Any = store.coordinationLock
    private val storageKey = "runtime.inbound-replay-denial.v1." +
        Base64.getUrlEncoder().withoutPadding().encodeToString(expectedDeviceId.toByteArray(Charsets.UTF_8))
    private val requiredKey = storageKey + ".required"
    private val requiredValue = JSONObject().put("version", 1).put("deviceId", expectedDeviceId).toString()

    init { require(expectedDeviceId.isNotBlank() && expectedDeviceId.length <= 128) }

    internal fun matchesJournal(journal: PersistentInboundApplicationJournal): Boolean = journal.matchesBacking(store, expectedDeviceId)

    /** Explicit first initialization only; missing state after initialization must never be recreated. */
    fun initializeFresh(assertAuthority: () -> Unit) = synchronized(coordinationLock) {
        try {
            assertAuthority()
            if (store.contains(storageKey) || store.contains(requiredKey) || store.getString(storageKey) != null || store.getString(requiredKey) != null) unavailable()
            // A crash after the required marker leaves unavailable state, never an empty replay ledger.
            store.putString(requiredKey, requiredValue)
            store.flush()
            if (store.getString(requiredKey) != requiredValue) unavailable()
            assertAuthority()
            persist(emptyList())
        } catch (error: CancellationException) { throw error } catch (_: Exception) { unavailable() }
    }

    fun boundaries(): List<InboundReplayRetirementBoundary> = synchronized(coordinationLock) {
        val boundaries = read()
        persist(boundaries)
        boundaries.map { it.copy(closedNumericPrefixes = it.closedNumericPrefixes.toMap()) }
    }

    /** Caller serializes this with consumer admission and revalidates the authenticated root proof. */
    fun install(boundary: InboundReplayRetirementBoundary, assertAuthority: () -> Unit) = synchronized(coordinationLock) {
        try {
            assertAuthority()
            val immutable = boundary.copy(closedNumericPrefixes = boundary.closedNumericPrefixes.toMap())
            validate(immutable)
            val boundaries = read()
            val prior = boundaries.find { it.scope == immutable.scope }
            if (prior != null) {
                if (immutable.minimumTrustSetEpoch < prior.minimumTrustSetEpoch || immutable.minimumKeyEpoch < prior.minimumKeyEpoch) unavailable()
                // An omitted stream is retained; an explicit decreasing boundary is rejected.
                prior.closedNumericPrefixes.forEach { (sender, prefix) ->
                    if (immutable.closedNumericPrefixes[sender]?.let { it < prefix } == true) unavailable()
                }
            }
            val merged = immutable.copy(closedNumericPrefixes = (prior?.closedNumericPrefixes ?: emptyMap()) + immutable.closedNumericPrefixes)
            validate(merged)
            val next = boundaries.filterNot { it.scope == merged.scope } + merged
            assertAuthority()
            persist(next)
            assertAuthority()
        } catch (error: CancellationException) { throw error } catch (_: Exception) { unavailable() }
    }

    /** Does not authenticate input; it can only reject permanently excluded envelopes. */
    fun isEnvelopeDenied(envelope: FamilyEnvelope, scope: RuntimeInboxScope): Boolean = synchronized(coordinationLock) {
        checkScope(scope)
        if (envelope.familyId != scope.familyId || envelope.recipient != RecipientBinding.Device(scope.recipientDeviceId)) unavailable()
        val boundaries = read()
        persist(boundaries)
        val boundary = boundaries.find { it.scope == scope } ?: return@synchronized false
        if (envelope.trustSetEpoch < boundary.minimumTrustSetEpoch || envelope.keyEpoch < boundary.minimumKeyEpoch) return@synchronized true
        val prefix = boundary.closedNumericPrefixes[envelope.senderKeyId] ?: return@synchronized false
        // Once trusted authority declares this exact key permanently numeric, noncanonical aliases
        // cannot become opaque-mode alternatives. Unknown senders remain opaque and uncompressed.
        val sequence = parseNumeric(envelope.sequenceOrNonce) ?: return@synchronized true
        sequence <= prefix
    }

    /** Epoch floors reject old wrappers but cannot retire a sender/nonce replay identity. */
    fun coversReplayIdentityPermanently(envelope: FamilyEnvelope, scope: RuntimeInboxScope): Boolean = synchronized(coordinationLock) {
        checkScope(scope)
        if (envelope.familyId != scope.familyId || envelope.recipient != RecipientBinding.Device(scope.recipientDeviceId)) unavailable()
        val boundaries = read()
        persist(boundaries)
        val prefix = boundaries.find { it.scope == scope }?.closedNumericPrefixes?.get(envelope.senderKeyId)
            ?: return@synchronized false
        val sequence = parseNumeric(envelope.sequenceOrNonce) ?: return@synchronized true
        sequence <= prefix
    }

    private fun checkScope(scope: RuntimeInboxScope) {
        if (scope.recipientDeviceId != expectedDeviceId) unavailable()
    }

    private fun validate(boundary: InboundReplayRetirementBoundary) {
        checkScope(boundary.scope)
        if (!EpochBounds.isValid(boundary.minimumTrustSetEpoch) || !EpochBounds.isValid(boundary.minimumKeyEpoch) || boundary.closedNumericPrefixes.size > 64) unavailable()
        val binding = Base64.getDecoder().decode(boundary.authorityBinding)
        if (binding.size !in 1..8192 || Base64.getEncoder().encodeToString(binding) != boundary.authorityBinding) unavailable()
        boundary.closedNumericPrefixes.forEach { (sender, prefix) ->
            if (sender.isEmpty() || sender.length > 128 || prefix !in 0..MAX_SEQUENCE) unavailable()
        }
    }

    private fun read(): List<InboundReplayRetirementBoundary> {
        try {
            if (store.getString(requiredKey) != requiredValue) unavailable()
            val raw = store.getString(storageKey) ?: unavailable()
            if (raw.toByteArray(Charsets.UTF_8).size > 131072) unavailable()
            val json = JSONObject(raw)
            if (json.get("version") != 1) unavailable()
            val entries = json.getJSONArray("boundaries")
            if (entries.length() > 16) unavailable()
            val scopes = HashSet<RuntimeInboxScope>()
            var streams = 0
            return (0 until entries.length()).map { index ->
                val item = entries.getJSONObject(index)
                fun string(key: String) = (item.get(key) as? String) ?: unavailable()
                fun integer(source: JSONObject, key: String): Long {
                    val value = source.get(key)
                    if (value !is Int && value !is Long) unavailable()
                    return (value as Number).toLong()
                }
                val scope = RuntimeInboxScope(string("familyId"), string("deviceId"))
                if (!scopes.add(scope)) unavailable()
                val array = item.getJSONArray("prefixes")
                streams += array.length()
                if (streams > 64) unavailable()
                val prefixes = mutableMapOf<String, Long>()
                for (position in 0 until array.length()) {
                    val prefix = array.getJSONObject(position)
                    val sender = (prefix.get("senderKeyId") as? String) ?: unavailable()
                    if (prefixes.put(sender, integer(prefix, "through")) != null) unavailable()
                }
                InboundReplayRetirementBoundary(scope, string("authorityBinding"), integer(item, "trustSetFloor"), integer(item, "keyFloor"), prefixes)
                    .also { validate(it) }
            }
        } catch (_: Exception) { unavailable() }
    }

    private fun persist(boundaries: List<InboundReplayRetirementBoundary>) {
        try {
            if (store.getString(requiredKey) != requiredValue || boundaries.size > 16 || boundaries.sumOf { it.closedNumericPrefixes.size } > 64) unavailable()
            val array = JSONArray()
            boundaries.forEach { boundary ->
                validate(boundary)
                val prefixes = JSONArray()
                boundary.closedNumericPrefixes.toSortedMap().forEach { (sender, prefix) ->
                    prefixes.put(JSONObject().put("senderKeyId", sender).put("through", prefix))
                }
                array.put(JSONObject().put("familyId", boundary.scope.familyId).put("deviceId", boundary.scope.recipientDeviceId)
                    .put("authorityBinding", boundary.authorityBinding).put("trustSetFloor", boundary.minimumTrustSetEpoch)
                    .put("keyFloor", boundary.minimumKeyEpoch).put("prefixes", prefixes))
            }
            val raw = JSONObject().put("version", 1).put("boundaries", array).toString()
            if (raw.toByteArray(Charsets.UTF_8).size > 131072) unavailable()
            store.putString(storageKey, raw)
            store.flush()
            if (store.getString(storageKey) != raw || store.getString(requiredKey) != requiredValue) unavailable()
        } catch (_: Exception) { unavailable() }
    }

    private fun unavailable(): Nothing = throw InboundReplayDenialUnavailable()
    private companion object {
        const val MAX_SEQUENCE = 999_999_999_999_999L
        val NUMERIC_SHAPE = Regex("0|[1-9][0-9]{0,14}")
        fun parseNumeric(value: String): Long? = if (NUMERIC_SHAPE.matches(value)) value.toLongOrNull() else null
    }
}
