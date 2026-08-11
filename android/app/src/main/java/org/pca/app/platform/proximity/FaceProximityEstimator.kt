package org.pca.app.platform.proximity

/**
 * Estimates a single coarse [ProximityReading] from one camera frame's face geometry.
 *
 * No concrete face-detection/face-geometry algorithm is implemented anywhere behind this
 * interface. Selecting and integrating a computer-vision library (e.g. CameraX + ML Kit Face
 * Detection) is a distinct decision that adds a new dependency surface and requires its own
 * privacy/product review -- it is out of scope for this slice, matching this codebase's
 * established pattern of gating concrete algorithm selection behind a reviewed, narrow port
 * (see e.g. PCA-1's crypto interfaces). This interface exists so the surrounding camera SAFETY
 * LIFECYCLE (foreground-only, permission-gated, immediate-stop-on-backgrounding --
 * [CameraProximitySource]) can be built and fully tested now, with a reviewed concrete estimator
 * substituted later without touching any lifecycle logic.
 *
 * A conforming implementation MUST:
 *  - return within this single synchronous call and retain nothing afterward -- no frame, no
 *    landmark set, no face embedding/template may survive past the call that produced [estimate];
 *  - never perform face recognition/identification, emotion or personality inference, age
 *    inference, or biometric-template generation of any kind;
 *  - never upload a frame, embedding, or landmark set to a network destination;
 *  - report only a coarse [ProximityReading] (NEAR/FAR/UNKNOWN) -- never a numeric distance.
 */
fun interface FaceProximityEstimator {
    fun estimate(): ProximityReading
}
