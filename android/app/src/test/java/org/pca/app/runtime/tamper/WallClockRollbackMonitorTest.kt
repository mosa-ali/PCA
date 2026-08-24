package org.pca.app.runtime.tamper

import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.repository.TamperEventRepository
import org.robolectric.RobolectricTestRunner

private class RollbackTestWallClock(var now: Long = 10_000L) : WallClockTimeSource {
    override fun currentTimeMillis(): Long = now
}

/**
 * PCA-FR-017/PCA-FR-085: proves the previously-missing "rollback observed
 * -> local TamperEvent" write path (see [WallClockRollbackMonitor]'s own
 * doc comment for the exact matrix finding this closes) actually happens,
 * survives a simulated process restart (a fresh monitor instance backed by
 * the SAME persisted state store), and is never fooled by a repeated
 * rollback to an already-seen earlier instant.
 */
@RunWith(RobolectricTestRunner::class)
class WallClockRollbackMonitorTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var repository: TamperEventRepository
    private val wallClock = RollbackTestWallClock()

    @Before
    fun setUp() {
        db = PersistenceTestSupport.inMemoryDb()
        repository = TamperEventRepository(db.tamperEventDao())
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun `first observation ever establishes a baseline without reporting a rollback`() = runTest {
        val notified = mutableListOf<String>()
        val monitor = WallClockRollbackMonitor(
            wallClockTimeSource = wallClock,
            stateStore = InMemoryPersistentStateStore(),
            deviceIdProvider = { "device-1" },
            tamperEventRepository = repository,
            notifyParent = { notified += it; true },
        )

        monitor.checkAndHandle()

        assertEquals(emptyList<String>(), notified)
        assertEquals(0, db.tamperEventDao().count())
    }

    @Test
    fun `time moving forward never reports a rollback`() = runTest {
        val notified = mutableListOf<String>()
        val monitor = WallClockRollbackMonitor(
            wallClockTimeSource = wallClock,
            stateStore = InMemoryPersistentStateStore(),
            deviceIdProvider = { "device-1" },
            tamperEventRepository = repository,
            notifyParent = { notified += it; true },
        )

        monitor.checkAndHandle()
        wallClock.now += 60_000L
        monitor.checkAndHandle()
        wallClock.now += 60_000L
        monitor.checkAndHandle()

        assertEquals(emptyList<String>(), notified)
        assertEquals(0, db.tamperEventDao().count())
    }

    @Test
    fun `a detected rollback creates one local tamper event and notifies the parent`() = runTest {
        val notified = mutableListOf<String>()
        val monitor = WallClockRollbackMonitor(
            wallClockTimeSource = wallClock,
            stateStore = InMemoryPersistentStateStore(),
            deviceIdProvider = { "device-1" },
            tamperEventRepository = repository,
            notifyParent = { notified += it; true },
        )

        monitor.checkAndHandle() // establishes baseline at 10_000
        wallClock.now = 5_000L // rolled back
        monitor.checkAndHandle()

        assertEquals(listOf(WallClockRollbackMonitor.CONDITION_CLOCK_ROLLBACK), notified)
        assertEquals(1, db.tamperEventDao().count())
        assertEquals(
            WallClockRollbackMonitor.CONDITION_CLOCK_ROLLBACK,
            db.tamperEventDao().getForDevice("device-1").single().conditionType,
        )
    }

    @Test
    fun `the high-water-mark survives a simulated process restart via the same persisted store`() = runTest {
        val store = InMemoryPersistentStateStore()
        val notified = mutableListOf<String>()
        val firstProcessMonitor = WallClockRollbackMonitor(
            wallClockTimeSource = wallClock,
            stateStore = store,
            deviceIdProvider = { "device-1" },
            tamperEventRepository = repository,
            notifyParent = { notified += it; true },
        )
        firstProcessMonitor.checkAndHandle() // baseline at 10_000, "process" then dies

        wallClock.now = 4_000L // device powered off, clock rolled back, powered on again
        val secondProcessMonitor = WallClockRollbackMonitor(
            wallClockTimeSource = wallClock,
            stateStore = store, // same durable store a real restart would still have on disk
            deviceIdProvider = { "device-1" },
            tamperEventRepository = repository,
            notifyParent = { notified += it; true },
        )
        secondProcessMonitor.checkAndHandle()

        assertEquals(listOf(WallClockRollbackMonitor.CONDITION_CLOCK_ROLLBACK), notified)
        assertEquals(1, db.tamperEventDao().count())
    }

    @Test
    fun `repeated checks against the SAME still-active rollback report only once, but a later separate rollback reports again`() = runTest {
        val store = InMemoryPersistentStateStore()
        val notified = mutableListOf<String>()
        val monitor = WallClockRollbackMonitor(
            wallClockTimeSource = wallClock,
            stateStore = store,
            deviceIdProvider = { "device-1" },
            tamperEventRepository = repository,
            notifyParent = { notified += it; true },
        )

        monitor.checkAndHandle() // baseline at 10_000
        wallClock.now = 3_000L
        monitor.checkAndHandle() // rollback #1 detected; high-water-mark must stay at 10_000
        monitor.checkAndHandle() // still the SAME ongoing rollback (now unchanged) -- must not re-report
        monitor.checkAndHandle() // polled again, still unchanged -- must still not re-report

        assertEquals(listOf(WallClockRollbackMonitor.CONDITION_CLOCK_ROLLBACK), notified)
        assertEquals(1, db.tamperEventDao().count())

        wallClock.now = 11_000L // time genuinely recovers past the high-water-mark
        monitor.checkAndHandle() // no rollback right now -- must not report anything

        wallClock.now = 3_500L // a second, later, independent rollback (a different instant this time)
        monitor.checkAndHandle()

        assertEquals(
            listOf(WallClockRollbackMonitor.CONDITION_CLOCK_ROLLBACK, WallClockRollbackMonitor.CONDITION_CLOCK_ROLLBACK),
            notified,
        )
        assertEquals(2, db.tamperEventDao().count())
    }

    @Test
    fun `no device id yet never crashes and never writes a tamper event`() = runTest {
        val notified = mutableListOf<String>()
        val monitor = WallClockRollbackMonitor(
            wallClockTimeSource = wallClock,
            stateStore = InMemoryPersistentStateStore(),
            deviceIdProvider = { null },
            tamperEventRepository = repository,
            notifyParent = { notified += it; true },
        )

        monitor.checkAndHandle()
        wallClock.now = 1_000L
        monitor.checkAndHandle()

        assertTrue(notified.contains(WallClockRollbackMonitor.CONDITION_CLOCK_ROLLBACK))
        assertEquals(0, db.tamperEventDao().count())
    }
}
