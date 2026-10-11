package org.pca.app.runtime.usage

import org.junit.Assert.*
import org.junit.Test
import org.pca.app.platform.UsageClockSample
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.util.Base64

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

    @Test fun rowStartMustMatchSampledStartWithinSharedClockTolerance() {
        val mismatched = binding.copy(start = binding.start + 1_001)
        assertThrows(IllegalArgumentException::class.java) {
            UsageSessionProvenanceCodec.encode(mismatched, value)
        }
        assertThrows(IllegalArgumentException::class.java) {
            UsageSessionProvenanceCodec.decode(mismatched, uncheckedEncoding(mismatched, value))
        }

        // A maximum tolerated +1,000 ms sampled drift remains valid, using the shared
        // UsageClockBridge detector rather than a provenance-specific threshold.
        val positiveBoundary = UsageProvenanceBinding("session", "device", "token", 11100, 11200, 100)
        val positiveValue = value.copy(
            closingQueryBefore = UsageClockSample(500, 11500),
            closingQueryAfter = UsageClockSample(510, 11510),
        )
        assertEquals(positiveValue, UsageSessionProvenanceCodec.decode(
            positiveBoundary,
            UsageSessionProvenanceCodec.encode(positiveBoundary, positiveValue),
        ))

        // The negative tolerance boundary is also accepted. One millisecond beyond either
        // boundary is rejected even when the rest of the provenance remains internally valid.
        val negativeBoundary = UsageProvenanceBinding("session", "device", "token", 9100, 9200, 100)
        val negativeValue = value.copy(
            closingQueryBefore = UsageClockSample(500, 9500),
            closingQueryAfter = UsageClockSample(510, 9510),
        )
        assertEquals(negativeValue, UsageSessionProvenanceCodec.decode(
            negativeBoundary,
            UsageSessionProvenanceCodec.encode(negativeBoundary, negativeValue),
        ))
        for ((outsideBinding, outsideValue) in listOf(
            positiveBoundary.copy(start = 11101) to positiveValue,
            negativeBoundary.copy(start = 9099) to negativeValue,
        )) {
            assertThrows(IllegalArgumentException::class.java) {
                UsageSessionProvenanceCodec.encode(outsideBinding, outsideValue)
            }
        }
    }

    private fun uncheckedEncoding(binding: UsageProvenanceBinding, value: UsageSessionProvenance): String {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { out ->
            out.writeInt(1)
            for (field in listOf(binding.id, binding.deviceId, binding.token,
                value.observationGeneration, value.bootId)) out.writeUTF(field)
            for (number in listOf(binding.start, binding.end, binding.duration,
                value.startedAtElapsedMillis, value.endedAtElapsedMillis,
                value.generationAnchor.elapsedMillis, value.generationAnchor.wallMillis,
                value.closingQueryBefore.elapsedMillis, value.closingQueryBefore.wallMillis,
                value.closingQueryAfter.elapsedMillis, value.closingQueryAfter.wallMillis)) out.writeLong(number)
        }
        return Base64.getEncoder().encodeToString(bytes.toByteArray())
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
