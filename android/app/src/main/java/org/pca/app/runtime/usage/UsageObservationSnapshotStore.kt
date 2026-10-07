package org.pca.app.runtime.usage

import org.pca.app.foundation.PersistentStateStore
import org.pca.app.platform.UsageClockSample
import org.pca.app.platform.UsageClockBridge
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.Base64

/**
 * Durable snapshot of [UsageSessionEngineState], the restart-safety counterpart to
 * `ScreenTimeSnapshot` (`feature/screentime/persistence/ScreenTimeSnapshot.kt`). [bootId] is used
 * the same way: stable across a process restart, different across a device reboot, so
 * [UsageObservationRestorer] can tell the two apart.
 */
data class UsageObservationSnapshot(
    val engineState: UsageSessionEngineState,
    val bootId: String?,
    val schemaVersion: Int = 1,
    val bridgeSample: UsageClockSample? = null,
    val deviceId: String? = null,
    val coverage: UsageObservationCoverage = UsageObservationCoverage.UNKNOWN,
    val observationGeneration: String? = null,
    val generationAnchor: UsageClockSample? = bridgeSample,
)

/** BASELINE is a fresh observation boundary; no earlier interval is credited.
 * OBSERVED describes validated sampled provenance, not gapless platform history. */
enum class UsageObservationCoverage { UNKNOWN, BASELINE, OBSERVED }
class UsageObservationSnapshotUnavailable : IllegalStateException("Usage observation snapshot unavailable")

interface UsageObservationSnapshotStore {
    fun save(snapshot: UsageObservationSnapshot)
    fun load(): UsageObservationSnapshot?
}

/** In-memory reference implementation -- tests and any caller before a durable store is wired in. */
class InMemoryUsageObservationSnapshotStore : UsageObservationSnapshotStore {
    private var current: UsageObservationSnapshot? = null

    override fun save(snapshot: UsageObservationSnapshot) {
        current = snapshot
    }

    override fun load(): UsageObservationSnapshot? = current
}

/**
 * Coordinator integration adapter: backs this port with the same generic [PersistentStateStore]
 * `PersistentScreenTimeSnapshotStore` uses, so process-restart survivability for usage-session
 * tracking gets the same OS-backed at-rest protection (doc 09 Section 7) as every other runtime
 * snapshot in this app -- not a second, weaker persistence mechanism.
 */
