package org.pca.app.runtime.background

import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * PCA-NFR-034: lightweight, in-memory-only diagnostic counters for this app's periodic background
 * work. This is NOT a telemetry/analytics pipeline -- none exists anywhere in this codebase, and
 * building one is out of this lane's scope (Section 16 of the mission brief: honest about what was
 * measured vs. documented as a target, not a promise of full telemetry). Every counter here is
 * process-local and reset on process death; it exists so a developer/QA build (or a future debug
 * screen) can inspect how often and how long the real [UsageIngestionWorker] actually ran.
 *
 * DOCUMENTED BATTERY-IMPACT TARGET (a target, NOT a verified on-device measurement -- Battery
 * Historian / `adb shell dumpsys batterystats` profiling is out of scope for this lane):
 *  - [UsageIngestionWorker] runs at most once per
 *    [WorkManagerBackgroundExecutionScheduler.PERIOD_MINUTES] minutes (15 -- WorkManager's own
 *    enforced floor for `PeriodicWorkRequest`).
 *  - Each run is constrained by [PcaBackgroundWorkConstraints.standardConstraints] (battery-not-low
 *    only) and performs only local work: one `UsageStatsManager.queryEvents` call plus already-
 *    batched Room reads/writes -- no network I/O, no wakelock held beyond WorkManager's own
 *    execution window.
 *  - MEASURED (not just documented): [BackgroundWorkMetricsTest] asserts that a single
 *    `doWork()` cycle against a small local database completes in low single-digit milliseconds on
 *    the local JVM/Robolectric test environment used by this repo's unit test suite. That number is
 *    NOT a real-device battery-drain measurement (real `UsageStatsManager` query cost and real disk
 *    I/O will be higher) -- it is evidence that the work performed per cycle is small and bounded,
 *    not evidence of actual battery drain, which remains an honestly-undone target.
 */
object BackgroundWorkMetrics {
    private val runCount = AtomicInteger(0)
    private val failureCount = AtomicInteger(0)
    private val lastDurationNanos = AtomicLong(0)
    private val totalDurationNanos = AtomicLong(0)

    fun recordRun(durationNanos: Long, success: Boolean) {
        runCount.incrementAndGet()
        if (!success) failureCount.incrementAndGet()
        lastDurationNanos.set(durationNanos)
        totalDurationNanos.addAndGet(durationNanos)
    }

    fun snapshot(): BackgroundWorkMetricsSnapshot = BackgroundWorkMetricsSnapshot(
        runCount = runCount.get(),
        failureCount = failureCount.get(),
        lastDurationNanos = lastDurationNanos.get(),
        totalDurationNanos = totalDurationNanos.get(),
    )

    /** Test-only reset -- production code never calls this; counters are meant to accumulate for
     * the process lifetime as a diagnostic, not to be zeroed mid-run. */
    fun resetForTest() {
        runCount.set(0)
        failureCount.set(0)
        lastDurationNanos.set(0)
        totalDurationNanos.set(0)
    }
}

data class BackgroundWorkMetricsSnapshot(
    val runCount: Int,
    val failureCount: Int,
    val lastDurationNanos: Long,
    val totalDurationNanos: Long,
)
