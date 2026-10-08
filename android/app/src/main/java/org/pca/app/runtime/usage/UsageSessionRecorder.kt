package org.pca.app.runtime.usage

import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.pca.app.foundation.MonotonicTimeSource
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.repository.UsageSessionRepository
import org.pca.app.platform.UsageAccessState
import org.pca.app.platform.UsageClockSample
import org.pca.app.platform.UsageClockBridge
import org.pca.app.platform.UsageQueryStatus
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import org.pca.app.platform.UsageEvent
import org.pca.app.platform.UsageObservationSource

/**
 * Outcome of one observation poll. Storage/query errors remain observable to the caller;
 * successful results distinguish uncertain coverage from recorded observations. A caller
 * (e.g. [org.pca.app.runtime.PcaRuntime]'s tick loop) can report permission state honestly rather
 * than treating "usage access not granted" as an error condition.
 */
data class UsagePollResult(
    val accessState: UsageAccessState,
    val recordedSessionCount: Int,
    /** PCA-RUNTIME-2R1: false when this poll recorded nothing because the device has no PCA
     * enrolled identity yet (see [org.pca.app.runtime.identity.DeviceIdentityProvider]) -- a
     * separate, orthogonal reason from [accessState] (platform permission), so a caller can tell
     * "no permission" apart from "not enrolled" rather than conflating them. */
    val deviceEnrolled: Boolean = true,
    val coverage: UsageObservationCoverage = UsageObservationCoverage.UNKNOWN,
)

/**
 * PCA-ANDROID-USAGE-LOCATION-1: the real, runtime-connected flow from
 * [UsageObservationSource] (legitimate `UsageStatsManager`-backed platform observation, NEVER
 * AccessibilityService/screen-scraping/keylogging) through [UsageSessionEngine]'s pure session
 * construction to Agent-12's [UsageSessionRepository] Room bridge.
 *
 * Permission-aware (doc 06 Section 5): [poll] honestly reports [UsageAccessState] on every call
 * and records no sessions while access is not [UsageAccessState.GRANTED]. It persists an
 * UNKNOWN boundary to discard any open interval spanning unavailable permission.
 *
 * Offline by construction: this class never touches the network, a connectivity observer, or a
 * sync port -- observation and local persistence work identically online or offline. Syncing a
 * recorded session onward is [UsageSyncPayloadSource]'s (separate, read-only) concern.
 *
 * Uses only an opaque, one-way-hashed app token (same SHA-256/16-hex-char convention as
 * [org.pca.app.runtime.wellbeing.RuntimeEligibleAppSignalSource]) -- the real package name never
 * reaches [UsageSessionRepository] or any sync payload derived from it.
 *
 * Restart-safe: [snapshotStore] persists [UsageSessionEngineState] after every poll (see
 * [UsageObservationRestorer] for the reboot-vs-process-restart distinction), so a process death
 * mid-session neither loses the open session nor duplicates the sessions already recorded --
 * [UsageSessionRepository.record] is itself `@Insert(REPLACE)`-keyed on a deterministic session id
 * ([sessionId]), so even a re-poll that reprocesses an already-recorded interval upserts the same
 * row rather than creating a duplicate.
 *
 * Concurrency (WRITER68 correction, PCA-AND-RUNTIME-PLATFORM-1): [PcaAppGraph.runUsageLocationIngestionCycle]
 * now has TWO genuinely concurrent callers -- the in-process 5-minute poll loop and the
 * `WorkManager`-backed [org.pca.app.runtime.background.UsageIngestionWorker] safety net, which can
 * overlap in time (there is no OS-level guarantee they never run together). [state] was previously
 * a plain `@Volatile var` mutated via a non-atomic read-modify-write inside [poll] -- safe with
 * exactly one caller, but a genuine lost-update race with two. [pollMutex] serializes the whole
 * critical section (read [state], run it through [UsageSessionEngine], write [state] back, persist
 * the snapshot) so two concurrent [poll] calls interleave safely rather than one clobbering the
 * other's cursor advancement -- see `UsageSessionRecorderTest`'s own concurrent-poll case for a
 * test that actually exercises two overlapping callers, not just two sequential ones.
 */
