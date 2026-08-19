package org.pca.app.platform.proximity

/**
 * PCA-FR-023/024 investigation outcome (see the mission report for the full writeup): this is the
 * pure, camera-independent JUDGMENT core a real [FaceProximityEstimator] would need -- converting a
 * detected face's bounding-box size (as a fraction of the camera frame) into a coarse
 * [ProximityReading]. It takes ONLY plain numbers, never an image, a landmark set, or any
 * ML-Kit-specific type, so it can be fully unit-tested without a camera, a device, or an emulator,
 * and reused verbatim by whichever concrete camera pipeline eventually backs it.
 *
 * A concrete estimator and an Android on-device detector now exist in
 * [OnDeviceApproximateFaceProximityEstimator] and [AndroidFaceGeometryDetector]. The remaining
 * boundary is deliberately narrower: a coordinator must supply a real foreground camera-session
 * adapter that creates [AndroidBitmapCameraFrame] values, honors permission and lifecycle
 * transitions, and closes the session immediately when eligibility ends. This package does not
 * invent a camera session, background capture path, or external ML dependency. Until that adapter
 * is bound and verified on a supported device, the camera capability remains unavailable and the
 * hardware sensor remains the only production source in the current graph.
 */
object FaceProximityClassifier {

    /**
     * @param largestFaceBoundingBoxFraction The largest detected face's bounding box, expressed as
     * the fraction (0.0-1.0, occasionally slightly over 1.0 for an extreme close-up) of the camera
     * frame's shorter/height dimension the box occupies -- a bigger fraction means the face fills
     * more of the frame, i.e. is physically closer to the camera. `null` means no face was detected
     * at all in this frame (never treated as [ProximityReading.FAR] -- "no face seen" is not the
     * same claim as "face confirmed far away"; it is [ProximityReading.UNKNOWN], matching this
     * codebase's "never fabricate a reading the source cannot actually back" discipline).
     */
    fun classify(
        largestFaceBoundingBoxFraction: Double?,
        config: FaceProximityClassifierConfig = FaceProximityClassifierConfig(),
    ): ProximityReading {
        if (largestFaceBoundingBoxFraction == null) return ProximityReading.UNKNOWN
        require(largestFaceBoundingBoxFraction.isFinite() && largestFaceBoundingBoxFraction >= 0.0) {
            "largestFaceBoundingBoxFraction must be finite and non-negative"
        }
        return when {
            largestFaceBoundingBoxFraction >= config.nearFractionThreshold -> ProximityReading.NEAR
            largestFaceBoundingBoxFraction <= config.farFractionThreshold -> ProximityReading.FAR
            // Between the two thresholds: genuinely ambiguous -- doc 13's "unknown/insufficient
            // confidence -> do not punish" rule applies here exactly as it does for a degraded
            // sensor, not only for a missing one.
            else -> ProximityReading.UNKNOWN
        }
    }
}

/**
 * Product-safe default thresholds: a face occupying at least 35% of the frame's height reads as
 * NEAR (roughly a face held within normal too-close reading/phone distance for most front cameras'
 * field of view), at most 15% reads as FAR (roughly arm's length or more). The band between the two
 * is deliberately wide and reads as UNKNOWN rather than guessing a side, matching
 * [org.pca.app.feature.eyedistance.engine.EyeDistanceEngine]'s false-positive-resistant design.
 * Final tuned values remain release-validated against real devices/cameras, not hardcoded product
 * policy, exactly like `EyeDistanceConfig`.
 */
data class FaceProximityClassifierConfig(
    val nearFractionThreshold: Double = 0.35,
    val farFractionThreshold: Double = 0.15,
) {
    init {
        require(nearFractionThreshold in 0.0..2.0) { "nearFractionThreshold out of plausible range" }
        require(farFractionThreshold in 0.0..2.0) { "farFractionThreshold out of plausible range" }
        require(farFractionThreshold < nearFractionThreshold) {
            "farFractionThreshold must be strictly less than nearFractionThreshold"
        }
    }
}
