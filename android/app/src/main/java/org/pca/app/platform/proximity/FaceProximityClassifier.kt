package org.pca.app.platform.proximity

/**
 * PCA-FR-023/024 investigation outcome (see the mission report for the full writeup): this is the
 * pure, camera-independent JUDGMENT core a real [FaceProximityEstimator] would need -- converting a
 * detected face's bounding-box size (as a fraction of the camera frame) into a coarse
 * [ProximityReading]. It takes ONLY plain numbers, never an image, a landmark set, or any
 * ML-Kit-specific type, so it can be fully unit-tested without a camera, a device, or an emulator,
 * and reused verbatim by whichever concrete camera pipeline eventually backs it.
 *
 * WHY THIS EXISTS BUT [FaceProximityEstimator] STILL HAS NO CONCRETE IMPLEMENTATION: a real
 * face-DETECTION library (ML Kit Face Detection, on-device, no frame retained by the library
 * itself) is confirmed available and resolvable from this project's configured Maven repositories.
 * The blocker is not the detector -- it is safely OWNING A CAMERA SESSION's lifecycle. Every
 * concrete camera source in this file ([HardwareProximitySource]) is either a passive
 * platform-managed sensor listener or (per [CameraProximitySource]'s own doc) driven by a
 * synchronous, stateless, no-session `estimate()` call. A real camera-backed implementation needs
 * to OPEN a camera session while foreground-eligible and GUARANTEE it is closed the instant
 * eligibility ends -- but [CameraProximitySource] only tells an estimator whether to answer
 * `estimate()`, it has no hook to tell a stateful estimator to open/close a session. Wiring a real
 * camera underneath the current interface would mean either (a) a session that opens lazily on
 * first `estimate()` with no code-enforced close path when foreground-eligibility flips false
 * (exactly the kind of "enforced only by documentation, not by code" gap this codebase's sibling
 * classes -- see [CameraProximitySource]'s own doc -- explicitly refuse to ship), or (b) extending
 * the [FaceProximityEstimator]/[CameraProximitySource] contract with explicit session lifecycle
 * hooks, which is exactly the kind of interface change this feature's own original doc comment
 * flags as needing its own dedicated review, plus real on-device camera-open/frame/camera-close
 * verification this sandboxed environment has no camera hardware or emulator to perform. Shipping
 * that unverified for a child-facing camera feature is the "any doubt, stop and report" case this
 * mission explicitly calls out -- so only this safe, fully-verifiable half is built now.
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
