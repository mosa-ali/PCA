package org.pca.app.runtime.background

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.ListenableWorker
import kotlinx.coroutines.CancellationException
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
 * Uses [Result.retry] (which respects [PcaBackgroundWorkConstraints]'s exponential backoff) on an
 * ordinary exception from the cycle itself. Coroutine cancellation and fatal JVM errors propagate;
 * [PcaAppGraph.runRetentionMaintenanceCycle]
 * (via [org.pca.app.persistence.retention.executeRetentionMaintenanceCycle]) isolates ordinary
 * failures per maintenance step while allowing cancellation and fatal errors to reach this
 * Worker's outer retry boundary (e.g. a graph-construction exception during an early-process-start
 * race).
 */
class RetentionMaintenanceWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result = runRetentionMaintenanceWork {
        val graph = PcaAppGraph.getInstance(applicationContext)
        graph.runRetentionMaintenanceCycle()
    }
}

/** Shared worker boundary kept independently testable from [PcaAppGraph]'s AndroidKeyStore-backed
 * composition. WorkManager cancellation is lifecycle control, not a transient maintenance failure:
 * propagate it so a stopped worker is not converted into a scheduled retry. */
internal suspend fun runRetentionMaintenanceWork(cycle: suspend () -> Unit): ListenableWorker.Result {
    val startNanos = System.nanoTime()
    return try {
        cycle()
        BackgroundWorkMetrics.recordRun(System.nanoTime() - startNanos, success = true)
        ListenableWorker.Result.success()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        BackgroundWorkMetrics.recordRun(System.nanoTime() - startNanos, success = false)
        ListenableWorker.Result.retry()
    }
}
