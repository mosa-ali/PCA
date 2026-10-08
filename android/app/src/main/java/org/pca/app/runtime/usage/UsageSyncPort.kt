package org.pca.app.runtime.usage

import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.repository.UsageSession
import org.pca.app.persistence.repository.UsageSessionRepository

/**
 * Read-only, domain-shaped view of a locally-recorded usage session for whichever component
 * builds the outbound family-sync [org.pca.app.runtime.sync.envelope.FamilyEnvelope] (Agent 16 /
 * Coordinator integration, same "this lane defines the port, the transport is out of scope" split
 * as [org.pca.app.runtime.port.FamilySyncRuntimePort]). [appOrCategoryToken] is the same stable,
 * truncated, unkeyed SHA-256 digest [UsageSessionRecorder] persisted -- it is not a raw package
 * name, but it is linkable and dictionary-testable, so it is not anonymity protection.
 */
data class UsageSessionSyncPayload(
    val sessionId: String,
    val deviceId: String,
    val appOrCategoryToken: String,
    val startedAtEpochMillis: Long,
    val endedAtEpochMillis: Long,
    val durationMillis: Long,
    val sourceConfidence: SourceConfidence,
)

/**
 * Clean port boundary for the sync layer: exposes locally-recorded sessions as
 * [UsageSessionSyncPayload]s, and nothing else -- no transport, no envelope construction, no
 * outbox enqueue call. A concrete sync implementation is expected to map each payload into an
 * outbound [org.pca.app.runtime.sync.envelope.FamilyEnvelope] and hand that (already-encrypted)
 * envelope to [org.pca.app.runtime.sync.outbox.SyncOutboxPort] -- neither step belongs to this
 * lane.
 */
interface UsageSyncPayloadSource {
    /**
     * Returns every retained local session for [deviceId]. This is not a pending-delivery queue:
     * the repository has no delivery marker or acknowledgement, so repeated reads can return the
     * same sessions until local retention removes them. The caller must supply the currently
     * enrolled device identity; this port scopes records to that value but is not an authority
     * boundary.
     */
    suspend fun availableSessionsForSync(deviceId: String): List<UsageSessionSyncPayload>
}

/** Thin, non-mutating adapter over [UsageSessionRepository] -- reuses Agent-12's decrypt-on-read
 * path (see [UsageSessionRepository.getForDevice]) rather than reimplementing it. */
class RepositoryBackedUsageSyncPayloadSource(
    private val repository: UsageSessionRepository,
) : UsageSyncPayloadSource {

    override suspend fun availableSessionsForSync(deviceId: String): List<UsageSessionSyncPayload> =
        repository.getForDevice(deviceId).map { session ->
            check(session.deviceId == deviceId) {
                "Usage session repository returned a row outside the requested device scope"
            }
            session.toSyncPayload()
        }

    private fun UsageSession.toSyncPayload() = UsageSessionSyncPayload(
        sessionId = id,
        deviceId = this.deviceId,
        appOrCategoryToken = appOrCategoryToken,
        startedAtEpochMillis = startedAtEpochMillis,
        endedAtEpochMillis = endedAtEpochMillis,
        durationMillis = durationMillis,
        sourceConfidence = sourceConfidence,
    )
}
