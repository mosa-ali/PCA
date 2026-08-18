package org.pca.app.platform.proximity

/**
 * One camera frame made available only for the current estimation cycle.
 *
 * The platform adapter must implement [close] by releasing the underlying image/buffer. This
 * interface intentionally exposes no pixels, landmarks, identity, or network operation to the
 * proximity feature. The detector receives the frame synchronously and the estimator closes it
 * in a `finally`-equivalent [use] block before returning the coarse result.
 */
interface EphemeralCameraFrame : AutoCloseable

/**
 * Narrow port for a foreground camera adapter. Implementations must keep the camera session
 * running only while [setRunning] is true, return at most one current frame from [nextFrame], and
 * keep all image processing on-device. A null frame is an unavailable/insufficient sample, not a
 * FAR assertion.
 */
interface EphemeralCameraFrameSource {
    fun isAvailable(): Boolean
    fun setRunning(running: Boolean)
    fun nextFrame(): EphemeralCameraFrame?
}

/**
 * The only detector output accepted by the eye-distance source: the largest detected face's
 * bounding-box fraction. It is geometry only and cannot carry a face identity, landmark set,
 * embedding, image, or claimed centimetre distance.
 */
data class ApproximateFaceGeometry(val largestFaceBoundingBoxFraction: Double?) {
    init {
        require(
            largestFaceBoundingBoxFraction == null ||
                (largestFaceBoundingBoxFraction.isFinite() && largestFaceBoundingBoxFraction >= 0.0),
        ) { "largestFaceBoundingBoxFraction must be finite and non-negative when present" }
    }
}

/** A local detector that returns only the bounded geometry required by the classifier. */
fun interface OnDeviceFaceGeometryDetector {
    fun detect(frame: EphemeralCameraFrame): ApproximateFaceGeometry?
}

/**
 * Foreground-only, permission-gated, on-device approximate proximity source.
 *
 * This implementation deliberately does not claim exact distance. It classifies the current
 * frame as [ProximityReading.NEAR], [ProximityReading.FAR], or [ProximityReading.UNKNOWN] using
 * [FaceProximityClassifier]. It never stores a frame and has no network path. The coordinator is
 * responsible for binding a platform camera/frame adapter and calling
 * [CameraProximitySource.setForegroundEligible] from the real foreground/permission lifecycle.
 */
class OnDeviceApproximateFaceProximityEstimator(
    private val frameSource: EphemeralCameraFrameSource,
    private val detector: OnDeviceFaceGeometryDetector,
    private val classifierConfig: FaceProximityClassifierConfig = FaceProximityClassifierConfig(),
) : ForegroundAwareFaceProximityEstimator {

    @Volatile private var foregroundEligible = false

    override fun setForegroundEligible(eligible: Boolean) {
        foregroundEligible = eligible
        frameSource.setRunning(eligible)
    }

    override fun isAvailable(): Boolean = frameSource.isAvailable()

    override fun estimate(): ProximityReading {
        if (!foregroundEligible || !frameSource.isAvailable()) return ProximityReading.UNKNOWN

        val frame = runCatching { frameSource.nextFrame() }.getOrNull() ?: return ProximityReading.UNKNOWN
        return try {
            frame.use {
                val geometry = detector.detect(it)
                FaceProximityClassifier.classify(geometry?.largestFaceBoundingBoxFraction, classifierConfig)
            }
        } catch (_: Exception) {
            // A camera/detector failure is an unknown sample, never a safe or near assertion.
            ProximityReading.UNKNOWN
        }
    }
}
