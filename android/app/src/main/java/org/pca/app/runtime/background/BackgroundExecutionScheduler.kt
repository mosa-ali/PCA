package org.pca.app.runtime.background

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * PCA-AND-RUNTIME-PLATFORM-1: the background-execution PRIMITIVE this lane exists to build, kept
 * behind a narrow interface so a future writer (protection-experience, wellbeing/sensors) can
 * schedule their own periodic work without depending on `WorkManager` APIs directly in their own
 * feature code, and so tests can substitute a fake without touching real `WorkManager` state --
 * see [org.pca.app.runtime.background] package doc / the mission report for how to extend this.
 *
 * Only [scheduleUsageIngestion] is implemented today (this lane's own concrete need); a future
 * writer needing a second periodic job should add a sibling method here (or, if their scheduling
 * needs genuinely differ, a new `CoroutineWorker` + a call to
 * [WorkManager.enqueueUniquePeriodicWork] built the same way, reusing
 * [PcaBackgroundWorkConstraints.standardConstraints] for consistency) rather than inventing a
 * second, differently-configured background-execution mechanism.
 */
interface BackgroundExecutionScheduler {
    /** Idempotent: safe to call on every [org.pca.app.runtime.graph.PcaAppGraph.start] (process
     * restart, configuration change) without creating duplicate periodic work. */
    fun scheduleUsageIngestion()
}

/**
 * Real, production `WorkManager` binding. [PERIOD_MINUTES] is `WorkManager`'s own enforced floor
 * for `PeriodicWorkRequest` (15 minutes -- a lower value is silently clamped up by the platform,
 * so this constant states the real, effective interval rather than an aspirational one PCA-NFR-033
 * would need to explain away). This is coarser than [org.pca.app.runtime.graph.PcaAppGraph]'s own
 * 5-minute in-process poll loop deliberately -- this job is the process-death SAFETY NET, not the
 * primary collection path; the in-process loop already provides higher-frequency collection
 * whenever the process happens to be alive.
 */
class WorkManagerBackgroundExecutionScheduler(private val context: Context) : BackgroundExecutionScheduler {

    override fun scheduleUsageIngestion() {
        val request = PeriodicWorkRequestBuilder<UsageIngestionWorker>(PERIOD_MINUTES, TimeUnit.MINUTES)
            .setConstraints(PcaBackgroundWorkConstraints.standardConstraints())
            .setBackoffCriteria(
                PcaBackgroundWorkConstraints.BACKOFF_POLICY,
                PcaBackgroundWorkConstraints.BACKOFF_DELAY_MILLIS,
                PcaBackgroundWorkConstraints.BACKOFF_DELAY_TIME_UNIT,
            )
            .addTag(WORK_TAG_USAGE_INGESTION)
            .build()

        // KEEP (not REPLACE/UPDATE): a re-call from a fresh PcaAppGraph.start() (process restart,
        // configuration change) must not reset an already-scheduled job's internal timing/backoff
        // state -- same idempotency discipline this graph's other `start()`-time registrations use.
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            UNIQUE_WORK_NAME_USAGE_INGESTION,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    companion object {
        const val UNIQUE_WORK_NAME_USAGE_INGESTION = "pca_usage_ingestion_periodic"
        const val WORK_TAG_USAGE_INGESTION = "pca_usage_ingestion"
        const val PERIOD_MINUTES = 15L
    }
}
