package org.pca.app.feature.eyedistance.ui

/**
 * PCA-PRIV-001 / PCA-FR-023/024 closure: a real, honest camera-permission disclosure surface for
 * the (currently not-yet-implemented) camera-based eye-distance tier -- see
 * [org.pca.app.platform.proximity.FaceProximityClassifier]'s doc for exactly why the underlying
 * estimator is not wired yet. This UI is real and independently valuable regardless of that: it
 * gives an honest answer to "what would this feature tell me before turning on my camera" today,
 * and is ready for a future safety-reviewed camera implementation to flip
 * [EyeDistanceCameraFeatureAvailability] on without any UI change.
 */
enum class EyeDistanceCameraPermissionUiState {
    /** The underlying camera-distance-detection feature isn't implemented in this build yet -- no
     * permission has anything to grant. Never shown as if it were [DENIED]; those are different,
     * user-actionable-vs-not claims. */
    FEATURE_UNAVAILABLE,
    /** Feature exists, camera permission has never been requested (or was reset) -- the primary
     * disclosure + Allow/Not-now choice is shown. */
    NOT_REQUESTED,
    /** Feature exists, the user (or a prior request) explicitly denied camera permission. */
    DENIED,
    /** Feature exists and camera permission is currently granted. */
    GRANTED,
}

object EyeDistanceCameraPermissionUiStateResolver {
    /**
     * Pure derivation -- never queries Android permission APIs itself (that stays the caller's
     * job, same "no I/O in decision logic" split as every other pure engine/resolver in this
     * codebase). [featureAvailable] should reflect
     * [EyeDistanceCameraFeatureAvailability.CAMERA_PROXIMITY_ESTIMATION_AVAILABLE] (or an override
     * in tests).
     */
    fun resolve(featureAvailable: Boolean, hasCameraPermission: Boolean, permissionExplicitlyDenied: Boolean): EyeDistanceCameraPermissionUiState =
        when {
            !featureAvailable -> EyeDistanceCameraPermissionUiState.FEATURE_UNAVAILABLE
            hasCameraPermission -> EyeDistanceCameraPermissionUiState.GRANTED
            permissionExplicitlyDenied -> EyeDistanceCameraPermissionUiState.DENIED
            else -> EyeDistanceCameraPermissionUiState.NOT_REQUESTED
        }
}

/**
 * Single source of truth for whether the camera-based eye-distance tier has a real estimator
 * behind it. PCA-FR-024 (REAL_SOURCE_GAP) closure: now `true` -- [org.pca.app.platform.proximity.CameraProximitySource]
 * is composed in production (`PcaAppGraph.cameraProximitySource`), backed by the real
 * [org.pca.app.platform.proximity.CameraXFrameSource] adapter, [org.pca.app.platform.proximity.AndroidFaceGeometryDetector],
 * and [org.pca.app.platform.proximity.FaceProximityClassifier]. This constant is not itself
 * device/build-dependent (every device either has front-camera hardware, reflected honestly via
 * [org.pca.app.platform.proximity.ProximitySourceAvailability.UNAVAILABLE], or does not); it is
 * the single switch that turns this disclosure screen from "not available in this build" into a
 * real permission request.
 */
object EyeDistanceCameraFeatureAvailability {
    const val CAMERA_PROXIMITY_ESTIMATION_AVAILABLE: Boolean = true
}
