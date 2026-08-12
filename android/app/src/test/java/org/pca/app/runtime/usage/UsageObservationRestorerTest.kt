package org.pca.app.runtime.usage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UsageObservationRestorerTest {

    @Test
    fun `no prior snapshot -- restores to INITIAL`() {
        assertEquals(UsageSessionEngineState.INITIAL, UsageObservationRestorer.restore(null, currentBootId = "boot-1"))
    }

    @Test
    fun `same confirmed boot id -- process restart, the persisted cursor is trusted`() {
        val open = OpenUsageSession(appToken = "abc", startedAtElapsedMillis = 1_000L, startedAtEpochMillis = 5_000L)
        val engineState = UsageSessionEngineState(openSession = open, lastProcessedElapsedMillis = 8_000_000_000L)
        val snapshot = UsageObservationSnapshot(engineState, bootId = "boot-1")

        val restored = UsageObservationRestorer.restore(snapshot, currentBootId = "boot-1")

        assertEquals(engineState, restored)
    }

    @Test
    fun `different confirmed boot id -- a real reboot discards the stale cursor entirely`() {
        val open = OpenUsageSession(appToken = "abc", startedAtElapsedMillis = 1_000L, startedAtEpochMillis = 5_000L)
        val engineState = UsageSessionEngineState(openSession = open, lastProcessedElapsedMillis = 8_000_000_000L)
        val snapshot = UsageObservationSnapshot(engineState, bootId = "boot-100")

        val restored = UsageObservationRestorer.restore(snapshot, currentBootId = "boot-101")

        assertEquals(UsageSessionEngineState.INITIAL, restored)
    }

    @Test
    fun `high pre-reboot cursor + a real reboot -- restore never lets the huge stale cursor survive`() {
        // The exact regression scenario: a large lastProcessedElapsedMillis persisted before a
        // reboot must not leak into the restored state once the boot instance has genuinely
        // changed -- a subsequent poll must query from the new boot's timeline, not wait for a
        // fresh elapsedRealtime to catch up to the old, now-meaningless, huge value.
        val engineState = UsageSessionEngineState(openSession = null, lastProcessedElapsedMillis = 999_999_999_999L)
        val snapshot = UsageObservationSnapshot(engineState, bootId = "boot-100")

        val restored = UsageObservationRestorer.restore(snapshot, currentBootId = "boot-101")

        assertEquals(UsageSessionEngineState.UNSET_CURSOR, restored.lastProcessedElapsedMillis)
        assertNull(restored.openSession)
    }

    @Test
    fun `snapshot bootId unknown -- fails safe to reboot handling, never assumed same-boot`() {
        val open = OpenUsageSession(appToken = "abc", startedAtElapsedMillis = 1_000L, startedAtEpochMillis = 5_000L)
        val engineState = UsageSessionEngineState(openSession = open, lastProcessedElapsedMillis = 8_000_000_000L)
        val snapshot = UsageObservationSnapshot(engineState, bootId = null)

        val restored = UsageObservationRestorer.restore(snapshot, currentBootId = "boot-1")

        assertEquals(UsageSessionEngineState.INITIAL, restored)
    }

    @Test
    fun `current boot instance unknown -- fails safe to reboot handling, never assumed same-boot`() {
        // PCA-RUNTIME-2R1's core regression gate: "unable to determine boot instance" must never
        // be interpreted as "definitely same boot."
        val open = OpenUsageSession(appToken = "abc", startedAtElapsedMillis = 1_000L, startedAtEpochMillis = 5_000L)
        val engineState = UsageSessionEngineState(openSession = open, lastProcessedElapsedMillis = 8_000_000_000L)
        val snapshot = UsageObservationSnapshot(engineState, bootId = "boot-1")

        val restored = UsageObservationRestorer.restore(snapshot, currentBootId = null)

        assertEquals(UsageSessionEngineState.INITIAL, restored)
    }

    @Test
    fun `both sides unknown -- fails safe to reboot handling`() {
        val engineState = UsageSessionEngineState(openSession = null, lastProcessedElapsedMillis = 500L)
        val snapshot = UsageObservationSnapshot(engineState, bootId = null)

        val restored = UsageObservationRestorer.restore(snapshot, currentBootId = null)

        assertEquals(UsageSessionEngineState.INITIAL, restored)
    }
}
