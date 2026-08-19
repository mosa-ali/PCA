package org.pca.app.platform.proximity

import android.graphics.Bitmap
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AndroidFaceGeometryDetectorTest {

    @Test
    fun `unsupported frame type is unknown geometry and is not inspected as an image`() {
        val frame = RecordingFrame()

        assertNull(AndroidFaceGeometryDetector().detect(frame))
        assertFalse(frame.closed)
    }

    @Test
    fun `bitmap frame is recycled after detector use and detector failure stays bounded`() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        assertTrue(context != null)
        val bitmap = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888)
        val frame = AndroidBitmapCameraFrame(bitmap)
        val estimator = OnDeviceApproximateFaceProximityEstimator(
            frameSource = SingleFrameSource(frame),
            detector = AndroidFaceGeometryDetector(),
        )
        estimator.setForegroundEligible(true)

        // A blank synthetic frame cannot establish a face; a platform detector failure is an
        // UNKNOWN sample, never FAR/NEAR. The estimator still owns and closes the frame.
        assertEquals(ProximityReading.UNKNOWN, estimator.estimate())
        assertTrue(bitmap.isRecycled)
    }

    private class RecordingFrame : EphemeralCameraFrame {
        var closed = false

        override fun close() {
            closed = true
        }
    }

    private class SingleFrameSource(private val frame: EphemeralCameraFrame) : EphemeralCameraFrameSource {
        private var running = false
        private var returned = false

        override fun isAvailable(): Boolean = running

        override fun setRunning(running: Boolean) {
            this.running = running
        }

        override fun nextFrame(): EphemeralCameraFrame? = if (running && !returned) {
            returned = true
            frame
        } else {
            null
        }
    }
}
