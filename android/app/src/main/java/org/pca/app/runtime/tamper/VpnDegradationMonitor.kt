package org.pca.app.runtime.tamper

import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.repository.TamperEventRepository
import org.pca.app.platform.TrackedVpnState
import org.pca.app.platform.VpnCapabilityStateTracker

/**
 * Records a real VPN consent/lifecycle degradation after a connected state was
 * observed. A never-started or never-consented VPN is setup state, not a
 * tamper event. No traffic inspection or covert reconnect is performed here.
 */
class VpnDegradationMonitor(
    private val tracker: VpnCapabilityStateTracker,
    private val deviceIdProvider: () -> String?,
    private val wallClockTimeSource: WallClockTimeSource,
    private val tamperEventRepository: TamperEventRepository,
    private val notifyParent: (String) -> Boolean,
) {
    private var lastObservedState: TrackedVpnState? = null
    private val checkMutex = Mutex()

    suspend fun checkAndHandle() = checkMutex.withLock {
        val state = tracker.currentState()
        val previous = lastObservedState
        lastObservedState = state
        if (previous == null || previous == state) return@withLock

        val condition = when (state) {
            TrackedVpnState.REVOKED -> CONDITION_VPN_CONSENT_REVOKED
            TrackedVpnState.DEGRADED -> CONDITION_VPN_CONNECTION_DEGRADED
            else -> null
        } ?: return@withLock

        val deviceId = deviceIdProvider()
        if (deviceId != null) {
            val now = wallClockTimeSource.currentTimeMillis()
            tamperEventRepository.record(
                id = UUID.nameUUIDFromBytes("$deviceId|$condition|$now".toByteArray(Charsets.UTF_8)).toString(),
                deviceId = deviceId,
                conditionType = condition,
                detectedAtEpochMillis = now,
            )
        }
        notifyParent(condition)
    }

    companion object {
        const val CONDITION_VPN_CONSENT_REVOKED = "VPN_CONSENT_REVOKED"
        const val CONDITION_VPN_CONNECTION_DEGRADED = "VPN_CONNECTION_DEGRADED"
    }
}
