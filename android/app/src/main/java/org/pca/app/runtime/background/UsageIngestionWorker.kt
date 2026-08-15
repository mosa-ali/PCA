package org.pca.app.runtime.background

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.pca.app.runtime.graph.PcaAppGraph

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
 * Uses [Result.retry] (which respects [PcaBackgroundWorkConstraints]'s exponential backoff) on any
 * uncaught throwable from the cycle itself -- note [PcaAppGraph.runUsageLocationIngestionCycle]
 * already `runCatching`-guards each of its own three steps internally, so this Worker's own
 * try/catch is a second, outer safety net (e.g. against [PcaAppGraph.getInstance] itself throwing
 * during a pathological early-process-start race), not the primary error-handling layer.
 */
class UsageIngestionWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val startNanos = System.nanoTime()
        return try {
            val graph = PcaAppGraph.getInstance(applicationContext)
            graph.runUsageLocationIngestionCycle()
            BackgroundWorkMetrics.recordRun(System.nanoTime() - startNanos, success = true)
            Result.success()
        } catch (t: Throwable) {
            BackgroundWorkMetrics.recordRun(System.nanoTime() - startNanos, success = false)
            Result.retry()
        }
    }
}
