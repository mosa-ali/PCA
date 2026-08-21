package org.pca.app.runtime.background

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.pca.app.runtime.graph.PcaAppGraph

/**
 * PCA-DATA-024/PCA-FR-105 closure: the retention-deletion safety net. A repo-wide audit found
 * [org.pca.app.persistence.retention.RetentionEngine] -- a real, fully-implemented, unit-tested
 * class -- constructed exactly once in production
 * ([org.pca.app.persistence.PcaLocalPersistence.retentionEngine]) but never actually invoked by
 * anything: on-device data was never deleted per family retention policy, regardless of how
 * correct the engine's own deletion algorithm is in isolation. This is the app's second
 * `WorkManager`/`CoroutineWorker` background component (mirroring [UsageIngestionWorker], the
 * first) -- `WorkManager` persists this job's schedule across process death AND device reboot,
 * so retention maintenance keeps running even though nothing else in this app currently drives it
 * from an in-process loop (see [PcaAppGraph.runRetentionMaintenanceCycle]'s own doc comment for
 * why no in-process counterpart exists here the way usage/location ingestion has one).
 *
 * Deliberately does NOT duplicate [PcaAppGraph.runRetentionMaintenanceCycle]'s logic -- `doWork()`
 * calls the exact same production suspend function via the same process-wide [PcaAppGraph]
 * singleton, so there is exactly one implementation of "what one retention-maintenance cycle
 * does," never two paths that could drift.
 *
 * Uses [Result.retry] (which respects [PcaBackgroundWorkConstraints]'s exponential backoff) on any
 * uncaught throwable from the cycle itself -- note [PcaAppGraph.runRetentionMaintenanceCycle]
 * (via [org.pca.app.persistence.retention.executeRetentionMaintenanceCycle]) already
 * `runCatching`-guards each of its own three engine calls internally, so this Worker's own
 * try/catch is a second, outer safety net (e.g. against [PcaAppGraph.getInstance] itself throwing
 * during a pathological early-process-start race), not the primary error-handling layer.
 */
class RetentionMaintenanceWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val startNanos = System.nanoTime()
        return try {
            val graph = PcaAppGraph.getInstance(applicationContext)
            graph.runRetentionMaintenanceCycle()
            BackgroundWorkMetrics.recordRun(System.nanoTime() - startNanos, success = true)
            Result.success()
        } catch (t: Throwable) {
            BackgroundWorkMetrics.recordRun(System.nanoTime() - startNanos, success = false)
            Result.retry()
        }
    }
}
