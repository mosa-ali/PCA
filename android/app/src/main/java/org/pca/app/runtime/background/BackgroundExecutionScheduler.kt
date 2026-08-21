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
 * [scheduleUsageIngestion] was the first implementation of this pattern; [scheduleRetentionMaintenance]
 * (PCA-DATA-024/PCA-FR-105) is the second, added as the sibling method this interface's own doc
 * comment invited -- a future writer needing a third periodic job should add another sibling
 * method here (or, if their scheduling needs genuinely differ, a new `CoroutineWorker` + a call to
 * [WorkManager.enqueueUniquePeriodicWork] built the same way, reusing
 * [PcaBackgroundWorkConstraints.standardConstraints] for consistency) rather than inventing a
 * second, differently-configured background-execution mechanism.
 */
interface BackgroundExecutionScheduler {
    /** Idempotent: safe to call on every [org.pca.app.runtime.graph.PcaAppGraph.start] (process
     * restart, configuration change) without creating duplicate periodic work. */
    fun scheduleUsageIngestion()

    /** Idempotent, same discipline as [scheduleUsageIngestion]: safe to call on every
     * [org.pca.app.runtime.graph.PcaAppGraph.start] without creating duplicate periodic work. */
    fun scheduleRetentionMaintenance()
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

    /**
     * PCA-DATA-024/PCA-FR-105: retention/deletion maintenance does not need `WorkManager`'s
     * 15-minute [PERIOD_MINUTES] floor the way live usage/location ingestion does -- there is no
     * freshness requirement for "how quickly must an expired record actually be deleted" anywhere
     * near as tight as ingestion's own near-real-time collection need, and a device's retention
     * windows are measured in days/months (see [RetentionPolicy][org.pca.app.persistence.entity.RetentionPolicy]),
     * not minutes. [RETENTION_PERIOD_DAYS] (one day) is therefore the right cadence: frequent
     * enough that an expired record is never retained for materially longer than its policy
     * window, without the extra `WorkManager` execution overhead a 15-minute cadence would add for
     * work that only ever has something to do once actual cutoffs have passed.
     */
    override fun scheduleRetentionMaintenance() {
        val request = PeriodicWorkRequestBuilder<RetentionMaintenanceWorker>(RETENTION_PERIOD_DAYS, TimeUnit.DAYS)
            .setConstraints(PcaBackgroundWorkConstraints.standardConstraints())
            .setBackoffCriteria(
                PcaBackgroundWorkConstraints.BACKOFF_POLICY,
                PcaBackgroundWorkConstraints.BACKOFF_DELAY_MILLIS,
                PcaBackgroundWorkConstraints.BACKOFF_DELAY_TIME_UNIT,
            )
            .addTag(WORK_TAG_RETENTION_MAINTENANCE)
            .build()

        // KEEP, same idempotency discipline as scheduleUsageIngestion above.
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            UNIQUE_WORK_NAME_RETENTION_MAINTENANCE,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    companion object {
        const val UNIQUE_WORK_NAME_USAGE_INGESTION = "pca_usage_ingestion_periodic"
        const val WORK_TAG_USAGE_INGESTION = "pca_usage_ingestion"

        /** PCA-NFR-034: defined IN TERMS OF [PcaBatteryBudgetPolicy.MIN_PERIODIC_INTERVAL_MINUTES]
         * (rather than repeating the literal `15`) so this scheduler's real interval and the
         * canonical platform-floor policy can never silently drift apart -- see
         * [PcaBatteryBudgetPolicy]'s own doc comment. */
        const val PERIOD_MINUTES = PcaBatteryBudgetPolicy.MIN_PERIODIC_INTERVAL_MINUTES
        const val UNIQUE_WORK_NAME_RETENTION_MAINTENANCE = "pca_retention_maintenance_periodic"
        const val WORK_TAG_RETENTION_MAINTENANCE = "pca_retention_maintenance"
        const val RETENTION_PERIOD_DAYS = 1L
    }
}
