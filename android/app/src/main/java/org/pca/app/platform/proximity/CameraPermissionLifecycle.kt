package org.pca.app.platform.proximity

/**
 * Explicit camera permission lifecycle as observed by the foreground camera feature.
 * [NOT_REQUESTED] is distinct from [DENIED], while [REVOKED] is emitted only after a prior
 * [GRANTED] observation. The feature never requests permission from this port.
 */
enum class CameraPermissionStatus {
    NOT_REQUESTED,
    GRANTED,
    DENIED,
    REVOKED,
    UNAVAILABLE,
}

/** Platform-owned, read-only permission state port for [CameraProximitySource]. */
fun interface CameraPermissionStateSource {
    fun currentState(): CameraPermissionStatus
}

/**
 * Compatibility adapter for callers that have only a boolean permission query. A boolean cannot
 * prove that the user has never been prompted, so its initial false state is conservatively
 * [CameraPermissionStatus.DENIED]; after a grant, a later false becomes [REVOKED].
 */
class BooleanCameraPermissionStateSource(
    private val hasCameraPermission: () -> Boolean,
) : CameraPermissionStateSource {
    private var everObservedGranted = false

    override fun currentState(): CameraPermissionStatus {
        if (hasCameraPermission()) {
            everObservedGranted = true
            return CameraPermissionStatus.GRANTED
        }
        return if (everObservedGranted) {
            CameraPermissionStatus.REVOKED
        } else {
            CameraPermissionStatus.DENIED
        }
    }
}
