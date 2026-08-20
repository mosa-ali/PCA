package org.pca.app.runtime.tamper

import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.pca.app.foundation.WallClockTimeSource
import org.pca.app.persistence.repository.TamperEventRepository
import org.pca.app.platform.CameraPermissionStateTracker
import org.pca.app.platform.TrackedCameraPermissionState

/**
 * PCA-FR-080 closure for the camera-permission capability: records a real degradation only after
 * a granted state was previously observed (REVOKED) or the camera hardware/build capability
 * itself disappears (UNAVAILABLE) -- exact same discipline as [VpnDegradationMonitor]/
 * [DevicePolicyDegradationMonitor], which this class is deliberately structured to mirror. A
 * never-granted camera permission (DENIED, never previously GRANTED) is ordinary setup state, not
 * a tamper event. This class reads only the boolean [TrackedCameraPermissionState] signal -- it
 * never touches a camera frame, image, or any [org.pca.app.platform.proximity.EphemeralCameraFrame].
 */
class CameraDegradationMonitor(
    private val tracker: CameraPermissionStateTracker,
    private val deviceIdProvider: () -> String?,
    private val wallClockTimeSource: WallClockTimeSource,
    private val tamperEventRepository: TamperEventRepository,
    private val notifyParent: (String) -> Boolean,
) {
    private var lastObservedState: TrackedCameraPermissionState? = null
    private val checkMutex = Mutex()

    suspend fun checkAndHandle() = checkMutex.withLock {
        val state = tracker.currentState()
        val previous = lastObservedState
        lastObservedState = state
        if (previous == null || previous == state) return@withLock

        val condition = when (state) {
            TrackedCameraPermissionState.REVOKED -> CONDITION_CAMERA_PERMISSION_REVOKED
            TrackedCameraPermissionState.UNAVAILABLE -> CONDITION_CAMERA_UNAVAILABLE
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
        const val CONDITION_CAMERA_PERMISSION_REVOKED = "CAMERA_PERMISSION_REVOKED"
        const val CONDITION_CAMERA_UNAVAILABLE = "CAMERA_UNAVAILABLE"
    }
}
