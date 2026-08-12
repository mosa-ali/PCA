package org.pca.app.runtime

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import org.pca.app.feature.wellbeing.ports.BreakStateSource
import org.pca.app.feature.wellbeing.ports.EligibleAppSignalSource
import org.pca.app.feature.wellbeing.ports.NotificationCapabilitySource
import org.pca.app.feature.wellbeing.ports.ScreenLockStateSource
import org.pca.app.feature.wellbeing.ports.SuppressionContextSource
import org.pca.app.feature.wellbeing.ports.WallClockCalendarSource
import org.pca.app.foundation.MonotonicTimeSource
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.platform.BackgroundLocationState
import org.pca.app.platform.LocationCapabilitySnapshot
import org.pca.app.platform.LocationCapabilitySource
import org.pca.app.platform.LocationPermissionState
import org.pca.app.platform.LocationProviderAvailability
import org.pca.app.platform.LocationSample
import org.pca.app.platform.LocationServicesState
import org.pca.app.platform.ProtectionMode
import org.pca.app.platform.PlatformProtectionCapabilities
import org.pca.app.platform.UsageAccessState
import org.pca.app.platform.UsageEvent
import org.pca.app.platform.UsageObservationSource
import org.pca.app.platform.proximity.ProximityConfidence
import org.pca.app.platform.proximity.ProximityObservation
import org.pca.app.platform.proximity.ProximityReading
import org.pca.app.platform.proximity.ProximitySource
import org.pca.app.platform.proximity.ProximitySourceAvailability
import org.pca.app.platform.proximity.ProximitySourceClass
import org.pca.app.runtime.connectivity.NetworkConnectivityObserver
import org.pca.app.runtime.port.FamilySyncConnectionState
import org.pca.app.runtime.port.ChildRequestPayload
import org.pca.app.runtime.port.FamilySyncRuntimePort
import org.pca.app.runtime.port.ScheduleRuntimePort
import org.pca.app.runtime.port.ScheduleRuntimeStatus
import org.pca.app.runtime.screenstate.ScreenStateObserver

class FakeMonotonicTimeSource(var nowNanos: Long = 0L) : MonotonicTimeSource {
    override fun elapsedRealtimeMillis(): Long = nowNanos / 1_000_000L
    override fun elapsedRealtimeNanos(): Long = nowNanos
}

class FakeWallClockTimeSource(var nowMillis: Long = 0L) : WallClockTimeSource {
    override fun currentTimeMillis(): Long = nowMillis
}

class FakeConnectivityObserver(initiallyOnline: Boolean = true) : NetworkConnectivityObserver {
    private val flow = MutableStateFlow(initiallyOnline)
    override fun observe(): Flow<Boolean> = flow
    override fun isCurrentlyOnline(): Boolean = flow.value
    fun setOnline(online: Boolean) {
        flow.value = online
    }
}

class FakeScheduleRuntimePort(var status: ScheduleRuntimeStatus = ScheduleRuntimeStatus.NOT_READY) : ScheduleRuntimePort {
    override fun currentStatus(): ScheduleRuntimeStatus = status
}

class FakeFamilySyncRuntimePort(
    var state: FamilySyncConnectionState = FamilySyncConnectionState.OFFLINE,
    var lastSuccessfulSyncEpochMillis: Long? = null,
) : FamilySyncRuntimePort {
    val submitted = mutableListOf<ChildRequestPayload>()
    var acceptSubmissions: Boolean = true

    override fun currentConnectionState(): FamilySyncConnectionState = state
    override fun lastSuccessfulSyncEpochMillis(): Long? = lastSuccessfulSyncEpochMillis
    override suspend fun submitChildRequest(request: ChildRequestPayload): Boolean {
        if (!acceptSubmissions) return false
        submitted += request
        return true
    }
}

class FakeProtectionCapabilities(var mode: ProtectionMode = ProtectionMode.STANDARD) : PlatformProtectionCapabilities {
    override fun currentMode(): ProtectionMode = mode
}

