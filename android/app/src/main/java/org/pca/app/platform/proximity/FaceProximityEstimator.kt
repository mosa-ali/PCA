package org.pca.app.platform.proximity

/**
 * Estimates a single coarse [ProximityReading] from one camera frame's face geometry.
 *
 * A conforming implementation MUST:
 *  - return within this single synchronous call and retain nothing afterward -- no frame, no
 *    landmark set, no face embedding/template may survive past the call that produced [estimate];
 *  - never perform face recognition/identification, emotion or personality inference, age
 *    inference, or biometric-template generation of any kind;
 *  - never upload a frame, embedding, or landmark set to a network destination;
 *  - report only a coarse [ProximityReading] (NEAR/FAR/UNKNOWN) -- never a numeric distance.
 *
 * [OnDeviceApproximateFaceProximityEstimator] is the source-owned implementation. The camera
 * session and detector are deliberately supplied through narrow, platform-neutral ports so the
 * coordinator can bind an approved foreground camera implementation without widening this
 * feature into a storage, networking, recognition, or background-capture API.
 */
fun interface FaceProximityEstimator {
    fun estimate(): ProximityReading
}

/**
 * Optional lifecycle/availability contract for an estimator that owns a camera-session adapter.
 * [CameraProximitySource] propagates permission and foreground transitions through this seam so
 * backgrounding or permission revocation can stop the camera adapter immediately.
 */
interface ForegroundAwareFaceProximityEstimator : FaceProximityEstimator {
    fun setForegroundEligible(eligible: Boolean)

    /** True only when the concrete on-device estimator can currently provide a frame. */
    fun isAvailable(): Boolean
}