class PersistentUsageObservationSnapshotStore(
    private val store: PersistentStateStore,
    private val key: String = KEY,
) : UsageObservationSnapshotStore {

    override fun save(snapshot: UsageObservationSnapshot) {
        val raw = encode(snapshot)
        store.putString(key, raw)
        store.flush()
        if (store.getString(key) != raw) throw UsageObservationSnapshotUnavailable()
    }

    override fun load(): UsageObservationSnapshot? {
        val raw = store.getString(key) ?: return null
        return decode(raw) ?: throw UsageObservationSnapshotUnavailable()
    }

    internal fun encode(snapshot: UsageObservationSnapshot): String {
        if (snapshot.schemaVersion == 2) return encodeV2(snapshot)
        require(snapshot.schemaVersion == 1)
        val open = snapshot.engineState.openSession
        val fields = listOf(
            open?.appToken ?: NULL_SENTINEL,
            (open?.startedAtElapsedMillis ?: 0L).toString(),
            (open?.startedAtEpochMillis ?: 0L).toString(),
            snapshot.engineState.lastProcessedElapsedMillis.toString(),
            snapshot.bootId ?: NULL_SENTINEL,
        )
        require(fields.none { it.contains(FIELD_SEPARATOR) })
        return fields.joinToString(FIELD_SEPARATOR)
    }

    internal fun decode(raw: String): UsageObservationSnapshot? {
        if (raw.length > 16_384) return null
        if (raw.startsWith("v2:")) return decodeV2(raw)
        val parts = raw.split(FIELD_SEPARATOR)
        if (parts.size != FIELD_COUNT) return null
        return try {
            val openToken = parts[0].takeIf { it != NULL_SENTINEL }
            val open = openToken?.let {
                OpenUsageSession(
                    appToken = it,
                    startedAtElapsedMillis = parts[1].toLong(),
                    startedAtEpochMillis = parts[2].toLong(),
                )
            }
            UsageObservationSnapshot(
                engineState = UsageSessionEngineState(
                    openSession = open,
                    lastProcessedElapsedMillis = parts[3].toLong(),
                ),
                bootId = parts[4].takeIf { it != NULL_SENTINEL },
            )
        } catch (_: IllegalArgumentException) {
            // Malformed/corrupt persisted value -- fail safe to "no snapshot" rather than crash;
            // UsageObservationRestorer's own fallback (fresh state) takes over from there.
            null
        }
    }

    private fun encodeV2(snapshot: UsageObservationSnapshot): String {
        validateV2(snapshot)
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { out ->
            out.writeInt(2)
            out.writeIdentity(snapshot.bootId)
            out.writeIdentity(snapshot.deviceId)
            out.writeIdentity(snapshot.coverage.name)
            out.writeIdentity(snapshot.observationGeneration)
            out.writeBoolean(snapshot.generationAnchor != null)
            snapshot.generationAnchor?.let { out.writeLong(it.elapsedMillis); out.writeLong(it.wallMillis) }
            out.writeBoolean(snapshot.bridgeSample != null)
            snapshot.bridgeSample?.let { out.writeLong(it.elapsedMillis); out.writeLong(it.wallMillis) }
            out.writeLong(snapshot.engineState.lastProcessedElapsedMillis)
            val open = snapshot.engineState.openSession
            out.writeBoolean(open != null)
            open?.let { out.writeIdentity(it.appToken); out.writeLong(it.startedAtElapsedMillis); out.writeLong(it.startedAtEpochMillis) }
        }
        return "v2:" + Base64.getEncoder().encodeToString(bytes.toByteArray())
    }

    private fun decodeV2(raw: String): UsageObservationSnapshot? = try {
        val encoded = raw.removePrefix("v2:")
        val bytes = Base64.getDecoder().decode(encoded)
        require(bytes.size <= 12_288 && Base64.getEncoder().encodeToString(bytes) == encoded)
        val input = DataInputStream(ByteArrayInputStream(bytes))
        require(input.readInt() == 2)
        val boot = input.readIdentity()
        val device = input.readIdentity()
        val coverage = UsageObservationCoverage.valueOf(input.readIdentity() ?: error("missing coverage"))
        val generation = input.readIdentity()
        val anchor = if (input.readFlag()) UsageClockSample(input.readLong(), input.readLong()) else null
        val sample = if (input.readFlag()) UsageClockSample(input.readLong(), input.readLong()) else null
        val cursor = input.readLong()
        val open = if (input.readFlag()) OpenUsageSession(input.readIdentity() ?: error("missing app"), input.readLong(), input.readLong()) else null
        require(input.available() == 0)
        UsageObservationSnapshot(UsageSessionEngineState(open, cursor), boot, 2, sample, device, coverage, generation, anchor)
            .also { validateV2(it) }
    } catch (_: Exception) { null }

    private fun validateV2(snapshot: UsageObservationSnapshot) {
        require(snapshot.schemaVersion == 2)
        val cursor = snapshot.engineState.lastProcessedElapsedMillis
        require(cursor >= UsageSessionEngineState.UNSET_CURSOR)
        val sample = snapshot.bridgeSample
        if (sample == null) {
            require(snapshot.coverage == UsageObservationCoverage.UNKNOWN && cursor == UsageSessionEngineState.UNSET_CURSOR)
        } else {
            require(UsageClockBridge.valid(sample) && cursor <= sample.elapsedMillis)
        }
        snapshot.engineState.openSession?.let {
            require(snapshot.coverage == UsageObservationCoverage.OBSERVED && sample != null && snapshot.bootId != null && snapshot.deviceId != null)
            require(it.startedAtElapsedMillis >= 0L && it.startedAtElapsedMillis <= cursor && it.startedAtEpochMillis >= 0L)
            val anchor = requireNotNull(snapshot.generationAnchor)
            // A persisted original-wall start must belong to this generation's sampled
            // bridge. Nonnegative endpoints alone accept impossible future timestamps.
            require(UsageClockBridge.continuous(anchor,
                UsageClockSample(it.startedAtElapsedMillis, it.startedAtEpochMillis)))
        }
        if (snapshot.coverage != UsageObservationCoverage.UNKNOWN) require(sample != null && snapshot.observationGeneration != null && snapshot.generationAnchor != null)
        snapshot.generationAnchor?.let { anchor ->
            require(UsageClockBridge.valid(anchor) && sample != null && UsageClockBridge.continuous(anchor, sample))
        }
    }

    private fun DataOutputStream.writeIdentity(value: String?) {
        if (value == null) { writeInt(-1); return }
        require(value.isNotEmpty() && value.length <= 128)
        val encoded = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(value))
        val bytes = ByteArray(encoded.remaining()); encoded.get(bytes)
        writeInt(bytes.size); write(bytes)
    }

    private fun DataInputStream.readIdentity(): String? {
        val count = readInt()
        if (count == -1) return null
        require(count in 1..384 && count <= available())
        val bytes = ByteArray(count); readFully(bytes)
        val value = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
        require(value.isNotEmpty() && value.length <= 128)
        return value
    }

    private fun DataInputStream.readFlag(): Boolean = when (readUnsignedByte()) {
        0 -> false
        1 -> true
        else -> error("invalid flag")
    }

    private companion object {
        const val KEY = "usage_observation_snapshot_v1"
        const val FIELD_SEPARATOR = "|"
        const val FIELD_COUNT = 5
        const val NULL_SENTINEL = "NULL"
    }
}

/**
 * Restoration contract mirroring `ScreenTimeRestorer`: a process restart within the same boot
 * simply resumes from the persisted [UsageSessionEngineState] (elapsed-realtime keeps counting
 * across process death within one boot, so [UsageSessionEngineState.lastProcessedElapsedMillis]
 * stays comparable). A reboot invalidates the elapsed-realtime cursor entirely (the clock resets
 * to zero) -- rather than fabricate a session end the platform never reported, tracking resets to
 * [UsageSessionEngineState.INITIAL] and observation resumes fresh from the next poll. This is the
 * same "not gapless across reboot" limitation [org.pca.app.platform.UsageObservationSource] itself
 * documents, not a gap introduced by this adapter.
 */
object UsageObservationRestorer {
    fun restore(snapshot: UsageObservationSnapshot?, currentBootId: String?): UsageSessionEngineState {
        if (snapshot == null || snapshot.schemaVersion != 2 || snapshot.bridgeSample == null)
            return UsageSessionEngineState.INITIAL
        // PCA-RUNTIME-2R1: same-boot continuity must be POSITIVELY confirmed (both ids known and
        // equal) before trusting the persisted elapsed-realtime cursor -- if either side is
        // unknown, that is NOT evidence of a same-boot restart, and comparing a possibly-stale
        // cursor against an unverified boot boundary is exactly the bug this fixes.
        val sameBootConfirmed = snapshot.bootId != null && currentBootId != null && snapshot.bootId == currentBootId
        return if (sameBootConfirmed) snapshot.engineState else UsageSessionEngineState.INITIAL
    }
}
