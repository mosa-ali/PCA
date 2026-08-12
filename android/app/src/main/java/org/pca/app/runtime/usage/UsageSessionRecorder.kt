package org.pca.app.runtime.usage

import java.security.MessageDigest
import java.util.UUID
import org.pca.app.foundation.MonotonicTimeSource
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.repository.UsageSessionRepository
import org.pca.app.platform.UsageAccessState
import org.pca.app.platform.UsageEvent
import org.pca.app.platform.UsageObservationSource

/**
 * Outcome of one [UsageSessionRecorder.poll] call -- always returned, never thrown, so a caller
 * (e.g. [org.pca.app.runtime.PcaRuntime]'s tick loop) can report permission state honestly rather
 * than treating "usage access not granted" as an error condition.
 */
data class UsagePollResult(
    val accessState: UsageAccessState,
    val recordedSessionCount: Int,
)

/**
 * PCA-ANDROID-USAGE-LOCATION-1: the real, runtime-connected flow from
 * [UsageObservationSource] (legitimate `UsageStatsManager`-backed platform observation, NEVER
 * AccessibilityService/screen-scraping/keylogging) through [UsageSessionEngine]'s pure session
 * construction to Agent-12's [UsageSessionRepository] Room bridge.
 *
 * Permission-aware (doc 06 Section 5): [poll] honestly reports [UsageAccessState] on every call
 * and persists nothing while access is not [UsageAccessState.GRANTED] -- it never fabricates a
 * session from a permission it does not have.
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
 */
class UsageSessionRecorder(
    private val usageObservationSource: UsageObservationSource,
    private val usageSessionRepository: UsageSessionRepository,
    private val monotonicTimeSource: MonotonicTimeSource,
    private val wallClockTimeSource: WallClockTimeSource,
    private val snapshotStore: UsageObservationSnapshotStore,
    private val deviceId: String,
    currentBootId: String?,
) {
    @Volatile
    private var state: UsageSessionEngineState = UsageObservationRestorer.restore(snapshotStore.load(), currentBootId)
    private val bootId: String? = currentBootId

    /**
     * Queries real platform events since this recorder's own last-processed cursor, folds them
     * through [UsageSessionEngine], and persists any newly-completed session. Safe to call
     * repeatedly (duplicate/out-of-order events are absorbed by the engine's own cursor
     * discipline), and safe to call with no network connectivity (purely local).
     */
    suspend fun poll(): UsagePollResult {
        val accessState = usageObservationSource.accessState()
        if (accessState != UsageAccessState.GRANTED) {
            return UsagePollResult(accessState = accessState, recordedSessionCount = 0)
        }

        // Single bridge sample so every event in this batch converts from the platform's
        // monotonic timeline to wall-clock consistently (same technique
        // StandardUsageObservationSource itself uses internally for its own contract).
        val nowElapsed = monotonicTimeSource.elapsedRealtimeMillis()
        val nowEpoch = wallClockTimeSource.currentTimeMillis()

        val rawEvents = usageObservationSource.queryEventsSince(state.lastProcessedElapsedMillis)
        val timestamped = rawEvents.map { it.toTimestamped(nowElapsed, nowEpoch) }

        val result = UsageSessionEngine.apply(state, timestamped)
        state = result.state
        snapshotStore.save(UsageObservationSnapshot(state, bootId))

        for (session in result.completedSessions) {
            usageSessionRepository.record(
                id = sessionId(session),
                deviceId = deviceId,
                appOrCategoryToken = session.appToken,
                startedAtEpochMillis = session.startedAtEpochMillis,
                endedAtEpochMillis = session.endedAtEpochMillis,
                durationMillis = session.durationMillis,
                sourceConfidence = SourceConfidence.PLATFORM_API,
            )
        }

        return UsagePollResult(accessState = accessState, recordedSessionCount = result.completedSessions.size)
    }

    /** Snapshot of the engine's own state for a caller that wants to inspect it without polling. */
    fun currentEngineState(): UsageSessionEngineState = state

    private fun UsageEvent.toTimestamped(nowElapsed: Long, nowEpoch: Long) = TimestampedUsageEvent(
        appToken = opaqueToken(packageName),
        eventType = eventType,
        elapsedRealtimeMillis = elapsedRealtimeMillis,
        epochMillis = nowEpoch - (nowElapsed - elapsedRealtimeMillis),
    )

    /**
     * Deterministic on (device, app token, session start) so re-recording the SAME interval
     * (e.g. a restart-time re-poll that reprocesses an event already applied to the persisted
     * engine state, or a duplicate call) always yields the same id -- upserted, never duplicated.
     */
    private fun sessionId(session: CompletedUsageSession): String =
        UUID.nameUUIDFromBytes("$deviceId|${session.appToken}|${session.startedAtEpochMillis}".toByteArray(Charsets.UTF_8)).toString()

    private fun opaqueToken(packageName: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(packageName.toByteArray(Charsets.UTF_8))
        return digest.joinToString(separator = "") { "%02x".format(it) }.take(TOKEN_LENGTH)
    }

    private companion object {
        const val TOKEN_LENGTH = 16
    }
}
