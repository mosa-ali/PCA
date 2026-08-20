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
        val first = newFrame()
        val firstBitmap = first.withBitmap { it }

        buffer.publish(first)
        buffer.publish(newFrame())

        assertTrue("an unconsumed frame must be recycled once replaced", firstBitmap.isRecycled)
    }

    @Test
    fun `take returns the published frame exactly once, then null until the next publish`() {
        val buffer = SingleSlotFrameBuffer()
        val frame = newFrame()

        buffer.publish(frame)

        assertTrue(buffer.take() === frame)
        assertNull(buffer.take())
    }

    @Test
    fun `clear discards and closes whatever is currently buffered`() {
        val buffer = SingleSlotFrameBuffer()
        val frame = newFrame()
        val bitmap = frame.withBitmap { it }
        buffer.publish(frame)

        buffer.clear()

        assertTrue(bitmap.isRecycled)
        assertNull(buffer.take())
    }

    @Test
    fun `a consumed frame is never closed by a later publish or clear -- no double free`() {
        val buffer = SingleSlotFrameBuffer()
        val frame = newFrame()
        val bitmap = frame.withBitmap { it }
        buffer.publish(frame)

        val taken = buffer.take()
        assertTrue(taken === frame)
        assertTrue("consuming must not itself recycle the frame -- the caller owns it now", !bitmap.isRecycled)

        // Closing it here (as the real estimator does via frame.use { }) must be the only closer.
        taken?.close()
        assertTrue(bitmap.isRecycled)

        // Nothing left buffered, so clear() must not attempt to touch the already-closed frame.
        buffer.clear()
    }
}
