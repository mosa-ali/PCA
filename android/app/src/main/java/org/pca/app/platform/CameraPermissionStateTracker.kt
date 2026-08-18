package org.pca.app.platform

/**
 * Evidence-backed camera capability state for PCA-FR-080. A single denied
 * permission query cannot prove revocation; [REVOKED] is reported only after
 * this tracker has previously observed a granted state. Hardware/build
 * unavailability remains distinct from a user-denied permission.
 */
enum class TrackedCameraPermissionState {
    GRANTED,
    DENIED,
    REVOKED,
    UNAVAILABLE,
}

class CameraPermissionStateTracker(
    private val hasCameraPermission: () -> Boolean,
    private val cameraAvailable: () -> Boolean = { true },
) {
    private var everObservedGranted = false

    fun currentState(): TrackedCameraPermissionState {
        if (!cameraAvailable()) return TrackedCameraPermissionState.UNAVAILABLE
        if (hasCameraPermission()) {
            everObservedGranted = true
            return TrackedCameraPermissionState.GRANTED
        }
        return if (everObservedGranted) {
            TrackedCameraPermissionState.REVOKED
        } else {
            TrackedCameraPermissionState.DENIED
        }
    }
}
