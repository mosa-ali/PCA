package org.pca.app.feature.screentime.persistence

import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.engine.ScreenTimeState

/**
 * Restores only progress that was durably checkpointed before PCA stopped observing the device.
 *
 * A same-boot monotonic clock can measure how long the process was absent, but that interval is
 * not evidence of qualifying use, a completed Break Shield, or a continuous recovery pause. The
 * process-death contract therefore re-anchors the clock without feeding the missing interval to
 * the engine. Reboot recovery uses the same rule because monotonic time is from a new generation.
 *
 * A restored active or due-break checkpoint is preserved. A paused checkpoint keeps its active
 * debt but loses only its unverified pause progress; a fresh, continuously observed rest is needed
 * before that debt can clear. The coverage flag remains set until a complete observed Break Shield
 * or recovery pause resolves the old streak.
 */
object ScreenTimeRestorer {

    /**
     * Kept source-compatible with prior callers. [config] is intentionally unused: restoration
     * never estimates a missing interval by advancing the engine.
     */
    @Suppress("UNUSED_PARAMETER")
    fun restoreAfterProcessRestart(
        snapshot: ScreenTimeSnapshot,
        nowNanos: Long,
        config: ScreenTimeConfig = ScreenTimeConfig(),
    ): ScreenTimeState = reanchor(snapshot.state, nowNanos)

    fun restoreAfterReboot(snapshot: ScreenTimeSnapshot, nowNanos: Long): ScreenTimeState =
        reanchor(snapshot.state, nowNanos)

    /**
     * Selects a restoration path based on a positive boot-id match. Both paths preserve the
     * checkpoint and re-anchor without crediting downtime; the distinction remains useful for
     * callers that need to explain which clock-generation check was applied.
     */
    fun restore(
        snapshot: ScreenTimeSnapshot,
        nowNanos: Long,
        currentBootId: String?,
        @Suppress("UNUSED_PARAMETER") config: ScreenTimeConfig = ScreenTimeConfig(),
    ): ScreenTimeState {
        val sameBootConfirmed = snapshot.bootId != null && currentBootId != null && snapshot.bootId == currentBootId
        // Even with a matching boot ID, a monotonic reference in the future is not trustworthy.
        // Re-anchoring is safe for both cases and never grants time that was not observed.
        return if (sameBootConfirmed && nowNanos >= snapshot.state.lastTickMonotonicNanos) {
            restoreAfterProcessRestart(snapshot, nowNanos)
        } else {
            restoreAfterReboot(snapshot, nowNanos)
        }
    }

    private fun reanchor(state: ScreenTimeState, nowNanos: Long): ScreenTimeState {
        val hadPausedRecovery = state.mode == ScreenTimeMode.PAUSED ||
            (state.mode == ScreenTimeMode.EMERGENCY_EXCEPTION && state.preEmergencyMode == ScreenTimeMode.PAUSED) ||
            (state.mode == ScreenTimeMode.COMMUNICATION_EXCEPTION && state.preCommunicationMode == ScreenTimeMode.PAUSED)
        return state.copy(
            pauseElapsedNanos = if (hadPausedRecovery) 0L else state.pauseElapsedNanos,
            preEmergencyPauseElapsedNanos = if (state.preEmergencyMode == ScreenTimeMode.PAUSED) {
                0L
            } else {
                state.preEmergencyPauseElapsedNanos
            },
            preCommunicationPauseElapsedNanos = if (state.preCommunicationMode == ScreenTimeMode.PAUSED) {
                0L
            } else {
                state.preCommunicationPauseElapsedNanos
            },
            lastTickMonotonicNanos = nowNanos,
            coverageUncertain = true,
        )
    }
}
