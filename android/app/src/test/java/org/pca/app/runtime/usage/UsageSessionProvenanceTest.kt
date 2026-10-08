package org.pca.app.runtime.usage

import org.junit.Assert.*
import org.junit.Test
import org.pca.app.platform.UsageClockSample

class UsageSessionProvenanceTest {
    private val binding = UsageProvenanceBinding("session", "device", "token", 10100, 10200, 100)
    private val value = UsageSessionProvenance("generation", "boot", 100, 200,
        UsageClockSample(0, 10000), UsageClockSample(400, 10400), UsageClockSample(410, 10410))

    @Test fun roundTripIsBoundAndRedacted() {
        val encoded = UsageSessionProvenanceCodec.encode(binding, value)
        assertEquals(value, UsageSessionProvenanceCodec.decode(binding, encoded))
        assertFalse(value.toString().contains("generation"))
        for (other in listOf(binding.copy(id = "other"), binding.copy(deviceId = "other"),
            binding.copy(token = "other"), binding.copy(start = 10101), binding.copy(end = 10201),
            binding.copy(duration = 101))) {
            assertThrows(IllegalArgumentException::class.java) { UsageSessionProvenanceCodec.decode(other, encoded) }
        }
    }
    @Test fun invalidContinuityAndDurationAreRejected() {
        for (bad in listOf(value.copy(startedAtElapsedMillis = -1),
            value.copy(generationAnchor = UsageClockSample(150, 10150)),
            value.copy(endedAtElapsedMillis = 201), value.copy(bootId = ""),
            value.copy(closingQueryAfter = UsageClockSample(410, 15000)),
            value.copy(closingQueryBefore = UsageClockSample(199, 10199)))) {
            assertThrows(IllegalArgumentException::class.java) { UsageSessionProvenanceCodec.encode(binding, bad) }
        }
    }
    @Test fun malformedAndOversizedEncodingsAreRejected() {
        assertThrows(IllegalArgumentException::class.java) { UsageSessionProvenanceCodec.decode(binding, "!") }
        assertThrows(IllegalArgumentException::class.java) { UsageSessionProvenanceCodec.decode(binding, "A".repeat(12000)) }
        val encoded = UsageSessionProvenanceCodec.encode(binding, value)
        val bytes = java.util.Base64.getDecoder().decode(encoded)
        bytes[3] = 2
        assertThrows(IllegalArgumentException::class.java) { UsageSessionProvenanceCodec.decode(binding, java.util.Base64.getEncoder().encodeToString(bytes)) }
        var rejected = false
        try { UsageSessionProvenanceCodec.decode(binding, java.util.Base64.getEncoder().encodeToString(bytes.copyOf(20))) }
        catch (_: Exception) { rejected = true }
        assertTrue(rejected)
        assertThrows(IllegalArgumentException::class.java) { UsageSessionProvenanceCodec.decode(binding, encoded + "AAAA") }
    }
}
