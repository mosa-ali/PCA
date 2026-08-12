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
import org.pca.app.feature.wellbeing.catalogue.WellbeingContentCatalogue
import org.pca.app.feature.wellbeing.engine.WellbeingTriggerDispatcher
import org.pca.app.feature.wellbeing.model.NudgeDeliveryResult
import org.pca.app.feature.wellbeing.model.NudgeDeliveryStatus
import org.pca.app.feature.wellbeing.persistence.WellbeingPolicyStore
import org.pca.app.feature.wellbeing.persistence.WellbeingRateStateStore
import org.pca.app.platform.UsageAccessState
import org.pca.app.platform.LocationCapabilityLevel
import org.pca.app.runtime.child.ChildRequestOfflineQueue
import org.pca.app.runtime.port.FamilySyncConnectionState
import org.pca.app.runtime.port.ScheduleRuntimeStatus
import org.pca.app.foundation.InMemoryPersistentStateStore
import org.pca.app.runtime.wellbeing.WellbeingRuntimeCoordinator
import org.robolectric.RobolectricTestRunner
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

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
        screenStateObserver: FakeScreenStateObserver = FakeScreenStateObserver(initiallyActive = true),
        wellbeingCoordinator: WellbeingRuntimeCoordinator = buildTestWellbeingCoordinator(),
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
        wellbeingCoordinator = wellbeingCoordinator,
        screenStateObserver = screenStateObserver,
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

    private fun buildTestWellbeingCoordinator(
        store: InMemoryPersistentStateStore = InMemoryPersistentStateStore(),
        deliveries: MutableList<NudgeDeliveryResult> = mutableListOf(),
    ): WellbeingRuntimeCoordinator = WellbeingRuntimeCoordinator(
        dispatcherProvider = ::buildTestDispatcher,
        policyStore = WellbeingPolicyStore(store),
        rateStateStore = WellbeingRateStateStore(store),
        monotonicTimeSource = FakeMonotonicTimeSource(),
        catalogueEntries = WellbeingContentCatalogue.entries,
        deliver = { delivery, suggestions, now ->
            NudgeDeliveryResult(NudgeDeliveryStatus.DELIVERED, delivery, now, suggestions.map { it.suggestionId })
                .also { deliveries += it }
        },
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

    // ---- Correction round: real screen-state -> pause/resume wiring (Section 2/3, tests A-F) ----

    @Test
    fun `A - a real screen-lock signal drives pauseScreenTime`() = runTest {
        val screenState = FakeScreenStateObserver(initiallyActive = true)
        val runtime = buildRuntime(backgroundScope, screenStateObserver = screenState)
        runtime.start()
        assertEquals(ScreenTimeMode.ACTIVE, runtime.screenTimeState.value.mode)

        screenState.setActive(false)
        runCurrent()

        assertEquals(ScreenTimeMode.PAUSED, runtime.screenTimeState.value.mode)
    }

    @Test
    fun `B - a real unlock signal drives resumeScreenTime`() = runTest {
        val screenState = FakeScreenStateObserver(initiallyActive = true)
        val runtime = buildRuntime(backgroundScope, screenStateObserver = screenState)
        runtime.start()
        screenState.setActive(false)
        runCurrent()
        assertEquals(ScreenTimeMode.PAUSED, runtime.screenTimeState.value.mode)

        screenState.setActive(true)
        runCurrent()

        assertEquals(ScreenTimeMode.ACTIVE, runtime.screenTimeState.value.mode)
    }

    // 59m30s use + screen locked 5m + resume + 30s use => BREAK_SHIELD, driven entirely through
    // the real screen-state observer rather than direct pauseScreenTime()/resumeScreenTime() calls.
    @Test
    fun `C - 59m30s use, 5m real screen lock, 30s use reaches BREAK_SHIELD`() = runTest {
        val monotonic = FakeMonotonicTimeSource()
        val screenState = FakeScreenStateObserver(initiallyActive = true)
        val runtime = buildRuntime(backgroundScope, monotonic = monotonic, screenStateObserver = screenState)
        runtime.start()

        monotonic.nowNanos = 59.minutes.inWholeNanoseconds + 30.seconds.inWholeNanoseconds
        runtime.tick()
        screenState.setActive(false)
        runCurrent()
        monotonic.nowNanos += 5.minutes.inWholeNanoseconds
        runtime.tick()
        assertEquals(59.minutes.inWholeNanoseconds + 30.seconds.inWholeNanoseconds, runtime.screenTimeState.value.activeElapsedNanos)

        screenState.setActive(true)
        runCurrent()
        monotonic.nowNanos += 30.seconds.inWholeNanoseconds
        runtime.tick()

        assertEquals(ScreenTimeMode.BREAK_SHIELD, runtime.screenTimeState.value.mode)
    }

    // 55m use + 30 continuous minutes of real screen-off recovery => accumulated debt reset to zero.
    @Test
    fun `D - 30 continuous minutes of real screen-off recovery resets accumulated debt`() = runTest {
        val monotonic = FakeMonotonicTimeSource()
        val screenState = FakeScreenStateObserver(initiallyActive = true)
        val runtime = buildRuntime(backgroundScope, monotonic = monotonic, screenStateObserver = screenState)
        runtime.start()

        monotonic.nowNanos = 55.minutes.inWholeNanoseconds
        runtime.tick()
        screenState.setActive(false)
        runCurrent()
        monotonic.nowNanos += 30.minutes.inWholeNanoseconds
        runtime.tick()

        assertEquals(0L, runtime.screenTimeState.value.activeElapsedNanos)
    }

    // E: process restart preserves active debt -- already proven end-to-end by
    // `process recreation restores accumulated state from the persistence ports` above.
    // F: Internet loss does not reset active debt -- already proven end-to-end by
    // `screen time continues to advance while offline` and `break shield continues while offline`
    // above (both run with connectivity permanently offline throughout).

    // ---- Correction round: emergency access (Section 6/7/8, tests G-H) ----

    @Test
    fun `G - tapping emergency access activates the real runtime emergency exception`() = runTest {
        val runtime = buildRuntime(backgroundScope)
        runtime.start()
        assertEquals(ScreenTimeMode.ACTIVE, runtime.screenTimeState.value.mode)

        runtime.activateEmergencyException()

        assertEquals(ScreenTimeMode.EMERGENCY_EXCEPTION, runtime.screenTimeState.value.mode)
        assertTrue(runtime.status.value.isEmergencyExceptionActive)
    }

    // H: emergency duration must not become a fake recovery break -- accumulated active-use debt
    // is exactly restored, not cleared, once the emergency ends (PCA-RUNTIME-1's engine already
    // freezes/restores this; this proves the *runtime* entry points route to that same behavior).
    @Test
    fun `H - emergency duration does not count as a recovery reset -- debt is restored exactly`() = runTest {
        val monotonic = FakeMonotonicTimeSource()
        val runtime = buildRuntime(backgroundScope, monotonic = monotonic)
        runtime.start()
        monotonic.nowNanos = 55.minutes.inWholeNanoseconds
        runtime.tick()
        val debtBeforeEmergency = runtime.screenTimeState.value.activeElapsedNanos
        assertEquals(55.minutes.inWholeNanoseconds, debtBeforeEmergency)

        runtime.activateEmergencyException()
        monotonic.nowNanos += 45.minutes.inWholeNanoseconds // an emergency call lasting 45 minutes
        runtime.tick()
        runtime.deactivateEmergencyException()

        assertEquals(ScreenTimeMode.ACTIVE, runtime.screenTimeState.value.mode)
        assertEquals(debtBeforeEmergency, runtime.screenTimeState.value.activeElapsedNanos)

        // Confirms the debt is real (not silently cleared): only 5 more minutes should be needed.
        monotonic.nowNanos += 5.minutes.inWholeNanoseconds
        runtime.tick()
        assertEquals(ScreenTimeMode.BREAK_SHIELD, runtime.screenTimeState.value.mode)
    }

    // ---- Correction round: parent contact (Section 9, tests I-J) ----

    @Test
    fun `I - the parent contact action creates a real, queued child request`() = runTest {
        val queue = ChildRequestOfflineQueue(InMemoryPersistentStateStore())
        val runtime = buildRuntime(backgroundScope, childRequestQueue = queue)
        runtime.start()

        runtime.createChildRequest(requestId = "contact-1", kind = "PARENT_CONTACT", detail = "Child requested to contact parent")

        assertEquals(1, queue.pending().size)
        assertEquals("PARENT_CONTACT", queue.pending().first().payload.kind)
    }

    @Test
    fun `J - parent contact created while offline honestly reports PENDING_SYNC_LOCAL until sync`() = runTest {
        val syncPort = FakeFamilySyncRuntimePort(state = FamilySyncConnectionState.OFFLINE)
        val queue = ChildRequestOfflineQueue(InMemoryPersistentStateStore())
        val connectivity = FakeConnectivityObserver(initiallyOnline = false)
        val runtime = buildRuntime(backgroundScope, syncPort = syncPort, childRequestQueue = queue, connectivity = connectivity)
        runtime.start()

        runtime.createChildRequest(requestId = "contact-2", kind = "PARENT_CONTACT", detail = "Child requested to contact parent")

        assertEquals(
            org.pca.app.runtime.child.ChildRequestLocalStatus.PENDING_SYNC_LOCAL,
            queue.pending().first().status,
        )
        assertEquals(1, runtime.status.value.pendingChildRequestCount)
        assertFalse(runtime.status.value.isDeviceOnline)
    }

    // ---- Correction round: wellbeing dispatch production path (Section 10/11, tests K-M) ----
    // K/L (a real runtime event driving WellbeingTriggerDispatcher.dispatch, and bedtime
    // suppression) are proven at the WellbeingRuntimeCoordinator unit level in
    // WellbeingRuntimeCoordinatorTest -- that is the actual production caller this correction
    // round introduces, and testing it directly (real dispatcher + real NudgeSelectionEngine +
    // real WellbeingContentCatalogue) is a stronger proof than re-deriving the same call chain
    // through PcaRuntime's screen-state plumbing a second time.

    @Test
    fun `M - repeated start() calls never re-register the screen-state observer -- exactly one collector`() = runTest {
        val screenState = FakeScreenStateObserver(initiallyActive = true)
        val runtime = buildRuntime(backgroundScope, screenStateObserver = screenState)

        // Simulates Activity/process recreation calling start() again on the same PcaRuntime
        // instance (Section 13/14: PcaAppGraph survives Activity recreation, only start() is
        // re-invoked).
        runtime.start()
        runtime.start()
        runtime.start()
        runCurrent()

        assertEquals(1, screenState.observeCallCount)
    }
}
