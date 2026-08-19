package org.pca.app.platform.proximity

import android.graphics.Bitmap
import android.media.FaceDetector

/**
 * An owned, in-memory Android frame wrapper for the optional camera tier.
 *
 * The frame is intentionally not a general image container: the only operation exposed to the
 * detector is a synchronous callback, and [close] recycles the bitmap exactly once. A camera
 * adapter must create one wrapper for one current frame and must not retain it after the estimator
 * returns. This class does not open a camera, schedule capture, persist a bitmap, or perform any
 * network operation.
 */
class AndroidBitmapCameraFrame(
    private val bitmap: Bitmap,
) : EphemeralCameraFrame {
    private val lock = Any()
    private var closed = false

    internal fun <T> withBitmap(block: (Bitmap) -> T): T = synchronized(lock) {
        check(!closed) { "camera frame has already been closed" }
        block(bitmap)
    }

    override fun close() {
        synchronized(lock) {
            if (closed) return
            closed = true
            if (!bitmap.isRecycled) bitmap.recycle()
        }
    }
}

/**
 * Android's platform face detector, reduced to the one geometry value accepted by PCA's
 * proximity classifier.
 *
 * [FaceDetector] exposes eye spacing rather than a face bounding box. We therefore derive a
 * deliberately coarse face-scale fraction from that spacing. This is a near/far heuristic only;
 * it is not a centimetre estimate, a calibration claim, a recognition result, or a biometric
 * template. The detector is useful only when a coordinator supplies a foreground, permission-
 * gated [AndroidBitmapCameraFrame] source. It is not itself a camera-session owner.
 */
class AndroidFaceGeometryDetector(
    private val maxFaces: Int = 1,
    private val estimatedFaceHeightFromEyeDistance: Double = 2.2,
) : OnDeviceFaceGeometryDetector {

    init {
        require(maxFaces in 1..64) { "maxFaces must be between 1 and 64" }
        require(estimatedFaceHeightFromEyeDistance.isFinite() && estimatedFaceHeightFromEyeDistance > 0.0) {
            "estimatedFaceHeightFromEyeDistance must be finite and positive"
        }
    }

    override fun detect(frame: EphemeralCameraFrame): ApproximateFaceGeometry? {
        val bitmapFrame = frame as? AndroidBitmapCameraFrame ?: return null
        return bitmapFrame.withBitmap(::detectBitmap)
    }

    @Suppress("DEPRECATION")
    private fun detectBitmap(bitmap: Bitmap): ApproximateFaceGeometry? {
        if (bitmap.isRecycled || bitmap.width <= 0 || bitmap.height <= 0) return null

        // The legacy detector requires RGB_565. Any conversion is strictly scoped to this call
        // and the temporary copy is recycled before the detector returns.
        val detectorBitmap = if (bitmap.config == Bitmap.Config.RGB_565) {
            bitmap
        } else {
            bitmap.copy(Bitmap.Config.RGB_565, false) ?: return null
        }

        return try {
            val faces = arrayOfNulls<FaceDetector.Face>(maxFaces)
            val faceCount = FaceDetector(detectorBitmap.width, detectorBitmap.height, maxFaces)
                .findFaces(detectorBitmap, faces)
            val largestFace = faces
                .take(faceCount.coerceIn(0, faces.size))
                .filterNotNull()
                .maxByOrNull { it.eyesDistance().toDouble() }
                ?: return null
            val eyeDistance = largestFace.eyesDistance().toDouble()
            if (!eyeDistance.isFinite() || eyeDistance <= 0.0) return null

            ApproximateFaceGeometry(
                largestFaceBoundingBoxFraction =
                    (eyeDistance * estimatedFaceHeightFromEyeDistance / detectorBitmap.height)
                        .coerceIn(0.0, 2.0),
            )
        } finally {
            if (detectorBitmap !== bitmap && !detectorBitmap.isRecycled) detectorBitmap.recycle()
        }
    }
}
