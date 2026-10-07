package org.pca.app.runtime.usage

import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.repository.UsageSessionRepository
import org.pca.app.platform.*
import org.pca.app.runtime.FakeMonotonicTimeSource
import org.pca.app.runtime.FakeWallClockTimeSource
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class UsageRecorderContinuityTest {
    @Test fun `corrupt snapshot permits startup but cannot restore or credit historical events`() = runTest {
        val db = PersistenceTestSupport.inMemoryDb()
        try {
            val repo = UsageSessionRepository(db.usageSessionDao(), PersistenceTestSupport.testCipher())
            val elapsed = FakeMonotonicTimeSource(100_000_000L)
            val wall = FakeWallClockTimeSource(10_100L)
            var persisted: UsageObservationSnapshot? = null
            var queries = 0
            val store = object : UsageObservationSnapshotStore {
                override fun load(): UsageObservationSnapshot? = persisted
                    ?: throw UsageObservationSnapshotUnavailable()
                override fun save(snapshot: UsageObservationSnapshot) { persisted = snapshot }
            }
            val source = object : UsageObservationSource {
                override fun accessState() = UsageAccessState.GRANTED
                override fun queryEventsSince(elapsedRealtimeMillis: Long) = emptyList<UsageEvent>()
                override fun queryObservationBatchSince(elapsedRealtimeMillis: Long): UsageObservationBatch? {
                    queries++
                    return null
                }
            }
            val recorder = UsageSessionRecorder(source, repo, elapsed, wall, store, { "device-1" }, "boot-1")
            assertNull(recorder.currentEngineState().openSession)
            assertEquals(UsageObservationCoverage.BASELINE, recorder.poll().coverage)
            assertEquals(0, queries)
            assertEquals(100L, persisted!!.engineState.lastProcessedElapsedMillis)
            assertTrue(repo.getForDevice("device-1").isEmpty())
        } finally { db.close() }
    }

    @Test fun `permission gap discards open interval and requires fresh baseline`() = runTest {
        val db = PersistenceTestSupport.inMemoryDb()
        try {
            val repo = UsageSessionRepository(db.usageSessionDao(), PersistenceTestSupport.testCipher())
            val elapsed = FakeMonotonicTimeSource(0L)
            val wall = FakeWallClockTimeSource(10_000L)
            var access = UsageAccessState.GRANTED
            var events = emptyList<UsageObservedEvent>()
            val source = object : UsageObservationSource {
                override fun accessState() = access
                override fun queryEventsSince(elapsedRealtimeMillis: Long) = emptyList<UsageEvent>()
                override fun queryObservationBatchSince(elapsedRealtimeMillis: Long): UsageObservationBatch {
                    val sample = UsageClockSample(elapsed.elapsedRealtimeMillis(), wall.currentTimeMillis())
                    return UsageObservationBatch(events, sample, sample,
                        UsageClockBridge.wallAtElapsed(elapsedRealtimeMillis, sample), access, UsageQueryStatus.OBSERVED)
                }
            }
            val store = InMemoryUsageObservationSnapshotStore()
            val recorder = UsageSessionRecorder(source, repo, elapsed, wall, store, { "device-1" }, "boot-1")
            assertEquals(UsageObservationCoverage.BASELINE, recorder.poll().coverage)
            elapsed.nowNanos += 100_000_000L; wall.nowMillis += 100L
            events = listOf(UsageObservedEvent(UsageEvent("pkg", UsageEventType.FOREGROUND, 100L), 10_100L))
            recorder.poll()
            assertNotNull(recorder.currentEngineState().openSession)
            access = UsageAccessState.DENIED
            recorder.poll()
            assertNull(recorder.currentEngineState().openSession)
            access = UsageAccessState.GRANTED
            elapsed.nowNanos += 100_000_000L; wall.nowMillis += 100L
            events = listOf(UsageObservedEvent(UsageEvent("pkg", UsageEventType.BACKGROUND, 200L), 10_200L))
            assertEquals(UsageObservationCoverage.BASELINE, recorder.poll().coverage)
            recorder.poll()
            assertTrue(repo.getForDevice("device-1").isEmpty())
        } finally { db.close() }
    }
    @Test fun `snapshot failure retains replay cursor and restart upserts one completed row`() = runTest {
        val db = PersistenceTestSupport.inMemoryDb()
        try {
            val repo = UsageSessionRepository(db.usageSessionDao(), PersistenceTestSupport.testCipher())
            val elapsed = FakeMonotonicTimeSource(0L)
            val wall = FakeWallClockTimeSource(10_000L)
            var access = UsageAccessState.GRANTED
            var events = emptyList<UsageObservedEvent>()
            val source = object : UsageObservationSource {
                override fun accessState() = access
                override fun queryEventsSince(elapsedRealtimeMillis: Long) = emptyList<UsageEvent>()
                override fun queryObservationBatchSince(elapsedRealtimeMillis: Long): UsageObservationBatch {
                    val sample = UsageClockSample(elapsed.elapsedRealtimeMillis(), wall.currentTimeMillis())
                    return UsageObservationBatch(events, sample, sample,
                        UsageClockBridge.wallAtElapsed(elapsedRealtimeMillis, sample), access, UsageQueryStatus.OBSERVED)
                }
            }
            val backing = InMemoryUsageObservationSnapshotStore()
            var failSave = false
            val store = object : UsageObservationSnapshotStore {
                override fun load() = backing.load()
                override fun save(snapshot: UsageObservationSnapshot) {
                    if (failSave) error("injected snapshot failure")
                    backing.save(snapshot)
                }
            }
            val recorder = UsageSessionRecorder(source, repo, elapsed, wall, store, { "device-1" }, "boot-1")
            assertEquals(UsageObservationCoverage.BASELINE, recorder.poll().coverage)
            elapsed.nowNanos += 100_000_000L; wall.nowMillis += 100L
            events = listOf(UsageObservedEvent(UsageEvent("pkg", UsageEventType.FOREGROUND, 100L), 10_100L))
            recorder.poll()
            assertNotNull(recorder.currentEngineState().openSession)
            elapsed.nowNanos += 100_000_000L; wall.nowMillis += 100L
            events = listOf(UsageObservedEvent(UsageEvent("pkg", UsageEventType.BACKGROUND, 200L), 10_200L))
            failSave = true
            try {
                recorder.poll()
                fail("snapshot failure must remain observable")
            } catch (_: IllegalStateException) { }
            assertEquals(100L, recorder.currentEngineState().lastProcessedElapsedMillis)
            assertEquals(100L, backing.load()!!.engineState.lastProcessedElapsedMillis)
            assertEquals(1, repo.getForDevice("device-1").size)
            failSave = false
            val restored = UsageSessionRecorder(source, repo, elapsed, wall, store, { "device-1" }, "boot-1")
            assertEquals(1, restored.poll().recordedSessionCount)
            assertEquals(1, repo.getForDevice("device-1").size)
            assertEquals(200L, restored.currentEngineState().lastProcessedElapsedMillis)

        } finally { db.close() }
    }
    @Test fun `generation anchor detects accumulated individually small wall drift`() = runTest {
        val db = PersistenceTestSupport.inMemoryDb()
        try {
            val repo = UsageSessionRepository(db.usageSessionDao(), PersistenceTestSupport.testCipher())
            val elapsed = FakeMonotonicTimeSource(0L)
            val wall = FakeWallClockTimeSource(10_000L)
            var access = UsageAccessState.GRANTED
            var events = emptyList<UsageObservedEvent>()
            val source = object : UsageObservationSource {
                override fun accessState() = access
                override fun queryEventsSince(elapsedRealtimeMillis: Long) = emptyList<UsageEvent>()
                override fun queryObservationBatchSince(elapsedRealtimeMillis: Long): UsageObservationBatch {
                    val sample = UsageClockSample(elapsed.elapsedRealtimeMillis(), wall.currentTimeMillis())
                    return UsageObservationBatch(events, sample, sample,
                        UsageClockBridge.wallAtElapsed(elapsedRealtimeMillis, sample), access, UsageQueryStatus.OBSERVED)
                }
            }
            val store = InMemoryUsageObservationSnapshotStore()
            val recorder = UsageSessionRecorder(source, repo, elapsed, wall, store, { "device-1" }, "boot-1")
            assertEquals(UsageObservationCoverage.BASELINE, recorder.poll().coverage)
            elapsed.nowNanos += 100_000_000L; wall.nowMillis += 100L
            events = listOf(UsageObservedEvent(UsageEvent("pkg", UsageEventType.FOREGROUND, 100L), 10_100L))
            recorder.poll()
            assertNotNull(recorder.currentEngineState().openSession)
            elapsed.nowNanos += 100_000_000L; wall.nowMillis += 700L
            events = emptyList()
            assertEquals(UsageObservationCoverage.OBSERVED, recorder.poll().coverage)
            assertNotNull(recorder.currentEngineState().openSession)
            elapsed.nowNanos += 100_000_000L; wall.nowMillis += 700L
            assertEquals(UsageObservationCoverage.BASELINE, recorder.poll().coverage)
            assertNull(recorder.currentEngineState().openSession)
            assertTrue(repo.getForDevice("device-1").isEmpty())

        } finally { db.close() }
    }

}
