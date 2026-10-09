package org.pca.app.platform.proximity

import android.graphics.Bitmap
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * PCA-FR-024 ("no retained frame buffer beyond the current estimation cycle") -- direct unit-test
 * coverage of [SingleSlotFrameBuffer], the primitive [CameraXFrameSource] uses to enforce that
 * guarantee. Deliberately does not attempt to exercise CameraX's own camera-binding path (that
 * requires a real device/emulator camera stack, out of reach for a JVM/Robolectric unit test) --
 * this proves the retention/recycling discipline the analyzer callback relies on, independent of
 * CameraX itself.
 */
@RunWith(RobolectricTestRunner::class)
class CameraXFrameSourceTest {

    private fun newFrame(): AndroidBitmapCameraFrame =
        AndroidBitmapCameraFrame(Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888))

    @Test
    fun `a frame that is never taken is closed when replaced by the next publish`() {
        val buffer = SingleSlotFrameBuffer()
        buffer.setAccepting(true)
        val generation = requireNotNull(buffer.admissionToken())
        val first = newFrame()
        val firstBitmap = first.withBitmap { it }

        buffer.publishIfAccepting(first, generation)
        buffer.publishIfAccepting(newFrame(), generation)

        assertTrue("an unconsumed frame must be recycled once replaced", firstBitmap.isRecycled)
    }

    @Test
    fun `take returns the published frame exactly once, then null until the next publish`() {
        val buffer = SingleSlotFrameBuffer()
        buffer.setAccepting(true)
        val generation = requireNotNull(buffer.admissionToken())
        val frame = newFrame()

        buffer.publishIfAccepting(frame, generation)

        assertTrue(buffer.take() === frame)
        assertNull(buffer.take())
    }

    @Test
    fun `clear discards and closes whatever is currently buffered`() {
        val buffer = SingleSlotFrameBuffer()
        buffer.setAccepting(true)
        val generation = requireNotNull(buffer.admissionToken())
        val frame = newFrame()
        val bitmap = frame.withBitmap { it }
        buffer.publishIfAccepting(frame, generation)

        buffer.clear()

        assertTrue(bitmap.isRecycled)
        assertNull(buffer.take())
    }

    @Test
    fun `a consumed frame is never closed by a later publish or clear -- no double free`() {
        val buffer = SingleSlotFrameBuffer()
        buffer.setAccepting(true)
        val generation = requireNotNull(buffer.admissionToken())
        val frame = newFrame()
        val bitmap = frame.withBitmap { it }
        buffer.publishIfAccepting(frame, generation)

        val taken = buffer.take()
        assertTrue(taken === frame)
        assertTrue("consuming must not itself recycle the frame -- the caller owns it now", !bitmap.isRecycled)

        // Closing it here (as the real estimator does via frame.use { }) must be the only closer.
        taken?.close()
        assertTrue(bitmap.isRecycled)

        // Nothing left buffered, so clear() must not attempt to touch the already-closed frame.
        buffer.clear()
    }

    @Test
    fun `stop clears admitted frame and permanently invalidates the prior session token`() {
        val buffer = SingleSlotFrameBuffer()
        buffer.setAccepting(true)
        val priorGeneration = requireNotNull(buffer.admissionToken())
        buffer.setAccepting(true)
        assertTrue("repeated active checks must not invalidate the current session", buffer.admissionToken() == priorGeneration)
        val prior = newFrame()
        val priorBitmap = prior.withBitmap { it }
        assertTrue(buffer.publishIfAccepting(prior, priorGeneration))

        buffer.setAccepting(false)

        assertTrue("stop must synchronously recycle any buffered frame", priorBitmap.isRecycled)
        assertNull(buffer.take())
        assertNull(buffer.admissionToken())

        buffer.setAccepting(true)
        val currentGeneration = requireNotNull(buffer.admissionToken())
        val late = newFrame()
        val lateBitmap = late.withBitmap { it }
        assertTrue("a callback from the prior session must be rejected after restart", !buffer.publishIfAccepting(late, priorGeneration))
        assertTrue(lateBitmap.isRecycled)
        assertNull(buffer.take())

        val current = newFrame()
        assertTrue(buffer.publishIfAccepting(current, currentGeneration))
        assertTrue(buffer.take() === current)
    }
}
