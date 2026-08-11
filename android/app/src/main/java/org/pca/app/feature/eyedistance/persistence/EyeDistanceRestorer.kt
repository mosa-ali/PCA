package org.pca.app.feature.eyedistance.persistence

import org.pca.app.feature.eyedistance.engine.EyeDistanceConfig
import org.pca.app.feature.eyedistance.engine.EyeDistanceEngine
import org.pca.app.feature.eyedistance.engine.EyeDistanceEvent
import org.pca.app.feature.eyedistance.engine.EyeDistancePhase
import org.pca.app.feature.eyedistance.engine.EyeDistanceState
import org.pca.app.platform.proximity.ProximityReading

/**
 * Restoration contract for process restart and reboot -- doc 13 / task Section 2: "restore
 * justified active rest only." Unlike PCA-3's [org.pca.app.feature.screentime.persistence.ScreenTimeRestorer],
 * NOT every phase is eligible to resume across a gap: only a rest that had genuinely started
 * (REST_DUE/REST_ACTIVE) or just completed (RECOVERY) is "justified" to continue counting through
 * an arbitrarily long gap -- resuming a merely-*suspected* near streak (SUSPECTED_NEAR/WARNING)
 * across a process-death or reboot gap would fabricate continuous evidence that was never
 * actually observed, so those phases -- and UNAVAILABLE/SUSPENDED -- always come back to a clean
 * MONITORING baseline instead (identical "resume fresh" philosophy already used for a live
 * SUSPENDED source drop-out in [EyeDistanceEngine]).
 */
object EyeDistanceRestorer {

    fun restoreAfterProcessRestart(
        snapshot: EyeDistanceSnapshot,
        nowNanos: Long,
        config: EyeDistanceConfig = EyeDistanceConfig(),
    ): EyeDistanceState {
        val state = snapshot.state
        return when (state.phase) {
            EyeDistancePhase.REST_DUE, EyeDistancePhase.REST_ACTIVE, EyeDistancePhase.RECOVERY ->
                // The monotonic clock survived the process restart within the same boot, so
                // feeding a real observation lets the engine correctly account for however long
                // the process was actually dead -- including completing an already-due rest.
                EyeDistanceEngine.reduce(
                    state,
                    EyeDistanceEvent.Observation(nowNanos, ProximityReading.UNKNOWN, sourceAvailable = false),
                    config,
                )
            else -> freshBaseline(state.phase, nowNanos)
        }
    }

    fun restoreAfterReboot(snapshot: EyeDistanceSnapshot, nowNanos: Long): EyeDistanceState {
        val state = snapshot.state
        return when (state.phase) {
            EyeDistancePhase.REST_DUE, EyeDistancePhase.REST_ACTIVE ->
                // A reboot resets the monotonic origin, so the old lastTickMonotonicNanos is not
                // comparable to a post-reboot reading -- accumulated rest progress is preserved
                // exactly, and only the reference point is re-anchored to "now" (never fabricate
                // a cross-boot delta), mirroring ScreenTimeRestorer.restoreAfterReboot exactly.
                state.copy(lastTickMonotonicNanos = nowNanos)
            else -> freshBaseline(state.phase, nowNanos)
        }
    }

    /**
     * Picks the correct path automatically. A reboot is detected only when both the snapshot and
     * the current environment can supply a [EyeDistanceSnapshot.bootId] and they differ; if
     * either is unavailable, an ordinary process restart is assumed (the common case).
     */
    fun restore(
        snapshot: EyeDistanceSnapshot,
        nowNanos: Long,
        currentBootId: String?,
        config: EyeDistanceConfig = EyeDistanceConfig(),
    ): EyeDistanceState {
        val rebooted = snapshot.bootId != null && currentBootId != null && snapshot.bootId != currentBootId
        return if (rebooted) {
            restoreAfterReboot(snapshot, nowNanos)
        } else {
            restoreAfterProcessRestart(snapshot, nowNanos, config)
        }
    }

    private fun freshBaseline(priorPhase: EyeDistancePhase, nowNanos: Long): EyeDistanceState =
        EyeDistanceState(
            phase = if (priorPhase == EyeDistancePhase.UNAVAILABLE) EyeDistancePhase.UNAVAILABLE else EyeDistancePhase.MONITORING,
            lastTickMonotonicNanos = nowNanos,
        )
}
