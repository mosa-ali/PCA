package org.pca.app.runtime.usage

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.repository.UsageSessionRepository
import org.pca.app.platform.UsageAccessState
import org.pca.app.platform.UsageEvent
import org.pca.app.platform.UsageEventType
import org.pca.app.platform.UsageObservationSource
import org.pca.app.runtime.FakeMonotonicTimeSource
import org.pca.app.runtime.FakeUsageObservationSource
import org.pca.app.runtime.FakeWallClockTimeSource
import org.robolectric.RobolectricTestRunner

/**
 * Real Room (`PersistenceTestSupport.inMemoryDb`) + real AES/GCM cipher end-to-end coverage for
 * [UsageSessionRecorder] -- exercises the actual [UsageSessionRepository]/`UsageSessionDao`
 * contract, not a mock of it.
 */
@RunWith(RobolectricTestRunner::class)
class UsageSessionRecorderTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var repository: UsageSessionRepository
    private val source = FakeUsageObservationSource()
    private val monotonic = FakeMonotonicTimeSource(0L)
    private val wallClock = FakeWallClockTimeSource(1_000_000L)

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        repository = UsageSessionRepository(db.usageSessionDao(), PersistenceTestSupport.testCipher())
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun newRecorder(
        bootId: String? = "boot-1",
        store: UsageObservationSnapshotStore = InMemoryUsageObservationSnapshotStore(),
        deviceIdProvider: () -> String? = { "device-1" },
    ) = UsageSessionRecorder(source, repository, monotonic, wallClock, store, deviceIdProvider, bootId)

    // -- permission missing --------------------------------------------------------------------

    @Test
    fun `usage access not granted -- poll reports the real access state and persists nothing`() = runTest {
        source.accessState = UsageAccessState.DENIED
        source.events = listOf(UsageEvent("com.example.app", UsageEventType.FOREGROUND, 0L))
        val recorder = newRecorder()

        val result = recorder.poll()

        assertEquals(UsageAccessState.DENIED, result.accessState)
        assertEquals(0, result.recordedSessionCount)
        assertTrue(repository.getForDevice("device-1").isEmpty())
    }

    // -- pre-enrollment: no PCA device id yet ----------------------------------------------------

    @Test
    fun `device not enrolled -- poll reports deviceEnrolled=false and fabricates no record under any id`() = runTest {
        source.accessState = UsageAccessState.GRANTED
        source.events = listOf(
            UsageEvent("com.example.preenroll", UsageEventType.FOREGROUND, 0L),
            UsageEvent("com.example.preenroll", UsageEventType.BACKGROUND, 1_000L),
        )
        val recorder = newRecorder(deviceIdProvider = { null })

        val result = recorder.poll()

        assertEquals(0, result.recordedSessionCount)
        assertFalse(result.deviceEnrolled)
        assertTrue(repository.getForDevice("device-1").isEmpty())
    }

    @Test
    fun `enrollment completing after construction is picked up on the next poll without recreating the recorder`() = runTest {
        source.accessState = UsageAccessState.GRANTED
        var enrolledId: String? = null
        val recorder = newRecorder(deviceIdProvider = { enrolledId })

        source.events = listOf(UsageEvent("com.example.late", UsageEventType.FOREGROUND, 0L))
        val beforeEnrollment = recorder.poll()
        assertFalse(beforeEnrollment.deviceEnrolled)

        enrolledId = "device-late"
        source.events = listOf(UsageEvent("com.example.late", UsageEventType.BACKGROUND, 1_000L))
        val afterEnrollment = recorder.poll()

        assertEquals(1, afterEnrollment.recordedSessionCount)
        assertTrue(afterEnrollment.deviceEnrolled)
        assertEquals("device-late", repository.getForDevice("device-late").single().deviceId)
    }

    // -- realistic synthetic observation flow end to end ----------------------------------------

    @Test
    fun `foreground then background is recorded as one encrypted-at-rest session with an opaque token`() = runTest {
        source.accessState = UsageAccessState.GRANTED
        source.events = listOf(
            UsageEvent("com.example.chat", UsageEventType.FOREGROUND, 0L),
            UsageEvent("com.example.chat", UsageEventType.BACKGROUND, 60_000L),
        )
        val recorder = newRecorder()

        val result = recorder.poll()

        assertEquals(1, result.recordedSessionCount)
        val sessions = repository.getForDevice("device-1")
        assertEquals(1, sessions.size)
        val session = sessions.single()
        assertEquals(60_000L, session.durationMillis)
        assertNotEquals("com.example.chat", session.appOrCategoryToken)
        assertEquals(16, session.appOrCategoryToken.length)

        // Encrypted at rest: the raw DB row must never contain the plaintext token.
        val rawRow = db.usageSessionDao().getForDevice("device-1").single()
        assertFalse(rawRow.appOrCategoryTokenEnc.contains(session.appOrCategoryToken))
    }

    // -- offline persistence ---------------------------------------------------------------------

    @Test
    fun `recording works with zero network dependency -- no connectivity type is ever consulted`() = runTest {
        // No NetworkConnectivityObserver, no FamilySyncRuntimePort, no sync port is constructed
        // or referenced anywhere in this test -- the recorder's constructor closure over
        // (source, repository, monotonic, wallClock, store, deviceId, bootId) is the complete
        // dependency set, proven by this test compiling and passing without any network fake.
        source.accessState = UsageAccessState.GRANTED
        source.events = listOf(
            UsageEvent("com.example.offline", UsageEventType.FOREGROUND, 0L),
            UsageEvent("com.example.offline", UsageEventType.BACKGROUND, 5_000L),
        )
        val result = newRecorder().poll()
        assertEquals(1, result.recordedSessionCount)
    }

    // -- duplicate observation handling -----------------------------------------------------------

    @Test
    fun `re-polling with the same already-processed events does not duplicate the session`() = runTest {
        source.accessState = UsageAccessState.GRANTED
        source.events = listOf(
            UsageEvent("com.example.dup", UsageEventType.FOREGROUND, 0L),
            UsageEvent("com.example.dup", UsageEventType.BACKGROUND, 1_000L),
        )
        val recorder = newRecorder()
        recorder.poll()
        assertEquals(1, repository.getForDevice("device-1").size)

        // Same events, same fake source (as if a duplicate producer tick re-delivered the same
        // query window) -- the engine's own cursor rejects them as stale.
        recorder.poll()
        assertEquals(1, repository.getForDevice("device-1").size)
    }

    // -- out-of-order observation handling ---------------------------------------------------------

    @Test
    fun `events delivered out of chronological order still produce a correctly-ordered session`() = runTest {
        source.accessState = UsageAccessState.GRANTED
        source.events = listOf(
            UsageEvent("com.example.ooo", UsageEventType.BACKGROUND, 2_000L),
            UsageEvent("com.example.ooo", UsageEventType.FOREGROUND, 0L),
        )
        val result = newRecorder().poll()

        assertEquals(1, result.recordedSessionCount)
        assertEquals(2_000L, repository.getForDevice("device-1").single().durationMillis)
    }

    // -- restart safety --------------------------------------------------------------------------

    @Test
    fun `an open session survives a process restart -- same boot, same store, no duplicate or lost session`() = runTest {
        val store = InMemoryUsageObservationSnapshotStore()
        source.accessState = UsageAccessState.GRANTED
        source.events = listOf(UsageEvent("com.example.restart", UsageEventType.FOREGROUND, 0L))

        // "Process A": observes the app open, then dies (nothing more is called on this instance).
        val recorderBeforeRestart = newRecorder(bootId = "boot-1", store = store)
        val firstPoll = recorderBeforeRestart.poll()
        assertEquals(0, firstPoll.recordedSessionCount) // still open, nothing to complete yet
        assertTrue(repository.getForDevice("device-1").isEmpty())

        // "Process B": a fresh recorder instance, same boot, restored from the same durable store.
        source.events = listOf(UsageEvent("com.example.restart", UsageEventType.BACKGROUND, 30_000L))
        val recorderAfterRestart = newRecorder(bootId = "boot-1", store = store)
        val secondPoll = recorderAfterRestart.poll()

        assertEquals(1, secondPoll.recordedSessionCount)
        val session = repository.getForDevice("device-1").single()
        // Duration spans from the ORIGINAL foreground event (before restart) to the background
        // event observed after restart -- the open session was neither lost nor duplicated.
        assertEquals(30_000L, session.durationMillis)
    }

    @Test
    fun `a device reboot between polls does not fabricate a session across the boot boundary`() = runTest {
        val store = InMemoryUsageObservationSnapshotStore()
        source.accessState = UsageAccessState.GRANTED
        source.events = listOf(UsageEvent("com.example.reboot", UsageEventType.FOREGROUND, 0L))

        val beforeReboot = newRecorder(bootId = "boot-1", store = store)
        beforeReboot.poll()
        assertTrue(repository.getForDevice("device-1").isEmpty())

        // Different bootId -- elapsedRealtime has reset; the stale open session must be dropped,
        // not stitched into a session that appears to span the reboot.
        source.events = listOf(UsageEvent("com.example.reboot", UsageEventType.BACKGROUND, 500L))
        val afterReboot = newRecorder(bootId = "boot-2", store = store)
        val result = afterReboot.poll()

        // The BACKGROUND event has no matching open session post-reboot (it was correctly
        // discarded), so it is ignored rather than fabricated into a completed session.
        assertEquals(0, result.recordedSessionCount)
        assertTrue(repository.getForDevice("device-1").isEmpty())
    }

    // -- Room adapter's interface contract ---------------------------------------------------------

    @Test
    fun `recorded sessions round-trip through the real UsageSessionDao contract, sorted by start time`() = runTest {
        source.accessState = UsageAccessState.GRANTED
        source.events = listOf(
            UsageEvent("com.example.one", UsageEventType.FOREGROUND, 0L),
            UsageEvent("com.example.one", UsageEventType.BACKGROUND, 1_000L),
            UsageEvent("com.example.two", UsageEventType.FOREGROUND, 1_000L),
            UsageEvent("com.example.two", UsageEventType.BACKGROUND, 3_000L),
        )
        val recorder = newRecorder()
        val result = recorder.poll()

        assertEquals(2, result.recordedSessionCount)
        val sessions = repository.getForDevice("device-1")
        assertEquals(2, sessions.size)
        // getForDevice orders DESC by startedAtEpochMillis (UsageSessionDao's own contract).
        assertTrue(sessions[0].startedAtEpochMillis >= sessions[1].startedAtEpochMillis)
    }

    // -- concurrency (QA68 correction: PcaAppGraph.runUsageLocationIngestionCycle now has two
    // genuinely concurrent callers -- the in-process poll loop and the WorkManager safety net) --

    /**
     * Proves [UsageSessionRecorder.poll]'s internal `Mutex` actually serializes two overlapping
     * calls rather than racing on `state`. Uses REAL OS threads (`Dispatchers.Default`, not
     * `runTest`'s virtual-time single-threaded dispatcher -- that dispatcher never produces a
     * genuine race) and a source that hands out two DIFFERENT, chronologically-ordered event
     * batches (open at elapsed=100, close at elapsed=200) to the first and second caller. Without
     * the fix, a real lost-update is reproducible here: both calls can read the same stale initial
     * `state` before either writes back, and whichever call's write lands last silently discards
     * the other call's session-boundary update -- the open-at-100 event can vanish entirely rather
     * than ever being recorded as a completed session. With the fix, both batches are applied in
     * one serialized sequence: exactly one completed session is recorded and the cursor reflects
     * both batches, regardless of which coroutine's thread happens to run first.
     */
    @Test
    fun `two genuinely concurrent poll calls never lose either one's session-boundary update`() {
        val callIndex = AtomicInteger(0)
        val batches = listOf(
            listOf(UsageEvent("pkg-a", UsageEventType.FOREGROUND, 100L)),
            listOf(UsageEvent("pkg-a", UsageEventType.BACKGROUND, 200L)),
        )
        val sequencedSource = object : UsageObservationSource {
            override fun accessState(): UsageAccessState = UsageAccessState.GRANTED
            override fun queryEventsSince(elapsedRealtimeMillis: Long): List<UsageEvent> {
                val idx = callIndex.getAndIncrement().coerceAtMost(batches.size - 1)
                return batches[idx]
            }
        }
        val recorder = UsageSessionRecorder(
            usageObservationSource = sequencedSource,
            usageSessionRepository = repository,
            monotonicTimeSource = monotonic,
            wallClockTimeSource = wallClock,
            snapshotStore = InMemoryUsageObservationSnapshotStore(),
            deviceIdProvider = { "device-1" },
            currentBootId = "boot-1",
        )

        val recordedCount = runBlocking {
            listOf(
                async(Dispatchers.Default) { recorder.poll() },
                async(Dispatchers.Default) { recorder.poll() },
            ).awaitAll()
            repository.getForDevice("device-1").size
        }

        // Both batches' effects survived: the session that opened at 100 and closed at 200 was
        // actually persisted (not silently dropped by a losing writer), and the cursor reflects
        // having applied both batches, not just whichever call happened to write last.
        assertEquals(1, recordedCount)
        assertEquals(200L, recorder.currentEngineState().lastProcessedElapsedMillis)
    }
}
