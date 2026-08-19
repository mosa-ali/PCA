package org.pca.app.platform.proximity

import org.pca.app.foundation.MonotonicTimeSource

/**
 * Tier 2 of the sensor hierarchy (doc 13 Section 4): optional foreground camera-based proximity
 * estimation, used only when no [HardwareProximitySource] is available. This class owns the
 * SAFETY LIFECYCLE -- exactly when estimation is permitted to run at all -- and delegates the
 * actual computer-vision judgment to an injected [FaceProximityEstimator]. When the estimator is
 * [ForegroundAwareFaceProximityEstimator], foreground and permission transitions are propagated
 * so its camera-session adapter can stop immediately.
 *
 * Hard rules enforced HERE as code, not just documented (doc 13 Section 5 / task Section 3):
 *  - [setForegroundEligible]`(false)` immediately stops estimation from being invoked at all --
 *    the caller (the feature's lifecycle owner) is responsible for calling it the instant the
 *    app backgrounds, the screen locks where required, or any other condition that should stop
 *    camera use.
 *  - [availability] reports [ProximitySourceAvailability.PERMISSION_DENIED] whenever
 *    [hasCameraPermission] currently returns false, and [PERMISSION_REQUIRED][ProximitySourceAvailability.PERMISSION_REQUIRED]
 *    is reserved for a caller that wants to distinguish "never asked" from "denied" upstream of
 *    this class (this class itself only has a boolean permission signal, so it reports
 *    PERMISSION_DENIED for any not-granted state -- a caller with richer permission-request-state
 *    information may translate that further before surfacing it to the user).
 *  - [currentObservation] NEVER invokes [estimator] unless BOTH foreground-eligible AND
 *    permission-granted are true at that exact call -- there is no code path that estimates a
 *    frame while either condition is false. Revoking permission or leaving the foreground takes
 *    effect on the very next call, with no grace period.
 */
class CameraProximitySource(
    private val estimator: FaceProximityEstimator,
    private val hasCameraPermission: () -> Boolean,
    private val monotonicTimeSource: MonotonicTimeSource,
    private val permissionStateSource: CameraPermissionStateSource =
        BooleanCameraPermissionStateSource(hasCameraPermission),
) : ProximitySource {

    @Volatile private var foregroundEligible: Boolean = false
    private val foregroundAwareEstimator = estimator as? ForegroundAwareFaceProximityEstimator

    override val sourceClass = ProximitySourceClass.CAMERA_FACE_GEOMETRY

    /** Must be called by the feature's lifecycle owner on every relevant transition: true only
     * while the app is foregrounded, the screen is unlocked (where required), and the PCA
     * eye-distance context is the one actively requesting estimation. */
    fun setForegroundEligible(eligible: Boolean) {
        foregroundEligible = eligible
        syncEstimatorLifecycle(eligible && currentPermissionState() == CameraPermissionStatus.GRANTED)
    }

    override fun availability(): ProximitySourceAvailability {
        val availability = when (currentPermissionState()) {
            CameraPermissionStatus.GRANTED -> when {
                !foregroundEligible -> ProximitySourceAvailability.UNAVAILABLE
                foregroundAwareEstimator?.let { !runCatching { it.isAvailable() }.getOrDefault(false) } == true ->
                    ProximitySourceAvailability.UNAVAILABLE
                else -> ProximitySourceAvailability.AVAILABLE
            }
            CameraPermissionStatus.NOT_REQUESTED -> ProximitySourceAvailability.PERMISSION_REQUIRED
            CameraPermissionStatus.DENIED,
            CameraPermissionStatus.REVOKED,
            -> ProximitySourceAvailability.PERMISSION_DENIED
            CameraPermissionStatus.UNAVAILABLE -> ProximitySourceAvailability.UNAVAILABLE
        }
        syncEstimatorLifecycle(availability == ProximitySourceAvailability.AVAILABLE)
        return availability
    }

    override fun currentObservation(): ProximityObservation {
        val avail = availability()
        val reading = if (avail == ProximitySourceAvailability.AVAILABLE) {
            runCatching { estimator.estimate() }.getOrDefault(ProximityReading.UNKNOWN)
        } else {
            ProximityReading.UNKNOWN
        }
        return ProximityObservation(
            reading = reading,
            sourceClass = sourceClass,
            confidence = if (reading == ProximityReading.UNKNOWN) ProximityConfidence.NONE else ProximityConfidence.MEDIUM,
            availability = avail,
            elapsedRealtimeNanos = monotonicTimeSource.elapsedRealtimeNanos(),
            degraded = false,
        )
    }

    private fun syncEstimatorLifecycle(eligible: Boolean) {
        foregroundAwareEstimator?.setForegroundEligible(eligible)
    }

    private fun currentPermissionState(): CameraPermissionStatus = runCatching {
        permissionStateSource.currentState()
    }.getOrDefault(CameraPermissionStatus.UNAVAILABLE)
}
