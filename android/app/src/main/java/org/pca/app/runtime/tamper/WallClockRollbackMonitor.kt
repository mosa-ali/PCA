package org.pca.app.runtime.tamper

import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.pca.app.foundation.PersistentStateStore
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.repository.TamperEventRepository

/**
 * PCA-FR-017/PCA-FR-085: detects a wall-clock rollback (the device's
 * current wall-clock reading LOWER than a persisted high-water-mark from an
 * earlier observation) and records it as a real, timestamped TamperEvent --
 * the concrete "rollback-to-TamperEvent writer" [org.pca.app.feature.screentime.clock.MonotonicClockBridge]'s
 * own doc comment (see the PCA-FR-017 matrix finding it links to) flags as
 * missing. This complements, never replaces,
 * [org.pca.app.foundation.MonotonicTimeSource]'s structural immunity to
 * wall-clock changes for duration math (doc 06 Section 5): that mechanism
 * keeps a rollback from ever shortening a measured session/break; this
 * monitor is the separate, additive tamper-SIGNAL half PCA-FR-085 also
 * requires (permission loss / clock rollback / DPC policy removal /
 * Accessibility Service disabled all feed the same local TamperEvent +
 * parent-notification path -- see [UsageAccessDegradationMonitor] and
 * [DevicePolicyDegradationMonitor] for the sibling monitors this mirrors).
 *
 * The high-water-mark is persisted (not merely in-memory) so a rollback
 * performed while the app process is dead -- device powered off, clock set
 * backward, device powered on again -- is still detected on the very next
 * check, not lost to process restart. It is deliberately never moved
 * backward while a rollback is active: the stored mark stays at the
 * highest wall-clock time genuinely observed until time catches back up to
 * (or passes) it, so this monitor can never be fooled into treating an
 * attacker/user-controlled rolled-back reading as a new legitimate
 * baseline.
 *
 * Reporting itself is transition-based (not-rolled-back -> rolled-back),
 * exactly like [DevicePolicyDegradationMonitor]/[UsageAccessDegradationMonitor]'s
 * own `lastObservedState` debounce: a caller that polls repeatedly while
 * the SAME rollback remains in effect gets exactly one TamperEvent/
 * notification for it, not one per poll. A genuinely later, separate
 * rollback -- time first recovers past the high-water-mark, then rolls
 * back again -- is reported again as its own incident.
 */
class WallClockRollbackMonitor(
    private val wallClockTimeSource: WallClockTimeSource,
    private val stateStore: PersistentStateStore,
    private val deviceIdProvider: () -> String?,
    private val tamperEventRepository: TamperEventRepository,
    private val notifyParent: (String) -> Boolean,
) {
    // Deliberately in-memory only (never persisted) -- same posture as every sibling monitor's
    // own lastObservedState (see DevicePolicyDegradationMonitor/UsageAccessDegradationMonitor):
    // it debounces repeat notifications for the SAME ongoing rollback within one process
    // lifetime, never a second, independent rollback. It intentionally resets to false on every
    // process restart so a rollback that is STILL in effect after a restart -- unlike the
    // persisted high-water-mark below -- is reported fresh once, matching every other monitor in
    // this graph rather than requiring its own special case.
    private var lastCheckWasRollback = false
    private val checkMutex = Mutex()

    suspend fun checkAndHandle() = checkMutex.withLock {
        val now = wallClockTimeSource.currentTimeMillis()
        val highWaterMark = stateStore.getString(HIGH_WATER_MARK_KEY)?.toLongOrNull()

        if (highWaterMark == null) {
            // First observation ever (fresh install, or the store was cleared) -- nothing to
            // compare against yet. Establishing a baseline is not itself a rollback.
            stateStore.putString(HIGH_WATER_MARK_KEY, now.toString())
            lastCheckWasRollback = false
            return@withLock
        }

        val isRollback = now < highWaterMark
        val wasRollback = lastCheckWasRollback
        lastCheckWasRollback = isRollback

        if (!isRollback) {
            if (now > highWaterMark) stateStore.putString(HIGH_WATER_MARK_KEY, now.toString())
            return@withLock
        }

        // now < highWaterMark: wall-clock is currently rolled back. Only report the
        // NOT-rolled-back -> rolled-back transition, exactly once per incident -- a caller that
        // polls repeatedly while the clock remains rolled back must not flood the tamper log or
        // re-notify the parent on every tick for the same still-ongoing incident.
        if (wasRollback) return@withLock

        val deviceId = deviceIdProvider()
        if (deviceId != null) {
            tamperEventRepository.record(
                id = UUID.nameUUIDFromBytes("$deviceId|$CONDITION_CLOCK_ROLLBACK|$now".toByteArray(Charsets.UTF_8)).toString(),
                deviceId = deviceId,
                conditionType = CONDITION_CLOCK_ROLLBACK,
                detectedAtEpochMillis = now,
            )
        }
        notifyParent(CONDITION_CLOCK_ROLLBACK)
    }

    companion object {
        const val CONDITION_CLOCK_ROLLBACK = "WALL_CLOCK_ROLLBACK_DETECTED"
        private const val HIGH_WATER_MARK_KEY = "wall_clock_high_water_mark_millis"
    }
}
