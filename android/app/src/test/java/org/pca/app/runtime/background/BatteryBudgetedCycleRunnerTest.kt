package org.pca.app.runtime.background

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * PCA-NFR-034: proves [BatteryBudgetedCycleRunner]'s exact contract --
 * [PcaAppGraph.runUsageLocationIngestionCycle][org.pca.app.runtime.graph.PcaAppGraph.runUsageLocationIngestionCycle]
 * wires its four protection/tamper-degradation monitor checks as `criticalWork` and its usage/
 * location/prayer/geofence steps as `nonCriticalWork` through exactly this runner, so proving the
 * runner's contract here proves the real production wiring's safety property directly, without
 * needing Robolectric/a real device or a fully-composed `PcaAppGraph`.
 *
 * This is this lane's REGRESSION TEST for "safety-critical protection must never be gated by
 * battery saver" (PCA-NFR-034 principle 7): [criticalWork always runs] would fail the moment
 * anyone changes [BatteryBudgetedCycleRunner.run] to also gate `criticalWork` on
 * `shouldRunNonCritical`.
 */
class BatteryBudgetedCycleRunnerTest {

    @Test
    fun `criticalWork always runs, even when shouldRunNonCritical is false`() = runTest {
        var criticalRunCount = 0

        BatteryBudgetedCycleRunner.run(
            shouldRunNonCritical = { false },
            nonCriticalWork = { error("must not run") },
            criticalWork = { criticalRunCount++ },
        )

        assertEquals(
            "criticalWork (this app's protection/tamper-degradation monitor checks) must run unconditionally regardless of the battery-saver signal -- gating it would weaken safety to save battery, which PCA-NFR-034 explicitly forbids",
            1,
            criticalRunCount,
        )
    }

    @Test
    fun `criticalWork still runs when shouldRunNonCritical is true`() = runTest {
        var criticalRunCount = 0

        BatteryBudgetedCycleRunner.run(
            shouldRunNonCritical = { true },
            nonCriticalWork = { },
            criticalWork = { criticalRunCount++ },
        )

        assertEquals(1, criticalRunCount)
    }

    @Test
    fun `nonCriticalWork runs only when shouldRunNonCritical is true`() = runTest {
        var nonCriticalRunCount = 0

        BatteryBudgetedCycleRunner.run(
            shouldRunNonCritical = { true },
            nonCriticalWork = { nonCriticalRunCount++ },
            criticalWork = { },
        )

        assertEquals(
            "nonCriticalWork must run when the battery budget allows it",
            1,
            nonCriticalRunCount,
        )
    }

    @Test
    fun `nonCriticalWork is skipped when shouldRunNonCritical is false -- respects battery saver`() = runTest {
        var nonCriticalRunCount = 0

        BatteryBudgetedCycleRunner.run(
            shouldRunNonCritical = { false },
            nonCriticalWork = { nonCriticalRunCount++ },
            criticalWork = { },
        )

        assertEquals(
            "nonCriticalWork must back off while the OS reports Battery Saver active, per PCA-NFR-034",
            0,
            nonCriticalRunCount,
        )
    }
}
