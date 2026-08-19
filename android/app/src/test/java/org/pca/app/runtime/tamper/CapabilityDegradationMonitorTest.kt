package org.pca.app.runtime.tamper

import android.content.Intent
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.PersistenceTestSupport
import org.pca.app.persistence.PcaLocalDatabase
import org.pca.app.persistence.repository.TamperEventRepository
import org.pca.app.platform.DevicePolicyAuthorityTracker
import org.pca.app.platform.DevicePolicyCapabilitySource
import org.pca.app.platform.ManagedDeviceAuthority
import org.pca.app.platform.VpnCapabilitySource
import org.pca.app.platform.VpnCapabilityStateTracker
import org.pca.app.platform.VpnConnectionState
import org.robolectric.RobolectricTestRunner

private class FakeWallClock(var now: Long = 10_000L) : WallClockTimeSource {
    override fun currentTimeMillis(): Long = now
}

private class FakeVpnSource(
    var granted: Boolean = true,
    var state: VpnConnectionState = VpnConnectionState.CONNECTED,
) : VpnCapabilitySource {
    override fun isPermissionGranted(): Boolean = granted
    override fun connectionState(): VpnConnectionState = state
    override fun createConsentIntentIfNeeded(): Intent? = null
}

@RunWith(RobolectricTestRunner::class)
class CapabilityDegradationMonitorTest {
    private lateinit var db: PcaLocalDatabase
    private lateinit var repository: TamperEventRepository
    private val wallClock = FakeWallClock()

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
    fun `device owner loss creates one local tamper event and debounces repeats`() = runTest {
        var authority = ManagedDeviceAuthority.DEVICE_OWNER
        val tracker = DevicePolicyAuthorityTracker(object : DevicePolicyCapabilitySource {
            override fun currentAuthority(): ManagedDeviceAuthority = authority
        })
        val notified = mutableListOf<String>()
        val monitor = DevicePolicyDegradationMonitor(
            tracker = tracker,
            deviceIdProvider = { "device-1" },
            wallClockTimeSource = wallClock,
            tamperEventRepository = repository,
            notifyParent = { notified += it; true },
        )

        monitor.checkAndHandle()
        authority = ManagedDeviceAuthority.NONE
        monitor.checkAndHandle()
        monitor.checkAndHandle()

        assertEquals(listOf(DevicePolicyDegradationMonitor.CONDITION_DEVICE_OWNER_REVOKED), notified)
        assertEquals(1, db.tamperEventDao().count())
        assertEquals(
            DevicePolicyDegradationMonitor.CONDITION_DEVICE_OWNER_REVOKED,
            db.tamperEventDao().getForDevice("device-1").single().conditionType,
        )
    }

    @Test
    fun `device owner query failure is reported as unavailable rather than revoked`() = runTest {
        var authority = ManagedDeviceAuthority.DEVICE_OWNER
        val tracker = DevicePolicyAuthorityTracker(object : DevicePolicyCapabilitySource {
            override fun currentAuthority(): ManagedDeviceAuthority = authority
        })
        val notified = mutableListOf<String>()
        val monitor = DevicePolicyDegradationMonitor(
            tracker = tracker,
            deviceIdProvider = { "device-1" },
            wallClockTimeSource = wallClock,
            tamperEventRepository = repository,
            notifyParent = { notified += it; true },
        )

        monitor.checkAndHandle()
        authority = ManagedDeviceAuthority.UNAVAILABLE
        monitor.checkAndHandle()
        monitor.checkAndHandle()

        assertEquals(listOf(DevicePolicyDegradationMonitor.CONDITION_DEVICE_POLICY_UNAVAILABLE), notified)
        assertEquals(
            DevicePolicyDegradationMonitor.CONDITION_DEVICE_POLICY_UNAVAILABLE,
            db.tamperEventDao().getForDevice("device-1").single().conditionType,
        )
    }

    @Test
    fun `VPN loss after connected creates a local tamper event`() = runTest {
        val source = FakeVpnSource()
        val notified = mutableListOf<String>()
        val monitor = VpnDegradationMonitor(
            tracker = VpnCapabilityStateTracker(source),
            deviceIdProvider = { "device-1" },
            wallClockTimeSource = wallClock,
            tamperEventRepository = repository,
            notifyParent = { notified += it; true },
        )

        monitor.checkAndHandle()
        source.state = VpnConnectionState.DISCONNECTED
        monitor.checkAndHandle()

        assertEquals(listOf(VpnDegradationMonitor.CONDITION_VPN_CONNECTION_DEGRADED), notified)
        assertEquals(1, db.tamperEventDao().count())
    }
}
