package org.pca.app.runtime.usage

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.dao.UsageSessionDao
import org.pca.app.persistence.entity.UsageSessionEntity
import org.pca.app.persistence.repository.UsageSessionRepository
import org.pca.app.platform.*
import org.pca.app.runtime.FakeMonotonicTimeSource
import org.pca.app.runtime.FakeWallClockTimeSource
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class UsageRecorderPersistenceBoundaryTest {
    private class Fixture : AutoCloseable {
        val db = PersistenceTestSupport.inMemoryDb()
        val elapsed = FakeMonotonicTimeSource()
        val wall = FakeWallClockTimeSource(10_000L)
        val store = InMemoryUsageObservationSnapshotStore()
        var device: String? = "device-1"
        var events = emptyList<UsageObservedEvent>()
        var onQuery: () -> Unit = {}
        var beforeWrite: suspend (UsageSessionEntity) -> Unit = {}
        var afterWrite: suspend (UsageSessionEntity) -> Unit = {}
        val dao = object : UsageSessionDao by db.usageSessionDao() {
            override suspend fun upsert(entity: UsageSessionEntity) {
                beforeWrite(entity)
                db.usageSessionDao().upsert(entity)
                afterWrite(entity)
            }
        }
        val repository = UsageSessionRepository(dao, PersistenceTestSupport.testCipher())
        val source = object : UsageObservationSource {
            override fun accessState() = UsageAccessState.GRANTED
            override fun queryEventsSince(elapsedRealtimeMillis: Long) = emptyList<UsageEvent>()
            override fun queryObservationBatchSince(elapsedRealtimeMillis: Long): UsageObservationBatch {
                val sample = UsageClockSample(elapsed.elapsedRealtimeMillis(), wall.currentTimeMillis())
                val batch = UsageObservationBatch(events, sample, sample,
                    UsageClockBridge.wallAtElapsed(elapsedRealtimeMillis, sample),
                    UsageAccessState.GRANTED, UsageQueryStatus.OBSERVED)
                onQuery()
                return batch
            }
        }
        fun recorder() = UsageSessionRecorder(source, repository, elapsed, wall, store, { device }, "boot-1")
        fun completedBatch() {
            elapsed.nowNanos = 400_000_000L
            wall.nowMillis = 10_400L
            events = listOf(
                UsageEvent("one", UsageEventType.FOREGROUND, 100L),
                UsageEvent("one", UsageEventType.BACKGROUND, 200L),
                UsageEvent("two", UsageEventType.FOREGROUND, 300L),
                UsageEvent("two", UsageEventType.BACKGROUND, 400L),
            ).map { UsageObservedEvent(it, 10_000L + it.elapsedRealtimeMillis) }
        }
        override fun close() = db.close()
    }

    @Test fun `persisted interval preceding generation anchor is discarded without credit`() = runTest {
        Fixture().use { f ->
            f.elapsed.nowNanos = 100_000_000L
            f.wall.nowMillis = 10_100L
            val anchor = UsageClockSample(100L, 10_100L)
            f.store.save(UsageObservationSnapshot(
                UsageSessionEngineState(OpenUsageSession("opaque", 50L, 10_050L), 100L),
                "boot-1", 2, anchor, "device-1", UsageObservationCoverage.OBSERVED, "generation", anchor))
            val recorder = f.recorder()
            f.elapsed.nowNanos = 200_000_000L
            f.wall.nowMillis = 10_200L
            f.events = listOf(UsageObservedEvent(UsageEvent("new", UsageEventType.FOREGROUND, 200L), 10_200L))
            assertEquals(UsageObservationCoverage.BASELINE, recorder.poll().coverage)
            assertEquals(0, f.db.usageSessionDao().count())
            assertNull(recorder.currentEngineState().openSession)
        }
    }

    @Test fun `cancellation during second Room write preserves cursor and restart replays without duplicates`() = runTest {
        Fixture().use { f ->
            val recorder = f.recorder()
            recorder.poll()
            val baseline = f.store.load()
            f.completedBatch()
            val reachedSecondWrite = CompletableDeferred<Unit>()
            var writes = 0
            f.beforeWrite = {
                if (++writes == 2) {
                    reachedSecondWrite.complete(Unit)
                    awaitCancellation()
                }
            }
            val job = launch { recorder.poll() }
            reachedSecondWrite.await()
            job.cancelAndJoin()
            assertEquals(baseline, f.store.load())
            assertEquals(baseline!!.engineState, recorder.currentEngineState())
            assertEquals(1, f.repository.getForDevice("device-1").size)
            f.beforeWrite = {}
            assertEquals(2, f.recorder().poll().recordedSessionCount)
            assertEquals(2, f.repository.getForDevice("device-1").size)
            assertTrue(f.repository.getForDevice("device-1").all { it.observationProvenance != null })
            assertEquals(400L, f.store.load()!!.engineState.lastProcessedElapsedMillis)
        }
    }

    @Test fun `device change during query discards old batch and establishes a new identity boundary`() = runTest {
        Fixture().use { f ->
            val recorder = f.recorder()
            recorder.poll()
            f.completedBatch()
            f.onQuery = { f.device = "device-2" }
            assertEquals(UsageObservationCoverage.BASELINE, recorder.poll().coverage)
            assertEquals("device-2", f.store.load()!!.deviceId)
            assertNull(recorder.currentEngineState().openSession)
            assertEquals(0, f.db.usageSessionDao().count())
        }
    }

    @Test fun `partial Room retry with changed bridge offset retains original wall based row identity`() = runTest {
        Fixture().use { f ->
            val recorder = f.recorder()
            recorder.poll()
            val baseline = f.store.load()
            f.completedBatch()
            var writes = 0
            f.beforeWrite = { if (++writes == 2) error("injected second row failure") }
            try {
                recorder.poll()
                fail("partial failure must preserve the replay cursor")
            } catch (_: IllegalStateException) { }
            assertEquals(baseline, f.store.load())
            val originalId = f.repository.getForDevice("device-1").single().id
            f.beforeWrite = {}
            // The same original platform events now project 50 ms earlier. This sampled
            // offset change is within tolerance; identity must not use the projection.
            f.elapsed.nowNanos = 500_000_000L
            f.wall.nowMillis = 10_550L
            f.events = f.events.map { it.copy(event = it.event.copy(
                elapsedRealtimeMillis = it.event.elapsedRealtimeMillis - 50L)) }
            assertEquals(2, f.recorder().poll().recordedSessionCount)
            val rows = f.repository.getForDevice("device-1")
            assertEquals(2, rows.size)
            assertEquals(1, rows.count { it.id == originalId })
            assertEquals(350L, f.store.load()!!.engineState.lastProcessedElapsedMillis)
        }
    }

    @Test fun `device change after first Room row prevents cursor publication and new identity credit`() = runTest {
        Fixture().use { f ->
            val recorder = f.recorder()
            recorder.poll()
            val baseline = f.store.load()
            f.completedBatch()
            f.afterWrite = { f.device = "device-2" }
            try {
                recorder.poll()
                fail("identity change must prevent cursor publication")
            } catch (_: IllegalStateException) { }
            assertEquals(baseline, f.store.load())
            assertEquals(baseline!!.engineState, recorder.currentEngineState())
            assertEquals(1, f.repository.getForDevice("device-1").size)
            assertTrue(f.repository.getForDevice("device-2").isEmpty())
            f.afterWrite = {}
            assertEquals(UsageObservationCoverage.BASELINE, f.recorder().poll().coverage)
            assertTrue(f.repository.getForDevice("device-2").isEmpty())
        }
    }
}
