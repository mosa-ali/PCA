package org.pca.app.runtime.usage

import org.pca.app.persistence.entity.SourceConfidence
import org.pca.app.persistence.repository.UsageSession
import org.pca.app.persistence.repository.UsageSessionRepository

/**
 * Read-only, domain-shaped view of a locally-recorded usage session for whichever component
 * builds the outbound family-sync [org.pca.app.runtime.sync.envelope.FamilyEnvelope] (Agent 16 /
 * Coordinator integration, same "this lane defines the port, the transport is out of scope" split
 * as [org.pca.app.runtime.port.FamilySyncRuntimePort]). [appOrCategoryToken] is already the same
 * opaque SHA-256 token [UsageSessionRecorder] persisted -- never a raw package name, so there is
 * no plaintext app identity for this payload to leak even before encryption.
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
    suspend fun pendingSessionsForSync(deviceId: String): List<UsageSessionSyncPayload>
}

/** Thin, non-mutating adapter over [UsageSessionRepository] -- reuses Agent-12's decrypt-on-read
 * path (see [UsageSessionRepository.getForDevice]) rather than reimplementing it. */
class RepositoryBackedUsageSyncPayloadSource(
    private val repository: UsageSessionRepository,
) : UsageSyncPayloadSource {

    override suspend fun pendingSessionsForSync(deviceId: String): List<UsageSessionSyncPayload> =
        repository.getForDevice(deviceId).map { it.toSyncPayload() }

    private fun UsageSession.toSyncPayload() = UsageSessionSyncPayload(
        sessionId = id,
        deviceId = deviceId,
        appOrCategoryToken = appOrCategoryToken,
        startedAtEpochMillis = startedAtEpochMillis,
        endedAtEpochMillis = endedAtEpochMillis,
        durationMillis = durationMillis,
        sourceConfidence = sourceConfidence,
    )
}
