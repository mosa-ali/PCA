package org.pca.app.runtime

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.feature.eyedistance.engine.EyeDistanceConfig
import org.pca.app.feature.eyedistance.persistence.EyeDistanceSnapshotStore
import org.pca.app.feature.eyedistance.persistence.InMemoryEyeDistanceSnapshotStore
import org.pca.app.feature.screentime.engine.ScreenTimeConfig
import org.pca.app.feature.screentime.engine.ScreenTimeMode
import org.pca.app.feature.screentime.persistence.InMemoryScreenTimeSnapshotStore
import org.pca.app.feature.screentime.persistence.ScreenTimeSnapshotStore
import org.pca.app.feature.wellbeing.engine.WellbeingTriggerDispatcher
import org.pca.app.platform.UsageAccessState
import org.pca.app.platform.LocationCapabilityLevel
import org.pca.app.runtime.child.ChildRequestOfflineQueue
import org.pca.app.runtime.port.FamilySyncConnectionState
import org.pca.app.runtime.port.ScheduleRuntimeStatus
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.robolectric.RobolectricTestRunner
import kotlin.time.Duration.Companion.minutes

/**
 * Robolectric is required here purely because [org.pca.app.runtime.child.ChildRequestOfflineQueue]
 * encodes through `android.util.Base64` (unavailable on a plain JVM unit-test classloader) -- none
 * of these tests otherwise touch real Android framework state; every platform dependency is a fake
 * from [PcaRuntimeTestFakes].
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class PcaRuntimeTest {

    private fun buildRuntime(
        scope: kotlinx.coroutines.CoroutineScope,
        monotonic: FakeMonotonicTimeSource = FakeMonotonicTimeSource(),
        wallClock: FakeWallClockTimeSource = FakeWallClockTimeSource(),
        screenTimeSnapshotStore: ScreenTimeSnapshotStore = InMemoryScreenTimeSnapshotStore(),
        eyeDistanceSnapshotStore: EyeDistanceSnapshotStore = InMemoryEyeDistanceSnapshotStore(),
        bootId: String? = "boot-1",
        connectivity: FakeConnectivityObserver = FakeConnectivityObserver(),
        schedulePort: FakeScheduleRuntimePort = FakeScheduleRuntimePort(),
        syncPort: FakeFamilySyncRuntimePort = FakeFamilySyncRuntimePort(),
        usageObservationSource: FakeUsageObservationSource = FakeUsageObservationSource(),
        locationCapabilitySource: FakeLocationCapabilitySource = FakeLocationCapabilitySource(),
        childRequestQueue: ChildRequestOfflineQueue = ChildRequestOfflineQueue(InMemoryPersistentStateStore()),
        tickIntervalMillis: Long = Long.MAX_VALUE / 2,
    ): PcaRuntime = PcaRuntime(
        monotonicTimeSource = monotonic,
        wallClockTimeSource = wallClock,
        screenTimeSnapshotStore = screenTimeSnapshotStore,
        eyeDistanceSnapshotStore = eyeDistanceSnapshotStore,
        currentBootId = bootId,
        connectivityObserver = connectivity,
        scheduleRuntimePort = schedulePort,
        familySyncRuntimePort = syncPort,
        protectionCapabilities = FakeProtectionCapabilities(),
        usageObservationSource = usageObservationSource,
        locationCapabilitySource = locationCapabilitySource,
        notificationCapabilitySource = FakeNotificationCapabilitySource(),
        proximitySource = FakeProximitySource(),
        wellbeingDispatcherProvider = ::buildTestDispatcher,
        childRequestQueue = childRequestQueue,
        externalScope = scope,
        screenTimeConfig = ScreenTimeConfig(),
        eyeDistanceConfig = EyeDistanceConfig(),
        tickIntervalMillis = tickIntervalMillis,
    )

    private fun buildTestDispatcher(): WellbeingTriggerDispatcher = WellbeingTriggerDispatcher(
        monotonicTimeSource = FakeMonotonicTimeSource(),
        eligibleAppSignalSource = FakeEligibleAppSignalSource(),
        screenLockStateSource = FakeScreenLockStateSource(),
        notificationCapabilitySource = FakeNotificationCapabilitySource(),
        suppressionContextSource = FakeSuppressionContextSource(),
        breakStateSource = FakeBreakStateSource(),
        wallClockCalendarSource = FakeWallClockCalendarSource(),
    )

    @Test
    fun `offline startup still runs local enforcement`() = runTest {
        val connectivity = FakeConnectivityObserver(initiallyOnline = false)
        val runtime = buildRuntime(backgroundScope, connectivity = connectivity)
        runtime.start()

        runtime.tick()

        assertEquals(ScreenTimeMode.ACTIVE, runtime.screenTimeState.value.mode)
        assertFalse(runtime.status.value.isDeviceOnline)
        assertTrue(runtime.status.value.isLocalProtectionActive)
    }

    @Test
    fun `online to offline transition does not reset accumulated screen time`() = runTest {
        val monotonic = FakeMonotonicTimeSource()
        val connectivity = FakeConnectivityObserver(initiallyOnline = true)
        val runtime = buildRuntime(backgroundScope, monotonic = monotonic, connectivity = connectivity)
        runtime.start()

        monotonic.nowNanos = 30.minutes.inWholeNanoseconds
        runtime.tick()
        val activeBefore = runtime.screenTimeState.value.activeElapsedNanos

        connectivity.setOnline(false)
        runCurrent()

        assertEquals(activeBefore, runtime.screenTimeState.value.activeElapsedNanos)
        assertFalse(runtime.status.value.isDeviceOnline)
    }

    @Test
    fun `offline to online transition does not reset accumulated screen time`() = runTest {
        val monotonic = FakeMonotonicTimeSource()
        val connectivity = FakeConnectivityObserver(initiallyOnline = false)
        val runtime = buildRuntime(backgroundScope, monotonic = monotonic, connectivity = connectivity)
        runtime.start()

        monotonic.nowNanos = 30.minutes.inWholeNanoseconds
        runtime.tick()
        val activeBefore = runtime.screenTimeState.value.activeElapsedNanos

        connectivity.setOnline(true)
        runCurrent()

        assertEquals(activeBefore, runtime.screenTimeState.value.activeElapsedNanos)
        assertTrue(runtime.status.value.isDeviceOnline)
    }

    @Test
    fun `connectivity flapping does not duplicate engine init or lose progress`() = runTest {
        val monotonic = FakeMonotonicTimeSource()
        val connectivity = FakeConnectivityObserver(initiallyOnline = true)
        val runtime = buildRuntime(backgroundScope, monotonic = monotonic, connectivity = connectivity)
        runtime.start()
        runtime.start() // duplicate start() must be a no-op (Section 13/14)

        monotonic.nowNanos = 20.minutes.inWholeNanoseconds
        runtime.tick()
        val activeBefore = runtime.screenTimeState.value.activeElapsedNanos

        repeat(5) { connectivity.setOnline(it % 2 == 0) }
        runCurrent()

        assertEquals(activeBefore, runtime.screenTimeState.value.activeElapsedNanos)
        assertEquals(ScreenTimeMode.ACTIVE, runtime.screenTimeState.value.mode)
    }

    @Test
    fun `screen time continues to advance while offline`() = runTest {
        val monotonic = FakeMonotonicTimeSource()
        val connectivity = FakeConnectivityObserver(initiallyOnline = false)
        val runtime = buildRuntime(backgroundScope, monotonic = monotonic, connectivity = connectivity)
        runtime.start()

        monotonic.nowNanos = 60.minutes.inWholeNanoseconds
        runtime.tick()

        assertEquals(ScreenTimeMode.BREAK_SHIELD, runtime.screenTimeState.value.mode)
    }

    @Test
    fun `break shield continues while offline`() = runTest {
        val monotonic = FakeMonotonicTimeSource()
        val connectivity = FakeConnectivityObserver(initiallyOnline = false)
        val runtime = buildRuntime(backgroundScope, monotonic = monotonic, connectivity = connectivity)
        runtime.start()
        monotonic.nowNanos = 60.minutes.inWholeNanoseconds
        runtime.tick()
        assertTrue(runtime.status.value.isBreakShieldActive)

        monotonic.nowNanos = 75.minutes.inWholeNanoseconds
        runtime.tick()

        assertTrue(runtime.status.value.isBreakShieldActive)
        assertFalse(runtime.status.value.isDeviceOnline)
    }

    @Test
    fun `schedule port status is surfaced honestly`() = runTest {
        val schedulePort = FakeScheduleRuntimePort(ScheduleRuntimeStatus.EPOCH_STALE)
        val runtime = buildRuntime(backgroundScope, schedulePort = schedulePort)
        runtime.start()

        assertEquals(ScheduleRuntimeStatus.EPOCH_STALE, runtime.status.value.scheduleStatus)
    }

    @Test
    fun `sync port connection state is surfaced honestly, connected socket is not conflated with live`() = runTest {
        val syncPort = FakeFamilySyncRuntimePort(state = FamilySyncConnectionState.SYNCING)
        val runtime = buildRuntime(backgroundScope, syncPort = syncPort)
        runtime.start()

        assertEquals(FamilySyncConnectionState.SYNCING, runtime.status.value.syncConnectionState)
        assertNotEquals(FamilySyncConnectionState.LIVE, runtime.status.value.syncConnectionState)
    }

    @Test
    fun `child request created offline is queued locally as pending and later flushed once sync is live`() = runTest {
        val syncPort = FakeFamilySyncRuntimePort(state = FamilySyncConnectionState.OFFLINE)
        val queue = ChildRequestOfflineQueue(InMemoryPersistentStateStore())
        val connectivity = FakeConnectivityObserver(initiallyOnline = false)
        val runtime = buildRuntime(backgroundScope, syncPort = syncPort, childRequestQueue = queue, connectivity = connectivity)
        runtime.start()

        runtime.createChildRequest("req-1", "SKIP_BREAK", "detail")

        assertEquals(1, runtime.status.value.pendingChildRequestCount)
        assertTrue(syncPort.submitted.isEmpty())

        syncPort.state = FamilySyncConnectionState.LIVE
        connectivity.setOnline(true) // triggers an opportunistic flush attempt
        runCurrent()

        assertEquals(1, syncPort.submitted.size)
        assertEquals("req-1", syncPort.submitted.first().requestId)
        assertEquals(0, runtime.status.value.pendingChildRequestCount)
    }

    @Test
    fun `missing usage permission is reported honestly, never fabricated`() = runTest {
        val usage = FakeUsageObservationSource(accessState = UsageAccessState.DENIED)
        val runtime = buildRuntime(backgroundScope, usageObservationSource = usage)
        runtime.start()

        assertEquals(UsageAccessState.DENIED, runtime.status.value.usageAccessState)
    }

    @Test
    fun `unavailable location capability is reported honestly`() = runTest {
        val location = FakeLocationCapabilitySource(FakeLocationCapabilitySource.unusableSnapshot())
        val runtime = buildRuntime(backgroundScope, locationCapabilitySource = location)
        runtime.start()

        assertEquals(LocationCapabilityLevel.UNUSABLE, runtime.status.value.locationCapabilityLevel)
    }

    @Test
    fun `process recreation restores accumulated state from the persistence ports`() = runTest {
        val screenTimeStore: ScreenTimeSnapshotStore = InMemoryScreenTimeSnapshotStore()
        val eyeDistanceStore: EyeDistanceSnapshotStore = InMemoryEyeDistanceSnapshotStore()
        val monotonic1 = FakeMonotonicTimeSource()
        val runtime1 = buildRuntime(backgroundScope, monotonic = monotonic1, screenTimeSnapshotStore = screenTimeStore, eyeDistanceSnapshotStore = eyeDistanceStore)
        runtime1.start()
        monotonic1.nowNanos = 59.minutes.inWholeNanoseconds
        runtime1.tick()
        assertEquals(59.minutes.inWholeNanoseconds, runtime1.screenTimeState.value.activeElapsedNanos)

        // Simulate process death/recreation: a brand new PcaRuntime instance, same boot,
        // same persistence ports, monotonic clock continues from where it left off.
        val monotonic2 = FakeMonotonicTimeSource(nowNanos = 59.minutes.inWholeNanoseconds + 1.minutes.inWholeNanoseconds)
        val runtime2 = buildRuntime(backgroundScope, monotonic = monotonic2, screenTimeSnapshotStore = screenTimeStore, eyeDistanceSnapshotStore = eyeDistanceStore)

        assertEquals(ScreenTimeMode.BREAK_SHIELD, runtime2.screenTimeState.value.mode)
    }

    @Test
    fun `emergency exception invariant survives offline and stale schedule state`() = runTest {
        val schedulePort = FakeScheduleRuntimePort(ScheduleRuntimeStatus.NOT_READY)
        val connectivity = FakeConnectivityObserver(initiallyOnline = false)
        val runtime = buildRuntime(backgroundScope, schedulePort = schedulePort, connectivity = connectivity)
        runtime.start()

        runtime.activateEmergencyException()

        assertTrue(runtime.status.value.isEmergencyExceptionActive)
        assertEquals(ScreenTimeMode.EMERGENCY_EXCEPTION, runtime.screenTimeState.value.mode)

        connectivity.setOnline(true)
        connectivity.setOnline(false)
        runCurrent()

        assertTrue(runtime.status.value.isEmergencyExceptionActive)

        runtime.deactivateEmergencyException()
        assertFalse(runtime.status.value.isEmergencyExceptionActive)
    }
}
