package org.pca.app.firstdevice

import java.io.InputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FirstDeviceErrorResponseDrainTest {
    private class ErrorStream(private val availableBytes: Int, private val forbiddenProbe: Boolean) : InputStream() {
        var consumed = 0
        var closed = false
        override fun read(): Int = error("bulk read required")
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (consumed == availableBytes) {
                check(!forbiddenProbe) { "read beyond response bound would block" }
                return -1
            }
            val count = minOf(length, availableBytes - consumed)
            consumed += count
            return count
        }
        override fun close() { closed = true }
    }

    @Test fun `oversized or endless error stream is closed without reading beyond the bound`() {
        val stream = ErrorStream(8 * 1024, forbiddenProbe = true)
        discardBootstrapErrorResponse(stream, 8 * 1024)
        assertEquals(8 * 1024, stream.consumed)
        assertTrue(stream.closed)
    }

    @Test fun `short error stream reaches EOF and is closed`() {
        val stream = ErrorStream(97, forbiddenProbe = false)
        discardBootstrapErrorResponse(stream, 8 * 1024)
        assertEquals(97, stream.consumed)
        assertTrue(stream.closed)
    }

    @Test fun `non-progressing error stream cannot loop indefinitely`() {
        var reads = 0
        var closed = false
        val stream = object : InputStream() {
            override fun read(): Int = error("bulk read required")
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int { reads++; return 0 }
            override fun close() { closed = true }
        }
        discardBootstrapErrorResponse(stream, 8 * 1024)
        assertEquals(1, reads)
        assertTrue(closed)
    }
}
