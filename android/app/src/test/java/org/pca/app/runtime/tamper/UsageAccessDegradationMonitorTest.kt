package org.pca.app.runtime.tamper

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.foundation.MonotonicTimeSource
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.repository.TamperEventRepository
import org.pca.app.platform.TrackedUsageAccessState
import org.pca.app.platform.UsageAccessState
import org.pca.app.platform.UsageAccessStateTracker
import org.pca.app.platform.UsageEvent
import org.pca.app.platform.UsageEventType
import org.pca.app.platform.UsageObservationSource
import org.robolectric.RobolectricTestRunner

private class FakeUsageObservationSource : UsageObservationSource {
    var state: UsageAccessState = UsageAccessState.GRANTED
    var events: List<UsageEvent> = listOf(UsageEvent("pkg", UsageEventType.FOREGROUND, 100))
    override fun accessState(): UsageAccessState = state
    override fun queryEventsSince(elapsedRealtimeMillis: Long): List<UsageEvent> = events
}

private class FakeMonotonicTimeSource(var nowMillis: Long = 1000L) : MonotonicTimeSource {
    override fun elapsedRealtimeMillis(): Long = nowMillis
    override fun elapsedRealtimeNanos(): Long = nowMillis * 1_000_000
}

private class FakeWallClockTimeSource(var nowMillis: Long = 5_000_000L) : WallClockTimeSource {
    override fun currentTimeMillis(): Long = nowMillis
}

/**
 * PCA-FR-085/PCA-FR-081: proves the one real tamper-signal producer this lane adds actually writes
 * a [org.pca.app.persistence.entity.TamperEventEntity] row on a genuine REVOKED transition (via a
 * real Room DB, same discipline as [org.pca.app.persistence.RetentionEngineTest]), notifies on both
 * REVOKED and DEGRADED, and never repeat-fires while the state is unchanged.
 */
@RunWith(RobolectricTestRunner::class)
class UsageAccessDegradationMonitorTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var tamperEventRepository: TamperEventRepository

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        tamperEventRepository = TamperEventRepository(db.tamperEventDao())
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun buildMonitor(
        source: FakeUsageObservationSource,
        monotonic: FakeMonotonicTimeSource = FakeMonotonicTimeSource(),
        wallClock: FakeWallClockTimeSource = FakeWallClockTimeSource(),
        deviceId: String? = "device-1",
        notified: MutableList<TrackedUsageAccessState> = mutableListOf(),
    ): UsageAccessDegradationMonitor {
        val tracker = UsageAccessStateTracker(source, monotonic)
        return UsageAccessDegradationMonitor(
            tracker = tracker,
            deviceIdProvider = { deviceId },
            wallClockTimeSource = wallClock,
            tamperEventRepository = tamperEventRepository,
            notifyParent = { state -> notified.add(state); true },
        )
    }

    @Test
    fun `first observation is a baseline -- never itself treated as a transition`() = runTest {
        val notified = mutableListOf<TrackedUsageAccessState>()
        val source = FakeUsageObservationSource().apply { state = UsageAccessState.DENIED }
        val monitor = buildMonitor(source, notified = notified)

        monitor.checkAndHandle()

        assertEquals(emptyList<TrackedUsageAccessState>(), notified)
        assertEquals(0, db.tamperEventDao().count())
    }

    @Test
    fun `a real transition into REVOKED writes a TamperEvent row and notifies`() = runTest {
        val notified = mutableListOf<TrackedUsageAccessState>()
        val source = FakeUsageObservationSource().apply { state = UsageAccessState.GRANTED }
        val monitor = buildMonitor(source, notified = notified)

        monitor.checkAndHandle() // baseline: GRANTED
        source.state = UsageAccessState.DENIED // evidence-backed revocation, per UsageAccessStateTracker
        monitor.checkAndHandle()

        assertEquals(listOf(TrackedUsageAccessState.REVOKED), notified)
        assertEquals(1, db.tamperEventDao().count())
        val row = db.tamperEventDao().getForDevice("device-1").single()
        assertEquals(UsageAccessDegradationMonitor.CONDITION_USAGE_ACCESS_REVOKED, row.conditionType)
        assertEquals("device-1", row.deviceId)
    }

    @Test
    fun `repeated checks while still REVOKED never write a second row or re-notify`() = runTest {
        val notified = mutableListOf<TrackedUsageAccessState>()
        val source = FakeUsageObservationSource().apply { state = UsageAccessState.GRANTED }
        val monitor = buildMonitor(source, notified = notified)

        monitor.checkAndHandle() // baseline
        source.state = UsageAccessState.DENIED
        monitor.checkAndHandle() // REVOKED transition
        monitor.checkAndHandle() // still REVOKED
        monitor.checkAndHandle() // still REVOKED

        assertEquals(1, notified.size)
        assertEquals(1, db.tamperEventDao().count())
    }

    @Test
    fun `DEGRADED notifies but never writes a TamperEvent row`() = runTest {
        val notified = mutableListOf<TrackedUsageAccessState>()
        val source = FakeUsageObservationSource().apply { state = UsageAccessState.DENIED }
        val monitor = buildMonitor(source, notified = notified)
        monitor.checkAndHandle() // baseline DENIED

        source.state = UsageAccessState.GRANTED
        source.events = emptyList() // GRANTED with no fresh evidence -- DEGRADED, distinct from REVOKED
        monitor.checkAndHandle()

        assertEquals(listOf(TrackedUsageAccessState.DEGRADED), notified)
        assertEquals(0, db.tamperEventDao().count())
    }

    @Test
    fun `no enrolled device id -- notification still fires but no TamperEvent row is written`() = runTest {
        val notified = mutableListOf<TrackedUsageAccessState>()
        val source = FakeUsageObservationSource().apply { state = UsageAccessState.GRANTED }
        val monitor = buildMonitor(source, deviceId = null, notified = notified)

        monitor.checkAndHandle()
        source.state = UsageAccessState.DENIED
        monitor.checkAndHandle()

        assertEquals(listOf(TrackedUsageAccessState.REVOKED), notified)
        assertEquals(0, db.tamperEventDao().count())
    }
}
