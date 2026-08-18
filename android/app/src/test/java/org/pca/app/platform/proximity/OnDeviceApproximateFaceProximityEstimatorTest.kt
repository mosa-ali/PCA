package org.pca.app.platform.proximity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OnDeviceApproximateFaceProximityEstimatorTest {

    @Test
    fun `does not request a frame before foreground eligibility`() {
        val frameSource = RecordingFrameSource(geometry = ApproximateFaceGeometry(0.8))
        val estimator = estimator(frameSource)

        assertEquals(ProximityReading.UNKNOWN, estimator.estimate())
        assertEquals(0, frameSource.nextFrameCalls)
        assertFalse(frameSource.runningState)
    }

    @Test
    fun `classifies a large current face geometry as near without numeric distance`() {
        val frameSource = RecordingFrameSource(geometry = ApproximateFaceGeometry(0.5))
        val estimator = estimator(frameSource)
        estimator.setForegroundEligible(true)

        assertEquals(ProximityReading.NEAR, estimator.estimate())
        assertEquals(1, frameSource.nextFrameCalls)
        assertEquals(1, frameSource.lastFrame?.closeCalls)
    }

    @Test
    fun `classifies a small current face geometry as far`() {
        val frameSource = RecordingFrameSource(geometry = ApproximateFaceGeometry(0.05))
        val estimator = estimator(frameSource)
        estimator.setForegroundEligible(true)

        assertEquals(ProximityReading.FAR, estimator.estimate())
        assertEquals(1, frameSource.lastFrame?.closeCalls)
    }

    @Test
    fun `ambiguous geometry and missing frame are unknown rather than punishment`() {
        val frameSource = RecordingFrameSource(geometry = ApproximateFaceGeometry(0.25))
        val estimator = estimator(frameSource)
        estimator.setForegroundEligible(true)

        assertEquals(ProximityReading.UNKNOWN, estimator.estimate())
        frameSource.returnFrame = false
        assertEquals(ProximityReading.UNKNOWN, estimator.estimate())
    }

    @Test
    fun `estimator unavailable is reported without opening a frame`() {
        val frameSource = RecordingFrameSource(geometry = ApproximateFaceGeometry(0.8), available = false)
        val estimator = estimator(frameSource)
        val source = CameraProximitySource(
            estimator = estimator,
            hasCameraPermission = { true },
            monotonicTimeSource = FixedMonotonicTimeSource(),
        )
        source.setForegroundEligible(true)

        val observation = source.currentObservation()

        assertEquals(ProximitySourceAvailability.UNAVAILABLE, observation.availability)
        assertEquals(ProximityReading.UNKNOWN, observation.reading)
        assertEquals(0, frameSource.nextFrameCalls)
    }

    @Test
    fun `detector failure still disposes the current frame and degrades to unknown`() {
        val frameSource = RecordingFrameSource(geometry = ApproximateFaceGeometry(0.8))
        val estimator = OnDeviceApproximateFaceProximityEstimator(
            frameSource = frameSource,
            detector = OnDeviceFaceGeometryDetector { throw IllegalStateException("detector failure") },
        )
        estimator.setForegroundEligible(true)

        assertEquals(ProximityReading.UNKNOWN, estimator.estimate())
        assertEquals(1, frameSource.lastFrame?.closeCalls)
    }

    @Test
    fun `background transition stops the frame source`() {
        val frameSource = RecordingFrameSource(geometry = ApproximateFaceGeometry(0.8))
        val estimator = estimator(frameSource)

        estimator.setForegroundEligible(true)
        assertTrue(frameSource.runningState)
        estimator.setForegroundEligible(false)

        assertFalse(frameSource.runningState)
        assertEquals(ProximityReading.UNKNOWN, estimator.estimate())
        assertEquals(0, frameSource.nextFrameCalls)
    }

    private fun estimator(frameSource: RecordingFrameSource) =
        OnDeviceApproximateFaceProximityEstimator(
            frameSource = frameSource,
            detector = OnDeviceFaceGeometryDetector { frameSource.geometry },
        )

    private class RecordingFrameSource(
        val geometry: ApproximateFaceGeometry?,
        private val available: Boolean = true,
    ) : EphemeralCameraFrameSource {
        var runningState = false
        var returnFrame = true
        var nextFrameCalls = 0
        var lastFrame: RecordingFrame? = null

        override fun isAvailable(): Boolean = available

        override fun setRunning(running: Boolean) {
            runningState = running
        }

        override fun nextFrame(): EphemeralCameraFrame? {
            nextFrameCalls++
            if (!returnFrame) return null
            return RecordingFrame().also { lastFrame = it }
        }
    }

    private class RecordingFrame : EphemeralCameraFrame {
        var closeCalls = 0

        override fun close() {
            closeCalls++
        }
    }

    private class FixedMonotonicTimeSource : org.pca.app.foundation.MonotonicTimeSource {
        override fun elapsedRealtimeMillis(): Long = 0L
        override fun elapsedRealtimeNanos(): Long = 0L
    }
}
