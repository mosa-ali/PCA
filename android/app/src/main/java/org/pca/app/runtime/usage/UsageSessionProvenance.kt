package org.pca.app.runtime.usage

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.util.Base64
import org.pca.app.platform.UsageClockBridge
import org.pca.app.platform.UsageClockSample

/** Local sampled continuity only: neither complete history nor authoritative quota usage.
 * Closing samples do not reconstruct the opening event's original query bridge. */
data class UsageSessionProvenance(
    val observationGeneration: String,
    val bootId: String,
    val startedAtElapsedMillis: Long,
    val endedAtElapsedMillis: Long,
    val generationAnchor: UsageClockSample,
    val closingQueryBefore: UsageClockSample,
    val closingQueryAfter: UsageClockSample,
) {
    override fun toString(): String = "UsageSessionProvenance([REDACTED])"

    internal fun validate(durationMillis: Long) {
        require(observationGeneration.isNotBlank() && observationGeneration.length <= 128)
        require(bootId.isNotBlank() && bootId.length <= 256)
        require(startedAtElapsedMillis >= generationAnchor.elapsedMillis && endedAtElapsedMillis >= startedAtElapsedMillis)
        require(endedAtElapsedMillis - startedAtElapsedMillis == durationMillis)
        require(endedAtElapsedMillis <= closingQueryBefore.elapsedMillis)
        require(UsageClockBridge.continuous(generationAnchor, closingQueryBefore))
        require(UsageClockBridge.continuous(generationAnchor, closingQueryAfter))
        require(UsageClockBridge.continuous(closingQueryBefore, closingQueryAfter))
    }
}

/** Bound inside authenticated ciphertext because LocalRecordCipher has no row AAD API. */
internal data class UsageProvenanceBinding(
    val id: String, val deviceId: String, val token: String,
    val start: Long, val end: Long, val duration: Long,
) {
    override fun toString() = "UsageProvenanceBinding([REDACTED])"
}

internal object UsageSessionProvenanceCodec {
    private const val MAX_BYTES = 8_192

    private fun validateBinding(binding: UsageProvenanceBinding, value: UsageSessionProvenance) {
        require(binding.start >= 0 && binding.end >= 0)
        value.validate(binding.duration)
        require(UsageClockBridge.elapsedAtWall(binding.end, value.closingQueryBefore) == value.endedAtElapsedMillis)
    }

    fun encode(binding: UsageProvenanceBinding, value: UsageSessionProvenance): String {
        validateBinding(binding, value)
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { out ->
            out.writeInt(1)
            for (field in listOf(binding.id, binding.deviceId, binding.token,
                value.observationGeneration, value.bootId)) {
                require(field.isNotBlank() && field.length <= 512)
                out.writeUTF(field)
            }
            for (number in listOf(binding.start, binding.end, binding.duration,
                value.startedAtElapsedMillis, value.endedAtElapsedMillis,
                value.generationAnchor.elapsedMillis, value.generationAnchor.wallMillis,
                value.closingQueryBefore.elapsedMillis, value.closingQueryBefore.wallMillis,
                value.closingQueryAfter.elapsedMillis, value.closingQueryAfter.wallMillis)) out.writeLong(number)
        }
        require(bytes.size() <= MAX_BYTES)
        return Base64.getEncoder().encodeToString(bytes.toByteArray())
    }

    fun decode(binding: UsageProvenanceBinding, encoded: String): UsageSessionProvenance {
        require(encoded.length <= 4 * ((MAX_BYTES + 2) / 3))
        val bytes = Base64.getDecoder().decode(encoded)
        require(bytes.size <= MAX_BYTES)
        return DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            require(input.readInt() == 1)
            val id = input.readUTF(); val device = input.readUTF(); val token = input.readUTF()
            val generation = input.readUTF(); val boot = input.readUTF()
            val start = input.readLong(); val end = input.readLong(); val duration = input.readLong()
            require(UsageProvenanceBinding(id, device, token, start, end, duration) == binding)
            val value = UsageSessionProvenance(generation, boot, input.readLong(), input.readLong(),
                UsageClockSample(input.readLong(), input.readLong()),
                UsageClockSample(input.readLong(), input.readLong()),
                UsageClockSample(input.readLong(), input.readLong()))
            require(input.available() == 0)
            validateBinding(binding, value)
            require(encode(binding, value) == encoded)
            value
        }
    }
}
