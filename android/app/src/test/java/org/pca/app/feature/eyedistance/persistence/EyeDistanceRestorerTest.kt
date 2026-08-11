package org.pca.app.feature.eyedistance.persistence

import org.junit.Assert.assertEquals
import org.junit.Test
import org.pca.app.feature.eyedistance.engine.EyeDistanceConfig
import org.pca.app.feature.eyedistance.engine.EyeDistancePhase
import org.pca.app.feature.eyedistance.engine.EyeDistanceState
import kotlin.time.Duration.Companion.seconds

class EyeDistanceRestorerTest {

    private val config = EyeDistanceConfig()

    // ---- process death / restart -----------------------------------------

    @Test
    fun `process restart during REST_ACTIVE resumes the countdown, accounting for the real gap`() {
        val snapshot = EyeDistanceSnapshot(
            state = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE, restElapsedNanos = 10.seconds.inWholeNanoseconds, lastTickMonotonicNanos = 100L),
            snapshotWallClockMillis = 0L,
            bootId = "boot-1",
        )
        // Process was dead for 20 seconds -- same boot, monotonic clock still valid.
        val nowNanos = 100L + 20.seconds.inWholeNanoseconds
        val restored = EyeDistanceRestorer.restoreAfterProcessRestart(snapshot, nowNanos, config)

        assertEquals(EyeDistancePhase.REST_ACTIVE, restored.phase)
        assertEquals(30.seconds.inWholeNanoseconds, restored.restElapsedNanos)
    }

    @Test
    fun `process restart during REST_ACTIVE that spans past 60s completes the rest`() {
        val snapshot = EyeDistanceSnapshot(
            state = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE, restElapsedNanos = 50.seconds.inWholeNanoseconds, lastTickMonotonicNanos = 100L),
            snapshotWallClockMillis = 0L,
            bootId = "boot-1",
        )
        val nowNanos = 100L + 20.seconds.inWholeNanoseconds
        val restored = EyeDistanceRestorer.restoreAfterProcessRestart(snapshot, nowNanos, config)

        assertEquals(EyeDistancePhase.RECOVERY, restored.phase)
    }

    @Test
    fun `process restart during speculative SUSPECTED_NEAR resets to a clean MONITORING baseline`() {
        val snapshot = EyeDistanceSnapshot(
            state = EyeDistanceState(phase = EyeDistancePhase.SUSPECTED_NEAR, nearElapsedNanos = 5.seconds.inWholeNanoseconds, lastTickMonotonicNanos = 100L),
            snapshotWallClockMillis = 0L,
            bootId = "boot-1",
        )
        val restored = EyeDistanceRestorer.restoreAfterProcessRestart(snapshot, 500L, config)

        assertEquals(EyeDistancePhase.MONITORING, restored.phase)
        assertEquals(0L, restored.nearElapsedNanos)
    }

    @Test
    fun `process restart during WARNING resets rather than fabricating a downtime-spanning near streak`() {
        val snapshot = EyeDistanceSnapshot(
            state = EyeDistanceState(phase = EyeDistancePhase.WARNING, nearElapsedNanos = 8.seconds.inWholeNanoseconds, lastTickMonotonicNanos = 100L),
            snapshotWallClockMillis = 0L,
            bootId = "boot-1",
        )
        val restored = EyeDistanceRestorer.restoreAfterProcessRestart(snapshot, 100L + 2.seconds.inWholeNanoseconds, config)
        assertEquals(EyeDistancePhase.MONITORING, restored.phase)
        assertEquals(0L, restored.nearElapsedNanos)
    }

    // ---- reboot -------------------------------------------------------------

    @Test
    fun `reboot during REST_ACTIVE preserves accumulated rest progress exactly`() {
        val snapshot = EyeDistanceSnapshot(
            state = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE, restElapsedNanos = 45.seconds.inWholeNanoseconds, lastTickMonotonicNanos = 999_999L),
            snapshotWallClockMillis = 0L,
            bootId = "boot-1",
        )
        val nowNanos = 500L // post-reboot monotonic origin resets, so this is smaller than the old reference
        val restored = EyeDistanceRestorer.restoreAfterReboot(snapshot, nowNanos)

        assertEquals(EyeDistancePhase.REST_ACTIVE, restored.phase)
        assertEquals(45.seconds.inWholeNanoseconds, restored.restElapsedNanos)
        assertEquals(nowNanos, restored.lastTickMonotonicNanos)
    }

    @Test
    fun `reboot during MONITORING evidence phases resets to a clean baseline`() {
        val snapshot = EyeDistanceSnapshot(
            state = EyeDistanceState(phase = EyeDistancePhase.WARNING, nearElapsedNanos = 8.seconds.inWholeNanoseconds, lastTickMonotonicNanos = 999_999L),
            snapshotWallClockMillis = 0L,
            bootId = "boot-1",
        )
        val restored = EyeDistanceRestorer.restoreAfterReboot(snapshot, 500L)
        assertEquals(EyeDistancePhase.MONITORING, restored.phase)
        assertEquals(0L, restored.nearElapsedNanos)
    }

    // ---- auto-detect --------------------------------------------------------

    @Test
    fun `restore auto-detects a reboot via differing bootId and preserves rest`() {
        val snapshot = EyeDistanceSnapshot(
            state = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE, restElapsedNanos = 45.seconds.inWholeNanoseconds, lastTickMonotonicNanos = 999_999L),
            snapshotWallClockMillis = 0L,
            bootId = "boot-1",
        )
        val restored = EyeDistanceRestorer.restore(snapshot, 500L, currentBootId = "boot-2", config = config)
        assertEquals(45.seconds.inWholeNanoseconds, restored.restElapsedNanos)
        assertEquals(500L, restored.lastTickMonotonicNanos)
    }

    @Test
    fun `restore falls back to process-restart path when bootId is unavailable`() {
        val snapshot = EyeDistanceSnapshot(
            state = EyeDistanceState(phase = EyeDistancePhase.REST_ACTIVE, restElapsedNanos = 10.seconds.inWholeNanoseconds, lastTickMonotonicNanos = 100L),
            snapshotWallClockMillis = 0L,
            bootId = null,
        )
        val nowNanos = 100L + 5.seconds.inWholeNanoseconds
        val restored = EyeDistanceRestorer.restore(snapshot, nowNanos, currentBootId = null, config = config)
        assertEquals(15.seconds.inWholeNanoseconds, restored.restElapsedNanos)
    }
}