class UsageSessionRecorder(
    private val usageObservationSource: UsageObservationSource,
    private val usageSessionRepository: UsageSessionRepository,
    private val monotonicTimeSource: MonotonicTimeSource,
    private val wallClockTimeSource: WallClockTimeSource,
    private val snapshotStore: UsageObservationSnapshotStore,
    /** PCA-RUNTIME-2R1: resolved fresh on every [poll] rather than fixed at construction, since
     * this recorder is a long-lived singleton and enrollment can complete after it -- returns
     * null when the device has no PCA enrolled identity yet (see
     * [org.pca.app.runtime.identity.DeviceIdentityProvider]). Never a random/platform-derived
     * substitute id: when null, [poll] records nothing rather than misattribute local records to
     * an identity nothing on the family side recognizes. */
    private val deviceIdProvider: () -> String?,
    currentBootId: String?,
) {
    @Volatile
    private var snapshot: UsageObservationSnapshot? = try { snapshotStore.load() }
        catch (_: UsageObservationSnapshotUnavailable) { null }
        catch (_: IllegalStateException) { null }
    @Volatile
    private var state: UsageSessionEngineState = UsageObservationRestorer.restore(snapshot, currentBootId)
    private val bootId: String? = currentBootId

    /** Guards every read-modify-write of [state] (see this class's own doc comment on why this
     * exists now that two independent callers can genuinely overlap). */
    private val pollMutex = Mutex()

    /**
     * Queries real platform events since this recorder's own last-processed cursor, folds them
     * through [UsageSessionEngine], and persists any newly-completed session. Safe to call
     * repeatedly (duplicate/out-of-order events are absorbed by the engine's own cursor
     * discipline), safe to call with no network connectivity (purely local), AND now genuinely
     * safe to call concurrently from two different coroutines/callers -- the whole cycle runs
     * under [pollMutex], so two overlapping calls are serialized rather than racing on [state].
     */
    suspend fun poll(): UsagePollResult = pollMutex.withLock { doPoll() }

    private suspend fun doPoll(): UsagePollResult {
        currentCoroutineContext().ensureActive()
        val access = usageObservationSource.accessState()
        val before = clockSample()
        val device = deviceIdProvider()
        val previous = snapshot
        if (access != UsageAccessState.GRANTED || device == null || bootId == null ||
            previous?.schemaVersion != 2 || previous.coverage == UsageObservationCoverage.UNKNOWN ||
            previous.bootId != bootId || previous.deviceId != device ||
            previous.bridgeSample == null || previous.generationAnchor == null || previous.observationGeneration == null ||
            !UsageClockBridge.continuous(previous.bridgeSample, before) ||
            !UsageClockBridge.continuous(previous.generationAnchor, before)) {
            return establishBaseline(before, device, access)
        }
        val batch = usageObservationSource.queryObservationBatchSince(state.lastProcessedElapsedMillis)
            ?: return establishBaseline(clockSample(), device, access)
        val after = clockSample()
        val expectedStart = UsageClockBridge.wallAtElapsed(state.lastProcessedElapsedMillis, batch.beforeQuery)
        val validBatch = batch.status == UsageQueryStatus.OBSERVED && batch.accessState == UsageAccessState.GRANTED &&
            usageObservationSource.accessState() == UsageAccessState.GRANTED && deviceIdProvider() == device &&
            batch.beforeQuery.elapsedMillis >= before.elapsedMillis && after.elapsedMillis >= batch.afterQuery.elapsedMillis &&
            UsageClockBridge.continuous(before, batch.beforeQuery) &&
            UsageClockBridge.continuous(batch.beforeQuery, batch.afterQuery) &&
            UsageClockBridge.continuous(batch.afterQuery, after) &&
            UsageClockBridge.continuous(previous.generationAnchor, batch.beforeQuery) &&
            UsageClockBridge.continuous(previous.generationAnchor, batch.afterQuery) &&
            UsageClockBridge.continuous(previous.generationAnchor, after) &&
            batch.queryStartWallMillis == expectedStart && expectedStart != null && batch.events.size <= 4_096 &&
            batch.events.all { observed ->
                observed.event.packageName.isNotEmpty() && observed.event.packageName.length <= 256 &&
                observed.epochMillis >= expectedStart && observed.epochMillis <= batch.beforeQuery.wallMillis &&
                UsageClockBridge.elapsedAtWall(observed.epochMillis, batch.beforeQuery) == observed.event.elapsedRealtimeMillis
            }
        if (!validBatch) return establishBaseline(after, deviceIdProvider(), usageObservationSource.accessState())
        val timestamped = batch.events.map { observed ->
            TimestampedUsageEvent(opaqueToken(observed.event.packageName), observed.event.eventType,
                observed.event.elapsedRealtimeMillis, observed.epochMillis)
        }
        val result = UsageSessionEngine.apply(state, timestamped)
        // A tolerated projection change must not credit an interval before this generation.
        if (result.completedSessions.any { it.startedAtElapsedMillis < previous.generationAnchor.elapsedMillis }) {
            return establishBaseline(after, device, access)
        }
        // Stable framed identity uses original platform wall time, not a reprojected start.
        // A new generation separates intervals on each detected continuity reset.
        for (session in result.completedSessions) {
            currentCoroutineContext().ensureActive()
            check(deviceIdProvider() == device) { "Usage device changed during persistence" }
            usageSessionRepository.record(
                id = sessionId(device, previous.observationGeneration, session), deviceId = device,
                appOrCategoryToken = session.appToken, startedAtEpochMillis = session.startedAtEpochMillis,
                endedAtEpochMillis = session.endedAtEpochMillis, durationMillis = session.durationMillis,
                sourceConfidence = SourceConfidence.PLATFORM_API,
                observationProvenance = UsageSessionProvenance(previous.observationGeneration, bootId,
                    session.startedAtElapsedMillis, session.endedAtElapsedMillis,
                    previous.generationAnchor, batch.beforeQuery, batch.afterQuery))
        }
        currentCoroutineContext().ensureActive()
        check(deviceIdProvider() == device) { "Usage device changed before cursor commit" }
        commit(UsageObservationSnapshot(result.state, bootId, 2, after, device,
            UsageObservationCoverage.OBSERVED, previous.observationGeneration, previous.generationAnchor))
        return UsagePollResult(access, result.completedSessions.size, true, UsageObservationCoverage.OBSERVED)
    }

    private fun establishBaseline(sample: UsageClockSample, device: String?, access: UsageAccessState): UsagePollResult {
        val validSample = sample.takeIf { UsageClockBridge.valid(it) }
        val coverage = if (validSample != null && access == UsageAccessState.GRANTED && device != null && bootId != null)
            UsageObservationCoverage.BASELINE else UsageObservationCoverage.UNKNOWN
        val baseline = UsageSessionEngineState(null, validSample?.elapsedMillis ?: UsageSessionEngineState.UNSET_CURSOR)
        commit(UsageObservationSnapshot(baseline, bootId, 2, validSample, device, coverage, UUID.randomUUID().toString()))
        return UsagePollResult(access, 0, device != null, coverage)
    }

    private fun commit(candidate: UsageObservationSnapshot) {
        snapshotStore.save(candidate)
        check(snapshotStore.load() == candidate) { "Usage snapshot readback failed" }
        snapshot = candidate
        state = candidate.engineState
    }

    fun currentEngineState(): UsageSessionEngineState = state

    private fun clockSample() = UsageClockSample(monotonicTimeSource.elapsedRealtimeMillis(), wallClockTimeSource.currentTimeMillis())

    private fun sessionId(device: String, generation: String, session: CompletedUsageSession): String {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { out ->
            for (value in listOf(bootId!!, device, generation, session.appToken)) {
                val field = value.toByteArray(Charsets.UTF_8); out.writeInt(field.size); out.write(field)
            }
            out.writeLong(session.startedAtEpochMillis)
        }
        return UUID.nameUUIDFromBytes(bytes.toByteArray()).toString()
    }

    private fun opaqueToken(packageName: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(packageName.toByteArray(Charsets.UTF_8))
        return digest.joinToString(separator = "") { "%02x".format(it) }.take(TOKEN_LENGTH)
    }

    private companion object {
        const val TOKEN_LENGTH = 16
    }
}
