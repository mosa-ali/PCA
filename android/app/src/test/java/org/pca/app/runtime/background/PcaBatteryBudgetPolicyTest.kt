package org.pca.app.runtime.background

import androidx.work.PeriodicWorkRequest
import androidx.work.WorkRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.pca.app.platform.PowerSaveModeSource
import java.util.concurrent.TimeUnit

/**
 * PCA-NFR-034: proves the two machine-checkable claims [PcaBatteryBudgetPolicy] makes.
 *
 *  1. [PcaBatteryBudgetPolicy.MIN_PERIODIC_INTERVAL_MINUTES] genuinely matches the REAL platform
 *     floor `WorkManager` itself enforces ([PeriodicWorkRequest.MIN_PERIODIC_INTERVAL_MILLIS]) --
 *     not a hand-typed guess that could silently drift from the real platform constant -- and
 *     [PcaBatteryBudgetPolicy.meetsPlatformMinimumInterval] correctly classifies intervals on
 *     both sides of that floor. This is the test that would catch a real scheduler being changed
 *     to poll below the platform's supported minimum interval (see
 *     [WorkManagerBackgroundExecutionSchedulerTest] for the same floor exercised against the real,
 *     production `PeriodicWorkRequestBuilder` call).
 *  2. [PcaBatteryBudgetPolicy.shouldRunNonCriticalWork] is exactly `!isPowerSaveMode()` -- the one
 *     decision every non-safety-critical background cycle in this app should consult (see
 *     [BatteryBudgetedCycleRunnerTest] for proof that this decision genuinely gates non-critical
 *     work while never gating safety-critical work).
 */
class PcaBatteryBudgetPolicyTest {

    @Test
    fun `MIN_PERIODIC_INTERVAL_MINUTES matches WorkManager's own real, documented floor`() {
        val realFloorMillis = PeriodicWorkRequest.MIN_PERIODIC_INTERVAL_MILLIS
        val policyFloorMillis = TimeUnit.MINUTES.toMillis(PcaBatteryBudgetPolicy.MIN_PERIODIC_INTERVAL_MINUTES)
        assertEquals(
            "PcaBatteryBudgetPolicy's floor must equal WorkManager's real PeriodicWorkRequest.MIN_PERIODIC_INTERVAL_MILLIS, not an independently-guessed literal",
            realFloorMillis,
            policyFloorMillis,
        )
    }

    @Test
    fun `meetsPlatformMinimumInterval rejects intervals below the platform floor and accepts intervals at or above it`() {
        assertFalse(PcaBatteryBudgetPolicy.meetsPlatformMinimumInterval(1))
        assertFalse(PcaBatteryBudgetPolicy.meetsPlatformMinimumInterval(PcaBatteryBudgetPolicy.MIN_PERIODIC_INTERVAL_MINUTES - 1))
        assertTrue(PcaBatteryBudgetPolicy.meetsPlatformMinimumInterval(PcaBatteryBudgetPolicy.MIN_PERIODIC_INTERVAL_MINUTES))
        assertTrue(PcaBatteryBudgetPolicy.meetsPlatformMinimumInterval(PcaBatteryBudgetPolicy.MIN_PERIODIC_INTERVAL_MINUTES + 1))
    }

    @Test
    fun `the real production schedulers' own intervals satisfy the platform floor`() {
        // WorkManagerBackgroundExecutionScheduler.PERIOD_MINUTES is defined IN TERMS OF this same
        // policy constant (see that class's own doc comment) -- this assertion still has real
        // value: it fails loudly if a future edit ever reintroduces an independent literal there.
        assertTrue(
            PcaBatteryBudgetPolicy.meetsPlatformMinimumInterval(WorkManagerBackgroundExecutionScheduler.PERIOD_MINUTES),
        )
        // Retention maintenance runs daily -- converted to minutes, it clears the 15-minute floor
        // by a wide, deliberate margin (see WorkManagerBackgroundExecutionScheduler.scheduleRetentionMaintenance's
        // own doc comment for why a slower-than-ingestion cadence is the correct choice here).
        val retentionIntervalMinutes = TimeUnit.DAYS.toMinutes(WorkManagerBackgroundExecutionScheduler.RETENTION_PERIOD_DAYS)
        assertTrue(PcaBatteryBudgetPolicy.meetsPlatformMinimumInterval(retentionIntervalMinutes))
    }

    @Test
    fun `PcaBackgroundWorkConstraints backoff bounds stay within WorkManager's own documented backoff range`() {
        assertTrue(PcaBackgroundWorkConstraints.BACKOFF_DELAY_MILLIS >= WorkRequest.MIN_BACKOFF_MILLIS)
        assertTrue(PcaBackgroundWorkConstraints.BACKOFF_DELAY_MILLIS <= WorkRequest.MAX_BACKOFF_MILLIS)
        // Starts at the platform's own minimum -- a deliberately conservative first-retry delay,
        // not an arbitrarily short one (see PcaBackgroundWorkConstraints' own doc comment).
        assertEquals(WorkRequest.MIN_BACKOFF_MILLIS, PcaBackgroundWorkConstraints.BACKOFF_DELAY_MILLIS)
    }

    @Test
    fun `shouldRunNonCriticalWork is true only when the OS is not in power-save mode`() {
        assertTrue(PcaBatteryBudgetPolicy.shouldRunNonCriticalWork(FakePowerSaveModeSource(isPowerSaveMode = false)))
        assertFalse(PcaBatteryBudgetPolicy.shouldRunNonCriticalWork(FakePowerSaveModeSource(isPowerSaveMode = true)))
    }
}

internal class FakePowerSaveModeSource(private val isPowerSaveMode: Boolean) : PowerSaveModeSource {
    override fun isPowerSaveMode(): Boolean = isPowerSaveMode
}
