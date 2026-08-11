package org.pca.app.feature.screentime.persistence

import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.engine.ScreenTimeEngine
import org.pca.app.feature.screentime.engine.ScreenTimeEvent
import org.pca.app.feature.screentime.engine.ScreenTimeState

/**
 * Restoration contract for the two ways the engine's process can come back:
 *
 * 1. **Process restart, same boot.** The monotonic clock (e.g. `elapsedRealtime`) keeps
 *    counting across app process death within the same boot, so the persisted
 *    [ScreenTimeState.lastTickMonotonicNanos] reference is still comparable to a fresh reading.
 *    Restoring is simply feeding a [ScreenTimeEvent.Tick] for "now" through the normal engine —
 *    any time that passed while the process was dead (including an arbitrarily long offline
 *    gap) is accounted for identically to a large tick delta, cascading through as many
 *    active/break cycles as it actually spans.
 *
 * 2. **Reboot.** A monotonic clock sourced from the OS resets at boot, so an old
 *    `lastTickMonotonicNanos` reading is no longer comparable to a post-reboot reading — using
 *    it directly would either fabricate a huge bogus delta or (if the new reading happens to be
 *    smaller) get clamped to zero. Neither is trustworthy. The contract is therefore
 *    conservative by design: accumulated progress (elapsed active/break time, mode, counters)
 *    is preserved exactly as it was, and only the monotonic reference point is re-anchored to
 *    "now" in the new boot. A reboot can never be used to erase a pending break or reset the
 *    active-use counter — that would defeat the engine's purpose — but it also never fabricates
 *    time that didn't actually elapse.
 */
object ScreenTimeRestorer {

    fun restoreAfterProcessRestart(
        snapshot: ScreenTimeSnapshot,
        nowNanos: Long,
        config: ScreenTimeConfig = ScreenTimeConfig(),
    ): ScreenTimeState = ScreenTimeEngine.reduce(snapshot.state, ScreenTimeEvent.Tick(nowNanos), config)

    fun restoreAfterReboot(snapshot: ScreenTimeSnapshot, nowNanos: Long): ScreenTimeState =
        snapshot.state.copy(lastTickMonotonicNanos = nowNanos)

    /**
     * Picks the correct path automatically. A reboot is detected only when both the snapshot
     * and the current environment can supply a [ScreenTimeSnapshot.bootId] and they differ; if
     * either is unavailable, the caller is assumed to be within the same boot (the common case
     * for ordinary process restarts) and the process-restart path is used.
     */
    fun restore(
        snapshot: ScreenTimeSnapshot,
        nowNanos: Long,
        currentBootId: String?,
        config: ScreenTimeConfig = ScreenTimeConfig(),
    ): ScreenTimeState {
        val rebooted = snapshot.bootId != null && currentBootId != null && snapshot.bootId != currentBootId
        return if (rebooted) {
            restoreAfterReboot(snapshot, nowNanos)
        } else {
            restoreAfterProcessRestart(snapshot, nowNanos, config)
        }
    }
}
