package org.pca.app.runtime.tamper

import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.repository.TamperEventRepository
import org.pca.app.platform.DevicePolicyAuthorityTracker
import org.pca.app.platform.TrackedDevicePolicyState

/**
 * Records only an evidence-backed loss of previously observed device-owner
 * authority (or a later inability to query the authority). It never attempts
 * provisioning, installs an admin receiver, or treats profile-owner authority
 * as full-device Protected Mode.
 */
class DevicePolicyDegradationMonitor(
    private val tracker: DevicePolicyAuthorityTracker,
    private val deviceIdProvider: () -> String?,
    private val wallClockTimeSource: WallClockTimeSource,
    private val tamperEventRepository: TamperEventRepository,
    private val notifyParent: (String) -> Boolean,
) {
    private var lastObservedState: TrackedDevicePolicyState? = null
    private val checkMutex = Mutex()

    suspend fun checkAndHandle() = checkMutex.withLock {
        val state = tracker.currentState()
        val previous = lastObservedState
        lastObservedState = state
        if (previous == null || previous == state) return@withLock

        val condition = when (state) {
            TrackedDevicePolicyState.DEVICE_OWNER_REVOKED -> CONDITION_DEVICE_OWNER_REVOKED
            TrackedDevicePolicyState.UNAVAILABLE -> CONDITION_DEVICE_POLICY_UNAVAILABLE
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
        const val CONDITION_DEVICE_OWNER_REVOKED = "DEVICE_OWNER_AUTHORITY_LOST"
        const val CONDITION_DEVICE_POLICY_UNAVAILABLE = "DEVICE_POLICY_UNAVAILABLE"
    }
}
