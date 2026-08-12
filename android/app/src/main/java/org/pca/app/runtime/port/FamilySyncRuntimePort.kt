package org.pca.app.runtime.port

/**
 * Real, observable family-sync connection state. Section 9 of the PCA-RUNTIME-ANDROID-1 brief is
 * explicit: a connected socket must never be equated with [LIVE] -- a transport can be up while
 * the family channel itself is still catching up, pending, or known-stale.
 */
enum class FamilySyncConnectionState {
    /** No transport connection to the family sync service at all. Local enforcement continues
     * unaffected (Section 0/10) -- this state only affects remote-visibility/parent-sync surfaces. */
    OFFLINE,
    /** A transport connection exists and an initial/ongoing synchronization pass is in progress. */
    SYNCING,
    /** Locally-originated changes (e.g. a queued child request) exist and are waiting to be sent;
     * the transport may or may not currently be connected. */
    SYNC_PENDING,
    /** A transport connection may exist, but the last successfully synchronized state is known to
     * be stale (e.g. the family channel epoch has advanced beyond what this device has applied). */
    STALE,
    /** Transport connected AND the family channel is fully caught up -- the only state in which a
     * caller may treat remote family state as current. */
    LIVE,
}

/** A locally-originated child request, queued while offline and handed to the sync port once it
 * reports [FamilySyncConnectionState.LIVE]. Deliberately carries no encryption/envelope detail --
 * that belongs to Agent 16's (`runtime.sync package`) concrete implementation, which is the only code
 * authorized to construct and encrypt an outbound family-channel envelope. */
data class ChildRequestPayload(
    val requestId: String,
    val kind: String,
    val detail: String,
    val createdAtEpochMillis: Long,
)

/**
 * Coordinator-bound port: Agent 16 (`runtime.sync package`) owns the concrete implementation. This
 * composition layer only depends on the interface so it compiles and is fully testable before
 * that binding exists (see `OfflineFamilySyncRuntimePort` below, the conservative placeholder
 * used until the coordinator wires the real one in).
 */
interface FamilySyncRuntimePort {
    fun currentConnectionState(): FamilySyncConnectionState

    /** Epoch millis of the last connection state that reached [FamilySyncConnectionState.LIVE],
     * or null if this device has never successfully synced. Wall-clock, display-only. */
    fun lastSuccessfulSyncEpochMillis(): Long?

    /** Submits a previously locally-queued child request through the authorized family message
     * flow. Must only be called once [currentConnectionState] is [FamilySyncConnectionState.LIVE]
     * -- returns false (never throws) if the port cannot currently accept it, in which case the
     * caller must keep the request queued locally and retry later. */
    suspend fun submitChildRequest(request: ChildRequestPayload): Boolean
}

/**
 * Conservative placeholder: always reports [FamilySyncConnectionState.OFFLINE] and never
 * successfully submits a request, rather than fabricating connectivity this lane has no real
 * transport to back. A real adapter is a Coordinator integration task (Agent 16), not something
 * this worktree invents. Local enforcement and child-request queueing both continue to work
 * correctly against this placeholder (Section 0/10/12) -- only remote delivery is unavailable.
 */
class OfflineFamilySyncRuntimePort : FamilySyncRuntimePort {
    override fun currentConnectionState(): FamilySyncConnectionState = FamilySyncConnectionState.OFFLINE
    override fun lastSuccessfulSyncEpochMillis(): Long? = null
    override suspend fun submitChildRequest(request: ChildRequestPayload): Boolean = false
}
