package org.pca.app.runtime.background

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ListenableWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import org.pca.app.runtime.graph.PcaAppGraph
import org.pca.app.runtime.sync.RuntimeCustodyOutcome

/**
 * PCA-AND-002/PCA-FR-040/PCA-NFR-033 closure: the app's first `WorkManager`/`CoroutineWorker`
 * background component. A fresh audit found ZERO `WorkManager` usage anywhere in this module --
 * usage-ingestion previously only ran via [PcaAppGraph]'s own in-process coroutine loop
 * (`startUsageLocationPolling`), which dies with the process and only resumes when something else
 * (a launcher tap, a system-triggered relaunch) restarts the app. This Worker is the resilient,
 * OS-scheduled safety net: `WorkManager` persists this job's schedule across process death AND
 * device reboot (it re-registers itself via its own `BOOT_COMPLETED` receiver internally -- no
 * action needed from this app's manifest for that part), so ingestion resumes automatically.
 *
 * Deliberately does NOT duplicate [PcaAppGraph.runUsageLocationIngestionCycle]'s logic --
 * `doWork()` calls the exact same production suspend function the in-process loop calls, via the
 * same process-wide [PcaAppGraph] singleton. This keeps exactly one implementation of "what one
 * ingestion cycle does" (poll usage, capture a location sample, re-evaluate usage-access
 * degradation), with two independent CALLERS for two independent reasons (freshness while the
 * process is alive vs. resilience across process death), never two logic paths that could drift.
 *
 * Uses [Result.retry] (which respects [PcaBackgroundWorkConstraints]'s exponential backoff) on an
 * ordinary exception from the cycle itself. Coroutine cancellation and fatal JVM errors propagate;
 * [PcaAppGraph.runUsageLocationIngestionCycle] isolates ordinary failures per suspend step while
 * allowing cancellation and fatal errors to reach this Worker's outer retry boundary (e.g. a
 * graph-construction exception during an early-process-start race).
 */
class UsageIngestionWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result = runUsageIngestionWork {
        val graph = PcaAppGraph.getInstance(applicationContext)
        graph.runUsageLocationIngestionCycle()
        // Reuse this persisted OS schedule after process death/reboot.
        // Only an eligible committed identity may pull; custody never applies a policy.
        val outcome = graph.synchronizeRuntimeCustody()
        val retry = outcome == RuntimeCustodyOutcome.MORE_PENDING || outcome == RuntimeCustodyOutcome.RETRYABLE_FAILURE
        UsageIngestionWorkerOutcome(
            shouldRetry = retry,
            metricsSuccess = !retry && outcome != RuntimeCustodyOutcome.BLOCKED,
        )
    }
}

internal data class UsageIngestionWorkerOutcome(val shouldRetry: Boolean, val metricsSuccess: Boolean)

/** Testable boundary for WorkManager outcomes. Only ordinary exceptions become retries; lifecycle
 * cancellation and fatal JVM errors must propagate to WorkManager/the runtime. */
internal suspend fun runUsageIngestionWork(
    cycle: suspend () -> UsageIngestionWorkerOutcome,
): ListenableWorker.Result {
    val startNanos = System.nanoTime()
    return try {
        val outcome = cycle()
        BackgroundWorkMetrics.recordRun(System.nanoTime() - startNanos, success = outcome.metricsSuccess)
        if (outcome.shouldRetry) ListenableWorker.Result.retry() else ListenableWorker.Result.success()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        BackgroundWorkMetrics.recordRun(System.nanoTime() - startNanos, success = false)
        ListenableWorker.Result.retry()
    }
}
