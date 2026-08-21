package org.pca.app.runtime.background

import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkInfo
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * PCA-AND-002/PCA-NFR-033: proves the real, reachable path -- a class existing is not enough (per
 * this lane's own testing standard). Uses [WorkManagerTestInitHelper] (androidx `work-testing`) so
 * this exercises real `WorkManager` enqueue/uniqueness/constraint behavior, not a hand-rolled fake.
 */
@RunWith(RobolectricTestRunner::class)
class WorkManagerBackgroundExecutionSchedulerTest {

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val config = Configuration.Builder()
            .setExecutor(SynchronousExecutor())
            .build()
        WorkManagerTestInitHelper.initializeTestWorkManager(context, config)
    }

    @Test
    fun `scheduleUsageIngestion enqueues a real periodic WorkManager job under the documented unique name`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val scheduler = WorkManagerBackgroundExecutionScheduler(context)

        scheduler.scheduleUsageIngestion()

        val workInfos = androidx.work.WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(WorkManagerBackgroundExecutionScheduler.UNIQUE_WORK_NAME_USAGE_INGESTION)
            .get()

        assertEquals(1, workInfos.size)
        val info = workInfos.single()
        assertTrue(info.state == WorkInfo.State.ENQUEUED || info.state == WorkInfo.State.RUNNING)
        assertTrue(info.tags.contains(WorkManagerBackgroundExecutionScheduler.WORK_TAG_USAGE_INGESTION))
    }

    @Test
    fun `calling scheduleUsageIngestion twice keeps exactly one job -- KEEP policy, never a duplicate`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val scheduler = WorkManagerBackgroundExecutionScheduler(context)

        scheduler.scheduleUsageIngestion()
        scheduler.scheduleUsageIngestion()

        val workInfos = androidx.work.WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(WorkManagerBackgroundExecutionScheduler.UNIQUE_WORK_NAME_USAGE_INGESTION)
            .get()

        assertEquals(1, workInfos.size)
    }

    // --- PCA-DATA-024/PCA-FR-105: scheduleRetentionMaintenance -------------------------------

    @Test
    fun `scheduleRetentionMaintenance enqueues a real periodic WorkManager job under the documented unique name`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val scheduler = WorkManagerBackgroundExecutionScheduler(context)

        scheduler.scheduleRetentionMaintenance()

        val workInfos = androidx.work.WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(WorkManagerBackgroundExecutionScheduler.UNIQUE_WORK_NAME_RETENTION_MAINTENANCE)
            .get()

        assertEquals(1, workInfos.size)
        val info = workInfos.single()
        assertTrue(info.state == WorkInfo.State.ENQUEUED || info.state == WorkInfo.State.RUNNING)
        assertTrue(info.tags.contains(WorkManagerBackgroundExecutionScheduler.WORK_TAG_RETENTION_MAINTENANCE))
    }

    @Test
    fun `calling scheduleRetentionMaintenance twice keeps exactly one job -- KEEP policy, never a duplicate`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val scheduler = WorkManagerBackgroundExecutionScheduler(context)

        scheduler.scheduleRetentionMaintenance()
        scheduler.scheduleRetentionMaintenance()

        val workInfos = androidx.work.WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork(WorkManagerBackgroundExecutionScheduler.UNIQUE_WORK_NAME_RETENTION_MAINTENANCE)
            .get()

        assertEquals(1, workInfos.size)
    }
}
