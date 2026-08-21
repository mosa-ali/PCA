package org.pca.app.runtime.background

/**
 * PCA-NFR-034: the one shared "run a cycle's non-critical work only when the battery budget
 * allows it, but always run its safety-critical work regardless" coordination shape -- pure
 * (no `Context`, no platform dependency) and directly unit-testable, so the "safety-critical work
 * is genuinely unconditional" contract is provable without Robolectric/a real device.
 *
 * [org.pca.app.runtime.graph.PcaAppGraph.runUsageLocationIngestionCycle] is the one production
 * caller today: [criticalWork] is its four protection/tamper-degradation monitor checks (never
 * gated, per PCA-NFR-034's standing decision that safety-critical protection may keep running
 * under battery saver); [nonCriticalWork] is usage/location collection, prayer-location staleness
 * notification, and geofence evaluation (informational parent-visibility features, legitimately
 * deferrable). A future background cycle with the same "always run X, only run Y when the battery
 * budget allows" shape should reuse this rather than re-deriving its own gating `if`.
 */
object BatteryBudgetedCycleRunner {
    /**
     * Runs [nonCriticalWork] only when [shouldRunNonCritical] returns true, then runs
     * [criticalWork]. This runner adds no exception-suppression of its own -- an uncaught throw
     * from [nonCriticalWork] propagates and skips [criticalWork], so callers whose critical work
     * must run even if their non-critical work fails MUST internally `runCatching` their own
     * non-critical steps, exactly as
     * [org.pca.app.runtime.graph.PcaAppGraph.runUsageLocationIngestionCycle] already does for
     * every step it passes in here (see that function's own doc comment for its existing
     * per-step `runCatching` discipline, unchanged by this runner).
     */
    suspend fun run(
        shouldRunNonCritical: () -> Boolean,
        nonCriticalWork: suspend () -> Unit,
        criticalWork: suspend () -> Unit,
    ) {
        if (shouldRunNonCritical()) {
            nonCriticalWork()
        }
        criticalWork()
    }
}