class FakeUsageObservationSource(
    var accessState: UsageAccessState = UsageAccessState.GRANTED,
    var events: List<UsageEvent> = emptyList(),
) : UsageObservationSource {
    override fun accessState(): UsageAccessState = accessState
    override fun queryEventsSince(elapsedRealtimeMillis: Long): List<UsageEvent> = events
}

class FakeLocationCapabilitySource(
    var snapshot: LocationCapabilitySnapshot = unusableSnapshot(),
) : LocationCapabilitySource {
    override fun currentCapability(): LocationCapabilitySnapshot = snapshot
    override fun lastKnownLocation(): LocationSample? = null

    companion object {
        fun unusableSnapshot() = LocationCapabilitySnapshot(
            permissionState = LocationPermissionState.DENIED,
            backgroundState = BackgroundLocationState.NOT_APPLICABLE_FOREGROUND_DENIED,
            servicesState = LocationServicesState.DISABLED,
            providerAvailability = LocationProviderAvailability(gpsProviderEnabled = false, networkProviderEnabled = false),
            backgroundExecutionUnrestricted = false,
        )

        fun usableSnapshot() = LocationCapabilitySnapshot(
            permissionState = LocationPermissionState.FINE,
            backgroundState = BackgroundLocationState.GRANTED,
            servicesState = LocationServicesState.ENABLED,
            providerAvailability = LocationProviderAvailability(gpsProviderEnabled = true, networkProviderEnabled = true),
            backgroundExecutionUnrestricted = true,
        )
    }
}

class FakeNotificationCapabilitySource(var enabled: Boolean = true) : NotificationCapabilitySource {
    override fun notificationsEnabled(): Boolean = enabled
    override fun lockScreenNotificationsAvailable(): Boolean = enabled
}

class FakeProximitySource(
    var availability: ProximitySourceAvailability = ProximitySourceAvailability.UNAVAILABLE,
    var reading: ProximityReading = ProximityReading.UNKNOWN,
) : ProximitySource {
    override val sourceClass: ProximitySourceClass = ProximitySourceClass.HARDWARE_PROXIMITY_SENSOR
    override fun availability(): ProximitySourceAvailability = availability
    override fun currentObservation(): ProximityObservation = ProximityObservation(
        reading = reading,
        sourceClass = sourceClass,
        confidence = ProximityConfidence.NONE,
        availability = availability,
        elapsedRealtimeNanos = 0L,
        degraded = false,
    )
}

class FakeEligibleAppSignalSource(var token: String? = null) : EligibleAppSignalSource {
    override fun currentEligibleAppToken(): String? = token
}

class FakeScreenLockStateSource(var locked: Boolean = false) : ScreenLockStateSource {
    override fun isScreenLocked(): Boolean = locked
}

class FakeSuppressionContextSource : SuppressionContextSource {
    var emergency = false
    var call = false
    override fun isEmergencyActive(): Boolean = emergency
    override fun isCallActive(): Boolean = call
    override fun isNavigationOrSafetyContextActive(): Boolean = false
    override fun isSchoolModeActive(): Boolean = false
    override fun isCriticalWarningActive(): Boolean = false
    override fun isDegradedOrErrorFlow(): Boolean = false
}

class FakeBreakStateSource(var active: Boolean = false) : BreakStateSource {
    override fun isBreakShieldActive(): Boolean = active
}

class FakeWallClockCalendarSource(var minute: Int = 0) : WallClockCalendarSource {
    override fun minuteOfDay(): Int = minute
}

/** Test double for [ScreenStateObserver] -- lets a test drive real screen lock/unlock
 * transitions deterministically without a real `BroadcastReceiver`. [observeCallCount] proves
 * [org.pca.app.runtime.PcaRuntime.start]'s idempotency guard actually prevents a second collector
 * from ever being registered (Section 13/M). */
class FakeScreenStateObserver(initiallyActive: Boolean = true) : ScreenStateObserver {
    private val flow = MutableStateFlow(initiallyActive)
    var observeCallCount: Int = 0
        private set

    override fun observe(): Flow<Boolean> {
        observeCallCount++
        return flow
    }

    override fun isCurrentlyActive(): Boolean = flow.value
    fun setActive(active: Boolean) {
        flow.value = active
    }
}
